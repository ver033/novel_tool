import type {
  OpenRouterChatCompletionResult,
  OpenRouterMessage,
  OpenRouterReasoningConfig,
  OpenRouterStreamHandlers,
  OpenRouterToolCall,
  OpenRouterToolDefinition
} from "./openrouter-client";
import { buildChatAgentMemoryText } from "./chat-agent-memory";
import { estimateMessagesTokens, estimateTextTokens } from "./token-estimator";
import type { TokenBudget } from "./token-budget";
import type { AiChatAction, AiChatMessageRecord } from "../shared/types";

const CHAT_AGENT_MAX_ITERATIONS = 8;
const CHAT_AGENT_REASONING: OpenRouterReasoningConfig = {
  effort: "medium",
  exclude: false
};
const CHAT_AGENT_TRUNCATED_FINAL_NOTICE = "\n\n（回答已被模型截断，以上是已生成的部分。建议缩小范围，或按章节继续校对。）";

export type ChatAgentDirectoryItem = {
  readonly ordinal: number;
  readonly id: string;
  readonly title: string;
  readonly wordCount: number;
  readonly current: boolean;
};

export type ChatAgentModelInput = {
  readonly messages: readonly OpenRouterMessage[];
  readonly tools: readonly OpenRouterToolDefinition[];
  readonly maxCompletionTokens: number;
  readonly temperature: number;
  readonly reasoning: OpenRouterReasoningConfig;
  readonly signal?: AbortSignal;
};

export type ChatAgentModel = {
  readonly stream: (input: ChatAgentModelInput, handlers?: OpenRouterStreamHandlers) => Promise<OpenRouterChatCompletionResult>;
};

export type ChatAgentToolExecutorResult = {
  readonly content: string;
  readonly action: AiChatAction | null;
};

export type ChatAgentLoopInput = {
  readonly requestId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly userMessage: string;
  readonly history: readonly AiChatMessageRecord[];
  readonly compactedMemorySummary?: string | null;
  readonly compactedMemoryThroughMessageId?: string | null;
  readonly currentChapterId?: string;
  readonly currentChapterTitle?: string;
  readonly selectionText?: string;
  readonly chapterDirectory: readonly ChatAgentDirectoryItem[];
  readonly tools: readonly OpenRouterToolDefinition[];
  readonly model: ChatAgentModel;
  readonly tokenBudget: TokenBudget;
  readonly modelContextTokens: number | null;
  readonly modelName: string;
  readonly signal?: AbortSignal;
  readonly executeTool: (call: OpenRouterToolCall) => Promise<ChatAgentToolExecutorResult>;
};

export type ChatAgentLoopHandlers = {
  readonly onChunk?: (event: { readonly requestId: string; readonly content: string }) => void;
  readonly onReasoning?: (event: { readonly requestId: string; readonly content: string }) => void;
  readonly onContext?: (event: {
    readonly requestId: string;
    readonly estimatedInputTokens: number;
    readonly maxInputTokens: number;
    readonly maxOutputTokens: number;
    readonly modelContextTokens: number | null;
    readonly modelName: string;
    readonly contextMode: "direct" | "summarized";
    readonly scopeLabel: string;
  }) => void;
};

export type ChatAgentLoopResult = {
  readonly content: string;
  readonly actions: readonly AiChatAction[];
};

type ChatAgentContextStatus = {
  readonly contextMode: "direct" | "summarized";
  readonly scopeLabel: string;
};

function assertNotCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("AI 对话已取消。");
  }
}

function buildSystemPrompt(): string {
  return [
    "你是墨枢的中文小说写作 agent，服务对象是正在写长篇中文小说的作者。",
    "你可以使用工具读取项目章节、读取选区或作者在当前消息里直接粘贴的正文、把内容写入草稿纸。工具结果，以及作者当前消息里明确粘贴的待处理正文，才是可靠的正文来源。",
    "凡是用户问题涉及某章、全部章节、现有章节、人物、剧情、伏笔、设定、连续性、总结或摘要，必须先调用 read_chapters 读取对应范围，不要只根据当前打开章节或章节目录回答。",
    "如果用户在当前消息里直接粘贴正文并要求“润色这一段”“改写下面内容”等，可以调用 read_selection；没有编辑器选区时，该工具会读取当前消息里的粘贴文本。",
    "如果用户使用自然语言追问，例如“同时”“还有”“顺便”，要结合最近对话记忆判断上一轮范围；不确定时可以先 list_chapters 或 read_chapters，而不是直接要求用户重复。",
    "如果用户明确要求保存到草稿纸，先整理要保存的正文，再调用 add_to_scratchpad；工具成功后再给最终回复。",
    "不要直接写回正文。涉及改写、润色、扩写、续写时，最终回答必须包含可直接复制的完整候选正文，并用【润色稿】、【改写稿】、【扩写稿】或【续写稿】标明。",
    "校对不是润色或改写。校对整篇、全文、全部章节或现有文章时，不要输出全文改写稿，不要逐句铺满；按章节列出明确问题和修改建议，最多 20 条，优先错别字、病句、重复表达、逻辑矛盾和前后不一致。没有明确问题时，直接说明未发现明显校对问题。",
    "这类正文生成任务不能只给改进建议，不能说“已提供润色建议”却不输出正文；若范围过长，应先说明需要缩小范围，而不是丢掉候选正文。",
    "不要伪造未读取的章节内容。工具返回摘要时，要说明结论基于压缩后的上下文。",
    "最终回答要简洁、具体、可执行。"
  ].join("\n");
}

function formatChapterDirectory(chapters: readonly ChatAgentDirectoryItem[]): string {
  if (chapters.length === 0) {
    return "（当前项目没有章节）";
  }

  return chapters
    .map((chapter) => {
      const marker = chapter.current ? " | 当前打开" : "";
      return `${chapter.ordinal}. ${chapter.title} | id=${chapter.id} | 字数=${chapter.wordCount}${marker}`;
    })
    .join("\n");
}

function buildUserPrompt(input: ChatAgentLoopInput): string {
  return [
    "用户问题：",
    input.userMessage,
    "",
    `当前打开章节：${input.currentChapterTitle ?? input.currentChapterId ?? "无"}`,
    input.selectionText?.trim() ? "当前有选中文本，可通过 read_selection 读取。" : "当前没有选中文本。",
    "如果用户问题本身粘贴了待处理正文，并要求处理“这一段/下面内容/以上文字”，可通过 read_selection 读取这段粘贴文本。",
    "",
    "章节目录：",
    formatChapterDirectory(input.chapterDirectory),
    "",
    "最近对话记忆（只用于理解追问和任务意图，不是正文来源）：",
    buildChatAgentMemoryText({
      history: input.history,
      tokenBudget: input.tokenBudget,
      compactedSummary: input.compactedMemorySummary,
      compactedThroughMessageId: input.compactedMemoryThroughMessageId
    })
  ].join("\n");
}

function buildAssistantToolCallMessage(content: string, toolCalls: readonly OpenRouterToolCall[]): OpenRouterMessage {
  return {
    role: "assistant",
    content: content.trim() ? content : null,
    tool_calls: toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: {
        name: call.name,
        arguments: call.argumentsJson
      }
    }))
  };
}

function emitContextUsage(
  input: ChatAgentLoopInput,
  handlers: ChatAgentLoopHandlers,
  messages: readonly OpenRouterMessage[],
  contextStatus: ChatAgentContextStatus
): void {
  handlers.onContext?.({
    requestId: input.requestId,
    estimatedInputTokens: estimateMessagesTokens(messages),
    maxInputTokens: input.tokenBudget.maxInputTokens,
    maxOutputTokens: input.tokenBudget.maxOutputTokens,
    modelContextTokens: input.modelContextTokens,
    modelName: input.modelName,
    contextMode: contextStatus.contextMode,
    scopeLabel: contextStatus.scopeLabel
  });
}

function assertMessagesWithinBudget(messages: readonly OpenRouterMessage[], maxInputTokens: number): void {
  const estimated = estimateMessagesTokens(messages);
  if (estimated <= maxInputTokens) {
    return;
  }

  throw new Error(`AI 对话上下文太长，预计输入约 ${estimated} tokens，超过上限 ${maxInputTokens}。请缩小章节范围或开启新对话后重试。`);
}

function flushFinalContent(input: ChatAgentLoopInput, handlers: ChatAgentLoopHandlers, streamedContent: string, content: string): void {
  const text = streamedContent ? "" : content;
  if (text) {
    handlers.onChunk?.({
      requestId: input.requestId,
      content: text
    });
  }
}

function finishTruncatedFinalContent(
  input: ChatAgentLoopInput,
  handlers: ChatAgentLoopHandlers,
  streamedContent: string,
  resultContent: string,
  actions: readonly AiChatAction[]
): ChatAgentLoopResult {
  const partialContent = (streamedContent || resultContent).trim();
  if (!partialContent) {
    throw new Error("AI 对话回答被截断，且模型没有返回可展示内容。请缩小章节范围后重试。");
  }

  const content = `${partialContent}${CHAT_AGENT_TRUNCATED_FINAL_NOTICE}`;
  handlers.onChunk?.({
    requestId: input.requestId,
    content: streamedContent ? CHAT_AGENT_TRUNCATED_FINAL_NOTICE : content
  });

  return {
    content,
    actions
  };
}

function readToolContextStatus(toolResultContent: string): ChatAgentContextStatus | null {
  try {
    const parsed = JSON.parse(toolResultContent) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const candidate = parsed as { readonly mode?: unknown; readonly scopeLabel?: unknown };
    if ((candidate.mode !== "direct" && candidate.mode !== "summarized") || typeof candidate.scopeLabel !== "string" || !candidate.scopeLabel.trim()) {
      return null;
    }
    return {
      contextMode: candidate.mode,
      scopeLabel: candidate.scopeLabel.trim()
    };
  } catch {
    return null;
  }
}

export async function runChatAgentLoop(input: ChatAgentLoopInput, handlers: ChatAgentLoopHandlers = {}): Promise<ChatAgentLoopResult> {
  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt()
    },
    {
      role: "user",
      content: buildUserPrompt(input)
    }
  ];
  const actions: AiChatAction[] = [];
  let contextStatus: ChatAgentContextStatus = {
    contextMode: "direct",
    scopeLabel: "Agent 工具上下文"
  };
  let hasAuthorContext = false;

  for (let iteration = 0; iteration < CHAT_AGENT_MAX_ITERATIONS; iteration += 1) {
    assertNotCanceled(input.signal);
    assertMessagesWithinBudget(messages, input.tokenBudget.maxInputTokens);
    if (hasAuthorContext) {
      emitContextUsage(input, handlers, messages, contextStatus);
    }

    let streamedContent = "";
    const result = await input.model.stream(
      {
        messages,
        tools: input.tools,
        maxCompletionTokens: input.tokenBudget.maxOutputTokens,
        temperature: 0.55,
        reasoning: CHAT_AGENT_REASONING,
        signal: input.signal
      },
      {
        onToken(token) {
          streamedContent += token;
          handlers.onChunk?.({
            requestId: input.requestId,
            content: token
          });
        },
        onReasoning(token) {
          handlers.onReasoning?.({
            requestId: input.requestId,
            content: token
          });
        }
      }
    );
    const toolCalls = result.toolCalls ?? [];

    if (result.truncated && toolCalls.length > 0) {
      throw new Error("AI 对话回答被截断。请缩小章节范围，或换用上下文/输出额度更高的模型后重试。");
    }

    if (toolCalls.length > 0) {
      messages.push(buildAssistantToolCallMessage(result.content, toolCalls));
      for (const call of toolCalls) {
        assertNotCanceled(input.signal);
        const toolResult = await input.executeTool(call);
        if (toolResult.action) {
          actions.push(toolResult.action);
        }
        const nextContextStatus = readToolContextStatus(toolResult.content);
        if (nextContextStatus) {
          contextStatus = nextContextStatus;
          hasAuthorContext = true;
        }
        if (estimateTextTokens(toolResult.content) > input.tokenBudget.maxInputTokens) {
          throw new Error(`AI 工具 ${call.name} 返回内容超过模型输入预算。`);
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.name,
          content: toolResult.content
        });
      }
      continue;
    }

    const content = result.content.trim();
    if (result.truncated) {
      return finishTruncatedFinalContent(input, handlers, streamedContent, content, actions);
    }
    if (!content) {
      throw new Error("OpenRouter 返回了空对话内容。");
    }
    flushFinalContent(input, handlers, streamedContent, content);

    return {
      content,
      actions
    };
  }

  throw new Error(`AI 对话工具调用超过 ${CHAT_AGENT_MAX_ITERATIONS} 轮，已停止以避免循环。`);
}
