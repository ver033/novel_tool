import { describe, expect, it } from "vitest";
import { runChatAgentLoop, type ChatAgentModel } from "../../src/main/ai/chat-agent-harness";
import type { OpenRouterMessage, OpenRouterToolCall, OpenRouterToolDefinition } from "../../src/main/ai/openrouter-client";
import type { AiChatAction } from "../../src/main/shared/types";
import { getTokenBudget } from "../../src/main/ai/token-budget";

const tools: readonly OpenRouterToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_chapters",
      description: "读取章节",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "add_to_scratchpad",
      description: "加入草稿纸",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  }
];

function getToolMessages(messages: readonly OpenRouterMessage[]): readonly Extract<OpenRouterMessage, { role: "tool" }>[] {
  return messages.filter((message): message is Extract<OpenRouterMessage, { role: "tool" }> => message.role === "tool");
}

describe("chat agent harness", () => {
  it("runs a tool-call loop and feeds tool results back before the final answer", async () => {
    const modelMessages: OpenRouterMessage[][] = [];
    const model: ChatAgentModel = {
      async stream(input) {
        modelMessages.push([...input.messages]);
        if (modelMessages.length === 1) {
          expect(input.messages[0].content).toContain("run_writing_operation 返回 candidate_text");
          expect(input.tools.map((tool) => tool.function.name)).toContain("read_chapters");
          return {
            content: "",
            truncated: false,
            toolCalls: [
              {
                id: "call_read_all",
                name: "read_chapters",
                argumentsJson: JSON.stringify({
                  scope: {
                    type: "all_chapters"
                  }
                })
              }
            ]
          };
        }

        const toolMessages = getToolMessages(input.messages);
        expect(toolMessages).toHaveLength(1);
        expect(toolMessages[0]).toMatchObject({
          tool_call_id: "call_read_all",
          name: "read_chapters"
        });
        expect(toolMessages[0].content).toContain("第二章真实正文");
        return {
          content: "全部章节总结：第一章起势，第二章推进冲突。",
          truncated: false
        };
      }
    };
    const chunks: string[] = [];

    const result = await runChatAgentLoop(
      {
        requestId: "agent_loop_tool",
        projectId: "project_agent",
        sessionId: "chat_1",
        userMessage: "总结现有全部章节",
        history: [],
        currentChapterId: "chapter_1",
        chapterDirectory: [
          {
            ordinal: 1,
            id: "chapter_1",
            title: "第1章 起点",
            wordCount: 10,
            current: true
          },
          {
            ordinal: 2,
            id: "chapter_2",
            title: "第2章 暗潮",
            wordCount: 12,
            current: false
          }
        ],
        tools,
        model,
        tokenBudget: getTokenBudget("chat"),
        modelContextTokens: 16_384,
        modelName: "test/model",
        async executeTool(call: OpenRouterToolCall) {
          expect(call.name).toBe("read_chapters");
          return {
            action: null,
            content: JSON.stringify({
              scopeLabel: "全部章节",
              mode: "direct",
              sourceChapterIds: ["chapter_1", "chapter_2"],
              contextText: "[第1章 起点]\n第一章真实正文。\n\n[第2章 暗潮]\n第二章真实正文。"
            })
          };
        }
      },
      {
        onChunk(event) {
          chunks.push(event.content);
        }
      }
    );

    expect(result.content).toBe("全部章节总结：第一章起势，第二章推进冲突。");
    expect(result.actions).toEqual([]);
    expect(chunks.join("")).toBe(result.content);
    expect(modelMessages).toHaveLength(2);
  });

  it("feeds tool execution errors back to the model so it can self-correct", async () => {
    let modelCallCount = 0;
    let toolCallCount = 0;
    const model: ChatAgentModel = {
      async stream(input) {
        modelCallCount += 1;
        const toolMessages = getToolMessages(input.messages);
        if (modelCallCount === 1) {
          return {
            content: "",
            truncated: false,
            toolCalls: [
              {
                id: "call_read_bad",
                name: "read_chapters",
                argumentsJson: "{\"scope\":"
              }
            ]
          };
        }
        if (modelCallCount === 2) {
          expect(toolMessages).toHaveLength(1);
          expect(toolMessages[0].tool_call_id).toBe("call_read_bad");
          expect(toolMessages[0].content).toContain("AI 工具 read_chapters 参数无效");
          return {
            content: "",
            truncated: false,
            toolCalls: [
              {
                id: "call_read_fixed",
                name: "read_chapters",
                argumentsJson: JSON.stringify({
                  scope: "all_chapters"
                })
              }
            ]
          };
        }

        expect(toolMessages).toHaveLength(2);
        expect(toolMessages[1].tool_call_id).toBe("call_read_fixed");
        expect(toolMessages[1].content).toContain("第二章真实正文");
        return {
          content: "已根据全部章节重新总结。",
          truncated: false
        };
      }
    };

    const result = await runChatAgentLoop({
      requestId: "agent_loop_tool_error_self_correct",
      projectId: "project_agent",
      sessionId: "chat_1",
      userMessage: "总结全部章节",
      history: [],
      chapterDirectory: [],
      tools,
      model,
      tokenBudget: getTokenBudget("chat"),
      modelContextTokens: null,
      modelName: "test/model",
      async executeTool(call: OpenRouterToolCall) {
        toolCallCount += 1;
        if (call.id === "call_read_bad") {
          throw new Error("AI 工具 read_chapters 参数无效：scope 必须是可解析的范围。");
        }
        expect(call.id).toBe("call_read_fixed");
        return {
          action: null,
          content: JSON.stringify({
            scopeLabel: "全部章节",
            mode: "direct",
            sourceChapterIds: ["chapter_1", "chapter_2"],
            contextText: "[第1章 起点]\n第一章真实正文。\n\n[第2章 暗潮]\n第二章真实正文。"
          })
        };
      }
    });

    expect(result.content).toBe("已根据全部章节重新总结。");
    expect(result.actions).toEqual([]);
    expect(modelCallCount).toBe(3);
    expect(toolCallCount).toBe(2);
  });

  it("reports summarized tool context usage after compressed chapter reads", async () => {
    const contextEvents: Array<{ readonly contextMode: string; readonly scopeLabel: string }> = [];
    let callCount = 0;
    const model: ChatAgentModel = {
      async stream() {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: "",
            truncated: false,
            toolCalls: [
              {
                id: "call_read_all",
                name: "read_chapters",
                argumentsJson: JSON.stringify({
                  scope: "all_chapters"
                })
              }
            ]
          };
        }

        return {
          content: "基于压缩上下文的总结。",
          truncated: false
        };
      }
    };

    await runChatAgentLoop(
      {
        requestId: "agent_loop_summarized_context",
        projectId: "project_agent",
        sessionId: "chat_1",
        userMessage: "总结全部章节",
        history: [],
        chapterDirectory: [],
        tools,
        model,
        tokenBudget: getTokenBudget("chat"),
        modelContextTokens: 16_384,
        modelName: "test/model",
        async executeTool() {
          return {
            action: null,
            content: JSON.stringify({
              scopeLabel: "全部章节",
              mode: "summarized",
              sourceChapterIds: ["chapter_1", "chapter_2"],
              contextText: "[全部章节 | 聚合摘要]\n压缩摘要。"
            })
          };
        }
      },
      {
        onContext(event) {
          contextEvents.push({
            contextMode: event.contextMode,
            scopeLabel: event.scopeLabel
          });
        }
      }
    );

    expect(contextEvents).toEqual([
      {
        contextMode: "summarized",
        scopeLabel: "全部章节"
      }
    ]);
  });

  it("emits context usage for a direct final answer without tool calls", async () => {
    const contextEvents: Array<{ readonly estimatedInputTokens: number; readonly scopeLabel: string }> = [];
    const model: ChatAgentModel = {
      async stream() {
        return {
          content: "可以，这段更适合先压低旁观者声音，再突出主角反应。",
          truncated: false
        };
      }
    };

    await runChatAgentLoop(
      {
        requestId: "agent_loop_direct_context",
        projectId: "project_agent",
        sessionId: "chat_1",
        userMessage: "这段节奏怎么样？",
        history: [],
        chapterDirectory: [],
        tools,
        model,
        tokenBudget: getTokenBudget("chat"),
        modelContextTokens: 16_384,
        modelName: "test/model",
        async executeTool() {
          throw new Error("direct answer should not execute tools");
        }
      },
      {
        onContext(event) {
          contextEvents.push({
            estimatedInputTokens: event.estimatedInputTokens,
            scopeLabel: event.scopeLabel
          });
        }
      }
    );

    expect(contextEvents).toHaveLength(1);
    expect(contextEvents[0].estimatedInputTokens).toBeGreaterThan(0);
    expect(contextEvents[0].scopeLabel).toBe("当前对话");
  });

  it("counts tool definitions before sending an agent prompt to the model", async () => {
    let modelCalled = false;
    const oversizedTools: readonly OpenRouterToolDefinition[] = [
      {
        type: "function",
        function: {
          name: "read_chapters",
          description: "读取章节正文，并严格根据工具返回内容回答。".repeat(360),
          parameters: {
            type: "object",
            properties: {
              scope: {
                type: "string",
                enum: ["all_chapters"]
              }
            }
          }
        }
      }
    ];
    const model: ChatAgentModel = {
      async stream() {
        modelCalled = true;
        return {
          content: "不应该发送到模型。",
          truncated: false
        };
      }
    };

    await expect(
      runChatAgentLoop({
        requestId: "agent_loop_counts_tools_budget",
        projectId: "project_agent",
        sessionId: "chat_1",
        userMessage: "总结全部章节",
        history: [],
        chapterDirectory: [],
        tools: oversizedTools,
        model,
        tokenBudget: {
          maxInputTokens: 3000,
          maxOutputTokens: 512
        },
        modelContextTokens: null,
        modelName: "test/model",
        async executeTool() {
          throw new Error("tool should not execute");
        }
      })
    ).rejects.toThrow("AI 对话上下文太长");
    expect(modelCalled).toBe(false);
  });

  it("keeps partial final chat output when the model hits the output limit", async () => {
    const chunks: string[] = [];
    let callCount = 0;
    const model: ChatAgentModel = {
      async stream(input, handlers) {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: "",
            truncated: false,
            toolCalls: [
              {
                id: "call_read_all",
                name: "read_chapters",
                argumentsJson: JSON.stringify({
                  scope: "all_chapters"
                })
              }
            ]
          };
        }

        handlers?.onToken?.("校对发现：第1章有重复表达。");
        return {
          content: "校对发现：第1章有重复表达。",
          truncated: true
        };
      }
    };

    const result = await runChatAgentLoop(
      {
        requestId: "agent_loop_truncated_final",
        projectId: "project_agent",
        sessionId: "chat_1",
        userMessage: "阅读全文，校对现有文章",
        history: [],
        chapterDirectory: [],
        tools,
        model,
        tokenBudget: getTokenBudget("chat"),
        modelContextTokens: 16_384,
        modelName: "test/model",
        async executeTool() {
          return {
            action: null,
            content: JSON.stringify({
              scopeLabel: "全部章节",
              mode: "direct",
              sourceChapterIds: ["chapter_1"],
              contextText: "[第1章 起点]\n第一章真实正文。"
            })
          };
        }
      },
      {
        onChunk(event) {
          chunks.push(event.content);
        }
      }
    );

    expect(result.content).toContain("校对发现：第1章有重复表达。");
    expect(result.content).toContain("回答已被模型截断");
    expect(result.content).toContain("按章节继续校对");
    expect(chunks.join("")).toBe(result.content);
  });

  it("returns a writing tool candidate directly when the tool result is too large for another model turn", async () => {
    const longCandidate = "少年在嘲笑声中站得笔直，指尖却因压抑而微微发白。".repeat(1000);
    const model: ChatAgentModel = {
      async stream(input) {
        const hasToolResult = input.messages.some((message) => message.role === "tool");
        if (hasToolResult) {
          throw new Error("large writing candidates should not be sent back to the model");
        }
        return {
          content: "",
          truncated: false,
          toolCalls: [
            {
              id: "call_polish",
              name: "run_writing_operation",
              argumentsJson: JSON.stringify({
                operation: "polish"
              })
            }
          ]
        };
      }
    };
    const chunks: string[] = [];

    const result = await runChatAgentLoop(
      {
        requestId: "agent_loop_large_writing_result",
        projectId: "project_agent",
        sessionId: "chat_1",
        userMessage: "润色选中文本",
        history: [],
        selectionText: "少年站着。",
        chapterDirectory: [],
        tools,
        model,
        tokenBudget: {
          maxInputTokens: 3000,
          maxOutputTokens: 512
        },
        modelContextTokens: null,
        modelName: "test/model",
        async executeTool(call: OpenRouterToolCall) {
          expect(call.name).toBe("run_writing_operation");
          return {
            action: null,
            content: JSON.stringify({
              operation: "polish",
              outputKind: "candidate_text",
              generatedText: longCandidate,
              changeSummary: "保留情绪张力，增强动作连贯性。",
              proofreadIssues: null,
              contextPlan: {
                mode: "direct",
                estimatedInputTokens: 512,
                maxInputTokens: 3000,
                reason: "选区是唯一修改目标，周边正文只作参考。"
              }
            })
          };
        }
      },
      {
        onChunk(event) {
          chunks.push(event.content);
        }
      }
    );

    expect(result.content).toContain("【润色稿】");
    expect(result.content).toContain(longCandidate);
    expect(chunks.join("")).toBe(result.content);
  });

  it("collects actions returned by tools without using prompt text regex", async () => {
    const action = {
      type: "add_to_scratchpad",
      content: "角色摘要：林远谨慎，沈青负责推动冲突。",
      chapterId: null
    } satisfies AiChatAction;
    const model: ChatAgentModel = {
      async stream(input) {
        if (!input.messages.some((message) => message.role === "tool")) {
          return {
            content: "",
            truncated: false,
            toolCalls: [
              {
                id: "call_scratch",
                name: "add_to_scratchpad",
                argumentsJson: JSON.stringify({
                  content: action.content,
                  chapterId: null
                })
              }
            ]
          };
        }

        return {
          content: "已把角色摘要加入草稿纸。",
          truncated: false
        };
      }
    };

    const result = await runChatAgentLoop({
      requestId: "agent_loop_scratch",
      projectId: "project_agent",
      sessionId: "chat_1",
      userMessage: "把角色摘要放进草稿纸",
      history: [],
      chapterDirectory: [],
      tools,
      model,
      tokenBudget: getTokenBudget("chat"),
      modelContextTokens: null,
      modelName: "test/model",
      async executeTool(call: OpenRouterToolCall) {
        expect(call.name).toBe("add_to_scratchpad");
        return {
          action,
          content: JSON.stringify({
            ok: true,
            action
          })
        };
      }
    });

    expect(result.content).toBe("已把角色摘要加入草稿纸。");
    expect(result.actions).toEqual([action]);
  });

  it("requires rewrite and polish answers to include a complete candidate text", async () => {
    const model: ChatAgentModel = {
      async stream(input) {
        const systemPrompt = String(input.messages.find((message) => message.role === "system")?.content ?? "");
        expect(systemPrompt).toContain("完整候选正文");
        expect(systemPrompt).toContain("不能只给改进建议");
        return {
          content: "【润色稿】\n他在雨声里停步，掌心的旧伤隐隐发烫。",
          truncated: false
        };
      }
    };

    const result = await runChatAgentLoop({
      requestId: "agent_loop_polish",
      projectId: "project_agent",
      sessionId: "chat_1",
      userMessage: "帮我润色这一段",
      history: [],
      selectionText: "他停下脚步，手心发热。",
      chapterDirectory: [],
      tools,
      model,
      tokenBudget: getTokenBudget("chat"),
      modelContextTokens: null,
      modelName: "test/model",
      async executeTool() {
        throw new Error("selection polish should not need a tool in this test");
      }
    });

    expect(result.content).toContain("【润色稿】");
  });

  it("keeps whole-document proofreading chat output bounded and diagnostic", async () => {
    const model: ChatAgentModel = {
      async stream(input) {
        const systemPrompt = String(input.messages.find((message) => message.role === "system")?.content ?? "");
        expect(systemPrompt).toContain("校对");
        expect(systemPrompt).toContain("不要输出全文改写稿");
        expect(systemPrompt).toContain("最多 20 条");
        return {
          content: "【校对结果】\n暂未发现明显错别字。",
          truncated: false
        };
      }
    };

    const result = await runChatAgentLoop({
      requestId: "agent_loop_proofread_bounded",
      projectId: "project_agent",
      sessionId: "chat_1",
      userMessage: "阅读全文，校对现有文章",
      history: [],
      chapterDirectory: [],
      tools,
      model,
      tokenBudget: getTokenBudget("chat"),
      modelContextTokens: null,
      modelName: "test/model",
      async executeTool() {
        throw new Error("prompt-only proofread test should not execute tools");
      }
    });

    expect(result.content).toContain("【校对结果】");
  });

  it("instructs the model that pasted chat text can be used as the rewrite source", async () => {
    const userMessage = ["少年面无表情，唇角带着一抹自嘲。", "这一段文字润色一下"].join("\n");
    const model: ChatAgentModel = {
      async stream(input) {
        const systemPrompt = String(input.messages.find((message) => message.role === "system")?.content ?? "");
        const userPrompt = String(input.messages.find((message) => message.role === "user")?.content ?? "");
        expect(systemPrompt).toContain("当前消息里直接粘贴的正文");
        expect(systemPrompt).toContain("target.kind=inline_text");
        expect(systemPrompt).toContain("没有 slash 时，你也必须根据作者自然语言自由决定是否调用 run_writing_operation");
        expect(systemPrompt).toContain("本地不会根据关键词猜测正文范围");
        expect(userPrompt).toContain("run_writing_operation.target.inline_text.text");
        return {
          content: "【润色稿】\n少年面色沉静，唇边却浮着一抹难以遮掩的自嘲。",
          truncated: false
        };
      }
    };

    const result = await runChatAgentLoop({
      requestId: "agent_loop_inline_polish",
      projectId: "project_agent",
      sessionId: "chat_1",
      userMessage,
      history: [],
      chapterDirectory: [],
      tools,
      model,
      tokenBudget: getTokenBudget("chat"),
      modelContextTokens: null,
      modelName: "test/model",
      async executeTool() {
        throw new Error("inline pasted text prompt test should not execute tools");
      }
    });

    expect(result.content).toContain("【润色稿】");
  });

  it("keeps a successful writing operation result when the final assistant turn is empty", async () => {
    const chunks: string[] = [];
    let callCount = 0;
    const model: ChatAgentModel = {
      async stream(input) {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: "",
            truncated: false,
            toolCalls: [
              {
                id: "call_polish",
                name: "run_writing_operation",
                argumentsJson: JSON.stringify({
                  operation: "polish",
                  target: {
                    kind: "inline_text",
                    text: "少年木然地站在原地。"
                  },
                  instruction: "润色一下"
                })
              }
            ]
          };
        }

        throw new Error("writing operation result should finish the chat turn without a second model call");
      }
    };

    const result = await runChatAgentLoop(
      {
        requestId: "agent_loop_empty_final_after_writing_operation",
        projectId: "project_agent",
        sessionId: "chat_1",
        userMessage: "少年木然地站在原地。\n这一段润色一下",
        history: [],
        chapterDirectory: [],
        tools,
        model,
        tokenBudget: getTokenBudget("chat"),
        modelContextTokens: null,
        modelName: "test/model",
        async executeTool(call: OpenRouterToolCall) {
          expect(call.name).toBe("run_writing_operation");
          return {
            action: null,
            content: JSON.stringify({
              operation: "polish",
              outputKind: "candidate_text",
              generatedText: "少年僵立原地，周遭的嘲笑声一寸寸刺进耳中。",
              changeSummary: "OpenRouter polish candidate",
              proofreadIssues: null,
              contextPlan: {
                mode: "direct",
                estimatedInputTokens: 731,
                maxInputTokens: 89_251,
                reason: "选区是唯一修改目标，前后文只作为参考上下文。"
              }
            })
          };
        }
      },
      {
        onChunk(event) {
          chunks.push(event.content);
        }
      }
    );

    expect(result.content).toContain("【润色稿】");
    expect(result.content).toContain("少年僵立原地");
    expect(result.content).not.toContain("changeSummary");
    expect(chunks.join("")).toBe(result.content);
    expect(callCount).toBe(1);
  });

  it("does not leak streamed preface text from a tool-call turn into the visible chat output", async () => {
    const chunks: string[] = [];
    const model: ChatAgentModel = {
      async stream(_input, handlers) {
        handlers?.onToken?.("我先帮你润色。\n");
        return {
          content: "我先帮你润色。",
          truncated: false,
          toolCalls: [
            {
              id: "call_polish_preface",
              name: "run_writing_operation",
              argumentsJson: JSON.stringify({
                operation: "polish",
                target: {
                  kind: "inline_text",
                  text: "少年木然地站在原地。"
                }
              })
            }
          ]
        };
      }
    };

    const result = await runChatAgentLoop(
      {
        requestId: "agent_loop_tool_preface_buffered",
        projectId: "project_agent",
        sessionId: "chat_1",
        userMessage: "少年木然地站在原地。\n这一段润色一下",
        history: [],
        chapterDirectory: [],
        tools,
        model,
        tokenBudget: getTokenBudget("chat"),
        modelContextTokens: null,
        modelName: "test/model",
        async executeTool(call: OpenRouterToolCall) {
          expect(call.name).toBe("run_writing_operation");
          return {
            action: null,
            content: JSON.stringify({
              operation: "polish",
              outputKind: "candidate_text",
              generatedText: "少年僵立原地，周遭的嘲笑声一寸寸刺进耳中。",
              changeSummary: "OpenRouter polish candidate",
              proofreadIssues: null,
              contextPlan: {
                mode: "direct",
                estimatedInputTokens: 731,
                maxInputTokens: 89_251,
                reason: "选区是唯一修改目标，前后文只作为参考上下文。"
              }
            })
          };
        }
      },
      {
        onChunk(event) {
          chunks.push(event.content);
        }
      }
    );

    expect(result.content).toContain("【润色稿】");
    expect(result.content).toContain("少年僵立原地");
    expect(result.content).not.toContain("我先帮你润色");
    expect(chunks.join("")).toBe(result.content);
  });

  it("uses the writing operation result even when the final assistant turn is only a summary", async () => {
    let callCount = 0;
    const model: ChatAgentModel = {
      async stream(input) {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: "",
            truncated: false,
            toolCalls: [
              {
                id: "call_polish",
                name: "run_writing_operation",
                argumentsJson: JSON.stringify({
                  operation: "polish",
                  target: {
                    kind: "inline_text",
                    text: "少年木然地站在原地。"
                  }
                })
              }
            ]
          };
        }

        throw new Error("writing operation result should finish the chat turn without summary rewriting");
      }
    };

    const result = await runChatAgentLoop({
      requestId: "agent_loop_summary_final_after_writing_operation",
      projectId: "project_agent",
      sessionId: "chat_1",
      userMessage: "少年木然地站在原地。\n这一段润色一下",
      history: [],
      chapterDirectory: [],
      tools,
      model,
      tokenBudget: getTokenBudget("chat"),
      modelContextTokens: null,
      modelName: "test/model",
      async executeTool(call: OpenRouterToolCall) {
        expect(call.name).toBe("run_writing_operation");
        return {
          action: null,
          content: JSON.stringify({
            operation: "polish",
            outputKind: "candidate_text",
            generatedText: "少年僵立原地，周遭的嘲笑声一寸寸刺进耳中。",
            changeSummary: "OpenRouter polish candidate",
            proofreadIssues: null,
            contextPlan: {
              mode: "direct",
              estimatedInputTokens: 731,
              maxInputTokens: 89_251,
              reason: "选区是唯一修改目标，前后文只作为参考上下文。"
            }
          })
        };
      }
    });

    expect(result.content).toContain("【润色稿】");
    expect(result.content).toContain("少年僵立原地");
    expect(result.content).not.toContain("已完成润色");
    expect(callCount).toBe(1);
  });

  it("allows an explicit scratchpad save after a writing operation while keeping the candidate visible", async () => {
    const action = {
      type: "add_to_scratchpad",
      content: "少年僵立原地，周遭的嘲笑声一寸寸刺进耳中。",
      chapterId: null
    } satisfies AiChatAction;
    let callCount = 0;
    const model: ChatAgentModel = {
      async stream(input) {
        callCount += 1;
        const toolMessages = getToolMessages(input.messages);
        if (callCount === 1) {
          return {
            content: "",
            truncated: false,
            toolCalls: [
              {
                id: "call_polish_save",
                name: "run_writing_operation",
                argumentsJson: JSON.stringify({
                  operation: "polish",
                  target: {
                    kind: "inline_text",
                    text: "少年木然地站在原地。"
                  }
                })
              }
            ]
          };
        }
        if (callCount === 2) {
          expect(toolMessages.some((message) => message.name === "run_writing_operation")).toBe(true);
          return {
            content: "",
            truncated: false,
            toolCalls: [
              {
                id: "call_save_candidate",
                name: "add_to_scratchpad",
                argumentsJson: JSON.stringify({
                  content: action.content,
                  chapterId: null
                })
              }
            ]
          };
        }

        expect(toolMessages.some((message) => message.name === "add_to_scratchpad")).toBe(true);
        return {
          content: "已加入草稿纸。",
          truncated: false
        };
      }
    };

    const result = await runChatAgentLoop({
      requestId: "agent_loop_writing_operation_then_scratch",
      projectId: "project_agent",
      sessionId: "chat_1",
      userMessage: "少年木然地站在原地。\n润色后加入草稿纸",
      history: [],
      chapterDirectory: [],
      tools,
      model,
      tokenBudget: getTokenBudget("chat"),
      modelContextTokens: null,
      modelName: "test/model",
      async executeTool(call: OpenRouterToolCall) {
        if (call.name === "run_writing_operation") {
          return {
            action: null,
            content: JSON.stringify({
              operation: "polish",
              outputKind: "candidate_text",
              generatedText: action.content,
              changeSummary: "OpenRouter polish candidate",
              proofreadIssues: null,
              contextPlan: {
                mode: "direct",
                estimatedInputTokens: 731,
                maxInputTokens: 89_251,
                reason: "选区是唯一修改目标，前后文只作为参考上下文。"
              }
            })
          };
        }
        expect(call.name).toBe("add_to_scratchpad");
        return {
          action,
          content: JSON.stringify({
            ok: true,
            action
          })
        };
      }
    });

    expect(result.content).toContain("【润色稿】");
    expect(result.content).toContain(action.content);
    expect(result.content).toContain("已加入草稿纸");
    expect(result.actions).toEqual([action]);
    expect(callCount).toBe(3);
  });

  it("reports writing operation tool context instead of leaving the session meter unchanged", async () => {
    const contextEvents: Array<{ readonly scopeLabel: string; readonly contextMode: string; readonly estimatedInputTokens: number }> = [];
    let callCount = 0;
    const model: ChatAgentModel = {
      async stream() {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: "",
            truncated: false,
            toolCalls: [
              {
                id: "call_polish",
                name: "run_writing_operation",
                argumentsJson: JSON.stringify({
                  operation: "polish",
                  target: {
                    kind: "inline_text",
                    text: "少年木然地站在原地。"
                  }
                })
              }
            ]
          };
        }

        throw new Error("writing operation result should finish the chat turn without a second model call");
      }
    };

    await runChatAgentLoop(
      {
        requestId: "agent_loop_writing_context",
        projectId: "project_agent",
        sessionId: "chat_1",
        userMessage: "/润色 少年木然地站在原地。",
        history: [],
        chapterDirectory: [],
        tools,
        model,
        tokenBudget: getTokenBudget("chat"),
        modelContextTokens: 16_384,
        modelName: "test/model",
        async executeTool() {
          return {
            action: null,
            content: JSON.stringify({
              operation: "polish",
              outputKind: "candidate_text",
              generatedText: "少年僵立原地，周遭的嘲笑声一寸寸刺进耳中。",
              changeSummary: "OpenRouter polish candidate",
              proofreadIssues: null,
              contextPlan: {
                mode: "direct",
                estimatedInputTokens: 731,
                maxInputTokens: 89_251,
                reason: "目标文本为对话内粘贴文本。"
              }
            })
          };
        }
      },
      {
        onContext(event) {
          contextEvents.push({
            scopeLabel: event.scopeLabel,
            contextMode: event.contextMode,
            estimatedInputTokens: event.estimatedInputTokens
          });
        }
      }
    );

    expect(contextEvents).toHaveLength(1);
    expect(contextEvents[0]).toMatchObject({
      scopeLabel: "写作操作：润色",
      contextMode: "direct"
    });
    expect(contextEvents[0].estimatedInputTokens).toBeGreaterThan(0);
  });

  it("reports mixed writing operation context usage", async () => {
    const contextEvents: Array<{ readonly scopeLabel: string; readonly contextMode: string }> = [];
    let callCount = 0;
    const model: ChatAgentModel = {
      async stream() {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: "",
            truncated: false,
            toolCalls: [
              {
                id: "call_polish_mixed",
                name: "run_writing_operation",
                argumentsJson: JSON.stringify({
                  operation: "polish",
                  target: {
                    kind: "inline_text",
                    text: "少年木然地站在原地。"
                  }
                })
              }
            ]
          };
        }

        return {
          content: "【润色稿】\n少年僵立原地，周遭的嘲笑声一寸寸刺进耳中。",
          truncated: false
        };
      }
    };

    await runChatAgentLoop(
      {
        requestId: "agent_loop_writing_mixed_context",
        projectId: "project_agent",
        sessionId: "chat_1",
        userMessage: "/润色 少年木然地站在原地。",
        history: [],
        chapterDirectory: [],
        tools,
        model,
        tokenBudget: getTokenBudget("chat"),
        modelContextTokens: 16_384,
        modelName: "test/model",
        async executeTool() {
          return {
            action: null,
            content: JSON.stringify({
              operation: "polish",
              outputKind: "candidate_text",
              generatedText: "少年僵立原地，周遭的嘲笑声一寸寸刺进耳中。",
              changeSummary: "OpenRouter polish candidate",
              proofreadIssues: null,
              contextPlan: {
                mode: "mixed",
                estimatedInputTokens: 1200,
                maxInputTokens: 8000,
                reason: "部分参考上下文已压缩。"
              }
            })
          };
        }
      },
      {
        onContext(event) {
          contextEvents.push({
            scopeLabel: event.scopeLabel,
            contextMode: event.contextMode
          });
        }
      }
    );

    expect(contextEvents).toContainEqual({
      scopeLabel: "写作操作：润色",
      contextMode: "mixed"
    });
  });

  it("does not execute partial tool calls from a truncated model response", async () => {
    let executedTool = false;
    const model: ChatAgentModel = {
      async stream() {
        return {
          content: "",
          truncated: true,
          toolCalls: [
            {
              id: "call_partial",
              name: "read_chapters",
              argumentsJson: "{\"scope\":{\"type\":\"all"
            }
          ]
        };
      }
    };

    await expect(
      runChatAgentLoop({
        requestId: "agent_loop_truncated_tool",
        projectId: "project_agent",
        sessionId: "chat_1",
        userMessage: "总结全部章节",
        history: [],
        chapterDirectory: [],
        tools,
        model,
        tokenBudget: getTokenBudget("chat"),
        modelContextTokens: null,
        modelName: "test/model",
        async executeTool() {
          executedTool = true;
          return {
            action: null,
            content: "{}"
          };
        }
      })
    ).rejects.toThrow("AI 对话回答被截断");
    expect(executedTool).toBe(false);
  });
});
