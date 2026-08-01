import { describe, expect, it } from "vitest";
import type { OpenRouterChatCompletionInput, OpenRouterClientOptions } from "../../src/main/ai/openrouter-client";
import { SettingsExternalBookSyncProviderTransport } from "../../src/main/external-book-sync/book-sync-provider-transport";
import type { SettingsService } from "../../src/main/settings/settings-service";

describe("SettingsExternalBookSyncProviderTransport", () => {
  it("sends the provider-specific payload as the exact user message with minimal output", async () => {
    const clientOptions: OpenRouterClientOptions[] = [];
    const requests: OpenRouterChatCompletionInput[] = [];
    const settingsService = {
      getSettings() {
        return {
          aiProviderKeyStatus: {
            openrouter: true,
            deepseek: true,
            "tencent-tokenhub": true
          }
        };
      },
      getAiConfigForProvider(providerType: "openrouter" | "deepseek" | "tencent-tokenhub") {
        return {
          providerType,
          apiKey: "secret-not-logged",
          baseUrl: `https://${providerType}.example/v1`,
          modelName: `${providerType}-model`,
          contextLength: 128_000,
          supportsTools: true
        };
      }
    } as Pick<SettingsService, "getSettings" | "getAiConfigForProvider">;
    const transport = new SettingsExternalBookSyncProviderTransport(settingsService, {
      createClient(options) {
        clientOptions.push(options);
        return {
          async streamChatCompletion(input) {
            requests.push(input);
            return { content: "OK", truncated: false, toolCalls: [] };
          }
        };
      }
    });

    await transport.send({
      provider: "openrouter",
      requestId: "delivery_1",
      projectId: "project_1",
      sessionId: "session_1",
      message: "第二章\n雨落青瓦。"
    });

    expect(clientOptions[0]).toMatchObject({
      providerType: "openrouter",
      baseUrl: "https://openrouter.example/v1",
      modelName: "openrouter/auto"
    });
    expect(requests[0]).toMatchObject({
      maxCompletionTokens: 8,
      temperature: 0,
      reasoning: { enabled: false, effort: "none", exclude: true }
    });
    expect(requests[0].messages.at(-1)).toEqual({
      role: "user",
      content: "第二章\n雨落青瓦。"
    });
  });
});
