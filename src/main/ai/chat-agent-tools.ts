import { z } from "zod";
import { resolveChatAgentContext, type ResolvedChatAgentContext } from "./chat-agent-context";
import { chatAgentScopeSchema, type ChatAgentContext, type ChatAgentPlan, type ChatAgentScope } from "./chat-agent-types";
import type { OpenRouterToolDefinition } from "./openrouter-client";
import type { TokenBudget } from "./token-budget";
import type { ChapterRepository } from "../db/repositories/chapter-repo";
import type { ScratchNoteRepository } from "../db/repositories/scratch-note-repo";
import type { AiChatAction } from "../shared/types";

export type ChatAgentToolName = "get_project_context" | "list_chapters" | "read_chapters" | "read_selection" | "add_to_scratchpad";

export type ChatAgentToolRuntime = {
  readonly projectId: string;
  readonly currentChapterId?: string;
  readonly selectionText?: string;
  readonly userMessage: string;
  readonly chapterRepo: ChapterRepository;
  readonly scratchRepo?: ScratchNoteRepository;
  readonly tokenBudget: TokenBudget;
  readonly signal?: AbortSignal;
  readonly allowedActions?: readonly AiChatAction["type"][];
  readonly summarizeResolvedContext?: (resolved: ResolvedChatAgentContext, signal?: AbortSignal) => Promise<ChatAgentContext>;
};

export type ChatAgentToolExecutionInput = {
  readonly name: string;
  readonly argumentsJson: string;
  readonly runtime: ChatAgentToolRuntime;
};

export type ChatAgentToolExecutionResult = {
  readonly content: string;
  readonly action: AiChatAction | null;
};

const emptyArgsSchema = z.object({}).strict();

const readChaptersArgsSchema = z
  .object({
    scope: chatAgentScopeSchema
  })
  .strict();

const readChaptersToolParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    scope: {
      type: "string",
      enum: ["current_chapter", "selection", "all_chapters", "chapter", "chapter_range"],
      description:
        "读取范围。全部章节用 all_chapters；当前章用 current_chapter；选区用 selection；单章用 chapter 并填写 ordinal；章节范围用 chapter_range 并填写 from/to。"
    },
    ordinal: {
      type: "integer",
      minimum: 1,
      description: "scope=chapter 时的章节序号，例如第4章填 4。"
    },
    from: {
      type: "integer",
      minimum: 1,
      description: "scope=chapter_range 时的起始章节序号。"
    },
    to: {
      type: "integer",
      minimum: 1,
      description: "scope=chapter_range 时的结束章节序号。"
    }
  },
  required: ["scope"]
} as const;

const addToScratchpadArgsSchema = z
  .object({
    content: z.string().trim().min(1),
    chapterId: z.string().trim().min(1).nullable().optional(),
    pinned: z.boolean().optional()
  })
  .strict();

function toJsonSchema(schema: z.ZodType): object {
  return z.toJSONSchema(schema, {
    target: "draft-7"
  }) as object;
}

export const MOSHU_CHAT_AGENT_TOOLS: readonly OpenRouterToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_project_context",
      description: "获取当前项目的轻量状态，包括章节数量、当前打开章节和是否存在选中文本。用于开始任务前确认工作区状态。",
      parameters: toJsonSchema(emptyArgsSchema)
    }
  },
  {
    type: "function",
    function: {
      name: "list_chapters",
      description: "列出当前项目的章节目录、章节顺序、字数和当前打开章节。用于判断可读取的章节范围。",
      parameters: toJsonSchema(emptyArgsSchema)
    }
  },
  {
    type: "function",
    function: {
      name: "read_chapters",
      description:
        "读取当前项目中指定章节范围的正文上下文。回答总结、人物、剧情、伏笔、设定、连续性问题前必须先调用本工具读取来源内容。参数示例：{\"scope\":\"all_chapters\"}、{\"scope\":\"chapter\",\"ordinal\":4}、{\"scope\":\"chapter_range\",\"from\":2,\"to\":5}。",
      parameters: readChaptersToolParameters
    }
  },
  {
    type: "function",
    function: {
      name: "read_selection",
      description:
        "读取作者当前选中的正文。没有编辑器选区时，如果作者在当前消息里直接粘贴了待处理正文，也会读取这段粘贴文本。只有问题明确要求处理选区、当前选中文本或当前消息里的这段文本时才调用。",
      parameters: toJsonSchema(emptyArgsSchema)
    }
  },
  {
    type: "function",
    function: {
      name: "add_to_scratchpad",
      description: "把已经整理好的总结、灵感、设定或素材写入草稿纸。只有作者明确要求保存到草稿纸时才调用。",
      parameters: toJsonSchema(addToScratchpadArgsSchema)
    }
  }
];

function parseJsonArguments(argumentsJson: string): unknown {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`AI 工具参数不是有效 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseArgs<T>(schema: z.ZodType<T>, argumentsJson: string, toolName: string): T {
  const parsed = schema.safeParse(parseJsonArguments(argumentsJson));
  if (!parsed.success) {
    throw new Error(`AI 工具 ${toolName} 参数无效：${parsed.error.message}`);
  }
  return parsed.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function normalizeScopeByType(type: string, args: Record<string, unknown>): ChatAgentScope | null {
  const normalized = type.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["all", "all_chapters", "all_chapter", "全部章节", "所有章节", "现有章节", "现有所有章节", "全文", "全书"].includes(normalized)) {
    return { type: "all_chapters" };
  }
  if (["current", "current_chapter", "current_chapters", "本章", "当前章节", "当前章"].includes(normalized)) {
    return { type: "current_chapter" };
  }
  if (["selection", "selected_text", "selected", "选区", "选中文本", "当前选区"].includes(normalized)) {
    return { type: "selection" };
  }
  if (["chapter", "single_chapter", "单章", "章节"].includes(normalized)) {
    const ordinal = toPositiveInteger(args.ordinal ?? args.chapter ?? args.chapterOrdinal);
    return ordinal ? { type: "chapter", ordinal } : null;
  }
  if (["chapter_range", "range", "chapters", "章节范围", "多章"].includes(normalized)) {
    const from = toPositiveInteger(args.from ?? args.start ?? args.startOrdinal);
    const to = toPositiveInteger(args.to ?? args.end ?? args.endOrdinal);
    return from && to ? { type: "chapter_range", from, to } : null;
  }
  return null;
}

function normalizeScopeString(value: string, args: Record<string, unknown>): ChatAgentScope | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const typed = normalizeScopeByType(trimmed, args);
  if (typed) {
    return typed;
  }

  const rangeMatch = trimmed.match(/^第?\s*(\d+)\s*章?\s*(?:-|~|～|—|－|至|到)\s*第?\s*(\d+)\s*章?$/i);
  if (rangeMatch) {
    const from = toPositiveInteger(rangeMatch[1]);
    const to = toPositiveInteger(rangeMatch[2]);
    return from && to ? { type: "chapter_range", from, to } : null;
  }

  const chapterMatch = trimmed.match(/^(?:第\s*)?(\d+)\s*章$/i) ?? trimmed.match(/^chapter[\s_-]*(\d+)$/i);
  if (chapterMatch) {
    const ordinal = toPositiveInteger(chapterMatch[1]);
    return ordinal ? { type: "chapter", ordinal } : null;
  }

  return null;
}

function normalizeScopeValue(value: unknown, parentArgs: Record<string, unknown>): ChatAgentScope | null {
  if (typeof value === "string") {
    return normalizeScopeString(value, parentArgs);
  }
  if (isRecord(value) && typeof value.type === "string") {
    const typed = normalizeScopeByType(value.type, value);
    if (typed) {
      return typed;
    }
    if (value.type.trim() === "chapter") {
      const ordinal = toPositiveInteger(value.ordinal);
      return ordinal ? { type: "chapter", ordinal } : null;
    }
    if (value.type.trim() === "chapter_range") {
      const from = toPositiveInteger(value.from);
      const to = toPositiveInteger(value.to);
      return from && to ? { type: "chapter_range", from, to } : null;
    }
  }
  return null;
}

function normalizeReadChaptersArgs(value: unknown): unknown {
  if (isRecord(value)) {
    if ("scope" in value) {
      const scope = normalizeScopeValue(value.scope, value);
      return scope ? { scope } : value;
    }
    const scope = normalizeScopeValue(value, value);
    return scope ? { scope } : value;
  }

  const scope = normalizeScopeValue(value, {});
  return scope ? { scope } : value;
}

function parseReadChaptersArgs(argumentsJson: string): { readonly scope: ChatAgentScope } {
  const parsed = readChaptersArgsSchema.safeParse(normalizeReadChaptersArgs(parseJsonArguments(argumentsJson)));
  if (!parsed.success) {
    throw new Error(
      `AI 工具 read_chapters 参数无效：请使用 {"scope":"all_chapters"}、{"scope":"current_chapter"}、{"scope":"chapter","ordinal":章节序号} 或 {"scope":"chapter_range","from":起始章节,"to":结束章节}。`
    );
  }
  return parsed.data;
}

function stringifyToolResult(value: unknown): string {
  return JSON.stringify(value);
}

function assertNotCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("AI 对话已取消。");
  }
}

type SelectionSource = {
  readonly text: string;
  readonly scopeLabel: "选中文本" | "对话内粘贴文本";
  readonly sourceChapterIds: readonly string[];
};

const INLINE_TEXT_VERB_RE = /润色|改写|重写|扩写|续写|校对|修改|优化|整理|调整|总结|概括|提炼|分析/;
const INLINE_TEXT_REFERENCE_RE = /这段|这一段|本段|下面|以下|上述|上面|前面|文字|内容|正文|段落|这章|这一章|本章/;

function stripWrappingCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  return match ? match[1].trim() : trimmed;
}

function isLikelyInlineTextInstructionLine(line: string): boolean {
  const compact = line.trim().replace(/\s+/g, "");
  if (!compact || compact.length > 90) {
    return false;
  }

  return INLINE_TEXT_VERB_RE.test(compact) && (INLINE_TEXT_REFERENCE_RE.test(compact) || /^(请|帮我|帮忙|麻烦)/.test(compact));
}

function isLikelyInlineSourceText(text: string): boolean {
  const compact = text.trim();
  return compact.length >= 12 && /[\u3400-\u9fff]/.test(compact);
}

function extractTextAfterInstructionColon(message: string): string | null {
  const normalized = message.replace(/\r\n/g, "\n").trim();
  const match = normalized.match(
    /^(?:请|帮我|帮忙|麻烦你?)?(?:把|将|对)?(?:下面|以下|这段|这一段|本段|这段文字|这段内容)?(?:文字|内容|正文|段落)?(?:进行)?(?:润色|改写|重写|扩写|续写|校对|修改|优化|整理|调整|总结|概括|提炼|分析)(?:一下|下)?[：:]\s*([\s\S]+)$/
  );
  if (!match) {
    return null;
  }

  const text = stripWrappingCodeFence(match[1]);
  return isLikelyInlineSourceText(text) ? text : null;
}

function extractInlineUserTextFromMessage(message: string): string | null {
  const afterColon = extractTextAfterInstructionColon(message);
  if (afterColon) {
    return afterColon;
  }

  const lines = stripWrappingCodeFence(message.replace(/\r\n/g, "\n"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return null;
  }

  let start = 0;
  let end = lines.length;
  let removedInstruction = false;

  while (start < end && isLikelyInlineTextInstructionLine(lines[start])) {
    start += 1;
    removedInstruction = true;
  }
  while (end > start && isLikelyInlineTextInstructionLine(lines[end - 1])) {
    end -= 1;
    removedInstruction = true;
  }

  if (!removedInstruction) {
    return null;
  }

  const text = stripWrappingCodeFence(lines.slice(start, end).join("\n"));
  return isLikelyInlineSourceText(text) ? text : null;
}

function resolveSelectionSource(runtime: ChatAgentToolRuntime): SelectionSource | null {
  const editorSelectionText = runtime.selectionText?.trim();
  if (editorSelectionText) {
    return {
      text: editorSelectionText,
      scopeLabel: "选中文本",
      sourceChapterIds: runtime.currentChapterId ? [runtime.currentChapterId] : []
    };
  }

  const inlineText = extractInlineUserTextFromMessage(runtime.userMessage);
  if (!inlineText) {
    return null;
  }

  return {
    text: inlineText,
    scopeLabel: "对话内粘贴文本",
    sourceChapterIds: []
  };
}

function createPlanForScope(scope: z.output<typeof chatAgentScopeSchema>): ChatAgentPlan {
  return {
    intent: "answer",
    scope,
    actions: [],
    reason: "AI 工具读取章节上下文"
  };
}

async function executeListChapters(runtime: ChatAgentToolRuntime): Promise<ChatAgentToolExecutionResult> {
  assertNotCanceled(runtime.signal);
  const chapters = runtime.chapterRepo.listByProject(runtime.projectId).map((chapter, index) => ({
    ordinal: index + 1,
    id: chapter.id,
    title: chapter.title,
    wordCount: chapter.wordCount,
    current: chapter.id === runtime.currentChapterId
  }));

  return {
    action: null,
    content: stringifyToolResult({
      chapters
    })
  };
}

async function executeGetProjectContext(runtime: ChatAgentToolRuntime): Promise<ChatAgentToolExecutionResult> {
  assertNotCanceled(runtime.signal);
  const chapters = runtime.chapterRepo.listByProject(runtime.projectId);
  const currentChapter = runtime.currentChapterId ? chapters.find((chapter) => chapter.id === runtime.currentChapterId) ?? null : null;
  const inlineText = extractInlineUserTextFromMessage(runtime.userMessage);

  return {
    action: null,
    content: stringifyToolResult({
      projectId: runtime.projectId,
      chapterCount: chapters.length,
      currentChapter: currentChapter
        ? {
            id: currentChapter.id,
            title: currentChapter.title,
            wordCount: currentChapter.wordCount
          }
        : null,
      hasSelection: Boolean(runtime.selectionText?.trim()),
      hasInlinePastedText: Boolean(inlineText)
    })
  };
}

async function executeReadChapters(runtime: ChatAgentToolRuntime, argumentsJson: string): Promise<ChatAgentToolExecutionResult> {
  assertNotCanceled(runtime.signal);
  const args = parseReadChaptersArgs(argumentsJson);
  if (args.scope.type === "selection") {
    const source = resolveSelectionSource(runtime);
    if (!source) {
      throw new Error("当前没有选中文本，请先选择正文，或把要处理的文字直接粘贴到当前消息里。");
    }
    return {
      action: null,
      content: stringifyToolResult({
        scopeLabel: source.scopeLabel,
        mode: "direct",
        sourceChapterIds: source.sourceChapterIds,
        contextText: source.text
      })
    };
  }

  const resolved = resolveChatAgentContext(
    {
      projectId: runtime.projectId,
      message: runtime.userMessage,
      chapterId: runtime.currentChapterId,
      selectionText: runtime.selectionText
    },
    createPlanForScope(args.scope),
    runtime.chapterRepo,
    runtime.tokenBudget
  );
  let agentContext = resolved.agentContext;

  if (resolved.requiresSummaries) {
    if (!runtime.summarizeResolvedContext) {
      throw new Error("章节上下文超过模型输入预算，需要摘要压缩，但 AI 摘要服务未初始化。");
    }
    agentContext = await runtime.summarizeResolvedContext(resolved, runtime.signal);
  }

  return {
    action: null,
    content: stringifyToolResult({
      scopeLabel: agentContext.scopeLabel,
      mode: agentContext.mode,
      sourceChapterIds: agentContext.sourceChapterIds,
      contextText: agentContext.contextText
    })
  };
}

async function executeReadSelection(runtime: ChatAgentToolRuntime): Promise<ChatAgentToolExecutionResult> {
  assertNotCanceled(runtime.signal);
  const source = resolveSelectionSource(runtime);
  if (!source) {
    throw new Error("当前没有选中文本，请先选择正文，或把要处理的文字直接粘贴到当前消息里。");
  }

  return {
    action: null,
    content: stringifyToolResult({
      scopeLabel: source.scopeLabel,
      mode: "direct",
      sourceChapterIds: source.sourceChapterIds,
      contextText: source.text
    })
  };
}

function assertChapterBelongsToProject(runtime: ChatAgentToolRuntime, chapterId: string): void {
  const exists = runtime.chapterRepo.listByProject(runtime.projectId).some((chapter) => chapter.id === chapterId);
  if (!exists) {
    throw new Error("不能把草稿纸内容绑定到当前项目以外的章节。");
  }
}

async function executeAddToScratchpad(runtime: ChatAgentToolRuntime, argumentsJson: string): Promise<ChatAgentToolExecutionResult> {
  assertNotCanceled(runtime.signal);
  if (!runtime.allowedActions?.includes("add_to_scratchpad")) {
    throw new Error("作者没有要求加入草稿纸，AI 不能自动写入草稿纸。");
  }
  if (!runtime.scratchRepo) {
    throw new Error("草稿纸服务未初始化，无法写入草稿纸。");
  }

  const args = parseArgs(addToScratchpadArgsSchema, argumentsJson, "add_to_scratchpad");
  const chapterId = args.chapterId === undefined ? runtime.currentChapterId ?? null : args.chapterId;
  if (chapterId) {
    assertChapterBelongsToProject(runtime, chapterId);
  }

  const note = runtime.scratchRepo.create({
    projectId: runtime.projectId,
    chapterId,
    content: args.content,
    pinned: args.pinned ?? false,
    sourceTaskId: null
  });
  const action = {
    type: "add_to_scratchpad",
    content: note.content,
    chapterId: note.chapterId
  } satisfies AiChatAction;

  return {
    action,
    content: stringifyToolResult({
      ok: true,
      noteId: note.id,
      action
    })
  };
}

export async function executeChatAgentTool(input: ChatAgentToolExecutionInput): Promise<string> {
  return (await executeChatAgentToolWithAction(input)).content;
}

export async function executeChatAgentToolWithAction(input: ChatAgentToolExecutionInput): Promise<ChatAgentToolExecutionResult> {
  switch (input.name) {
    case "get_project_context":
      parseArgs(emptyArgsSchema, input.argumentsJson, input.name);
      return executeGetProjectContext(input.runtime);
    case "list_chapters":
      parseArgs(emptyArgsSchema, input.argumentsJson, input.name);
      return executeListChapters(input.runtime);
    case "read_chapters":
      return executeReadChapters(input.runtime, input.argumentsJson);
    case "read_selection":
      parseArgs(emptyArgsSchema, input.argumentsJson, input.name);
      return executeReadSelection(input.runtime);
    case "add_to_scratchpad":
      return executeAddToScratchpad(input.runtime, input.argumentsJson);
    default:
      throw new Error(`未知 AI 工具：${input.name}`);
  }
}
