import { describe, expect, it } from "vitest";
import { parseOpenRouterSsePayload } from "../../src/main/ai/openrouter-stream-parser";

describe("parseOpenRouterSsePayload", () => {
  it("extracts content chunks and ignores OpenRouter comments", () => {
    const events = parseOpenRouterSsePayload(
      [
        ": OPENROUTER PROCESSING",
        "",
        'data: {"choices":[{"delta":{"content":"第一"}}]}',
        "",
        'data: {"choices":[{"delta":{"content":"段"}}]}',
        "",
        "data: [DONE]",
        ""
      ].join("\n")
    );

    expect(events).toEqual([
      { type: "content", content: "第一" },
      { type: "content", content: "段" },
      { type: "done" }
    ]);
  });

  it("extracts mid-stream OpenRouter errors", () => {
    const events = parseOpenRouterSsePayload(
      'data: {"error":{"message":"Provider disconnected"},"choices":[{"finish_reason":"error"}]}\n\n'
    );

    expect(events).toEqual([{ type: "error", message: "Provider disconnected" }]);
  });

  it("keeps partial content and marks length finish reasons as truncated", () => {
    const events = parseOpenRouterSsePayload('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n');

    expect(events).toEqual([{ type: "truncated" }]);
  });

  it("extracts streamed OpenRouter tool call deltas and finish markers", () => {
    const events = parseOpenRouterSsePayload(
      [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_read_1","type":"function","function":{"name":"read_chapters","arguments":"{\\"scope\\":"}}]}}]}',
        "",
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"type\\":\\"all_chapters\\"}"}}]}}]}',
        "",
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]},"finish_reason":"tool_calls"}]}',
        ""
      ].join("\n")
    );

    expect(events).toEqual([
      {
        type: "tool_call_delta",
        index: 0,
        id: "call_read_1",
        name: "read_chapters",
        argumentsJsonDelta: "{\"scope\":"
      },
      {
        type: "tool_call_delta",
        index: 0,
        argumentsJsonDelta: "{\"type\":\"all_chapters\"}"
      },
      {
        type: "tool_call_delta",
        index: 0,
        argumentsJsonDelta: "}"
      },
      { type: "tool_calls_done" }
    ]);
  });

  it("extracts OpenRouter reasoning details from streamed chunks", () => {
    const events = parseOpenRouterSsePayload(
      [
        'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"先判断范围。","id":"reasoning-1","format":"google-gemini-v1","index":0},{"type":"reasoning.summary","summary":"需要读取全部章节。","id":"summary-1","format":"google-gemini-v1","index":1}]}}]}',
        "",
        'data: {"choices":[{"delta":{"reasoning_content":"继续规划。"}}]}',
        ""
      ].join("\n")
    );

    expect(events).toEqual([
      {
        type: "reasoning",
        content: "先判断范围。",
        detailFormat: "google-gemini-v1",
        detailId: "reasoning-1",
        detailIndex: 0,
        detailType: "reasoning.text",
        source: "reasoning_details"
      },
      {
        type: "reasoning",
        content: "需要读取全部章节。",
        detailFormat: "google-gemini-v1",
        detailId: "summary-1",
        detailIndex: 1,
        detailType: "reasoning.summary",
        source: "reasoning_details"
      },
      { type: "reasoning", content: "继续规划。", source: "reasoning_content" }
    ]);
  });

  it("prefers structured reasoning_details over duplicated legacy reasoning fields in the same chunk", () => {
    const events = parseOpenRouterSsePayload(
      [
        'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"先判断范围。","id":"reasoning-1","index":0}],"reasoning_content":"先判断范围。","reasoning":"先判断范围。"}}]}',
        ""
      ].join("\n")
    );

    expect(events).toEqual([
      {
        type: "reasoning",
        content: "先判断范围。",
        detailId: "reasoning-1",
        detailIndex: 0,
        detailType: "reasoning.text",
        source: "reasoning_details"
      }
    ]);
  });

  it("skips malformed SSE JSON blocks instead of crashing the whole stream", () => {
    const events = parseOpenRouterSsePayload(
      ['data: {"choices":[{"delta":{"content":"前"}}]}', "", "data: {broken}", "", 'data: {"choices":[{"delta":{"content":"后"}}]}', ""].join("\n")
    );

    expect(events).toEqual([
      { type: "content", content: "前" },
      { type: "content", content: "后" }
    ]);
  });
});
