import { describe, expect, it } from "vitest";
import { chatAgentPlanSchema } from "../../src/main/ai/chat-agent-types";

describe("chat agent plan schema", () => {
  it("accepts an empty clarification question when no clarification is needed", () => {
    expect(
      chatAgentPlanSchema.parse({
        intent: "summarize",
        scope: { type: "all_chapters" },
        actions: [],
        needsClarification: false,
        clarificationQuestion: ""
      })
    ).toEqual({
      intent: "summarize",
      scope: { type: "all_chapters" },
      actions: [],
      needsClarification: false,
      clarificationQuestion: undefined
    });
  });

  it("rejects an empty clarification question when clarification is needed", () => {
    expect(() =>
      chatAgentPlanSchema.parse({
        intent: "answer",
        scope: { type: "current_chapter" },
        actions: [],
        needsClarification: true,
        clarificationQuestion: ""
      })
    ).toThrow();
  });
});
