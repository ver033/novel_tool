import { describe, expect, it } from "vitest";
import { DefaultOpenRouterConnectionTester } from "../../src/main/ai/openrouter-connection-tester";
import type { OpenRouterHttpRequest } from "../../src/main/ai/openrouter-client";

describe("DefaultOpenRouterConnectionTester", () => {
  it("treats a successful OpenRouter response with null content as a valid connection", async () => {
    const requests: OpenRouterHttpRequest[] = [];
    const tester = new DefaultOpenRouterConnectionTester({
      httpPost: async (request) => {
        requests.push(request);
        return {
          choices: [
            {
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: null
              }
            }
          ]
        };
      }
    });

    await expect(
      tester.testConnection({
        apiKey: "sk-or-v1-secret",
        baseUrl: "https://openrouter.ai/api/v1",
        modelName: "openai/gpt-5.2",
        contextLength: null
      })
    ).resolves.toEqual({
      ok: true,
      modelName: "openai/gpt-5.2"
    });
    expect(requests[0].body).toMatchObject({
      model: "openai/gpt-5.2",
      max_completion_tokens: 16
    });
  });

  it("passes configured baseUrl into the connection test client", async () => {
    const requests: OpenRouterHttpRequest[] = [];
    const tester = new DefaultOpenRouterConnectionTester({
      httpPost: async (request) => {
        requests.push(request);
        return {
          choices: [
            {
              message: {
                content: "OK"
              }
            }
          ]
        };
      }
    });

    await tester.testConnection({
      apiKey: "sk-or-v1-test-key",
      baseUrl: "https://openrouter-proxy.example.com/api/v1/",
      modelName: "openai/gpt-5.2",
      contextLength: null,
      supportsTools: true
    });

    expect(requests[0].url).toBe("https://openrouter-proxy.example.com/api/v1/chat/completions");
  });
});
