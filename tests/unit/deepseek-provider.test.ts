import { describe, expect, it } from "vitest";
import {
  OpenRouterClient,
  type OpenRouterHttpRequest
} from "../../src/main/ai/openrouter-client";

describe("DeepSeek provider adapter", () => {
  it("translates OpenRouter-shaped requests to the direct DeepSeek V4 API", async () => {
    const requests: OpenRouterHttpRequest[] = [];
    const client = new OpenRouterClient({
      providerType: "deepseek",
      apiKey: "sk-deepseek-secret",
      baseUrl: "https://api.deepseek.com",
      modelName: "deepseek-v4-flash",
      async httpPost(request) {
        requests.push(request);
        return {
          choices: [{
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "{\"issues\":[]}",
              reasoning_content: "internal reasoning"
            }
          }]
        };
      }
    });

    await expect(client.createChatCompletion({
      messages: [
        { role: "system", content: "Return JSON." },
        { role: "assistant", content: null, tool_calls: [{ id: "call_1" }] },
        { role: "tool", tool_call_id: "call_1", name: "read_chapter", content: "{}" },
        { role: "user", content: "Review this chapter." }
      ],
      maxCompletionTokens: 4096,
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "review",
          strict: true,
          schema: { type: "object" }
        }
      },
      reasoning: {
        effort: "medium",
        exclude: true
      },
      provider: {
        sort: "latency",
        allow_fallbacks: true
      },
      parallelToolCalls: false
    })).resolves.toMatchObject({
      content: "{\"issues\":[]}",
      reasoning: "internal reasoning"
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(requests[0].headers).toEqual({
      Authorization: "Bearer sk-deepseek-secret",
      "Content-Type": "application/json"
    });
    expect(requests[0].body).toMatchObject({
      model: "deepseek-v4-flash",
      stream: false,
      max_tokens: 4096,
      response_format: { type: "json_object" },
      thinking: { type: "enabled" },
      reasoning_effort: "high"
    });
    expect(requests[0].body).not.toHaveProperty("max_completion_tokens");
    expect(requests[0].body).not.toHaveProperty("reasoning");
    expect(requests[0].body).not.toHaveProperty("provider");
    expect(requests[0].body).not.toHaveProperty("parallel_tool_calls");
    expect(requests[0].body.messages).toEqual([
      { role: "system", content: "Return JSON." },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1" }], reasoning_content: "" },
      { role: "tool", tool_call_id: "call_1", content: "{}" },
      { role: "user", content: "Review this chapter." }
    ]);
  });

  it("uses DeepSeek in provider-facing errors and redacts its API key", async () => {
    const client = new OpenRouterClient({
      providerType: "deepseek",
      apiKey: "sk-deepseek-secret",
      baseUrl: "https://api.deepseek.com",
      modelName: "deepseek-v4-flash",
      async httpPost() {
        throw Object.assign(new Error("request failed"), {
          response: {
            status: 401,
            data: {
              error: {
                message: "invalid key sk-deepseek-secret"
              }
            }
          }
        });
      }
    });

    await expect(client.createChatCompletion({
      messages: [{ role: "user", content: "hello" }]
    })).rejects.toThrow("DeepSeek 请求失败 (401)：invalid key [REDACTED]");
  });
});
