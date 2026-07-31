import { describe, expect, it } from "vitest";
import {
  OpenRouterClient,
  OpenRouterModelCatalogClient,
  type OpenRouterHttpGetRequest,
  type OpenRouterHttpRequest
} from "../../src/main/ai/openrouter-client";

describe("Tencent Cloud TokenHub provider adapter", () => {
  it("uses Tencent Cloud's documented DeepSeek request semantics without OpenRouter-only fields", async () => {
    const requests: OpenRouterHttpRequest[] = [];
    const client = new OpenRouterClient({
      providerType: "tencent-tokenhub",
      apiKey: "sk-tencent-tokenhub-secret",
      baseUrl: "https://tokenhub.tencentmaas.com/v1",
      modelName: "deepseek-v4-flash",
      async httpPost(request) {
        requests.push(request);
        return {
          choices: [{
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              reasoning_content: "先读取章节",
              tool_calls: [{
                id: "call_1",
                type: "function",
                function: {
                  name: "read_chapter",
                  arguments: "{\"chapterId\":\"chapter_1\"}"
                }
              }]
            }
          }]
        };
      }
    });

    await expect(client.createChatCompletion({
      messages: [
        { role: "assistant", content: null, tool_calls: [{ id: "previous_call" }] },
        { role: "tool", tool_call_id: "previous_call", name: "read_chapter", content: "{}" },
        { role: "user", content: "检查第一章" }
      ],
      maxCompletionTokens: 4096,
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "chapter_review",
          strict: true,
          schema: { type: "object" }
        }
      },
      reasoning: { effort: "xhigh" },
      provider: { sort: "latency", allow_fallbacks: true },
      tools: [{
        type: "function",
        function: {
          name: "read_chapter",
          description: "读取章节",
          parameters: { type: "object" }
        }
      }],
      toolChoice: "auto",
      parallelToolCalls: false,
      allowEmptyContent: true
    })).resolves.toMatchObject({
      content: "",
      reasoning: "先读取章节",
      toolCalls: [{
        id: "call_1",
        name: "read_chapter",
        argumentsJson: "{\"chapterId\":\"chapter_1\"}"
      }]
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://tokenhub.tencentmaas.com/v1/chat/completions");
    expect(requests[0].headers).toEqual({
      Authorization: "Bearer sk-tencent-tokenhub-secret",
      "Content-Type": "application/json"
    });
    expect(requests[0].body).toMatchObject({
      model: "deepseek-v4-flash",
      stream: false,
      max_tokens: 4096,
      thinking: {
        type: "enabled",
        reasoning_effort: "max"
      },
      response_format: { type: "json_object" },
      tool_choice: "auto"
    });
    expect(requests[0].body.messages).toEqual([
      { role: "assistant", content: null, tool_calls: [{ id: "previous_call" }] },
      { role: "tool", tool_call_id: "previous_call", content: "{}" },
      { role: "user", content: "检查第一章" }
    ]);
    expect(requests[0].body).not.toHaveProperty("max_completion_tokens");
    expect(requests[0].body).not.toHaveProperty("reasoning");
    expect(requests[0].body).not.toHaveProperty("reasoning_effort");
    expect(requests[0].body).not.toHaveProperty("provider");
    expect(requests[0].body).not.toHaveProperty("parallel_tool_calls");
    expect(requests[0].headers).not.toHaveProperty("X-OpenRouter-Title");
  });

  it("fetches Tencent Cloud TokenHub's authenticated model list", async () => {
    const requests: OpenRouterHttpGetRequest[] = [];
    const catalog = new OpenRouterModelCatalogClient({
      async httpGet(request) {
        requests.push(request);
        return {
          object: "list",
          data: [{
            id: "deepseek-v4-flash",
            object: "model",
            name: "DeepSeek-V4-Flash",
            created: 1_783_000_000,
            status: "online"
          }]
        };
      }
    });

    await expect(catalog.listModels({
      providerType: "tencent-tokenhub",
      baseUrl: "https://tokenhub.tencentmaas.com/v1/",
      apiKey: "sk-tencent-tokenhub-secret"
    })).resolves.toEqual([{
      id: "deepseek-v4-flash",
      name: "DeepSeek-V4-Flash",
      contextLength: null,
      supportsTools: null
    }]);
    expect(requests).toEqual([{
      url: "https://tokenhub.tencentmaas.com/v1/models",
      headers: {
        Authorization: "Bearer sk-tencent-tokenhub-secret"
      }
    }]);
  });

  it("uses Tencent Cloud TokenHub in provider-facing errors and redacts its API key", async () => {
    const client = new OpenRouterClient({
      providerType: "tencent-tokenhub",
      apiKey: "sk-tencent-tokenhub-secret",
      baseUrl: "https://tokenhub.tencentmaas.com/v1",
      modelName: "deepseek-v4-flash",
      async httpPost() {
        throw Object.assign(new Error("request failed"), {
          response: {
            status: 401,
            data: {
              error: {
                message: "invalid key sk-tencent-tokenhub-secret"
              }
            }
          }
        });
      }
    });

    await expect(client.createChatCompletion({
      messages: [{ role: "user", content: "hello" }]
    })).rejects.toThrow("腾讯云 TokenHub 请求失败 (401)：invalid key [REDACTED]");
  });
});
