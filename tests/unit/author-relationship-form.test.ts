import { describe, expect, it } from "vitest";
import { buildAuthorRelationshipCreateInput } from "../../src/renderer/relationship-graph/author-relationship-form";

describe("author relationship form payload", () => {
  it("keeps mutual relationships bidirectional when the reverse field is not edited", () => {
    expect(
      buildAuthorRelationshipCreateInput({
        sourceCharacterName: " 白嘉轩 ",
        targetCharacterName: " 仙草 ",
        sourceToTargetLabel: " 夫妻 ",
        targetToSourceLabel: "",
        sameRelationBothWays: true
      })
    ).toEqual({
      sourceCharacterName: "白嘉轩",
      targetCharacterName: "仙草",
      sourceToTargetLabel: "夫妻",
      targetToSourceLabel: "夫妻"
    });
  });

  it("allows directional relationships to keep an explicit reverse label", () => {
    expect(
      buildAuthorRelationshipCreateInput({
        sourceCharacterName: "鹿三",
        targetCharacterName: "黑娃",
        sourceToTargetLabel: "父亲",
        targetToSourceLabel: "儿子",
        sameRelationBothWays: false
      })
    ).toMatchObject({
      sourceToTargetLabel: "父亲",
      targetToSourceLabel: "儿子"
    });
  });

  it("keeps directional reverse labels nullable only when the user chooses directional mode", () => {
    expect(
      buildAuthorRelationshipCreateInput({
        sourceCharacterName: "白嘉轩",
        targetCharacterName: "鹿三",
        sourceToTargetLabel: "主家与长工",
        targetToSourceLabel: "",
        sameRelationBothWays: false
      })
    ).toMatchObject({
      sourceToTargetLabel: "主家与长工",
      targetToSourceLabel: null
    });
  });
});
