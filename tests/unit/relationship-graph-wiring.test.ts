import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  authorRelationshipCreateCharacterInputSchema,
  authorRelationshipCreateRelationshipInputSchema,
  authorRelationshipDeleteCharacterInputSchema,
  authorRelationshipDeleteRelationshipInputSchema,
  parseIpcPayload,
  authorRelationshipUpdateCharacterInputSchema,
  authorRelationshipUpdateCharacterLayoutInputSchema,
  authorRelationshipUpdateRelationshipInputSchema,
  relationshipGraphGetInputSchema,
  relationshipGraphSourceStatusInputSchema
} from "../../src/main/shared/schemas";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("relationship graph contracts", () => {
  it("validates summary-derived graph query input strictly", () => {
    expect(
      parseIpcPayload(relationshipGraphGetInputSchema, {
        projectId: "project_1",
        chapterFrom: 1,
        chapterTo: 12,
        chapterCursor: 12,
        roleScope: "main",
        mode: "focus",
        focusName: "林砚",
        hopDepth: 2,
        minConfidence: 0.45,
        includeUncertain: true,
        query: "契约"
      })
    ).toMatchObject({
      projectId: "project_1",
      chapterFrom: 1,
      chapterTo: 12,
      chapterCursor: 12,
      roleScope: "main",
      mode: "focus",
      focusName: "林砚"
    });

    expect(parseIpcPayload(relationshipGraphSourceStatusInputSchema, { projectId: "project_1" })).toEqual({ projectId: "project_1" });
    expect(() =>
      parseIpcPayload(relationshipGraphGetInputSchema, {
        projectId: "project_1",
        chapterFrom: 10,
        chapterTo: 1
      })
    ).toThrow("IPC payload validation failed");
    expect(() =>
      parseIpcPayload(relationshipGraphGetInputSchema, {
        projectId: "project_1",
        chapterCursor: 1.5
      })
    ).toThrow("IPC payload validation failed");
  });

  it("declares graph result types and minimal IPC channels", () => {
    const graphTypes = readSource("src/main/shared/relationship-graph.ts");
    const sharedTypes = readSource("src/main/shared/types.ts");

    expect(graphTypes).toContain("RelationshipGraphResult");
    expect(graphTypes).toContain("RelationshipGraphSourceStatus");
    expect(graphTypes).toContain("sourceStatus");
    expect(graphTypes).toContain("availableChapters");
    expect(graphTypes).toContain("baseRelationLabel");
    expect(graphTypes).toContain("relationshipDimensions");
    expect(graphTypes).toContain("authorRelationshipId");
    expect(sharedTypes).toContain("RelationshipGraphGetInput");
    expect(sharedTypes).toContain("RelationshipGraphSourceStatusInput");
    expect(sharedTypes).toContain('getGraph: "novelTool:relationshipGraph:getGraph"');
    expect(sharedTypes).toContain('getSourceStatus: "novelTool:relationshipGraph:getSourceStatus"');
    expect(sharedTypes).not.toContain("upgradeMissingFromOriginalText");
    expect(sharedTypes).not.toContain("retryIdentityResolution");
  });
});

describe("relationship graph IPC wiring", () => {
  it("exposes summary-derived graph API through preload and register-ipc", () => {
    const preload = readSource("src/preload/api.ts");
    const registerIpc = readSource("src/main/ipc/register-ipc.ts");
    const relationshipIpc = readSource("src/main/ipc/relationship-graph-ipc.ts");

    expect(preload).toContain("readonly relationshipGraph");
    expect(preload).toContain("getGraph: (input: RelationshipGraphGetInput)");
    expect(preload).toContain("getSourceStatus: (input: RelationshipGraphSourceStatusInput)");
    expect(preload).toContain("ipcChannels.relationshipGraph.getGraph");
    expect(preload).toContain("ipcChannels.relationshipGraph.getSourceStatus");
    expect(registerIpc).toContain("registerRelationshipGraphIpc");
    expect(registerIpc).toContain("SummaryRelationshipGraphAggregator");
    expect(registerIpc).not.toContain("RelationshipIndexRepository");
    expect(registerIpc).not.toContain("RelationshipIdentityService");
    expect(relationshipIpc).toContain("relationshipGraphGetInputSchema");
    expect(relationshipIpc).toContain("relationshipGraphSourceStatusInputSchema");
    expect(relationshipIpc).toContain("createValidatedIpcHandler");
    expect(relationshipIpc).toContain("ipcChannels.relationshipGraph.getGraph");
    expect(relationshipIpc).toContain("ipcChannels.relationshipGraph.getSourceStatus");
  });

  it("exposes author-defined relationship APIs separately from AI graph APIs", () => {
    const preload = readSource("src/preload/api.ts");
    const registerIpc = readSource("src/main/ipc/register-ipc.ts");
    const authorIpc = readSource("src/main/ipc/author-relationship-ipc.ts");
    const sharedTypes = readSource("src/main/shared/types.ts");

    expect(
      parseIpcPayload(authorRelationshipCreateCharacterInputSchema, {
        projectId: "project_1",
        name: "白嘉轩"
      })
    ).toEqual({ projectId: "project_1", name: "白嘉轩" });
    expect(
      parseIpcPayload(authorRelationshipCreateRelationshipInputSchema, {
        projectId: "project_1",
        sourceCharacterName: "白嘉轩",
        targetCharacterName: "鹿三",
        sourceToTargetLabel: "主家与长工",
        targetToSourceLabel: "长工与主家"
      })
    ).toMatchObject({ sourceCharacterName: "白嘉轩", targetCharacterName: "鹿三" });
    expect(() => parseIpcPayload(authorRelationshipDeleteCharacterInputSchema, { projectId: "project_1" })).toThrow("IPC payload validation failed");
    expect(() => parseIpcPayload(authorRelationshipDeleteRelationshipInputSchema, { projectId: "project_1" })).toThrow("IPC payload validation failed");
    expect(
      parseIpcPayload(authorRelationshipUpdateCharacterInputSchema, {
        projectId: "project_1",
        characterId: "author_character_1",
        name: "白嘉轩",
        aliases: ["族长", "白家掌柜"],
        entityKind: "person",
        importance: "main",
        roleSummary: "白家族长",
        faction: "白家",
        notes: "作者备注"
      })
    ).toMatchObject({ name: "白嘉轩", aliases: ["族长", "白家掌柜"] });
    expect(
      parseIpcPayload(authorRelationshipUpdateCharacterLayoutInputSchema, {
        projectId: "project_1",
        characterId: "author_character_1",
        layoutPosition: { x: 120.5, y: -40 }
      })
    ).toMatchObject({ layoutPosition: { x: 120.5, y: -40 } });
    expect(
      parseIpcPayload(authorRelationshipUpdateRelationshipInputSchema, {
        projectId: "project_1",
        relationshipId: "author_relationship_1",
        sourceToTargetLabel: "父亲",
        targetToSourceLabel: "儿子"
      })
    ).toMatchObject({ relationshipId: "author_relationship_1", sourceToTargetLabel: "父亲", targetToSourceLabel: "儿子" });

    expect(sharedTypes).toContain("authorRelationship");
    expect(sharedTypes).toContain('getGraph: "novelTool:authorRelationship:getGraph"');
    expect(sharedTypes).toContain('createCharacter: "novelTool:authorRelationship:createCharacter"');
    expect(sharedTypes).toContain('updateCharacter: "novelTool:authorRelationship:updateCharacter"');
    expect(sharedTypes).toContain('updateCharacterLayout: "novelTool:authorRelationship:updateCharacterLayout"');
    expect(sharedTypes).toContain('createRelationship: "novelTool:authorRelationship:createRelationship"');
    expect(sharedTypes).toContain('updateRelationship: "novelTool:authorRelationship:updateRelationship"');
    expect(sharedTypes).toContain('deleteCharacter: "novelTool:authorRelationship:deleteCharacter"');
    expect(sharedTypes).toContain('deleteRelationship: "novelTool:authorRelationship:deleteRelationship"');
    expect(preload).toContain("readonly authorRelationship");
    expect(preload).toContain("getGraph: (input: RelationshipGraphGetInput)");
    expect(preload).toContain("createCharacter: (input: AuthorRelationshipCreateCharacterInput)");
    expect(preload).toContain("updateCharacter: (input: AuthorRelationshipUpdateCharacterInput)");
    expect(preload).toContain("updateCharacterLayout: (input: AuthorRelationshipUpdateCharacterLayoutInput)");
    expect(preload).toContain("createRelationship: (input: AuthorRelationshipCreateRelationshipInput)");
    expect(preload).toContain("updateRelationship: (input: AuthorRelationshipUpdateRelationshipInput)");
    expect(preload).toContain("deleteCharacter: (input: AuthorRelationshipDeleteCharacterInput)");
    expect(preload).toContain("deleteRelationship: (input: AuthorRelationshipDeleteRelationshipInput)");
    expect(registerIpc).toContain("registerAuthorRelationshipIpc");
    expect(registerIpc).toContain("AuthorRelationshipGraphService");
    expect(authorIpc).toContain("ipcChannels.authorRelationship.getGraph");
    expect(authorIpc).toContain("ipcChannels.authorRelationship.updateCharacter");
    expect(authorIpc).toContain("ipcChannels.authorRelationship.updateCharacterLayout");
    expect(authorIpc).toContain("ipcChannels.authorRelationship.updateRelationship");
    expect(authorIpc).toContain("createValidatedIpcHandler");
  });
});
