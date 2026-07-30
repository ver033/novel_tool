import type {
  AiChatAgentGenerationInput,
  AiChatGenerationInput,
  AiChatGenerator,
  AiChatHistoryMemorySummaryInput,
  AiChatMessageResult,
  AiChatStreamHandlers,
  AiGenerationOptions
} from "./ai-task-service";
import {
  buildArcIndexSummaryMessages,
  buildBookIndexSummaryMessages,
  buildChapterChunkIndexSummaryMessages,
  buildChapterChunkMergeSummaryMessages,
  buildChapterIndexSummaryMessages,
  buildContinuityCheckMessages,
  type ArcIndexSummaryInput,
  type BookIndexSummaryInput,
  type ChapterChunkIndexSummaryInput,
  type ChapterChunkMergeSummaryInput,
  type ChapterIndexSummaryInput,
  type ContinuityCheckInput
} from "./summary-prompts";
import { runChatAgentLoop, type ChatAgentModel } from "./chat-agent-harness";
import type { NovelAgentRuntimeHandlers } from "./agent-runtime/novel-agent-runtime";
import { buildChatAgentMemoryText } from "./chat-agent-memory";
import type {
  ChatAgentContext,
  ChatChapterSummaryInput,
  ChatContextBatchChapterInput,
  ChatContextBatchSummaryInput,
  ChatContextSummaryItem,
  ChatContextSummaryMergeInput
} from "./chat-agent-types";
import { logDevLlmPrompt } from "./dev-prompt-logger";
import type { OpenRouterChatCompletionResult, OpenRouterMessage } from "./openrouter-client";
import { OpenRouterClient } from "./openrouter-client";
import { compactOpenRouterInput } from "./openrouter-input-compactor";
import { buildReasoningConfig } from "./reasoning-budget";
import {
  arcAiSummaryPayloadSchema,
  bookAiSummaryPayloadSchema,
  chapterAiSummaryChunkPayloadSchema,
  chapterAiSummaryPayloadSchema,
  continuityCheckResultSchema,
  type ArcAiSummaryPayload,
  type BookAiSummaryPayload,
  type ChapterAiSummaryChunkPayload,
  type ChapterAiSummaryPayload,
  type ContinuityCheckResult
} from "../shared/summary-index";
import { getTokenBudget, type TokenBudget } from "./token-budget";
import { estimateMessagesTokens, estimateTextTokens, truncateTextToTokenBudget } from "./token-estimator";
import type { SettingsService } from "../settings/settings-service";
import type { z } from "zod";

function hasAgentContext(input: AiChatGenerationInput): input is AiChatGenerationInput & { readonly agentContext: ChatAgentContext } {
  return "agentContext" in input && Boolean(input.agentContext);
}

const CHAPTER_SUMMARY_MAX_TOKENS = 1800;
const CHAPTER_SUMMARY_MERGE_MAX_TOKENS = 2200;
const CONTEXT_BATCH_SUMMARY_MAX_TOKENS = 3200;
const CONTEXT_SUMMARY_MERGE_MAX_TOKENS = 3200;
const CHAT_MEMORY_SUMMARY_MAX_TOKENS = 2200;
const SUMMARY_INDEX_MAX_TOKENS = 24_000;
const CHAT_MEMORY_SUMMARY_PROMPT_RATIO = 0.75;
const CHAT_MEMORY_SUMMARY_RECOMPRESS_MAX_ROUNDS = 2;

function capInternalMaxCompletionTokens(requestedTokens: number, budget: TokenBudget): number {
  return Math.max(1, Math.min(requestedTokens, budget.maxOutputTokens));
}

function formatAgentContextSource(mode: ChatAgentContext["mode"]): string {
  if (mode === "summarized") {
    return "分章摘要";
  }
  if (mode === "mixed") {
    return "部分原文，部分摘要";
  }
  return "项目数据库原文";
}

function buildUserPrompt(input: AiChatGenerationInput): string {
  if (hasAgentContext(input)) {
    return [
      "用户问题：",
      input.message,
      `\n上下文范围：${input.agentContext.scopeLabel}`,
      `\n上下文来源：${formatAgentContextSource(input.agentContext.mode)}`,
      "\n上下文内容：",
      input.agentContext.contextText,
      input.selectionText ? `\n用户当前选中文本：\n${input.selectionText}` : ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "用户问题：",
    input.message,
    input.currentChapterTitle ? `\n当前章节：${input.currentChapterTitle}` : "",
    input.selectionText ? `\n选中文本：\n${input.selectionText}` : "",
    input.chapterExcerpt ? `\n当前章节节选：\n${input.chapterExcerpt}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSystemPrompt(): string {
  return [
    "你是中文小说写作助手。",
    "你可以讨论润色、扩写、校对、续写、节奏、人物动机和场景处理。",
    "用户要求总结并加入草稿纸时，直接给出可保存的总结正文；系统会负责保存动作。",
    "如果系统提供了“上下文范围”和“上下文内容”，必须以这些内容为准；不要声称用户没有提供对应章节。",
    "当上下文范围是全部章节或章节范围时，要综合所有给出的章节，不要只回答当前章节。",
    "不要直接替用户确认写回正文；涉及正文修改时给出建议或候选文本。",
    "保持回答简洁、具体、可执行。"
  ].join("\n");
}

function buildHistoryMessages(input: AiChatGenerationInput, chatBudget: TokenBudget): OpenRouterMessage[] {
  const memory = buildChatAgentMemoryText({
    history: input.history,
    tokenBudget: chatBudget,
    compactedSummary: input.compactedMemorySummary,
    compactedThroughMessageId: input.compactedMemoryThroughMessageId
  });
  if (memory === "（无）") {
    return [];
  }
  return [
    {
      role: "user",
      content: `对话记忆：\n${memory}`
    }
  ];
}

function stripJsonCodeFence(content: string): string {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

type SummarySchemaIssue = {
  readonly path?: readonly PropertyKey[];
  readonly code?: string;
  readonly message?: string;
  readonly keys?: readonly string[];
};

function formatSummarySchemaPath(path: readonly PropertyKey[] | undefined): string {
  if (!path?.length) {
    return "根对象";
  }
  return path.map((part) => String(part)).join(".");
}

function describeSummarySchemaIssue(issue: SummarySchemaIssue): string {
  const path = formatSummarySchemaPath(issue.path);
  if (issue.path?.some((part) => String(part) === "缓存版本")) {
    return `缓存版本错误：${path} 不符合当前章节缓存模板。完整章节缓存必须使用“三-Lite”；“二-Lite”只用于长章节片段缓存。`;
  }
  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys?.length ? `（${issue.keys.join("、")}）` : "";
    return `包含旧版或多余字段：${path}${keys}。`;
  }
  if (issue.code === "invalid_type") {
    return `字段类型错误：${path} 的类型不符合模板要求。`;
  }
  if (issue.code === "too_small") {
    return `必要字段为空或项目不足：${path}。`;
  }
  if (issue.code === "invalid_value") {
    return `字段取值错误：${path} 的取值不在允许范围内。`;
  }
  return `${path}：${issue.message ?? "不符合模板要求"}`;
}

function formatSummarySchemaError(label: string, issues: readonly SummarySchemaIssue[]): string {
  const shownIssues = issues.slice(0, 8).map((issue) => `- ${describeSummarySchemaIssue(issue)}`).join("\n");
  const extraCount = Math.max(0, issues.length - 8);
  const extraText = extraCount > 0 ? `\n- 另有 ${extraCount} 个结构问题未展开。` : "";
  return [
    `${label}无效：模型返回的 JSON 结构不符合章节缓存模板。`,
    shownIssues,
    extraText,
    "这通常是模型没有严格按章节缓存模板输出，不是章节正文内容问题；此类结构错误不会自动反复重试。建议换用更稳定的模型，或手动重试本章。"
  ]
    .filter(Boolean)
    .join("\n");
}

function parseSummaryIndexJson<T>(label: string, content: string, schema: z.ZodType<T>, normalize?: (parsed: unknown) => unknown): T {
  if (!content.trim()) {
    throw new Error(`${label}为空。`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonCodeFence(content));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}无效：模型没有返回合法 JSON（${reason}）。这通常是模型输出被截断或混入了非 JSON 文本，不是章节正文内容问题。`);
  }
  if (normalize) {
    parsed = normalize(parsed);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(formatSummarySchemaError(label, result.error.issues as readonly SummarySchemaIssue[]));
  }
  return result.data;
}

function normalizeArcSummaryIndexJson(parsed: unknown, input: ArcIndexSummaryInput): unknown {
  if (!isRecord(parsed)) {
    return parsed;
  }
  const stageInfo = isRecord(parsed.阶段信息) ? parsed.阶段信息 : {};
  return {
    ...parsed,
    阶段信息: {
      ...stageInfo,
      起始章节: input.chapterFrom,
      结束章节: input.chapterTo,
      覆盖章节: input.chapters.map((chapter) => chapter.ordinal),
      覆盖限制: arrayField(stageInfo.覆盖限制)
    },
    人物图谱: normalizeArcRelationshipGraph(parsed.人物图谱, input)
  };
}

function firstDefined(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }
  return undefined;
}

function stringValue(value: unknown, fallback: string): string {
  if (value === undefined || value === null) {
    return fallback;
  }
  const text = String(value).trim();
  return text || fallback;
}

function arrayFromUnknown(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  const text = String(value).trim();
  return text ? [text] : [];
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const percentMatch = /(\d+(?:\.\d+)?)\s*%/.exec(value);
    if (percentMatch) {
      return Number(percentMatch[1]) / 100;
    }
    const numberMatch = /(\d+(?:\.\d+)?)/.exec(value);
    if (numberMatch) {
      return Number(numberMatch[1]);
    }
  }
  return null;
}

function positiveIntegerFromUnknown(value: unknown, fallback: number): number {
  const parsed = numberFromUnknown(value);
  if (parsed === null || !Number.isFinite(parsed)) {
    return Math.max(1, Math.floor(fallback));
  }
  return Math.max(1, Math.floor(parsed));
}

function confidenceFromUnknown(value: unknown, fallback = 0.6): number {
  if (typeof value === "string") {
    if (value.includes("高")) {
      return 0.85;
    }
    if (value.includes("低")) {
      return 0.4;
    }
    if (value.includes("中")) {
      return 0.6;
    }
  }
  const parsed = numberFromUnknown(value);
  if (parsed === null || !Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, parsed > 1 ? parsed / 100 : parsed));
}

function booleanFromUnknown(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "是", "有", "稳定"].includes(normalized)) {
      return true;
    }
    if (["false", "no", "否", "无", "不稳定"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function enumFromUnknown<T extends string>(value: unknown, allowed: readonly T[], fallback: T, aliases: Record<string, T> = {}): T {
  const text = stringValue(value, "");
  if ((allowed as readonly string[]).includes(text)) {
    return text as T;
  }
  return aliases[text] ?? fallback;
}

function normalizeGraphEvidenceArray(value: unknown, fallbackChapterNumber: number): unknown[] {
  return arrayFromUnknown(value).slice(0, 5).map((item) => {
    if (!isRecord(item)) {
      return {
        chapterNumber: fallbackChapterNumber,
        text: stringValue(item, ""),
        reason: "模型未提供结构化证据理由。"
      };
    }
    return {
      ...item,
      chapterNumber: positiveIntegerFromUnknown(firstDefined(item, ["chapterNumber", "章节号", "章节", "chapter", "chapterIndex"]), fallbackChapterNumber),
      text: stringValue(firstDefined(item, ["text", "证据", "证据短句", "原文", "片段"]), ""),
      reason: stringValue(firstDefined(item, ["reason", "理由", "判断理由", "说明"]), "模型未提供结构化证据理由。")
    };
  });
}

function normalizeArcGraphCharacter(value: unknown, input: ArcIndexSummaryInput): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const firstSeenChapter = positiveIntegerFromUnknown(firstDefined(value, ["firstSeenChapter", "首次出现章节", "初次出现章节", "起始章节", "章节"]), input.chapterFrom);
  const lastSeenChapter = Math.max(
    firstSeenChapter,
    positiveIntegerFromUnknown(firstDefined(value, ["lastSeenChapter", "最后出现章节", "末次出现章节", "结束章节"]), input.chapterTo)
  );
  const canonicalName = stringValue(firstDefined(value, ["canonicalName", "规范名", "标准名", "人物", "姓名", "name", "displayName", "名称"]), "未命名人物");
  return {
    ...value,
    canonicalName,
    displayName: stringValue(firstDefined(value, ["displayName", "显示名", "展示名", "姓名", "name", "名称"]), canonicalName),
    aliases: arrayFromUnknown(firstDefined(value, ["aliases", "别名", "曾用名", "其他名字"])),
    mentionForms: arrayFromUnknown(firstDefined(value, ["mentionForms", "称谓", "提及形式", "出现称谓", "指称"])),
    roleHints: arrayFromUnknown(firstDefined(value, ["roleHints", "身份提示", "角色身份", "身份", "人物身份"])),
    firstSeenChapter,
    lastSeenChapter,
    importance: enumFromUnknown(firstDefined(value, ["importance", "重要性", "角色重要性"]), ["major", "supporting", "minor", "unknown"], "unknown", {
      主要: "major",
      核心: "major",
      主角: "major",
      配角: "supporting",
      次要: "minor",
      路人: "minor",
      未知: "unknown"
    }),
    confidence: confidenceFromUnknown(firstDefined(value, ["confidence", "置信度", "可信度"])),
    evidence: normalizeGraphEvidenceArray(firstDefined(value, ["evidence", "证据", "证据短句"]), firstSeenChapter)
  };
}

function normalizeArcGraphRelation(value: unknown, input: ArcIndexSummaryInput, defaultCategory: string): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const firstSeenChapter = positiveIntegerFromUnknown(firstDefined(value, ["firstSeenChapter", "首次出现章节", "初次出现章节", "起始章节", "章节"]), input.chapterFrom);
  const lastSeenChapter = Math.max(
    firstSeenChapter,
    positiveIntegerFromUnknown(firstDefined(value, ["lastSeenChapter", "最后出现章节", "末次出现章节", "结束章节"]), input.chapterTo)
  );
  const category = enumFromUnknown(
    firstDefined(value, ["category", "类别", "关系类别", "类型"]),
    ["基础关系", "剧情关系", "阵营关系", "情感关系", "冲突关系", "社会关系", "其他"],
    defaultCategory as "基础关系" | "剧情关系" | "阵营关系" | "情感关系" | "冲突关系" | "社会关系" | "其他"
  );
  return {
    ...value,
    source: stringValue(firstDefined(value, ["source", "来源", "主体", "人物A", "from", "sourceName"]), "未明确"),
    target: stringValue(firstDefined(value, ["target", "目标", "客体", "人物B", "to", "targetName"]), "未明确"),
    label: stringValue(firstDefined(value, ["label", "关系", "关系标签", "primaryLabel"]), "未明确关系"),
    category,
    polarity: enumFromUnknown(firstDefined(value, ["polarity", "极性", "倾向"]), ["positive", "negative", "neutral", "mixed", "unknown"], "unknown", {
      正向: "positive",
      负向: "negative",
      中性: "neutral",
      复杂: "mixed",
      混合: "mixed",
      未知: "unknown"
    }),
    directed: booleanFromUnknown(firstDefined(value, ["directed", "有向", "是否有向"]), false),
    stable: booleanFromUnknown(firstDefined(value, ["stable", "稳定", "是否稳定"]), category === "基础关系"),
    firstSeenChapter,
    lastSeenChapter,
    confidence: confidenceFromUnknown(firstDefined(value, ["confidence", "置信度", "可信度"])),
    evidence: normalizeGraphEvidenceArray(firstDefined(value, ["evidence", "证据", "证据短句"]), firstSeenChapter)
  };
}

function normalizeAmbiguousReference(value: unknown, input: ArcIndexSummaryInput): unknown {
  if (!isRecord(value)) {
    return value;
  }
  return {
    ...value,
    mention: stringValue(firstDefined(value, ["mention", "称谓", "提及", "指称"]), "未明确称谓"),
    candidates: arrayFromUnknown(firstDefined(value, ["candidates", "候选", "候选人物"])),
    chapterNumber: positiveIntegerFromUnknown(firstDefined(value, ["chapterNumber", "章节号", "章节"]), input.chapterFrom),
    reason: stringValue(firstDefined(value, ["reason", "理由", "说明"]), "模型标记为待确认称谓。"),
    recommendedAction: enumFromUnknown(
      firstDefined(value, ["recommendedAction", "建议动作", "处理建议"]),
      ["keep_separate", "needs_later_context", "manual_review"],
      "needs_later_context",
      {
        保持分开: "keep_separate",
        需要后文: "needs_later_context",
        需要人工确认: "manual_review"
      }
    )
  };
}

function normalizeGraphQualityIssue(value: unknown): unknown {
  if (!isRecord(value)) {
    return { level: "warning", message: stringValue(value, "人物图谱存在未结构化质量提示。") };
  }
  return {
    ...value,
    level: enumFromUnknown(firstDefined(value, ["level", "级别", "严重程度"]), ["info", "warning", "error"], "warning", {
      信息: "info",
      提示: "info",
      警告: "warning",
      错误: "error"
    }),
    message: stringValue(firstDefined(value, ["message", "信息", "提示", "说明"]), "人物图谱存在质量提示。")
  };
}

function normalizeArcRelationshipGraph(value: unknown, input: ArcIndexSummaryInput): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const stageRange = isRecord(value.阶段范围) ? value.阶段范围 : {};
  return {
    ...value,
    版本: "summary-relationship-v1",
    阶段范围: {
      ...stageRange,
      起始章节号: positiveIntegerFromUnknown(stageRange.起始章节号, input.chapterFrom),
      结束章节号: positiveIntegerFromUnknown(stageRange.结束章节号, input.chapterTo)
    },
    人物归一: arrayFromUnknown(value.人物归一).map((item) => normalizeArcGraphCharacter(item, input)),
    称谓待确认: arrayFromUnknown(value.称谓待确认).map((item) => normalizeAmbiguousReference(item, input)),
    基础关系: arrayFromUnknown(value.基础关系).map((item) => normalizeArcGraphRelation(item, input, "基础关系")),
    剧情关系: arrayFromUnknown(value.剧情关系).map((item) => normalizeArcGraphRelation(item, input, "剧情关系")),
    阶段关系摘要: stringValue(value.阶段关系摘要, ""),
    质量提示: arrayFromUnknown(value.质量提示).map(normalizeGraphQualityIssue)
  };
}

function formatBookCoverageRange(input: BookIndexSummaryInput): string {
  if (input.coverage.totalChapterCount > 0) {
    return `第1-${input.coverage.totalChapterCount}章`;
  }
  if (input.arcs.length > 0) {
    const chapterFrom = Math.min(...input.arcs.map((arc) => arc.chapterFrom));
    const chapterTo = Math.max(...input.arcs.map((arc) => arc.chapterTo));
    return `第${chapterFrom}-${chapterTo}章`;
  }
  return "无章节";
}

function normalizeBookSummaryIndexJson(parsed: unknown, input: BookIndexSummaryInput): unknown {
  if (!isRecord(parsed)) {
    return parsed;
  }
  const { 人物关系图谱: _ignoredRelationshipGraph, ...summaryFields } = parsed;
  const bookInfo = isRecord(parsed.全书信息) ? parsed.全书信息 : {};
  return {
    ...summaryFields,
    全书信息: {
      ...bookInfo,
      覆盖阶段: input.arcs.map((arc) => `第${arc.chapterFrom}-${arc.chapterTo}章`),
      覆盖章节范围: formatBookCoverageRange(input),
      总章节数: input.coverage.totalChapterCount,
      已索引章节数: input.coverage.indexedChapterCount,
      过期章节: input.coverage.staleChapterIds,
      缺失章节: input.coverage.missingChapterIds,
      过短跳过章节: input.coverage.skippedTooShortChapterIds,
      覆盖限制: arrayField(bookInfo.覆盖限制)
    }
  };
}

export function buildChatCompletionMessages(input: AiChatGenerationInput, chatBudget: TokenBudget = getTokenBudget("chat")): OpenRouterMessage[] {
  const systemMessage = {
    role: "system",
    content: buildSystemPrompt()
  } satisfies OpenRouterMessage;
  const userMessage = {
    role: "user",
    content: buildUserPrompt(input)
  } satisfies OpenRouterMessage;
  const compactedBase = compactOpenRouterInput({
    messages: [systemMessage, userMessage],
    maxInputTokens: chatBudget.maxInputTokens
  }).messages;
  let compactedUserMessage: OpenRouterMessage = userMessage;
  for (let index = compactedBase.length - 1; index >= 0; index -= 1) {
    const message = compactedBase[index];
    if (message.role === "user") {
      compactedUserMessage = message;
      break;
    }
  }
  const selectedHistory: OpenRouterMessage[] = [];

  for (const historyMessage of buildHistoryMessages(input, chatBudget).reverse()) {
    const candidate = [systemMessage, historyMessage, ...selectedHistory, compactedUserMessage];
    if (estimateMessagesTokens(candidate) <= chatBudget.maxInputTokens) {
      selectedHistory.unshift(historyMessage);
    }
  }

  return [...compactOpenRouterInput({
    messages: [systemMessage, ...selectedHistory, compactedUserMessage],
    maxInputTokens: chatBudget.maxInputTokens
  }).messages];
}

export class OpenRouterChatGenerator implements AiChatGenerator {
  constructor(private readonly settingsService: SettingsService) {}

  private async createClient(options: { readonly requireTools?: boolean } = { requireTools: true }): Promise<{
    readonly client: OpenRouterClient;
    readonly modelName: string;
    readonly contextLength: number | null;
    readonly chatBudget: TokenBudget;
  }> {
    const config = await this.settingsService.getOpenRouterConfigWithModelMetadata(undefined, options);
    return {
      modelName: config.modelName,
      contextLength: config.contextLength,
      chatBudget: getTokenBudget("chat", config.contextLength),
      client: new OpenRouterClient({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        modelName: config.modelName
      })
    };
  }

  async getSummaryIndexBudget(): Promise<{ readonly maxInputTokens: number; readonly modelContextTokens: number | null }> {
    const { chatBudget, contextLength } = await this.createClient();
    return {
      maxInputTokens: chatBudget.maxInputTokens,
      modelContextTokens: contextLength
    };
  }

  async sendMessageStream(input: AiChatGenerationInput, handlers: AiChatStreamHandlers, options: AiGenerationOptions = {}): Promise<AiChatMessageResult> {
    const { chatBudget, client, contextLength, modelName } = await this.createClient({ requireTools: false });
    const reasoning = buildReasoningConfig(chatBudget, { exclude: false, fallbackEffort: "medium" });
    const messages = buildChatCompletionMessages(input, chatBudget);
    handlers.onContext?.({
      requestId: input.requestId,
      estimatedInputTokens: estimateMessagesTokens(messages),
      maxInputTokens: chatBudget.maxInputTokens,
      maxOutputTokens: chatBudget.maxOutputTokens,
      modelContextTokens: contextLength,
      modelName,
      contextMode: input.agentContext?.mode ?? "direct",
      scopeLabel: input.agentContext?.scopeLabel ?? (input.currentChapterTitle ? "本章" : input.selectionText ? "选中文本" : "当前对话"),
      indexMode: input.agentContext?.indexMode,
      indexedChapterCount: input.agentContext?.indexedChapterCount,
      totalChapterCount: input.agentContext?.totalChapterCount,
      staleChapterCount: input.agentContext?.staleChapterCount,
      skippedTooShortChapterCount: input.agentContext?.skippedTooShortChapterCount
    });
    logDevLlmPrompt({
      kind: "chat",
      modelName,
      messages,
      meta: {
        chapterId: input.chapterId,
        agentContextMode: input.agentContext?.mode,
        agentContextScope: input.agentContext?.scopeLabel,
        currentChapterTitle: input.currentChapterTitle,
        historyMessageCount: input.history.length,
        projectId: input.projectId,
        requestMode: "stream",
        sessionId: input.sessionId
      },
      params: {
        maxCompletionTokens: chatBudget.maxOutputTokens,
        reasoning,
        temperature: 0.55
      }
    });
    const result = await client.streamChatCompletion(
      {
        messages,
        maxCompletionTokens: chatBudget.maxOutputTokens,
        reasoning,
        temperature: 0.55,
        signal: options.signal
      },
      {
        onToken(token) {
          handlers.onChunk?.({ requestId: input.requestId, content: token });
        },
        onReasoning(token) {
          handlers.onReasoning?.({ requestId: input.requestId, content: token });
        }
      }
    );
    const content = result.content.trim();
    if (!content) {
      throw new Error("OpenRouter 返回了空对话内容。");
    }

    return {
      role: "assistant",
      content,
      createdAt: new Date().toISOString()
    };
  }

  async sendAgentMessageStream(
    input: AiChatAgentGenerationInput,
    handlers: NovelAgentRuntimeHandlers,
    options: AiGenerationOptions = {}
  ): Promise<AiChatMessageResult> {
    const { chatBudget, client, contextLength, modelName } = await this.createClient();
    const reasoning = buildReasoningConfig(chatBudget, { exclude: false, fallbackEffort: "medium" });
    let iteration = 0;
    const model = {
      stream: async (agentInput, streamHandlers) => {
        iteration += 1;
        logDevLlmPrompt({
          kind: "chat:agent-loop",
          modelName,
          messages: agentInput.messages,
          meta: {
            projectId: input.projectId,
            sessionId: input.sessionId,
            requestMode: "agent_stream",
            iteration,
            toolCount: agentInput.tools.length
          },
          params: {
            maxCompletionTokens: agentInput.maxCompletionTokens,
            reasoning: agentInput.reasoning,
            temperature: agentInput.temperature
          }
        });

        return client.streamChatCompletion(
          {
            messages: agentInput.messages,
            tools: agentInput.tools,
            toolChoice: agentInput.toolChoice ?? "auto",
            parallelToolCalls: false,
            allowEmptyContent: true,
            maxCompletionTokens: agentInput.maxCompletionTokens,
            reasoning: agentInput.reasoning,
            temperature: agentInput.temperature,
            signal: agentInput.signal
          },
          streamHandlers
        );
      }
    } satisfies ChatAgentModel;

    const result = await runChatAgentLoop(
      {
        requestId: input.requestId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        userMessage: input.message,
        history: input.history,
        compactedMemorySummary: input.compactedMemorySummary,
        compactedMemoryThroughMessageId: input.compactedMemoryThroughMessageId,
        currentChapterId: input.chapterId,
        currentChapterTitle: input.currentChapterTitle,
        selectionText: input.selectionText,
        chapterDirectory: input.chapterDirectory,
        tools: input.tools.map((tool) => ({
          type: "function" as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          }
        })),
        executeTool: input.executeTool,
        model,
        tokenBudget: chatBudget,
        modelContextTokens: contextLength,
        modelName,
        reasoning,
        signal: options.signal
      },
      handlers
    );

    return {
      role: "assistant",
      content: result.content,
      createdAt: new Date().toISOString(),
      actions: result.actions
    };
  }

  async summarizeChapterForContext(input: ChatChapterSummaryInput, options: AiGenerationOptions = {}): Promise<string> {
    const { chatBudget: budget, client, modelName } = await this.createClient();
    const maxCompletionTokens = capInternalMaxCompletionTokens(CHAPTER_SUMMARY_MAX_TOKENS, budget);
    const chunkBudget = Math.max(1200, budget.maxInputTokens - estimateTextTokens(input.userMessage) - maxCompletionTokens);
    const chunks = splitTextIntoTokenChunks(input.plainText, chunkBudget);
    const chunkSummaries: string[] = [];

    for (const [index, chunk] of chunks.entries()) {
      const messages = buildChapterSummaryMessages(input, chunk, index + 1, chunks.length);
      logDevLlmPrompt({
        kind: "chat:chapter-summary",
        modelName,
        messages,
        meta: {
          projectId: input.projectId,
          chapterId: input.chapterId,
          chapterTitle: input.title,
          chunkIndex: index + 1,
          chunkCount: chunks.length,
          scopeLabel: input.scopeLabel
        },
        params: {
          maxCompletionTokens,
          temperature: 0.2
        }
      });
      const result = await this.runInternalStreamingCompletion(client, {
        messages,
        maxCompletionTokens,
        temperature: 0.2,
        signal: options.signal
      });
      const content = result.content.trim();
      if (!content) {
        throw new Error(`第${input.ordinal}章摘要为空。`);
      }
      if (result.truncated) {
        throw new Error(`第${input.ordinal}章摘要被截断，请换用输出额度更高的模型后重试。`);
      }
      chunkSummaries.push(content);
    }

    if (chunkSummaries.length === 1) {
      return chunkSummaries[0];
    }

    const messages = buildChapterSummaryMergeMessages(input, chunkSummaries);
    const mergeMaxCompletionTokens = capInternalMaxCompletionTokens(CHAPTER_SUMMARY_MERGE_MAX_TOKENS, budget);
    logDevLlmPrompt({
      kind: "chat:chapter-summary-merge",
      modelName,
      messages,
      meta: {
        projectId: input.projectId,
        chapterId: input.chapterId,
        chapterTitle: input.title,
        chunkCount: chunkSummaries.length,
        scopeLabel: input.scopeLabel
      },
      params: {
        maxCompletionTokens: mergeMaxCompletionTokens,
        temperature: 0.2
      }
    });
    const result = await this.runInternalStreamingCompletion(client, {
      messages,
      maxCompletionTokens: mergeMaxCompletionTokens,
      temperature: 0.2,
      signal: options.signal
    });
    const content = result.content.trim();
    if (!content) {
      throw new Error(`第${input.ordinal}章合并摘要为空。`);
    }
    if (result.truncated) {
      throw new Error(`第${input.ordinal}章合并摘要被截断，请换用输出额度更高的模型后重试。`);
    }
    return content;
  }

  async summarizeContextBatchForContext(input: ChatContextBatchSummaryInput, options: AiGenerationOptions = {}): Promise<string> {
    if (input.chapters.length === 0) {
      throw new Error("AI 对话批量摘要缺少章节。");
    }
    if (input.chapters.length === 1) {
      const chapter = input.chapters[0];
      return this.summarizeChapterForContext(
        {
          projectId: input.projectId,
          chapterId: chapter.chapterId,
          title: chapter.title,
          ordinal: chapter.ordinal,
          plainText: chapter.plainText,
          userMessage: input.userMessage,
          scopeLabel: input.scopeLabel
        },
        options
      );
    }

    const { chatBudget, client, modelName } = await this.createClient();
    const maxCompletionTokens = capInternalMaxCompletionTokens(CONTEXT_BATCH_SUMMARY_MAX_TOKENS, chatBudget);
    const messages = buildContextBatchSummaryMessages(input);
    const first = input.chapters[0];
    const last = input.chapters.at(-1) ?? first;
    logDevLlmPrompt({
      kind: "chat:context-batch-summary",
      modelName,
      messages,
      meta: {
        projectId: input.projectId,
        firstChapter: first.ordinal,
        lastChapter: last.ordinal,
        chapterCount: input.chapters.length,
        scopeLabel: input.scopeLabel
      },
      params: {
        maxCompletionTokens,
        temperature: 0.2
      }
    });
    const result = await this.runInternalStreamingCompletion(client, {
      messages,
      maxCompletionTokens,
      temperature: 0.2,
      responseFormat: { type: "json_object" },
      signal: options.signal
    });
    const content = result.content.trim();
    if (!content) {
      throw new Error(`第${first.ordinal}-${last.ordinal}章批量摘要为空。`);
    }
    if (result.truncated) {
      throw new Error(`第${first.ordinal}-${last.ordinal}章批量摘要被截断，请缩小章节范围或换用输出额度更高的模型后重试。`);
    }
    return content;
  }

  async mergeContextSummaries(input: ChatContextSummaryMergeInput, options: AiGenerationOptions = {}): Promise<string> {
    return this.mergeSummaryItems(input, input.summaries, options, 0);
  }

  async summarizeChatHistoryForMemory(input: AiChatHistoryMemorySummaryInput, options: AiGenerationOptions = {}): Promise<{ readonly summary: string }> {
    const { chatBudget, client, modelName } = await this.createClient();
    const maxCompletionTokens = capInternalMaxCompletionTokens(CHAT_MEMORY_SUMMARY_MAX_TOKENS, chatBudget);
    let currentSummary = input.previousSummary?.trim() ?? "";
    const formatted = input.messages.map(formatChatMemoryMessage).join("\n\n");
    let remaining = formatted.trim();
    let chunkIndex = 0;

    while (remaining) {
      chunkIndex += 1;
      const chunk = buildBudgetedChatMemoryChunk({
        input,
        currentSummary,
        maxCompletionTokens,
        maxInputTokens: chatBudget.maxInputTokens,
        remaining,
        chunkIndex
      });
      const messages = buildChatHistoryMemorySummaryMessages({
        ...input,
        previousSummary: currentSummary || null,
        messagesText: chunk,
        chunkIndex,
        chunkCount: estimateRemainingChunkCount(remaining, chunk, chunkIndex)
      });
      logDevLlmPrompt({
        kind: "chat:memory-compaction",
        modelName,
        messages,
        meta: {
          projectId: input.projectId,
          sessionId: input.sessionId,
          messageCount: input.messages.length,
          chunkIndex,
          chunkCount: estimateRemainingChunkCount(remaining, chunk, chunkIndex)
        },
        params: {
          maxCompletionTokens,
          temperature: 0.2
        }
      });
      const result = await this.runInternalStreamingCompletion(client, {
        messages,
        maxCompletionTokens,
        temperature: 0.2,
        signal: options.signal
      });
      currentSummary = result.content.trim();
      if (!currentSummary) {
        throw new Error("AI 对话记忆压缩结果为空。");
      }
      if (result.truncated) {
        throw new Error("AI 对话记忆压缩结果被截断，请换用输出额度更高的模型后重试。");
      }
      currentSummary = await this.recompressMemorySummaryIfNeeded({
        chatBudget,
        client,
        input,
        maxCompletionTokens,
        modelName,
        options,
        summary: currentSummary
      });
      remaining = remaining.slice(chunk.length).trimStart();
    }

    return {
      summary: currentSummary
    };
  }

  async summarizeChapterForIndex(input: ChapterIndexSummaryInput, options: AiGenerationOptions = {}): Promise<ChapterAiSummaryPayload> {
    const { chatBudget, client, modelName } = await this.createClient();
    const maxCompletionTokens = capInternalMaxCompletionTokens(SUMMARY_INDEX_MAX_TOKENS, chatBudget);
    const messages = buildChapterIndexSummaryMessages(input);
    logDevLlmPrompt({
      kind: "summary-index:chapter",
      modelName,
      messages,
      meta: {
        chapterTitle: input.title,
        ordinal: input.ordinal
      },
      params: {
        maxCompletionTokens,
        temperature: 0.2
      }
    });
    const result = await this.runInternalStreamingCompletion(client, {
      messages,
      maxCompletionTokens,
      temperature: 0.2,
      responseFormat: { type: "json_object" },
      signal: options.signal
    });
    if (result.truncated) {
      throw new Error("章节索引摘要被截断，请换用输出额度更高的模型后重试。");
    }
    return parseSummaryIndexJson("章节索引摘要", result.content, chapterAiSummaryPayloadSchema);
  }

  async summarizeChapterChunkForIndex(input: ChapterChunkIndexSummaryInput, options: AiGenerationOptions = {}): Promise<ChapterAiSummaryChunkPayload> {
    const { chatBudget, client, modelName } = await this.createClient();
    const maxCompletionTokens = capInternalMaxCompletionTokens(SUMMARY_INDEX_MAX_TOKENS, chatBudget);
    const messages = buildChapterChunkIndexSummaryMessages(input);
    logDevLlmPrompt({
      kind: "summary-index:chapter-chunk",
      modelName,
      messages,
      meta: {
        chapterTitle: input.title,
        ordinal: input.ordinal,
        chunkIndex: input.chunkIndex,
        chunkCount: input.chunkCount
      },
      params: {
        maxCompletionTokens,
        temperature: 0.2
      }
    });
    const result = await this.runInternalStreamingCompletion(client, {
      messages,
      maxCompletionTokens,
      temperature: 0.2,
      responseFormat: { type: "json_object" },
      signal: options.signal
    });
    if (result.truncated) {
      throw new Error("章节片段索引摘要被截断，请换用输出额度更高的模型后重试。");
    }
    return parseSummaryIndexJson("章节片段索引摘要", result.content, chapterAiSummaryChunkPayloadSchema);
  }

  async mergeChapterChunksForIndex(input: ChapterChunkMergeSummaryInput, options: AiGenerationOptions = {}): Promise<ChapterAiSummaryPayload> {
    const { chatBudget, client, modelName } = await this.createClient();
    const maxCompletionTokens = capInternalMaxCompletionTokens(SUMMARY_INDEX_MAX_TOKENS, chatBudget);
    const messages = buildChapterChunkMergeSummaryMessages(input);
    logDevLlmPrompt({
      kind: "summary-index:chapter-chunk-merge",
      modelName,
      messages,
      meta: {
        chapterTitle: input.title,
        ordinal: input.ordinal,
        chunkCount: input.chunks.length
      },
      params: {
        maxCompletionTokens,
        temperature: 0.2
      }
    });
    const result = await this.runInternalStreamingCompletion(client, {
      messages,
      maxCompletionTokens,
      temperature: 0.2,
      responseFormat: { type: "json_object" },
      signal: options.signal
    });
    if (result.truncated) {
      throw new Error("章节片段合并索引摘要被截断，请换用输出额度更高的模型后重试。");
    }
    return parseSummaryIndexJson("章节片段合并索引摘要", result.content, chapterAiSummaryPayloadSchema);
  }

  async summarizeArcForIndex(input: ArcIndexSummaryInput, options: AiGenerationOptions = {}): Promise<ArcAiSummaryPayload> {
    const { chatBudget, client, modelName } = await this.createClient();
    const maxCompletionTokens = capInternalMaxCompletionTokens(SUMMARY_INDEX_MAX_TOKENS, chatBudget);
    const messages = buildArcIndexSummaryMessages(input);
    logDevLlmPrompt({
      kind: "summary-index:arc",
      modelName,
      messages,
      meta: {
        arcKey: input.arcKey,
        chapterFrom: input.chapterFrom,
        chapterTo: input.chapterTo,
        chapterCount: input.chapters.length
      },
      params: {
        maxCompletionTokens,
        temperature: 0.2
      }
    });
    const result = await this.runInternalStreamingCompletion(client, {
      messages,
      maxCompletionTokens,
      temperature: 0.2,
      responseFormat: { type: "json_object" },
      signal: options.signal
    });
    if (result.truncated) {
      throw new Error("阶段索引摘要被截断，请换用输出额度更高的模型后重试。");
    }
    return parseSummaryIndexJson("阶段索引摘要", result.content, arcAiSummaryPayloadSchema, (parsed) =>
      normalizeArcSummaryIndexJson(parsed, input)
    );
  }

  async summarizeBookForIndex(input: BookIndexSummaryInput, options: AiGenerationOptions = {}): Promise<BookAiSummaryPayload> {
    const { chatBudget, client, modelName } = await this.createClient();
    const maxCompletionTokens = capInternalMaxCompletionTokens(SUMMARY_INDEX_MAX_TOKENS, chatBudget);
    const messages = buildBookIndexSummaryMessages(input);
    logDevLlmPrompt({
      kind: "summary-index:book",
      modelName,
      messages,
      meta: {
        arcCount: input.arcs.length,
        totalChapterCount: input.coverage.totalChapterCount,
        indexedChapterCount: input.coverage.indexedChapterCount
      },
      params: {
        maxCompletionTokens,
        temperature: 0.2
      }
    });
    const result = await this.runInternalStreamingCompletion(client, {
      messages,
      maxCompletionTokens,
      temperature: 0.2,
      responseFormat: { type: "json_object" },
      signal: options.signal
    });
    if (result.truncated) {
      throw new Error("全书索引摘要被截断，请换用输出额度更高的模型后重试。");
    }
    return parseSummaryIndexJson("全书索引摘要", result.content, bookAiSummaryPayloadSchema, (parsed) =>
      normalizeBookSummaryIndexJson(parsed, input)
    );
  }

  async checkContinuity(input: ContinuityCheckInput, options: AiGenerationOptions = {}): Promise<ContinuityCheckResult> {
    const { chatBudget, client, modelName } = await this.createClient();
    const maxCompletionTokens = capInternalMaxCompletionTokens(4000, chatBudget);
    const messages = buildContinuityCheckMessages(input);
    logDevLlmPrompt({
      kind: "summary-index:continuity-check",
      modelName,
      messages,
      meta: {
        chapterCount: input.chapters.length
      },
      params: {
        maxCompletionTokens,
        temperature: 0.1
      }
    });
    const result = await this.runInternalStreamingCompletion(client, {
      messages,
      maxCompletionTokens,
      temperature: 0.1,
      responseFormat: { type: "json_object" },
      signal: options.signal
    });
    if (result.truncated) {
      throw new Error("连续性检查结果被截断，请缩小章节范围后重试。");
    }
    return parseSummaryIndexJson("连续性检查", result.content, continuityCheckResultSchema);
  }

  private async mergeSummaryItems(
    input: ChatContextSummaryMergeInput,
    summaries: readonly ChatContextSummaryItem[],
    options: AiGenerationOptions,
    depth: number
  ): Promise<string> {
    if (summaries.length === 0) {
      return "（没有可用摘要）";
    }
    if (depth > 5) {
      throw new Error("AI 对话摘要层级过深，请缩小章节范围后重试。");
    }

    const { chatBudget, client, modelName } = await this.createClient();
    const maxCompletionTokens = capInternalMaxCompletionTokens(CONTEXT_SUMMARY_MERGE_MAX_TOKENS, chatBudget);
    const batches = buildSummaryMergeBatches(input, summaries, chatBudget, maxCompletionTokens);
    const merged: ChatContextSummaryItem[] = [];

    for (const [index, batch] of batches.entries()) {
      const messages = buildContextSummaryMergeMessages(input, batch);
      logDevLlmPrompt({
        kind: "chat:context-summary-merge",
        modelName,
        messages,
        meta: {
          projectId: input.projectId,
          scopeLabel: input.scopeLabel,
          mergeDepth: depth,
          batchIndex: index + 1,
          batchCount: batches.length,
          summaryCount: batch.length
        },
        params: {
          maxCompletionTokens,
          temperature: 0.2
        }
      });
      const result = await this.runInternalStreamingCompletion(client, {
        messages,
        maxCompletionTokens,
        temperature: 0.2,
        signal: options.signal
      });
      const content = result.content.trim();
      if (!content) {
        throw new Error("AI 对话聚合摘要为空。");
      }
      if (result.truncated) {
        throw new Error("AI 对话聚合摘要被截断，请缩小章节范围或换用输出额度更高的模型后重试。");
      }
      const first = batch[0];
      const last = batch.at(-1) ?? first;
      merged.push({
        chapterId: first.chapterId,
        title: first.ordinal === last.ordinal ? first.title : `${first.title} 至 ${last.title}`,
        ordinal: first.ordinal,
        summary: content
      });
    }

    if (merged.length === 1) {
      return merged[0].summary;
    }

    return this.mergeSummaryItems(input, merged, options, depth + 1);
  }

  private async runInternalStreamingCompletion(
    client: OpenRouterClient,
    input: {
      readonly messages: readonly OpenRouterMessage[];
      readonly maxCompletionTokens: number;
      readonly temperature: number;
      readonly responseFormat?: { readonly type: "json_object" };
      readonly signal?: AbortSignal;
    }
  ): Promise<OpenRouterChatCompletionResult> {
    return client.streamChatCompletion({
      messages: input.messages,
      maxCompletionTokens: input.maxCompletionTokens,
      temperature: input.temperature,
      responseFormat: input.responseFormat,
      signal: input.signal
    });
  }

  private async recompressMemorySummaryIfNeeded(input: {
    readonly client: OpenRouterClient;
    readonly chatBudget: TokenBudget;
    readonly input: AiChatHistoryMemorySummaryInput;
    readonly maxCompletionTokens: number;
    readonly modelName: string;
    readonly options: AiGenerationOptions;
    readonly summary: string;
  }): Promise<string> {
    const summaryBudget = getChatMemorySummaryBudget(input.chatBudget);
    let summary = input.summary;
    for (let round = 1; round <= CHAT_MEMORY_SUMMARY_RECOMPRESS_MAX_ROUNDS && estimateTextTokens(summary) > summaryBudget; round += 1) {
      const messages = buildChatMemoryRecompressionMessages(summary, summaryBudget, round);
      logDevLlmPrompt({
        kind: "chat:memory-recompression",
        modelName: input.modelName,
        messages,
        meta: {
          projectId: input.input.projectId,
          sessionId: input.input.sessionId,
          round
        },
        params: {
          maxCompletionTokens: input.maxCompletionTokens,
          temperature: 0.2
        }
      });
      const result = await this.runInternalStreamingCompletion(input.client, {
        messages,
        maxCompletionTokens: input.maxCompletionTokens,
        temperature: 0.2,
        signal: input.options.signal
      });
      summary = result.content.trim();
      if (!summary) {
        throw new Error("AI 对话记忆二次压缩结果为空。");
      }
      if (result.truncated) {
        throw new Error("AI 对话记忆二次压缩结果被截断，请换用输出额度更高的模型后重试。");
      }
    }
    if (estimateTextTokens(summary) > summaryBudget) {
      summary = `${truncateTextToTokenBudget(summary, summaryBudget).text.trim()}\n（对话记忆已按当前模型窗口进一步压缩。）`.trim();
    }
    return summary;
  }
}

function splitTextIntoTokenChunks(text: string, maxTokens: number): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining) {
    const chunk = truncateTextToTokenBudget(remaining, maxTokens).text;
    if (!chunk) {
      break;
    }
    chunks.push(chunk);
    remaining = remaining.slice(chunk.length).trimStart();
  }

  return chunks.length > 0 ? chunks : ["（本章暂无正文）"];
}

function estimateRemainingChunkCount(remaining: string, chunk: string, chunkIndex: number): number {
  const rest = remaining.slice(chunk.length).trimStart();
  if (!rest) {
    return chunkIndex;
  }
  const chunkTokens = Math.max(1, estimateTextTokens(chunk));
  return chunkIndex + Math.ceil(estimateTextTokens(rest) / chunkTokens);
}

function buildBudgetedChatMemoryChunk(input: {
  readonly input: AiChatHistoryMemorySummaryInput;
  readonly currentSummary: string;
  readonly maxCompletionTokens: number;
  readonly maxInputTokens: number;
  readonly remaining: string;
  readonly chunkIndex: number;
}): string {
  const reserveTokens = estimateTextTokens(input.currentSummary) + input.maxCompletionTokens + 400;
  let chunkBudget = Math.max(1, input.maxInputTokens - reserveTokens);
  let chunk = truncateTextToTokenBudget(input.remaining, chunkBudget).text;

  while (chunk) {
    const messages = buildChatHistoryMemorySummaryMessages({
      ...input.input,
      previousSummary: input.currentSummary || null,
      messagesText: chunk,
      chunkIndex: input.chunkIndex,
      chunkCount: estimateRemainingChunkCount(input.remaining, chunk, input.chunkIndex)
    });
    const estimatedTokens = estimateMessagesTokens(messages);
    if (estimatedTokens <= input.maxInputTokens) {
      return chunk;
    }

    const overage = estimatedTokens - input.maxInputTokens;
    chunkBudget = Math.max(0, estimateTextTokens(chunk) - overage - 64);
    const nextChunk = truncateTextToTokenBudget(chunk, chunkBudget).text;
    if (!nextChunk || nextChunk === chunk) {
      break;
    }
    chunk = nextChunk;
  }

  throw new Error("AI 对话记忆压缩输入超过模型窗口，请开启新对话，或换用上下文更大的模型后重试。");
}

function buildChapterSummaryMessages(input: ChatChapterSummaryInput, chunk: string, chunkIndex: number, chunkCount: number): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文小说章节摘要助手。",
        "你的任务是为后续整书/范围问答压缩上下文，必须忠实保留剧情事实、人物行动、关键冲突、伏笔、设定变化和未解决问题。",
        "不要评价文笔，不要改写正文，不要加入原文没有的信息。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `用户最终问题：${input.userMessage}`,
        `上下文范围：${input.scopeLabel}`,
        `章节：第${input.ordinal}章 ${input.title}`,
        `分段：${chunkIndex}/${chunkCount}`,
        "正文：",
        chunk,
        "请输出本段对最终问题有用的摘要。"
      ].join("\n")
    }
  ];
}

function buildChapterSummaryMergeMessages(input: ChatChapterSummaryInput, summaries: readonly string[]): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文小说章节摘要整合助手。",
        "把同一章节的多个分段摘要合并成一个章节摘要。",
        "保留剧情事实、人物行动、关键冲突、伏笔、设定变化和未解决问题；不要扩写。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `用户最终问题：${input.userMessage}`,
        `章节：第${input.ordinal}章 ${input.title}`,
        "分段摘要：",
        summaries.map((summary, index) => `段${index + 1}：\n${summary}`).join("\n\n"),
        "请合并为一个章节摘要。"
      ].join("\n")
    }
  ];
}

function formatBatchChapter(chapter: ChatContextBatchChapterInput): string {
  return [`[第${chapter.ordinal}章 ${chapter.title}]`, chapter.plainText.trim() || "（本章暂无正文）"].join("\n");
}

function buildContextBatchSummaryMessages(input: ChatContextBatchSummaryInput): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文小说多章节摘要助手。",
        "你的任务是把一组连续章节压缩成给后续对话使用的批量摘要。",
        "必须忠实保留剧情事实、人物行动、关键冲突、伏笔、设定变化和未解决问题。",
        "按章节顺序组织摘要，必要时用短小条目；不要评价文笔，不要改写正文，不要加入原文没有的信息。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `用户最终问题：${input.userMessage}`,
        `上下文范围：${input.scopeLabel}`,
        `章节批次：第${input.chapters[0]?.ordinal ?? "?"}-${input.chapters.at(-1)?.ordinal ?? "?"}章`,
        "正文：",
        input.chapters.map(formatBatchChapter).join("\n\n"),
        "请输出这批章节对最终问题有用的摘要。"
      ].join("\n")
    }
  ];
}

function formatSummaryItem(item: ChatContextSummaryItem): string {
  return [`[第${item.ordinal}章 ${item.title}]`, item.summary].join("\n");
}

function buildSummaryMergeBatches(
  input: ChatContextSummaryMergeInput,
  summaries: readonly ChatContextSummaryItem[],
  budget: TokenBudget = getTokenBudget("chat"),
  maxCompletionTokens = capInternalMaxCompletionTokens(CONTEXT_SUMMARY_MERGE_MAX_TOKENS, budget)
): readonly (readonly ChatContextSummaryItem[])[] {
  const maxBatchTokens = Math.max(1200, budget.maxInputTokens - estimateTextTokens(input.userMessage) - maxCompletionTokens);
  const batches: ChatContextSummaryItem[][] = [];
  let current: ChatContextSummaryItem[] = [];
  let currentTokens = 0;

  for (const item of summaries) {
    const block = formatSummaryItem(item);
    const blockTokens = estimateTextTokens(block);
    const nextWouldOverflow = current.length > 0 && currentTokens + blockTokens > maxBatchTokens;
    if (nextWouldOverflow) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }

    if (blockTokens > maxBatchTokens) {
      const trimmed = truncateTextToTokenBudget(item.summary, Math.max(200, maxBatchTokens - estimateTextTokens(item.title) - 80)).text;
      current.push({
        ...item,
        summary: trimmed
      });
      batches.push(current);
      current = [];
      currentTokens = 0;
      continue;
    }

    current.push(item);
    currentTokens += blockTokens;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

function buildContextSummaryMergeMessages(input: ChatContextSummaryMergeInput, summaries: readonly ChatContextSummaryItem[]): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文小说范围摘要压缩助手。",
        "把多个章节摘要压缩成更短的范围摘要，用于后续回答作者问题。",
        "必须保留主线进展、人物关系变化、关键冲突、伏笔、设定变化和未解决问题；不要加入原摘要没有的信息。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `用户最终问题：${input.userMessage}`,
        `上下文范围：${input.scopeLabel}`,
        "章节摘要：",
        summaries.map(formatSummaryItem).join("\n\n"),
        "请输出压缩后的范围摘要。"
      ].join("\n")
    }
  ];
}

function formatChatMemoryMessage(message: AiChatHistoryMemorySummaryInput["messages"][number]): string {
  const role = message.role === "user" ? "作者" : message.role === "assistant" ? "AI" : message.role;
  return [`[${role} | ${message.createdAt}]`, message.content.trim()].join("\n");
}

function buildChatHistoryMemorySummaryMessages(input: AiChatHistoryMemorySummaryInput & {
  readonly messagesText: string;
  readonly chunkIndex: number;
  readonly chunkCount: number;
}): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文小说写作 agent 的对话记忆压缩器。",
        "你的任务是把较早的多轮对话压缩成后续 agent 可继续使用的长期记忆。",
        "必须保留：用户长期目标、已指定的章节范围、已经总结过的剧情、人物特征、设定结论、用户偏好、未完成事项、上一轮仍可能被追问的指代对象。",
        "不要编造正文内容，不要删除仍有后续引用价值的信息。",
        "输出结构化 Markdown，简洁但信息完整。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        input.previousSummary ? `已有压缩记忆：\n${input.previousSummary}` : "已有压缩记忆：无",
        "",
        `待合并的较早对话：${input.chunkIndex}/${input.chunkCount}`,
        input.messagesText,
        "",
        "请输出更新后的完整压缩记忆。"
      ].join("\n")
    }
  ];
}

function getChatMemorySummaryBudget(chatBudget: TokenBudget): number {
  return Math.max(400, Math.floor(chatBudget.maxInputTokens * CHAT_MEMORY_SUMMARY_PROMPT_RATIO) - 120);
}

function buildChatMemoryRecompressionMessages(summary: string, targetTokens: number, round: number): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文小说写作 agent 的对话记忆二次压缩器。",
        "上一轮压缩记忆仍然过长，必须进一步压缩到更短。",
        "保留用户长期目标、章节范围、剧情结论、人物特征、设定结论、用户偏好和未完成事项。",
        "不要编造正文内容，不要加入新信息。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `目标长度：尽量控制在约 ${targetTokens} 个估算标记以内`,
        `压缩轮次：${round}`,
        "上一轮压缩记忆：",
        summary,
        "",
        "请输出更短的完整压缩记忆。"
      ].join("\n")
    }
  ];
}
