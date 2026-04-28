import type { AiChatGenerator, AiChatMessageResult } from "./ai-task-service";
import { OpenRouterClient } from "./openrouter-client";
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

export class OpenRouterChatGenerator implements AiChatGenerator {
  constructor(private readonly settingsService: SettingsService) {}

  async sendMessage(input: AiSendChatMessageInput): Promise<AiChatMessageResult> {
    const config = this.settingsService.getOpenRouterConfig();
    const client = new OpenRouterClient({
      apiKey: config.apiKey,
      modelName: config.modelName
    });
    const result = await client.createChatCompletion({
      messages: [
        {
          role: "system",
          content: [
            "你是中文小说写作助手。",
            "你可以讨论润色、扩写、校对、续写、节奏、人物动机和场景处理。",
            "不要直接替用户确认写回正文；涉及正文修改时给出建议或候选文本。",
            "保持回答简洁、具体、可执行。"
          ].join("\n")
        },
        {
          role: "user",
          content: buildUserPrompt(input)
        }
      ],
      maxCompletionTokens: 1600,
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
}
