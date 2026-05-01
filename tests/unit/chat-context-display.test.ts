import { describe, expect, it } from "vitest";
import { buildChatContextUsageDisplay, createIdleChatContextUsage } from "../../src/renderer/sidebar/chat-context-display";
import type { AiStreamContextEvent, SettingsState } from "../../src/main/shared/types";

function createContextUsage(patch: Partial<AiStreamContextEvent> = {}): AiStreamContextEvent {
  return {
    requestId: "chat_context",
    estimatedInputTokens: 4800,
    maxInputTokens: 12_000,
    maxOutputTokens: 4096,
    modelContextTokens: 16_384,
    modelName: "google/gemini-2.5-pro",
    contextMode: "direct",
    scopeLabel: "本章",
    ...patch
  };
}

describe("chat context usage display", () => {
  it("creates an idle context meter before the user asks a question", () => {
    const usage = createIdleChatContextUsage({
      aiProvider: {
        providerType: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        modelName: "google/gemini-2.5-pro",
        contextLength: 1_048_576,
        apiKeyConfigured: true
      }
    } as SettingsState);

    expect(usage).toMatchObject({
      requestId: "idle_context",
      estimatedInputTokens: 0,
      maxOutputTokens: 12000,
      modelContextTokens: 1_048_576,
      modelName: "google/gemini-2.5-pro",
      contextMode: "direct",
      scopeLabel: "待命"
    });
    expect(usage.maxInputTokens).toBeGreaterThan(12_000);
    expect(buildChatContextUsageDisplay(usage)).toMatchObject({
      percent: 0,
      usedLabel: "0",
      modelLabel: "gemini-2.5-pro",
      scopeLabel: "待命"
    });
  });

  it("creates an idle context meter even when AI settings are missing", () => {
    expect(buildChatContextUsageDisplay(createIdleChatContextUsage(null))).toMatchObject({
      percent: 0,
      usedOfTotalLabel: "已用 0 标记，共 12k 输入预算",
      modelLabel: "模型未配置",
      windowLabel: "未知",
      scopeLabel: "待命"
    });
  });

  it("uses the model window as the visible total when it is known", () => {
    expect(buildChatContextUsageDisplay(createContextUsage())).toMatchObject({
      percent: 29,
      percentText: "29%",
      usedOfTotalLabel: "已用 4.8k 标记，共 16k",
      windowLabel: "16k",
      modelLabel: "gemini-2.5-pro",
      compressionLabel: "原文背景信息"
    });
  });

  it("falls back to input budget copy when the model window is unknown", () => {
    expect(
      buildChatContextUsageDisplay(
        createContextUsage({
          modelContextTokens: null,
          contextMode: "summarized"
        })
      )
    ).toMatchObject({
      percent: 40,
      percentText: "40%",
      usedOfTotalLabel: "已用 4.8k 标记，共 12k 输入预算",
      windowLabel: "未知",
      modelLabel: "gemini-2.5-pro",
      compressionLabel: "墨枢已压缩背景信息"
    });
  });
});
