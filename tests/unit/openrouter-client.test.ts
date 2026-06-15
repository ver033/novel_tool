import { describe, expect, it } from "vitest";
import { OpenRouterClient, OpenRouterModelCatalogClient, type OpenRouterHttpRequest } from "../../src/main/ai/openrouter-client";

describe("OpenRouterClient", () => {
  it("sends non-streaming chat completions to the official OpenRouter endpoint", async () => {
    const requests: OpenRouterHttpRequest[] = [];
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "openai/gpt-5.2",
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

    const result = await client.createChatCompletion({
      messages: [
        { role: "system", content: "你是中文小说助手。" },
        { role: "user", content: "只回复 OK" }
      ],
      maxCompletionTokens: 16,
      temperature: 0
    });

    expect(result.content).toBe("OK");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: {
        Authorization: "Bearer sk-or-v1-test-key",
        "Content-Type": "application/json",
        "X-OpenRouter-Title": "MoShu"
      },
      body: {
        model: "openai/gpt-5.2",
        stream: false,
        max_completion_tokens: 16,
        temperature: 0
      }
    });
  });

  it("uses the configured OpenRouter-compatible base URL for chat completions", async () => {
    const requests: OpenRouterHttpRequest[] = [];
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      baseUrl: "https://openrouter-proxy.example.com/api/v1/",
      modelName: "openai/gpt-5.2",
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

    await client.createChatCompletion({
      messages: [{ role: "user", content: "只回复 OK" }]
    });

    expect(requests[0].url).toBe("https://openrouter-proxy.example.com/api/v1/chat/completions");
  });

  it("wraps non-streaming cancellation as a typed OpenRouter cancellation error", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "openai/gpt-5.2",
      httpPost: async () => {
        throw Object.assign(new Error("canceled"), {
          code: "ERR_CANCELED",
          name: "CanceledError"
        });
      }
    });

    await expect(
      client.createChatCompletion({
        messages: [{ role: "user", content: "写一段。" }]
      })
    ).rejects.toMatchObject({
      name: "OpenRouterError",
      code: "canceled",
      isCanceled: true,
      message: "OpenRouter 请求已取消。"
    });
  });

  it("wraps streaming cancellation as a typed OpenRouter cancellation error", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "openai/gpt-5.2",
      httpStreamPost: async () => {
        throw Object.assign(new Error("canceled"), {
          code: "ERR_CANCELED",
          name: "CanceledError"
        });
      }
    });

    await expect(
      client.streamChatCompletion({
        messages: [{ role: "user", content: "写一段。" }]
      })
    ).rejects.toMatchObject({
      name: "OpenRouterError",
      code: "canceled",
      isCanceled: true,
      message: "OpenRouter 请求已取消。"
    });
  });

  it("supports official json_schema response_format for proofread output", async () => {
    const requests: OpenRouterHttpRequest[] = [];
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "openai/gpt-5.2",
      httpPost: async (request) => {
        requests.push(request);
        return {
          choices: [
            {
              message: {
                content: "{\"issues\":[]}"
              }
            }
          ]
        };
      }
    });

    await client.createChatCompletion({
      messages: [{ role: "user", content: "校对这句话。" }],
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "proofread_result",
          strict: true,
          schema: {
            type: "object",
            properties: {
              issues: {
                type: "array",
                items: { type: "object" }
              }
            },
            required: ["issues"],
            additionalProperties: false
          }
        }
      }
    });

    expect(requests[0].body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "proofread_result",
        strict: true
      }
    });
  });

  it("passes high OpenRouter reasoning controls without returning reasoning text", async () => {
    const requests: OpenRouterHttpRequest[] = [];
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "google/gemini-2.5-pro",
      httpPost: async (request) => {
        requests.push(request);
        return {
          choices: [
            {
              message: {
                content: "{\"issues\":[{\"type\":\"无问题\",\"quote\":\"\",\"suggestion\":\"\",\"reason\":\"未发现明显问题\"}]}"
              }
            }
          ]
        };
      }
    });

    await client.createChatCompletion({
      messages: [{ role: "user", content: "校对这句话。" }],
      reasoning: {
        effort: "high",
        exclude: true
      }
    });

    expect(requests[0].body.reasoning).toEqual({
      effort: "high",
      exclude: true
    });
  });

  it("passes OpenRouter provider routing preferences for latency-sensitive calls", async () => {
    const requests: OpenRouterHttpRequest[] = [];
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "openai/gpt-5.2",
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

    await client.createChatCompletion({
      messages: [{ role: "user", content: "只回复 OK" }],
      provider: {
        sort: "throughput",
        require_parameters: true
      }
    });

    expect(requests[0].body.provider).toEqual({
      sort: "throughput",
      require_parameters: true
    });
  });

  it("returns non-streaming reasoning details when OpenRouter provides them", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "google/gemini-2.5-pro",
      httpPost: async () => ({
        choices: [
          {
            message: {
              content: "总结结果",
              reasoning_details: [
                {
                  type: "reasoning.text",
                  text: "先读取章节目录。"
                },
                {
                  type: "reasoning.summary",
                  summary: "需要综合全部章节。"
                }
              ]
            }
          }
        ]
      })
    });

    await expect(
      client.createChatCompletion({
        messages: [{ role: "user", content: "总结全部章节。" }]
      })
    ).resolves.toEqual({
      content: "总结结果",
      reasoning: "先读取章节目录。\n需要综合全部章节。",
      truncated: false
    });
  });

  it("sends tools and parses assistant tool calls", async () => {
    const requests: OpenRouterHttpRequest[] = [];
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "openai/gpt-5.2",
      httpPost: async (request) => {
        requests.push(request);
        return {
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_read_1",
                    type: "function",
                    function: {
                      name: "read_chapters",
                      arguments: "{\"scope\":{\"type\":\"all_chapters\"}}"
                    }
                  }
                ]
              }
            }
          ]
        };
      }
    });

    const result = await client.createChatCompletion({
      messages: [{ role: "user", content: "总结全部章节。" }],
      tools: [
        {
          type: "function",
          function: {
            name: "read_chapters",
            description: "Read chapter text from the current project.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false
            }
          }
        }
      ],
      toolChoice: "auto",
      parallelToolCalls: false,
      allowEmptyContent: true
    });

    expect(requests[0].body).toMatchObject({
      tools: [
        {
          type: "function",
          function: {
            name: "read_chapters"
          }
        }
      ],
      tool_choice: "auto",
      parallel_tool_calls: false
    });
    expect(result).toEqual({
      content: "",
      toolCalls: [
        {
          id: "call_read_1",
          name: "read_chapters",
          argumentsJson: "{\"scope\":{\"type\":\"all_chapters\"}}"
        }
      ],
      truncated: false
    });
  });

  it("defaults omitted tool call arguments to an empty JSON object", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "openai/gpt-5.2",
      httpPost: async () => ({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_no_args",
                  type: "function",
                  function: {
                    name: "read_selection"
                  }
                }
              ]
            }
          }
        ]
      })
    });

    await expect(
      client.createChatCompletion({
        messages: [{ role: "user", content: "读取选区。" }],
        allowEmptyContent: true
      })
    ).resolves.toMatchObject({
      toolCalls: [
        {
          id: "call_no_args",
          name: "read_selection",
          argumentsJson: "{}"
        }
      ]
    });
  });

  it("deduplicates non-streaming reasoning when OpenRouter mirrors reasoning_details into legacy fields", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "google/gemini-2.5-pro",
      httpPost: async () => ({
        choices: [
          {
            message: {
              content: "总结结果",
              reasoning_details: [
                {
                  type: "reasoning.text",
                  text: "先读取章节目录。"
                }
              ],
              reasoning_content: "先读取章节目录。",
              reasoning: "先读取章节目录。"
            }
          }
        ]
      })
    });

    await expect(
      client.createChatCompletion({
        messages: [{ role: "user", content: "总结全部章节。" }]
      })
    ).resolves.toEqual({
      content: "总结结果",
      reasoning: "先读取章节目录。",
      truncated: false
    });
  });

  it("allows null response content only for connection probes", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "openai/gpt-5.2",
      httpPost: async () => ({
        choices: [
          {
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: null
            }
          }
        ]
      })
    });

    await expect(
      client.createChatCompletion({
        messages: [{ role: "user", content: "只回复 OK" }],
        allowEmptyContent: true
      })
    ).resolves.toEqual({ content: "", truncated: false });

    await expect(
      client.createChatCompletion({
        messages: [{ role: "user", content: "生成正文" }]
      })
    ).rejects.toThrow("OpenRouter 请求失败：OpenRouter 响应没有文本内容");
  });

  it("returns a truncation flag for non-streaming length stops", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "openai/gpt-5.2",
      httpPost: async () => ({
        choices: [
          {
            finish_reason: "length",
            message: {
              role: "assistant",
              content: "半段结果"
            }
          }
        ]
      })
    });

    await expect(
      client.createChatCompletion({
        messages: [{ role: "user", content: "生成正文" }]
      })
    ).resolves.toEqual({ content: "半段结果", truncated: true });
  });

  it("treats empty non-streaming length stops as truncated instead of missing text", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "openai/gpt-5.2",
      httpPost: async () => ({
        choices: [
          {
            finish_reason: "length",
            message: {
              role: "assistant",
              content: null
            }
          }
        ]
      })
    });

    await expect(
      client.createChatCompletion({
        messages: [{ role: "user", content: "生成正文" }]
      })
    ).resolves.toEqual({ content: "", truncated: true });
  });

  it("surfaces choice-level OpenRouter errors", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-secret-key",
      modelName: "openai/gpt-5.2",
      httpPost: async () => ({
        choices: [
          {
            finish_reason: "error",
            message: {
              role: "assistant",
              content: null
            },
            error: {
              code: 502,
              message: "upstream provider failed"
            }
          }
        ]
      })
    });

    await expect(
      client.createChatCompletion({
        messages: [{ role: "user", content: "test" }],
        allowEmptyContent: true
      })
    ).rejects.toThrow("OpenRouter 请求失败：OpenRouter 模型返回错误 (502)：upstream provider failed");
  });

  it("redacts API keys from provider errors", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-secret-key",
      modelName: "openai/gpt-5.2",
      httpPost: async () => {
        throw {
          response: {
            status: 401,
            data: {
              error: {
                message: "invalid key sk-or-v1-secret-key"
              }
            }
          }
        };
      }
    });

    await expect(
      client.createChatCompletion({
        messages: [{ role: "user", content: "test" }]
      })
    ).rejects.toThrow("OpenRouter 请求失败 (401)：invalid key [REDACTED]");
  });

  it("includes provider metadata for OpenRouter provider-side rate limits", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-secret-key",
      modelName: "google/gemini-2.5-pro",
      httpPost: async () => {
        throw {
          response: {
            status: 429,
            data: {
              error: {
                code: 429,
                message: "Provider returned error",
                metadata: {
                  provider_name: "Google AI Studio",
                  raw: {
                    error: {
                      message: "Resource has been exhausted, please try again later."
                    }
                  }
                }
              }
            }
          }
        };
      }
    });

    await expect(
      client.createChatCompletion({
        messages: [{ role: "user", content: "test" }]
      })
    ).rejects.toThrow(
      "OpenRouter 请求失败 (429)：上游 Provider 限流或暂时不可用。请稍后重试，或在设置中换用其他模型。原始错误：Provider returned error；Provider: Google AI Studio；Resource has been exhausted, please try again later."
    );
  });

  it("turns generic 429 provider failures into actionable author-facing errors", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-secret-key",
      modelName: "google/gemini-2.5-pro",
      httpPost: async () => {
        throw {
          response: {
            status: 429,
            data: {}
          }
        };
      }
    });

    await expect(
      client.createChatCompletion({
        messages: [{ role: "user", content: "总结第四章" }]
      })
    ).rejects.toMatchObject({
      name: "OpenRouterError",
      code: "rate_limited",
      status: 429,
      isCanceled: false,
      message: "OpenRouter 请求失败 (429)：上游 Provider 限流或暂时不可用。请稍后重试，或在设置中换用其他模型。原始错误：provider returned an error"
    });
  });

  it("streams chat completions through official SSE chunks", async () => {
    const requests: OpenRouterHttpRequest[] = [];
    const tokens: string[] = [];
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "openai/gpt-5.2",
      httpStreamPost: async (request) => {
        requests.push(request);
        return [
          'data: {"choices":[{"delta":{"content":"第一"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"段"}}]}\n\n',
          "data: [DONE]\n\n"
        ];
      }
    });

    const result = await client.streamChatCompletion(
      {
        messages: [{ role: "user", content: "写一段。" }],
        maxCompletionTokens: 128,
        temperature: 0.4
      },
      {
        onToken(token) {
          tokens.push(token);
        }
      }
    );

    expect(result).toEqual({ content: "第一段", truncated: false });
    expect(tokens).toEqual(["第一", "段"]);
    expect(requests[0].body).toMatchObject({
      model: "openai/gpt-5.2",
      stream: true,
      max_completion_tokens: 128,
      temperature: 0.4
    });
  });

  it("streams reasoning chunks separately from final text", async () => {
    const reasoningChunks: string[] = [];
    const tokens: string[] = [];
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "google/gemini-2.5-pro",
      httpStreamPost: async () => [
        'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"先分析范围。"}]}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n',
        "data: [DONE]\n\n"
      ]
    });

    const result = await client.streamChatCompletion(
      {
        messages: [{ role: "user", content: "总结全部章节。" }]
      },
      {
        onReasoning(token) {
          reasoningChunks.push(token);
        },
        onToken(token) {
          tokens.push(token);
        }
      }
    );

    expect(result).toEqual({
      content: "答案",
      reasoning: "先分析范围。",
      truncated: false
    });
    expect(reasoningChunks).toEqual(["先分析范围。"]);
    expect(tokens).toEqual(["答案"]);
  });

  it("streams and assembles tool call argument deltas", async () => {
    const requests: OpenRouterHttpRequest[] = [];
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "openai/gpt-5.2",
      httpStreamPost: async (request) => {
        requests.push(request);
        return [
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_read_1","type":"function","function":{"name":"read_chapters","arguments":"{\\"scope\\":"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"type\\":\\"all_chapters\\"}"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]},"finish_reason":"tool_calls"}]}\n\n'
        ];
      }
    });

    const result = await client.streamChatCompletion({
      messages: [{ role: "user", content: "总结全部章节。" }],
      tools: [
        {
          type: "function",
          function: {
            name: "read_chapters",
            description: "Read chapter text from the current project.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false
            }
          }
        }
      ],
      parallelToolCalls: false
    });

    expect(requests[0].body).toMatchObject({
      parallel_tool_calls: false
    });
    expect(result).toEqual({
      content: "",
      toolCalls: [
        {
          id: "call_read_1",
          name: "read_chapters",
          argumentsJson: "{\"scope\":{\"type\":\"all_chapters\"}}"
        }
      ],
      truncated: false
    });
  });

  it("emits only the new reasoning suffix when providers repeat cumulative reasoning_details", async () => {
    const reasoningChunks: string[] = [];
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "google/gemini-2.5-pro",
      httpStreamPost: async () => [
        'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","id":"reasoning-1","index":0,"text":"先"}]}}]}\n\n',
        'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","id":"reasoning-1","index":0,"text":"先判断范围。"}]}}]}\n\n',
        'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","id":"reasoning-1","index":0,"text":"先判断范围。"}]}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n'
      ]
    });

    const result = await client.streamChatCompletion(
      {
        messages: [{ role: "user", content: "总结全部章节。" }]
      },
      {
        onReasoning(token) {
          reasoningChunks.push(token);
        }
      }
    );

    expect(reasoningChunks).toEqual(["先", "判断范围。"]);
    expect(result).toEqual({
      content: "答案",
      reasoning: "先判断范围。",
      truncated: false
    });
  });

  it("does not drop reasoning deltas just because the same short text appeared earlier", async () => {
    const reasoningChunks: string[] = [];
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "google/gemini-2.5-pro",
      httpStreamPost: async () => [
        'data: {"choices":[{"delta":{"reasoning_content":"这里的"}}]}\n\n',
        'data: {"choices":[{"delta":{"reasoning_content":"的"}}]}\n\n',
        'data: {"choices":[{"delta":{"reasoning_content":"确需要保留"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n'
      ]
    });

    const result = await client.streamChatCompletion(
      {
        messages: [{ role: "user", content: "检查 thinking 增量。" }]
      },
      {
        onReasoning(token) {
          reasoningChunks.push(token);
        }
      }
    );

    expect(reasoningChunks).toEqual(["这里的", "的", "确需要保留"]);
    expect(result).toEqual({
      content: "答案",
      reasoning: "这里的的确需要保留",
      truncated: false
    });
  });

  it("decodes streamed UTF-8 chunks across buffer boundaries", async () => {
    const encoded = Buffer.from("data: {\"choices\":[{\"delta\":{\"content\":\"山雨\"}}]}\n\n");
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "openai/gpt-5.2",
      httpStreamPost: async () => [encoded.subarray(0, 41), encoded.subarray(41)]
    });

    await expect(
      client.streamChatCompletion({
        messages: [{ role: "user", content: "写一段。" }]
      })
    ).resolves.toEqual({ content: "山雨", truncated: false });
  });

  it("passes abort signals to streaming requests", async () => {
    const controller = new AbortController();
    const requests: OpenRouterHttpRequest[] = [];
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "openai/gpt-5.2",
      httpStreamPost: async (request) => {
        requests.push(request);
        return ["data: [DONE]\n\n"];
      }
    });

    await client.streamChatCompletion({
      messages: [{ role: "user", content: "写一段。" }],
      signal: controller.signal
    });

    expect(requests[0].signal).toBe(controller.signal);
  });

  it("returns partial streamed content with a truncation flag when the provider stops at length", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "openai/gpt-5.2",
      httpStreamPost: async () => [
        'data: {"choices":[{"delta":{"content":"已经生成"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n'
      ]
    });

    await expect(
      client.streamChatCompletion({
        messages: [{ role: "user", content: "写一段。" }]
      })
    ).resolves.toEqual({ content: "已经生成", truncated: true });
  });

  it("surfaces mid-stream OpenRouter errors with partial content excluded from final results", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-secret-key",
      modelName: "openai/gpt-5.2",
      httpStreamPost: async () => [
        'data: {"choices":[{"delta":{"content":"半段"}}]}\n\n',
        'data: {"error":{"message":"Provider sk-or-v1-secret-key disconnected"},"choices":[{"finish_reason":"error"}]}\n\n'
      ]
    });

    await expect(
      client.streamChatCompletion(
        {
          messages: [{ role: "user", content: "写一段。" }]
        },
        {
          onToken() {}
        }
      )
    ).rejects.toThrow("OpenRouter 请求失败：Provider [REDACTED] disconnected");
  });

  it("redacts generic bearer tokens from provider errors", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-secret-key",
      modelName: "openai/gpt-5.2",
      httpPost: async () => {
        throw {
          response: {
            status: 401,
            data: {
              error: {
                message: "Authorization failed: Bearer third-party-secret-token"
              }
            }
          }
        };
      }
    });

    await expect(
      client.createChatCompletion({
        messages: [{ role: "user", content: "test" }]
      })
    ).rejects.toThrow("OpenRouter 请求失败 (401)：Authorization failed: Bearer [REDACTED]");
  });
});

describe("OpenRouterModelCatalogClient", () => {
  it("fetches text model metadata from the official OpenRouter models endpoint", async () => {
    const requests: Array<{ readonly url: string }> = [];
    const catalog = new OpenRouterModelCatalogClient({
      httpGet: async (request) => {
        requests.push(request);
        return {
          data: [
            {
              id: "google/gemini-2.5-pro",
              name: "Gemini 2.5 Pro",
              context_length: 1048576,
              supported_parameters: ["tools", "tool_choice", "reasoning"]
            }
          ]
        };
      }
    });

    await expect(catalog.listModels()).resolves.toEqual([
      {
        id: "google/gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        contextLength: 1048576,
        supportsTools: true
      }
    ]);
    expect(requests).toEqual([{ url: "https://openrouter.ai/api/v1/models?output_modalities=text&supported_parameters=tools" }]);
  });

  it("uses the configured OpenRouter-compatible base URL for model metadata", async () => {
    const requests: Array<{ readonly url: string }> = [];
    const catalog = new OpenRouterModelCatalogClient({
      baseUrl: "https://openrouter-proxy.example.com/api/v1/",
      httpGet: async (request) => {
        requests.push(request);
        return { data: [] };
      }
    });

    await catalog.listModels();

    expect(requests).toEqual([{ url: "https://openrouter-proxy.example.com/api/v1/models?output_modalities=text&supported_parameters=tools" }]);
  });

  it("uses provider context length when the root model context is missing", async () => {
    const catalog = new OpenRouterModelCatalogClient({
      httpGet: async () => ({
        data: [
          {
            id: "provider/model-with-provider-window",
            name: "Provider Window Model",
            supported_parameters: ["tools"],
            top_provider: {
              context_length: 200000
            }
          }
        ]
      })
    });

    await expect(catalog.listModels()).resolves.toEqual([
      {
        id: "provider/model-with-provider-window",
        name: "Provider Window Model",
        contextLength: 200000,
        supportsTools: true
      }
    ]);
  });
});
