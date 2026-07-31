import type { ChapterRepository } from "../db/repositories/chapter-repo";
import type { SummaryRepository } from "../db/repositories/summary-repo";
import type { SettingsService } from "../settings/settings-service";
import type { AiTaskRecord, TaskPromptPreset } from "../shared/types";
import type { AiProviderType } from "../shared/ai-provider";
import { DEFAULT_CONTENT_LANGUAGE, needsJapaneseResponseCorrection, resolveInlineContentLanguage, type ContentLanguage } from "../shared/language";
import type { AiGenerationOptions, AiTaskStreamHandlers } from "./ai-task-service";
import { logDevLlmPrompt } from "./dev-prompt-logger";
import {
  OpenRouterClient,
  type OpenRouterChatCompletionInput,
  type OpenRouterChatCompletionResult,
  type OpenRouterStreamHandlers
} from "./openrouter-client";
import { getTokenBudget } from "./token-budget";
import { planWritingOperationContext } from "./writing-context-planner";
import { getWritingOperationDefinition } from "./writing-operation-registry";
import {
  buildWritingOperationPrompt,
  estimateWritingOperationFixedInputTokens,
  parseWritingOperationResponse
} from "./writing-operation-prompt";
import { loadWritingSkill } from "./writing-skill-loader";
import { estimateMessagesTokens } from "./token-estimator";
import type { WritingOperationOutputKind, WritingOperationRequest, WritingOperationResult, WritingOperationTarget } from "./writing-operation-types";

type OpenRouterClientLike = {
  readonly createChatCompletion: (input: OpenRouterChatCompletionInput) => Promise<OpenRouterChatCompletionResult>;
  readonly streamChatCompletion: (
    input: OpenRouterChatCompletionInput,
    handlers?: OpenRouterStreamHandlers
  ) => Promise<OpenRouterChatCompletionResult>;
};

type WritingOperationRunnerOptions = {
  readonly resolveChapterRepo: (projectId: string) => ChapterRepository;
  readonly resolveSummaryRepo?: (projectId: string) => SummaryRepository;
  readonly resolveTaskPreset: (presetId: string | null | undefined, taskType: AiTaskRecord["taskType"]) => TaskPromptPreset | null;
  readonly resolveModelConfig: () => Promise<{
    readonly providerType?: AiProviderType;
    readonly apiKey: string;
    readonly baseUrl?: string;
    readonly modelName: string;
    readonly contextLength: number | null;
  }>;
  readonly createClient?: (config: {
    readonly providerType?: AiProviderType;
    readonly apiKey: string;
    readonly baseUrl?: string;
    readonly modelName: string;
  }) => OpenRouterClientLike;
  readonly resolveContentLanguage?: (projectId: string) => ContentLanguage;
};

const WRITING_BLOCKING_COMPLETION_TIMEOUT_MS = 60_000;

function taskTarget(task: AiTaskRecord): WritingOperationTarget {
  if (task.selection) {
    return {
      kind: "selection",
      chapterId: task.selection.chapterId,
      selectionHash: task.selection.selectionHash,
      text: task.inputText
    };
  }

  return {
    kind: "inline_text",
    text: task.inputText
  };
}

function buildTruncatedResult(taskType: AiTaskRecord["taskType"], content: string): Omit<WritingOperationResult, "contextPlan"> {
  return {
    generatedText: content.trim(),
    changeSummary: `AI ${taskType} candidate（结果已截断）`,
    proofreadIssues: null,
    truncated: true
  };
}

function buildContinuationMessages(
  prompt: { readonly messages: readonly OpenRouterChatCompletionInput["messages"][number][] },
  partialText: string,
  language: ContentLanguage
): readonly OpenRouterChatCompletionInput["messages"][number][] {
  return [
    ...prompt.messages,
    {
      role: "user",
      content: language === "ja-JP"
        ? [
            "前回の出力は途中で切れました。同じ候補本文の続きを出力してください。",
            "出力済みの部分を繰り返さず、説明、要約、提案一覧を付けないでください。",
            "以下の候補本文の末尾から続く本文だけを出力してください。",
            "",
            "【出力済み候補本文】",
            partialText.trim()
          ].join("\n")
        : [
            "上一次输出已被截断。请继续输出同一份候选正文。",
            "不要重复已输出内容，不要解释，不要总结，不要使用建议清单。",
            "只输出从以下已输出候选稿末尾继续的正文。",
            "",
            "【已输出候选稿】",
            partialText.trim()
          ].join("\n")
    }
  ];
}

function stripContinuationDraftLabel(content: string): string {
  return content
    .trim()
    .replace(/^【(?:润色稿|改写稿|扩写稿|续写稿|候选正文)】\s*/u, "")
    .replace(/^【(?:推敲案|リライト案|加筆案|続きの本文|候補本文)】\s*/u, "")
    .replace(/^(?:润色稿|改写稿|扩写稿|续写稿|候选正文)[:：]\s*/u, "")
    .trim();
}

function writingResultNeedsJapaneseCorrection(result: Omit<WritingOperationResult, "contextPlan">): boolean {
  const visibleText = result.generatedText.trim() || (result.proofreadIssues ?? [])
    .flatMap((issue) => [issue.explanation, issue.suggestion])
    .join("\n")
    .trim();
  return Boolean(visibleText) && needsJapaneseResponseCorrection(visibleText);
}

function japaneseCorrectionInstruction(outputKind: WritingOperationOutputKind): string {
  return outputKind === "proofread_issues"
    ? "直前の校正結果は中国語に偏っています。同じ指摘内容を保ち、explanation、suggestion、locationHint、evidence.note を自然な日本語に直し、指定済みの JSON Schema に一致する JSON だけを返してください。"
    : "直前の候補本文は中国語になっています。内容、視点、事実関係を変えず、自然な日本語の小説本文に直してください。説明や見出しを付けず、候補本文だけを返してください。";
}

export class WritingOperationRunner {
  constructor(private readonly options: WritingOperationRunnerOptions) {}

  static fromSettings(
    settingsService: SettingsService,
    resolveChapterRepo: (projectId: string) => ChapterRepository,
    resolveSummaryRepo?: (projectId: string) => SummaryRepository,
    resolveContentLanguage?: (projectId: string) => ContentLanguage
  ): WritingOperationRunner {
    return new WritingOperationRunner({
      resolveChapterRepo,
      resolveSummaryRepo,
      resolveContentLanguage,
      resolveTaskPreset: (presetId, taskType) => settingsService.getTaskPromptPresetForTask(presetId, taskType),
      resolveModelConfig: async () => {
        const config = await settingsService.getOpenRouterConfigWithModelMetadata();
        return {
          providerType: config.providerType,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          modelName: config.modelName,
          contextLength: config.contextLength
        };
      }
    });
  }

  private createClient(config: {
    readonly providerType?: AiProviderType;
    readonly apiKey: string;
    readonly baseUrl?: string;
    readonly modelName: string;
  }): OpenRouterClientLike {
    return this.options.createClient?.(config) ?? new OpenRouterClient(config);
  }

  private async createCompletionWithDeadline(
    client: OpenRouterClientLike,
    request: OpenRouterChatCompletionInput,
    language: ContentLanguage
  ): Promise<OpenRouterChatCompletionResult> {
    const controller = new AbortController();
    const abortFromCaller = (): void => controller.abort(request.signal?.reason);
    if (request.signal?.aborted) {
      abortFromCaller();
    } else {
      request.signal?.addEventListener("abort", abortFromCaller, { once: true });
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(language === "ja-JP"
          ? "AI の執筆操作が 60 秒以内に完了しませんでした。上流モデルが混雑している可能性があります。もう一度お試しください。"
          : "AI 写作操作未能在 60 秒内完成。上游模型可能繁忙，请重试。"));
        controller.abort();
      }, WRITING_BLOCKING_COMPLETION_TIMEOUT_MS);
    });

    try {
      return await Promise.race([
        client.createChatCompletion({ ...request, signal: controller.signal }),
        deadline
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  private async generateOperationResult(input: {
    readonly client: OpenRouterClientLike;
    readonly contentLanguage: ContentLanguage;
    readonly operation: ReturnType<typeof getWritingOperationDefinition>;
    readonly prompt: ReturnType<typeof buildWritingOperationPrompt>;
    readonly signal?: AbortSignal;
    readonly handlers?: AiTaskStreamHandlers;
  }): Promise<Omit<WritingOperationResult, "contextPlan">> {
    const request = {
      messages: input.prompt.messages,
      maxCompletionTokens: input.prompt.maxCompletionTokens,
      temperature: input.prompt.temperature,
      responseFormat: input.prompt.responseFormat,
      reasoning: input.prompt.reasoning,
      signal: input.signal
    };
    const streamCandidate = input.operation.outputKind === "candidate_text" && input.contentLanguage !== "ja-JP";
    let response = streamCandidate
      ? await input.client.streamChatCompletion(request, {
          onToken(token) {
            input.handlers?.onChunk?.({ requestId: "", content: token });
          },
          onReasoning(token) {
            input.handlers?.onReasoning?.({ requestId: "", content: token });
          }
        })
      : await this.createCompletionWithDeadline(input.client, request, input.contentLanguage);
    let result = response.truncated
      ? buildTruncatedResult(input.operation.id, response.content)
      : parseWritingOperationResponse(input.operation, response.content);

    if (!response.truncated && input.contentLanguage === "ja-JP" && writingResultNeedsJapaneseCorrection(result)) {
      response = await this.createCompletionWithDeadline(input.client, {
        ...request,
        messages: [
          ...input.prompt.messages,
          { role: "assistant", content: response.content },
          { role: "user", content: japaneseCorrectionInstruction(input.operation.outputKind) }
        ],
        temperature: Math.min(input.prompt.temperature, 0.25),
        reasoning: { effort: "low", exclude: true }
      }, input.contentLanguage);
      result = response.truncated
        ? buildTruncatedResult(input.operation.id, response.content)
        : parseWritingOperationResponse(input.operation, response.content);
      if (!response.truncated && writingResultNeedsJapaneseCorrection(result)) {
        throw new Error("日本語の候補を生成できませんでした。中国語の結果は表示せず停止しました。もう一度お試しください。");
      }
    }

    if (!streamCandidate && input.operation.outputKind === "candidate_text" && result.generatedText.trim()) {
      input.handlers?.onChunk?.({ requestId: "", content: result.generatedText });
    }
    return result;
  }

  private async buildPromptForRequest(request: WritingOperationRequest) {
    const config = await this.options.resolveModelConfig();
    const operation = getWritingOperationDefinition(request.operation);
    const projectLanguage = this.options.resolveContentLanguage?.(request.projectId) ?? DEFAULT_CONTENT_LANGUAGE;
    const targetText = request.target.kind === "inline_text" || request.target.kind === "selection"
      ? request.target.text
      : "";
    const contentLanguage = targetText ? resolveInlineContentLanguage(targetText, projectLanguage) : projectLanguage;
    const tokenBudget = getTokenBudget(operation.tokenBudgetTaskType, config.contextLength);
    const skill = loadWritingSkill(operation.skillId);
    const fixedInputTokens = estimateWritingOperationFixedInputTokens({
      operation,
      skill,
      userInstruction: request.userInstruction,
      preset: request.preset ?? null,
      tokenBudget,
      source: request.source,
      contentLanguage
    });
    const contextPlan = planWritingOperationContext({
      projectId: request.projectId,
      operation,
      target: request.target,
      chapterRepo: this.options.resolveChapterRepo(request.projectId),
      summaryRepo: this.options.resolveSummaryRepo?.(request.projectId),
      tokenBudget,
      reservedInputTokens: fixedInputTokens
    });
    const prompt = buildWritingOperationPrompt({
      operation,
      skill,
      contextPlan,
      userInstruction: request.userInstruction,
      preset: request.preset ?? null,
      tokenBudget,
      source: request.source,
      contentLanguage
    });
    const estimatedInputTokens = estimateMessagesTokens(prompt.messages);
    if (estimatedInputTokens > tokenBudget.maxInputTokens) {
      throw new Error(contentLanguage === "ja-JP"
        ? "今回の要望と対象本文が長すぎるため、一度に安定して処理できません。選択範囲または今回の要望を短くして、もう一度お試しください。"
        : "本次要求与目标文本合计过长，无法一次可靠处理。请缩短选区或本次要求后重试。");
    }
    const measuredContextPlan = {
      ...contextPlan,
      estimatedInputTokens
    };

    return { config, contentLanguage, contextPlan: measuredContextPlan, operation, prompt };
  }

  private async buildPromptForTask(task: AiTaskRecord) {
    return this.buildPromptForRequest({
      projectId: task.projectId,
      source: "selection_toolbar",
      operation: task.taskType,
      target: taskTarget(task),
      userInstruction: task.instruction ?? "",
      preset: this.options.resolveTaskPreset(task.presetId, task.taskType)
    });
  }

  async runRequest(
    request: WritingOperationRequest,
    options: AiGenerationOptions = {},
    handlers: AiTaskStreamHandlers = {}
  ): Promise<WritingOperationResult> {
    const { config, contentLanguage, contextPlan, operation, prompt } = await this.buildPromptForRequest(request);
    const client = this.createClient(config);
    handlers.onContext?.({
      requestId: "",
      estimatedInputTokens: contextPlan.estimatedInputTokens,
      maxInputTokens: contextPlan.maxInputTokens,
      maxOutputTokens: prompt.maxCompletionTokens,
      modelContextTokens: config.contextLength,
      modelName: config.modelName,
      contextMode: contextPlan.mode,
      scopeLabel: `写作操作：${operation.label}`
    });
    logDevLlmPrompt({
      kind: `writing-operation:${operation.id}:chat-tool`,
      modelName: config.modelName,
      messages: prompt.messages,
      meta: {
        contextMode: contextPlan.mode,
        operation: request.operation,
        projectId: request.projectId,
        source: request.source
      },
      params: {
        maxCompletionTokens: prompt.maxCompletionTokens,
        reasoning: prompt.reasoning,
        responseFormat: prompt.responseFormat,
        temperature: prompt.temperature
      }
    });

    const parsed = await this.generateOperationResult({
      client,
      contentLanguage,
      operation,
      prompt,
      signal: options.signal,
      handlers
    });

    return {
      ...parsed,
      contextPlan
    };
  }

  async continueStream(
    task: AiTaskRecord,
    partialText: string,
    handlers: AiTaskStreamHandlers,
    options: AiGenerationOptions = {}
  ): Promise<WritingOperationResult> {
    const { config, contentLanguage, contextPlan, operation, prompt } = await this.buildPromptForTask(task);
    if (operation.outputKind !== "candidate_text") {
      throw new Error("校对结果不能继续生成，请缩小校对范围后重试。");
    }
    const client = this.createClient(config);
    const messages = buildContinuationMessages(prompt, partialText, contentLanguage);
    handlers.onContext?.({
      requestId: "",
      estimatedInputTokens: contextPlan.estimatedInputTokens,
      maxInputTokens: contextPlan.maxInputTokens,
      maxOutputTokens: prompt.maxCompletionTokens,
      modelContextTokens: config.contextLength,
      modelName: config.modelName,
      contextMode: contextPlan.mode,
      scopeLabel: `写作操作：${operation.label}`
    });
    logDevLlmPrompt({
      kind: `writing-operation:${operation.id}:continue`,
      modelName: config.modelName,
      messages,
      meta: {
        chapterId: task.chapterId,
        contextMode: contextPlan.mode,
        projectId: task.projectId,
        requestMode: "stream",
        taskId: task.id,
        taskType: task.taskType
      },
      params: {
        maxCompletionTokens: prompt.maxCompletionTokens,
        reasoning: prompt.reasoning,
        responseFormat: undefined,
        temperature: prompt.temperature
      }
    });

    const response = await client.streamChatCompletion(
      {
        messages,
        maxCompletionTokens: prompt.maxCompletionTokens,
        temperature: prompt.temperature,
        reasoning: prompt.reasoning,
        signal: options.signal
      },
      {
        onToken(token) {
          handlers.onChunk?.({ requestId: "", content: token });
        }
      }
    );
    const continuedText = stripContinuationDraftLabel(response.content);
    if (!continuedText) {
      throw new Error("AI Provider 返回了空内容。");
    }

    return {
      generatedText: `${partialText}${continuedText}`,
      changeSummary: response.truncated ? `AI ${operation.id} continuation（结果已截断）` : `AI ${operation.id} continuation`,
      proofreadIssues: null,
      contextPlan,
      truncated: response.truncated
    };
  }

  async generateStream(
    task: AiTaskRecord,
    handlers: AiTaskStreamHandlers,
    options: AiGenerationOptions = {}
  ): Promise<WritingOperationResult> {
    const { config, contentLanguage, contextPlan, operation, prompt } = await this.buildPromptForTask(task);
    const client = this.createClient(config);
    handlers.onContext?.({
      requestId: "",
      estimatedInputTokens: contextPlan.estimatedInputTokens,
      maxInputTokens: contextPlan.maxInputTokens,
      maxOutputTokens: prompt.maxCompletionTokens,
      modelContextTokens: config.contextLength,
      modelName: config.modelName,
      contextMode: contextPlan.mode,
      scopeLabel: `写作操作：${operation.label}`
    });
    logDevLlmPrompt({
      kind: `writing-operation:${operation.id}:stream`,
      modelName: config.modelName,
      messages: prompt.messages,
      meta: {
        chapterId: task.chapterId,
        contextMode: contextPlan.mode,
        projectId: task.projectId,
        requestMode: "stream",
        taskId: task.id,
        taskType: task.taskType
      },
      params: {
        maxCompletionTokens: prompt.maxCompletionTokens,
        reasoning: prompt.reasoning,
        responseFormat: prompt.responseFormat,
        temperature: prompt.temperature
      }
    });

    const parsed = await this.generateOperationResult({
      client,
      contentLanguage,
      operation,
      prompt,
      signal: options.signal,
      handlers
    });

    return {
      ...parsed,
      contextPlan
    };
  }
}
