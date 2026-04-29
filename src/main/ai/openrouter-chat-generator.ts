import type { AiChatGenerationInput, AiChatGenerator, AiChatMessageResult, AiChatStreamHandlers, AiGenerationOptions } from "./ai-task-service";
import { logDevLlmPrompt } from "./dev-prompt-logger";
import type { OpenRouterMessage } from "./openrouter-client";
import { OpenRouterClient } from "./openrouter-client";
import { getTokenBudget } from "./token-budget";
import { estimateMessagesTokens } from "./token-estimator";
import type { SettingsService } from "../settings/settings-service";
import type { AiSendChatMessageInput } from "../shared/types";

function buildUserPrompt(input: AiSendChatMessageInput): string {
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
    "不要直接替用户确认写回正文；涉及正文修改时给出建议或候选文本。",
    "保持回答简洁、具体、可执行。"
  ].join("\n");
}

function buildHistoryMessages(input: AiChatGenerationInput): OpenRouterMessage[] {
  return input.history
    .flatMap((message): OpenRouterMessage[] => {
      if (message.role !== "user" && message.role !== "assistant") {
        return [];
      }
      return [
        {
          role: message.role,
          content: message.content
        }
      ];
    })
    .slice(-12);
}

function assertChatMessagesWithinBudget(messages: readonly OpenRouterMessage[], maxInputTokens: number): void {
  const estimatedTokens = estimateMessagesTokens(messages);
  if (estimatedTokens <= maxInputTokens) {
    return;
  }

  throw new Error(`AI 对话上下文太长，预计输入约 ${estimatedTokens} tokens，超过上限 ${maxInputTokens}。请缩短问题或选中文本后重试。`);
}

export function buildChatCompletionMessages(input: AiChatGenerationInput): OpenRouterMessage[] {
  const systemMessage = {
    role: "system",
    content: buildSystemPrompt()
  } satisfies OpenRouterMessage;
  const userMessage = {
    role: "user",
    content: buildUserPrompt(input)
  } satisfies OpenRouterMessage;
  const chatBudget = getTokenBudget("chat");
  assertChatMessagesWithinBudget([systemMessage, userMessage], chatBudget.maxInputTokens);
  const selectedHistory: OpenRouterMessage[] = [];

  for (const historyMessage of buildHistoryMessages(input).reverse()) {
    const candidate = [systemMessage, historyMessage, ...selectedHistory, userMessage];
    if (estimateMessagesTokens(candidate) <= chatBudget.maxInputTokens) {
      selectedHistory.unshift(historyMessage);
    }
  }

  return [systemMessage, ...selectedHistory, userMessage];
}

export class OpenRouterChatGenerator implements AiChatGenerator {
  constructor(private readonly settingsService: SettingsService) {}

  async sendMessage(input: AiSendChatMessageInput): Promise<AiChatMessageResult> {
    const chatBudget = getTokenBudget("chat");
    const config = this.settingsService.getOpenRouterConfig();
    const client = new OpenRouterClient({
      apiKey: config.apiKey,
      modelName: config.modelName
    });
    const messages = [
      {
        role: "system",
        content: buildSystemPrompt()
      },
      {
        role: "user",
        content: buildUserPrompt(input)
      }
    ] satisfies readonly OpenRouterMessage[];
    assertChatMessagesWithinBudget(messages, chatBudget.maxInputTokens);
    logDevLlmPrompt({
      kind: "chat",
      modelName: config.modelName,
      messages,
      meta: {
        chapterId: input.chapterId,
        currentChapterTitle: input.currentChapterTitle,
        projectId: input.projectId,
        sessionId: input.sessionId
      },
      params: {
        maxCompletionTokens: chatBudget.maxOutputTokens,
        temperature: 0.55
      }
    });
    const result = await client.createChatCompletion({
      messages,
      maxCompletionTokens: chatBudget.maxOutputTokens,
      temperature: 0.55
    });
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

  async sendMessageStream(input: AiChatGenerationInput, handlers: AiChatStreamHandlers, options: AiGenerationOptions = {}): Promise<AiChatMessageResult> {
    const chatBudget = getTokenBudget("chat");
    const config = this.settingsService.getOpenRouterConfig();
    const client = new OpenRouterClient({
      apiKey: config.apiKey,
      modelName: config.modelName
    });
    const messages = buildChatCompletionMessages(input);
    logDevLlmPrompt({
      kind: "chat",
      modelName: config.modelName,
      messages,
      meta: {
        chapterId: input.chapterId,
        currentChapterTitle: input.currentChapterTitle,
        historyMessageCount: input.history.length,
        projectId: input.projectId,
        requestMode: "stream",
        sessionId: input.sessionId
      },
      params: {
        maxCompletionTokens: chatBudget.maxOutputTokens,
        temperature: 0.55
      }
    });
    const result = await client.streamChatCompletion(
      {
        messages,
        maxCompletionTokens: chatBudget.maxOutputTokens,
        temperature: 0.55,
        signal: options.signal
      },
      {
        onToken(token) {
          handlers.onChunk?.({ requestId: input.requestId, content: token });
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
}
