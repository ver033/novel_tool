import { describe, expect, it, vi } from "vitest";
import { LegacyNovelAgentRuntime } from "../../src/main/ai/agent-runtime/legacy-novel-agent-runtime";
import type { NovelAgentRunInput, NovelAgentRuntimeHandlers } from "../../src/main/ai/agent-runtime/novel-agent-runtime";

function createInput(): NovelAgentRunInput {
  return {
    requestId: "request_1",
    projectId: "project_1",
    sessionId: "session_1",
    message: "第一章を要約してください",
    history: [],
    chapterDirectory: [],
    tools: [
      {
        name: "list_chapters",
        description: "List chapters",
        parameters: { type: "object", properties: {} }
      }
    ],
    executeTool: async () => ({ content: "{}", action: null })
  };
}

describe("NovelAgentRuntime seam", () => {
  it("keeps the legacy harness behind the provider-neutral runtime interface", async () => {
    const sendAgentMessageStream = vi.fn(async () => ({
      role: "assistant" as const,
      content: "要約しました。",
      createdAt: "2026-07-21T00:00:00.000Z"
    }));
    const runtime = new LegacyNovelAgentRuntime({ sendAgentMessageStream });
    const handlers: NovelAgentRuntimeHandlers = { onChunk: vi.fn() };
    const controller = new AbortController();
    const input = createInput();

    await expect(runtime.run(input, handlers, { signal: controller.signal })).resolves.toMatchObject({
      content: "要約しました。"
    });
    expect(sendAgentMessageStream).toHaveBeenCalledWith(input, handlers, { signal: controller.signal });
  });
});
