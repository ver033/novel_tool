import { describe, expect, it } from "vitest";
import { DefaultOpenRouterConnectionTester } from "../../src/main/ai/openrouter-connection-tester";
import type { OpenRouterHttpGetRequest, OpenRouterHttpRequest } from "../../src/main/ai/openrouter-client";

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
        providerType: "openrouter",
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
      providerType: "openrouter",
      apiKey: "sk-or-v1-test-key",
      baseUrl: "https://openrouter-proxy.example.com/api/v1/",
      modelName: "openai/gpt-5.2",
      contextLength: null,
      supportsTools: true
    });

    expect(requests[0].url).toBe("https://openrouter-proxy.example.com/api/v1/chat/completions");
  });

  it("tests Tencent Cloud TokenHub authentication without invoking model generation", async () => {
    const requests: OpenRouterHttpGetRequest[] = [];
    const tester = new DefaultOpenRouterConnectionTester({
      async httpPost() {
        throw new Error("Tencent Cloud TokenHub model generation must not be used for a connection test");
      },
      async httpGet(request) {
        requests.push(request);
        return {
          object: "list",
          data: [{
            id: "deepseek-v4-flash",
            object: "model",
            name: "DeepSeek V4 Flash",
            created: 1_783_000_000,
            status: "online"
          }]
        };
      }
    });

    await expect(tester.testConnection({
      providerType: "tencent-tokenhub",
      apiKey: "sk-tencent-tokenhub-secret",
      baseUrl: "https://tokenhub.tencentmaas.com/v1/",
      modelName: "deepseek-v4-flash",
      contextLength: null,
      supportsTools: true
    })).resolves.toEqual({
      ok: true,
      modelName: "deepseek-v4-flash"
    });

    expect(requests).toEqual([{
      url: "https://tokenhub.tencentmaas.com/v1/models",
      headers: {
        Authorization: "Bearer sk-tencent-tokenhub-secret"
      }
    }]);
  });
});
