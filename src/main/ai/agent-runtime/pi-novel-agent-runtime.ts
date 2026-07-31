import { agentLoop, type AgentContext, type AgentMessage, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import { streamSimple as streamOpenAiCompatible } from "@earendil-works/pi-ai/api/openai-completions";
import type { AssistantMessage, Message, Model, TSchema } from "@earendil-works/pi-ai";
import { DEFAULT_CONTENT_LANGUAGE, needsJapaneseResponseCorrection, resolveResponseLanguage } from "../../shared/language";
import type { AiChatAction } from "../../shared/types";
import type { OpenRouterRuntimeConfig, SettingsService } from "../../settings/settings-service";
import { getTokenBudget } from "../token-budget";
import {
  buildNovelAgentSystemPrompt,
  buildNovelAgentUserPrompt,
  estimateNovelAgentInputTokens,
  explicitlyRequestsWritingOperation,
  formatWritingOperationToolResult,
  isProofreadRequest,
  localizeNovelAgentTools,
  NOVEL_AGENT_MAX_TURNS,
  readNovelAgentContextStatus,
  userRequestedScratchpad,
  type NovelAgentContextStatus
} from "./novel-agent-policy";
import { createNovelAgentActivityTracker, type NovelAgentActivityTracker } from "./novel-agent-activity";
import { createNovelAgentTaskTools, type NovelAgentTaskTools } from "./novel-agent-task-tools";
import type {
  NovelAgentRunInput,
  NovelAgentRunOptions,
  NovelAgentRunResult,
  NovelAgentRuntime,
  NovelAgentRuntimeHandlers,
  NovelAgentToolDefinition
} from "./novel-agent-runtime";

type PiNovelAgentSettings = Pick<SettingsService, "getOpenRouterConfigWithModelMetadata">;

export type PiNovelAgentRuntimeDependencies = {
  readonly settingsService: PiNovelAgentSettings;
  readonly streamFn?: StreamFn;
  readonly now?: () => number;
};

function createModel(config: OpenRouterRuntimeConfig, maxOutputTokens: number): Model<"openai-completions"> {
  const directDeepSeek = config.providerType === "deepseek";
  const tencentTokenHub = config.providerType === "tencent-tokenhub";
  return {
    id: config.modelName,
    name: config.modelName,
    api: "openai-completions",
    provider: config.providerType,
    baseUrl: config.baseUrl.replace(/\/+$/u, ""),
    reasoning: true,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0
    },
    contextWindow: config.contextLength ?? 128_000,
    maxTokens: maxOutputTokens,
    ...(directDeepSeek
      ? {
          thinkingLevelMap: {
            minimal: null,
            low: null,
            medium: null,
            high: "high",
            xhigh: "max",
            max: "max"
          },
          compat: {
            supportsStore: false,
            supportsDeveloperRole: false,
            maxTokensField: "max_tokens" as const,
            requiresReasoningContentOnAssistantMessages: true,
            thinkingFormat: "deepseek" as const,
            sessionAffinityFormat: "openai" as const,
            supportsUsageInStreaming: true
          }
        }
      : tencentTokenHub
        ? {
            thinkingLevelMap: {
              minimal: "high",
              low: "high",
              medium: "high",
              high: "high",
              xhigh: "max",
              max: "max"
            },
            compat: {
              supportsStore: false,
              supportsDeveloperRole: false,
              supportsReasoningEffort: true,
              maxTokensField: "max_tokens" as const,
              requiresReasoningContentOnAssistantMessages: false,
              thinkingFormat: "deepseek" as const,
              sessionAffinityFormat: "openai" as const,
              supportsUsageInStreaming: true,
              supportsLongCacheRetention: false
            }
          }
        : {
          compat: {
            thinkingFormat: "openrouter" as const,
            sessionAffinityFormat: "openrouter" as const,
            supportsUsageInStreaming: true
          }
        })
  };
}

function assistantText(message: AssistantMessage): string {
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("").trim();
}

function hasToolCall(message: AssistantMessage): boolean {
  return message.content.some((part) => part.type === "toolCall");
}

function isShortToolPreamble(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length > 100) return false;
  return /^(?:好的[，,]?(?:我来|我先|先|现在|已)|我会|我先|接下来|现在|让我|まず|これから|先に|確認します|読み取ります|調べます)/u.test(normalized);
}

function toAgentTools(input: {
  readonly tools: readonly NovelAgentToolDefinition[];
  readonly runInput: NovelAgentRunInput;
  readonly actions: AiChatAction[];
  readonly language: "zh-CN" | "ja-JP";
  readonly canSaveToScratchpad: boolean;
  readonly onWritingPresentation: (content: string, alreadyStreamed: boolean) => void;
  readonly onContextStatus: (status: NovelAgentContextStatus) => void;
}): AgentTool<TSchema>[] {
  return input.tools.map((tool) => ({
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters as TSchema,
    executionMode: "sequential",
    async execute(toolCallId, params, signal) {
      if (signal?.aborted) {
        throw new Error(input.language === "ja-JP" ? "AI チャットはキャンセルされました。" : "AI 对话已取消。");
      }
      const result = await input.runInput.executeTool({
        id: toolCallId,
        name: tool.name,
        argumentsJson: JSON.stringify(params ?? {})
      });
      if (result.action) {
        input.actions.push(result.action);
      }
      const contextStatus = readNovelAgentContextStatus(result.content);
      if (contextStatus) {
        input.onContextStatus(contextStatus);
      }
      const writingPresentation = tool.name === "run_writing_operation"
        ? formatWritingOperationToolResult(result.content, input.language)
        : null;
      let alreadyStreamed = false;
      if (writingPresentation) {
        try {
          const parsed = JSON.parse(result.content) as { readonly streamedPresentation?: unknown };
          alreadyStreamed = parsed.streamedPresentation === true;
        } catch {
          alreadyStreamed = false;
        }
        input.onWritingPresentation(writingPresentation, alreadyStreamed);
      }
      return {
        content: [{ type: "text", text: result.content }],
        details: {
          action: result.action,
          toolName: tool.name
        },
        terminate: Boolean(writingPresentation && !input.canSaveToScratchpad)
      };
    }
  }));
}

function toTaskAgentTools(input: {
  readonly taskTools: NovelAgentTaskTools;
  readonly activityTracker: NovelAgentActivityTracker;
  readonly language: "zh-CN" | "ja-JP";
}): AgentTool<TSchema>[] {
  return input.taskTools.definitions.map((tool) => ({
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters as TSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) {
        throw new Error(input.language === "ja-JP" ? "AI チャットはキャンセルされました。" : "AI 对话已取消。");
      }
      const execution = input.taskTools.execute(tool.name, params);
      input.activityTracker.upsertTask(execution.task);
      return {
        content: [{ type: "text", text: execution.content }],
        details: { task: execution.task }
      };
    }
  }));
}

function createRunStreamFn(base: StreamFn, providerType: OpenRouterRuntimeConfig["providerType"]): StreamFn {
  return (model, context, options = {}) => {
    const callerPayloadTransform = options.onPayload;
    return base(model, context, {
      ...options,
      onPayload: async (payload, payloadModel) => {
        const callerPayload = callerPayloadTransform ? await callerPayloadTransform(payload, payloadModel) : undefined;
        const nextPayload = callerPayload ?? payload;
        if (!nextPayload || typeof nextPayload !== "object" || Array.isArray(nextPayload)) {
          return nextPayload;
        }
        if (providerType === "openrouter") {
          return {
            ...nextPayload,
            parallel_tool_calls: false
          };
        }
        if (providerType === "tencent-tokenhub") {
          const payloadRecord = nextPayload as Record<string, unknown>;
          const { reasoning_effort: reasoningEffort, ...payloadWithoutTopLevelEffort } = payloadRecord;
          const thinking = payloadRecord.thinking;
          return {
            ...payloadWithoutTopLevelEffort,
            ...(thinking && typeof thinking === "object" && !Array.isArray(thinking)
              ? {
                  thinking: {
                    ...thinking,
                    ...(typeof reasoningEffort === "string" ? { reasoning_effort: reasoningEffort } : {})
                  }
                }
              : {})
          };
        }
        return nextPayload;
      }
    });
  };
}

export class PiNovelAgentRuntime implements NovelAgentRuntime {
  private readonly now: () => number;
  private readonly streamFn: StreamFn;

  constructor(private readonly dependencies: PiNovelAgentRuntimeDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.streamFn = dependencies.streamFn ?? ((model, context, options) =>
      streamOpenAiCompatible(model as Model<"openai-completions">, context, options));
  }

  async run(
    input: NovelAgentRunInput,
    handlers: NovelAgentRuntimeHandlers,
    options: NovelAgentRunOptions = {}
  ): Promise<NovelAgentRunResult> {
    const contentLanguage = input.contentLanguage ?? DEFAULT_CONTENT_LANGUAGE;
    const language = input.responseLanguage ?? resolveResponseLanguage(input.message, contentLanguage);
    const config = await this.dependencies.settingsService.getOpenRouterConfigWithModelMetadata(undefined, { requireTools: true });
    const budget = getTokenBudget("chat", config.contextLength);
    const tools = localizeNovelAgentTools(input.tools, language);
    const taskTools = createNovelAgentTaskTools(language);
    const allToolDefinitions = [...tools, ...taskTools.definitions];
    const systemPrompt = buildNovelAgentSystemPrompt(language, contentLanguage);
    const userPrompt = buildNovelAgentUserPrompt(input, budget, language, contentLanguage);
    const actions: AiChatAction[] = [];
    const activityTracker = createNovelAgentActivityTracker({
      requestId: input.requestId,
      language,
      now: this.now,
      onActivity(activity) {
        handlers.onActivity?.({ requestId: input.requestId, activity });
      }
    });
    const canSaveToScratchpad = userRequestedScratchpad(input.message);
    let contextStatus: NovelAgentContextStatus = {
      contextMode: input.agentContext?.mode ?? "direct",
      scopeLabel: input.agentContext?.scopeLabel ?? (language === "ja-JP" ? "現在の会話" : "当前对话")
    };
    let writingPresentation: string | null = null;
    let writingPresentationAlreadyStreamed = false;

    const emitContext = (): void => {
      handlers.onContext?.({
        requestId: input.requestId,
        estimatedInputTokens: estimateNovelAgentInputTokens(systemPrompt, userPrompt, allToolDefinitions),
        maxInputTokens: budget.maxInputTokens,
        maxOutputTokens: budget.maxOutputTokens,
        modelContextTokens: config.contextLength,
        modelName: config.modelName,
        ...contextStatus
      });
    };
    emitContext();

    const piTools = [
      ...toAgentTools({
        tools,
        runInput: input,
        actions,
        language,
        canSaveToScratchpad,
        onWritingPresentation(content, alreadyStreamed) {
          writingPresentation = content;
          writingPresentationAlreadyStreamed = alreadyStreamed;
        },
        onContextStatus(status) {
          contextStatus = status;
          emitContext();
        }
      }),
      ...toTaskAgentTools({ taskTools, activityTracker, language })
    ];
    const context: AgentContext = {
      systemPrompt,
      messages: [],
      tools: piTools
    };
    const prompt: AgentMessage = {
      role: "user",
      content: userPrompt,
      timestamp: this.now()
    };
    let completedTurns = 0;
    let lastAssistant: AssistantMessage | null = null;
    let pendingVisibleText = "";
    const visibleAssistantSegments: string[] = [];
    let languageCorrectionPending = false;
    let languageCorrectionAttempts = 0;
    let writingToolCorrectionPending = false;
    let writingToolCorrectionAttempts = 0;
    const writingOperationAttempted = (): boolean => activityTracker.records().some(
      (activity) => activity.kind === "tool" && activity.toolName === "run_writing_operation"
    );
    const eventStream = agentLoop(
      [prompt],
      context,
      {
        model: createModel(config, budget.maxOutputTokens),
        apiKey: config.apiKey,
        ...(config.providerType === "openrouter"
          ? {
              headers: {
                "X-OpenRouter-Title": "MoShu"
              }
            }
          : {}),
        maxTokens: budget.maxOutputTokens,
        temperature: isProofreadRequest(input.message) ? 0.2 : 0.55,
        reasoning: config.providerType === "deepseek" ? "high" : "medium",
        toolExecution: "sequential",
        convertToLlm: (messages) => messages as Message[],
        shouldStopAfterTurn({ message }) {
          completedTurns += 1;
          const answer = assistantText(message);
          languageCorrectionPending = language === "ja-JP"
            && !hasToolCall(message)
            && Boolean(answer)
            && needsJapaneseResponseCorrection(answer)
            && languageCorrectionAttempts < 1
            && completedTurns < NOVEL_AGENT_MAX_TURNS;
          writingToolCorrectionPending = !hasToolCall(message)
            && Boolean(answer)
            && explicitlyRequestsWritingOperation(input.message)
            && !writingPresentation
            && !writingOperationAttempted()
            && writingToolCorrectionAttempts < 1
            && completedTurns < NOVEL_AGENT_MAX_TURNS;
          return completedTurns >= NOVEL_AGENT_MAX_TURNS;
        },
        getFollowUpMessages: async () => {
          if (languageCorrectionPending) {
            languageCorrectionPending = false;
            languageCorrectionAttempts += 1;
            return [{
              role: "user",
              content: "直前の回答は中国語に偏っています。内容を失わず、作者向けの説明と結論を自然な日本語だけで書き直してください。中国語の途中メモや推論は出さないでください。",
              timestamp: this.now()
            }];
          }
          if (writingToolCorrectionPending) {
            writingToolCorrectionPending = false;
            writingToolCorrectionAttempts += 1;
            return [{
              role: "user",
              content: language === "ja-JP"
                ? "この依頼は明示的な執筆操作です。直前の直接回答は採用せず、run_writing_operation を呼び出して構造化された候補または校正結果を生成してください。"
                : "这是明确的写作操作请求。不要采用上一轮直接回答，请调用 run_writing_operation 生成结构化候选或校对结果。",
              timestamp: this.now()
            }];
          }
          return [];
        }
      },
      options.signal,
      createRunStreamFn(this.streamFn, config.providerType)
    );

    try {
      for await (const event of eventStream) {
        if (event.type === "tool_execution_start") {
          activityTracker.startTool(event.toolCallId, event.toolName, event.args);
        }
        if (event.type === "tool_execution_update") {
          activityTracker.updateTool(event.toolCallId, event.partialResult);
        }
        if (event.type === "tool_execution_end") {
          activityTracker.finishTool(event.toolCallId, event.result, event.isError);
        }
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          pendingVisibleText += event.assistantMessageEvent.delta;
        }
        if (event.type === "message_end" && event.message.role === "assistant") {
          lastAssistant = event.message;
          const visibleText = pendingVisibleText.trim();
          const shouldKeepVisibleText = Boolean(visibleText)
            && (!hasToolCall(event.message) || !isShortToolPreamble(visibleText));
          if (shouldKeepVisibleText) {
            const shouldExpose = !(language === "ja-JP" && needsJapaneseResponseCorrection(visibleText))
              && !(explicitlyRequestsWritingOperation(input.message) && !writingOperationAttempted());
            if (shouldExpose) {
              visibleAssistantSegments.push(visibleText);
              handlers.onChunk?.({ requestId: input.requestId, content: visibleText });
            }
          }
          pendingVisibleText = "";
        }
      }
    } catch (error) {
      activityTracker.stopRunning(options.signal?.aborted ? "stopped" : "error");
      throw error;
    }

    if (options.signal?.aborted || lastAssistant?.stopReason === "aborted") {
      activityTracker.stopRunning("stopped");
      throw new Error(language === "ja-JP" ? "AI チャットはキャンセルされました。" : "AI 对话已取消。");
    }
    if (lastAssistant?.stopReason === "error") {
      activityTracker.stopRunning("error");
      throw new Error(lastAssistant.errorMessage || (language === "ja-JP" ? "AI エージェントの実行に失敗しました。" : "AI Agent 执行失败。"));
    }
    if (writingPresentation && (!lastAssistant || hasToolCall(lastAssistant) || !assistantText(lastAssistant))) {
      if (!writingPresentationAlreadyStreamed) {
        handlers.onChunk?.({ requestId: input.requestId, content: writingPresentation });
      }
      activityTracker.finishAll();
      return {
        role: "assistant",
        content: writingPresentation,
        createdAt: new Date(this.now()).toISOString(),
        actions,
        activities: activityTracker.records()
      };
    }
    if (completedTurns >= NOVEL_AGENT_MAX_TURNS && lastAssistant && hasToolCall(lastAssistant)) {
      activityTracker.stopRunning("error");
      throw new Error(
        language === "ja-JP"
          ? `AI のツール呼び出しが ${NOVEL_AGENT_MAX_TURNS} ターンを超えたため、ループ防止のため停止しました。`
          : `AI 对话工具调用超过 ${NOVEL_AGENT_MAX_TURNS} 轮，已停止以避免循环。`
      );
    }
    if (!lastAssistant) {
      activityTracker.stopRunning("error");
      throw new Error(language === "ja-JP" ? "AI から回答が返されませんでした。" : "AI 没有返回回答。");
    }
    const finalText = assistantText(lastAssistant);
    if (!finalText) {
      activityTracker.stopRunning("error");
      throw new Error(language === "ja-JP" ? "AI から表示可能な回答が返されませんでした。" : "AI 没有返回可展示的回答。");
    }
    const languageSafeText = language === "ja-JP" && needsJapaneseResponseCorrection(finalText)
      ? "日本語での回答生成に失敗しました。内容が中国語のまま表示されるのを防ぐため、回答を停止しました。もう一度お試しください。"
      : explicitlyRequestsWritingOperation(input.message) && !writingOperationAttempted()
        ? language === "ja-JP"
          ? "執筆操作ツールを正しく実行できなかったため、未検証の直接回答は表示しません。もう一度お試しください。"
          : "写作操作工具未能正确执行，因此没有展示未经结构化工具验证的直接回答。请重试。"
        : finalText;
    if (languageSafeText !== finalText) {
      handlers.onChunk?.({ requestId: input.requestId, content: languageSafeText });
    }
    const visibleContent = languageSafeText === finalText && visibleAssistantSegments.length > 0
      ? visibleAssistantSegments.join("\n\n")
      : languageSafeText;
    const content = lastAssistant.stopReason === "length"
      ? `${visibleContent}${language === "ja-JP" ? "\n\n（回答はモデルの出力上限で途中までになっています。範囲を小さくして続けてください。）" : "\n\n（回答已被模型截断，以上是已生成的部分。建议缩小范围后继续。）"}`
      : visibleContent;
    activityTracker.finishAll();
    return {
      role: "assistant",
      content,
      createdAt: new Date(this.now()).toISOString(),
      actions,
      activities: activityTracker.records()
    };
  }
}
