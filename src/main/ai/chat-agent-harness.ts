import type {
  OpenRouterChatCompletionResult,
  OpenRouterMessage,
  OpenRouterReasoningConfig,
  OpenRouterStreamHandlers,
  OpenRouterToolCall,
  OpenRouterToolDefinition
} from "./openrouter-client";
import { buildChatAgentMemoryText } from "./chat-agent-memory";
import { buildReasoningConfig } from "./reasoning-budget";
import { estimateMessagesTokens, estimateTextTokens } from "./token-estimator";
import type { TokenBudget } from "./token-budget";
import type { AiChatAction, AiChatMessageRecord } from "../shared/types";

const CHAT_AGENT_MAX_ITERATIONS = 8;
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
  readonly reasoning?: OpenRouterReasoningConfig;
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
  readonly reasoning?: OpenRouterReasoningConfig;
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
    readonly contextMode: "direct" | "summarized" | "mixed";
    readonly scopeLabel: string;
  }) => void;
};

export type ChatAgentLoopResult = {
  readonly content: string;
  readonly actions: readonly AiChatAction[];
};

type ChatAgentContextStatus = {
  readonly contextMode: "direct" | "summarized" | "mixed";
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
    "你可以使用工具读取项目章节、读取选区、处理作者在当前消息里直接粘贴的正文、把内容写入草稿纸。工具结果，以及作者当前消息里明确粘贴的待处理正文，才是可靠的正文来源。",
    "凡是用户问题涉及某章、全部章节、现有章节、人物、剧情、伏笔、设定、连续性、总结或摘要，必须先调用 read_chapters 读取对应范围，不要只根据当前打开章节或章节目录回答。",
    "如果用户在当前消息里直接粘贴正文并要求“润色这一段”“帮我润一下色”“改写下面内容”等写作操作，直接调用 run_writing_operation，并把待处理正文原样放进 target.kind=inline_text 的 text 字段；不要因为没有编辑器选区而报错。",
    "read_selection 只用于读取真实编辑器选区；如果确实要读取当前消息里的粘贴正文，必须由你把正文原样填入 read_selection.inlineText，本地不会根据关键词猜测正文范围。",
    "如果用户使用自然语言追问，例如“同时”“还有”“顺便”，要结合最近对话记忆判断上一轮范围；不确定时可以先 list_chapters 或 read_chapters，而不是直接要求用户重复。",
    "如果用户明确要求保存到草稿纸，先整理要保存的正文，再调用 add_to_scratchpad；工具成功后再给最终回复。",
    "作者输入 /润色、/扩写、/校对 或 /续写 时，这是强烈的写作操作意图；没有 slash 时，你也必须根据作者自然语言自由决定是否调用 run_writing_operation。",
    "不要直接写回正文。涉及改写、润色、扩写、续写时，最终回答必须包含可直接复制的完整候选正文，并用【润色稿】、【改写稿】、【扩写稿】或【续写稿】标明。",
    "校对不是润色或改写。校对整篇、全文、全部章节或现有文章时，不要输出全文改写稿，不要逐句铺满；按章节列出明确问题和修改建议，最多 20 条，优先错别字、病句、重复表达、逻辑矛盾和前后不一致。没有明确问题时，直接说明未发现明显校对问题。",
    "这类正文生成任务不能只给改进建议，不能说“已提供润色建议”却不输出正文；若范围过长，应先说明需要缩小范围，而不是丢掉候选正文。",
    "如果 run_writing_operation 返回 candidate_text，最终回答必须展示完整候选正文，使用【润色稿】、【扩写稿】或【续写稿】标题。不能只总结改进点。",
    "如果 run_writing_operation 返回 proofread_issues，最终回答必须按问题列表展示全部问题。不能说已经自动修改正文。",
    "除非用户明确要求加入草稿纸，不能在写作操作后调用 add_to_scratchpad。",
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
    input.selectionText?.trim() ? "当前有选中文本，可通过 read_selection 读取。" : "当前没有编辑器选区。",
    "如果用户问题本身粘贴了待处理正文，并要求润色、改写、扩写、续写或校对，直接把粘贴正文作为 run_writing_operation.target.inline_text.text；不要依赖 read_selection 猜测正文。",
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
    if (!isContextMode(candidate.mode) || typeof candidate.scopeLabel !== "string" || !candidate.scopeLabel.trim()) {
      if (!isRecord(parsed) || !isRecord(parsed.contextPlan)) {
        return null;
      }
      const contextPlan = parsed.contextPlan;
      const operation = parsed.operation;
      if (!isContextMode(contextPlan.mode)) {
        return null;
      }
      return {
        contextMode: contextPlan.mode,
        scopeLabel: `写作操作：${formatWritingOperationTitle(operation).replace(/稿$/, "")}`
      };
    }
    return {
      contextMode: candidate.mode,
      scopeLabel: candidate.scopeLabel.trim()
    };
  } catch {
    return null;
  }
}

function isContextMode(value: unknown): value is "direct" | "summarized" | "mixed" {
  return value === "direct" || value === "summarized" || value === "mixed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatWritingOperationTitle(operation: unknown): string {
  if (operation === "expand") {
    return "扩写稿";
  }
  if (operation === "continue") {
    return "续写稿";
  }
  if (operation === "proofread") {
    return "校对结果";
  }
  return "润色稿";
}

function formatProofreadToolResult(issues: unknown): string | null {
  if (!Array.isArray(issues)) {
    return null;
  }
  if (issues.length === 0) {
    return "【校对结果】\n未发现明显校对问题。";
  }

  const lines = issues.map((issue, index) => {
    if (!isRecord(issue)) {
      return `${index + 1}. ${String(issue)}`;
    }
    const quote = typeof issue.quote === "string" && issue.quote.trim() ? `原文：${issue.quote.trim()}` : null;
    const suggestion = typeof issue.suggestion === "string" && issue.suggestion.trim() ? `建议：${issue.suggestion.trim()}` : null;
    const reason = typeof issue.reason === "string" && issue.reason.trim() ? `原因：${issue.reason.trim()}` : null;
    return [`${index + 1}.`, quote, suggestion, reason].filter(Boolean).join("\n");
  });

  return ["【校对结果】", ...lines].join("\n");
}

function formatWritingOperationToolResult(toolResultContent: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolResultContent);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }

  if (parsed.outputKind === "proofread_issues") {
    return formatProofreadToolResult(parsed.proofreadIssues);
  }

  if (parsed.outputKind !== "candidate_text" || typeof parsed.generatedText !== "string" || !parsed.generatedText.trim()) {
    return null;
  }

  return `【${formatWritingOperationTitle(parsed.operation)}】\n${parsed.generatedText.trim()}`;
}

function finishWithToolResultContent(
  input: ChatAgentLoopInput,
  handlers: ChatAgentLoopHandlers,
  content: string,
  actions: readonly AiChatAction[]
): ChatAgentLoopResult {
  handlers.onChunk?.({
    requestId: input.requestId,
    content
  });

  return {
    content,
    actions
  };
}

function appendActionStatusToToolPresentation(content: string, actions: readonly AiChatAction[]): string {
  if (actions.some((action) => action.type === "add_to_scratchpad")) {
    return `${content}\n\n已加入草稿纸。`;
  }
  return content;
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
    scopeLabel: "当前对话"
  };
  let hasAuthorContext = false;
  let lastToolResultPresentation: string | null = null;
  const normalizedUserMessage = input.userMessage.replace(/\s+/g, "");
  const canSaveToScratchpad =
    input.tools.some((tool) => tool.function.name === "add_to_scratchpad") &&
    /(草稿纸|草稿|素材)/.test(normalizedUserMessage) &&
    /(加入|保存|存到|放到|记录)/.test(normalizedUserMessage);

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
        reasoning: input.reasoning ?? buildReasoningConfig(input.tokenBudget, { exclude: false, fallbackEffort: "medium" }),
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
      let authoritativeToolResultPresentation: string | null = null;
      for (const call of toolCalls) {
        assertNotCanceled(input.signal);
        const toolResult = await input.executeTool(call);
        if (toolResult.action) {
          actions.push(toolResult.action);
        }
        const writingToolPresentation = call.name === "run_writing_operation" ? formatWritingOperationToolResult(toolResult.content) : null;
        if (writingToolPresentation) {
          lastToolResultPresentation = writingToolPresentation;
          authoritativeToolResultPresentation = writingToolPresentation;
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
      if (authoritativeToolResultPresentation && !canSaveToScratchpad) {
        if (hasAuthorContext) {
          emitContextUsage(input, handlers, messages, contextStatus);
        }
        return finishWithToolResultContent(input, handlers, authoritativeToolResultPresentation, actions);
      }
      continue;
    }

    const content = result.content.trim();
    if (!hasAuthorContext) {
      emitContextUsage(input, handlers, messages, contextStatus);
    }
    if (result.truncated) {
      return finishTruncatedFinalContent(input, handlers, streamedContent, content, actions);
    }
    if (lastToolResultPresentation && canSaveToScratchpad) {
      return finishWithToolResultContent(input, handlers, appendActionStatusToToolPresentation(lastToolResultPresentation, actions), actions);
    }
    if (!content) {
      if (lastToolResultPresentation && !streamedContent.trim()) {
        return finishWithToolResultContent(input, handlers, appendActionStatusToToolPresentation(lastToolResultPresentation, actions), actions);
      }
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
