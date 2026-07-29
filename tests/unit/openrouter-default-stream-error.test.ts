import { beforeEach, describe, expect, it, vi } from "vitest";

describe("OpenRouterClient default stream transport errors", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("axios");
  });

  it("reads OpenRouter stream error bodies instead of collapsing them to provider returned an error", async () => {
    vi.doMock("axios", () => ({
      default: {
        post: vi.fn(async () => {
          throw {
            response: {
              status: 400,
              data: [Buffer.from('{"error":{"message":"Reasoning is mandatory for this endpoint and cannot be disabled."}}')]
            }
          };
        })
      }
    }));

    const { OpenRouterClient } = await import("../../src/main/ai/openrouter-client");
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "google/gemini-2.5-pro"
    });

    await expect(client.streamChatCompletion({ messages: [{ role: "user", content: "test" }] })).rejects.toThrow(
      "OpenRouter 请求失败 (400)：Reasoning is mandatory for this endpoint and cannot be disabled."
    );
  });

  it("routes default OpenRouter requests through the shared fetch transport", async () => {
    const axiosPost = vi.fn(async (..._args: unknown[]) => ({
      data: {
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: "OK"
            }
          }
        ]
      }
    }));
    vi.doMock("axios", () => ({
      default: {
        post: axiosPost
      }
    }));

    const { OpenRouterClient } = await import("../../src/main/ai/openrouter-client");
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "openai/gpt-5.2"
    });

    await client.createChatCompletion({
      messages: [{ role: "user", content: "test" }]
    });

    expect(axiosPost.mock.calls[0]?.[2]).toMatchObject({
      adapter: "fetch",
      env: {
        fetch: expect.any(Function)
      }
    });
  });
});
