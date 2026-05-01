import { describe, expect, it } from "vitest";
import { getWritingOperationDefinition, listWritingOperationDefinitions } from "../../src/main/ai/writing-operation-registry";

describe("writing operation registry", () => {
  it("exposes exactly the four V1 writing operations", () => {
    expect(listWritingOperationDefinitions().map((item) => item.id)).toEqual(["polish", "expand", "proofread", "continue"]);
  });

  it("keeps every operation read-only and bound to a bundled skill", () => {
    for (const operation of listWritingOperationDefinitions()) {
      expect(operation.sideEffectPolicy).toBe("none");
      expect(operation.skillId).toBe(`moshu.${operation.id}`);
      expect(operation.tokenBudgetTaskType).toBe(operation.id);
    }
  });

  it("marks proofread as structured issues and the other operations as candidate text", () => {
    expect(getWritingOperationDefinition("proofread").outputKind).toBe("proofread_issues");
    expect(getWritingOperationDefinition("polish").outputKind).toBe("candidate_text");
    expect(getWritingOperationDefinition("expand").outputKind).toBe("candidate_text");
    expect(getWritingOperationDefinition("continue").outputKind).toBe("candidate_text");
  });

  it("rejects unknown operations with a clear error", () => {
    expect(() => getWritingOperationDefinition("summarize" as never)).toThrow("未知写作操作：summarize");
  });
});
