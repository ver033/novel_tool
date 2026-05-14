import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseIpcPayload,
  relationshipGraphGetInputSchema,
  relationshipGraphRebuildInputSchema,
  relationshipGraphStatusInputSchema,
  relationshipGraphUpgradeMissingFromOriginalTextInputSchema
} from "../../src/main/shared/schemas";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("relationship graph contracts", () => {
  it("validates V2 graph query input strictly", () => {
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
    ).toEqual({
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
    });

    expect(parseIpcPayload(relationshipGraphStatusInputSchema, { projectId: "project_1" })).toEqual({ projectId: "project_1" });
    expect(parseIpcPayload(relationshipGraphRebuildInputSchema, { projectId: "project_1", force: true })).toEqual({
      projectId: "project_1",
      force: true
    });
    expect(
      parseIpcPayload(relationshipGraphUpgradeMissingFromOriginalTextInputSchema, {
        projectId: "project_1",
        chapterIds: ["chapter_1"],
        chapterFrom: 1,
        chapterTo: 12
      })
    ).toEqual({
      projectId: "project_1",
      chapterIds: ["chapter_1"],
      chapterFrom: 1,
      chapterTo: 12
    });

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
    expect(() =>
      parseIpcPayload(relationshipGraphGetInputSchema, {
        projectId: "project_1",
        relationshipTypes: ["ally"]
      })
    ).toThrow("IPC payload validation failed");
  });

  it("declares V2 graph types and IPC channels", () => {
    const graphTypes = readSource("src/main/shared/relationship-index.ts");
    const sharedTypes = readSource("src/main/shared/types.ts");

    expect(graphTypes).toContain("RelationshipGraphResult");
    expect(graphTypes).toContain("availableChapters");
    expect(graphTypes).toContain("baseRelationLabel");
    expect(graphTypes).toContain("relationshipDimensions");
    expect(sharedTypes).toContain("RelationshipGraphGetInput");
    expect(sharedTypes).toContain("RelationshipGraphStatusInput");
    expect(sharedTypes).toContain("RelationshipGraphRebuildInput");
    expect(sharedTypes).toContain("RelationshipGraphUpgradeMissingFromOriginalTextInput");
    expect(sharedTypes).toContain("RelationshipCacheSettingsStatus");
    expect(sharedTypes).toContain('getGraph: "novelTool:relationshipGraph:getGraph"');
    expect(sharedTypes).toContain('getStatus: "novelTool:relationshipGraph:getStatus"');
    expect(sharedTypes).toContain('rebuild: "novelTool:relationshipGraph:rebuild"');
    expect(sharedTypes).toContain('refreshCacheStatus: "novelTool:relationshipGraph:refreshCacheStatus"');
    expect(sharedTypes).toContain('getCacheSettingsStatus: "novelTool:relationshipGraph:getCacheSettingsStatus"');
    expect(sharedTypes).toContain('upgradeMissingFromOriginalText: "novelTool:relationshipGraph:upgradeMissingFromOriginalText"');
  });
});

describe("relationship graph IPC wiring", () => {
  it("exposes relationship graph API through preload and register-ipc", () => {
    const preload = readSource("src/preload/api.ts");
    const registerIpc = readSource("src/main/ipc/register-ipc.ts");
    const relationshipIpc = readSource("src/main/ipc/relationship-graph-ipc.ts");

    expect(preload).toContain("readonly relationshipGraph");
    expect(preload).toContain("getGraph: (input: RelationshipGraphGetInput)");
    expect(preload).toContain("getStatus: (input: RelationshipGraphStatusInput)");
    expect(preload).toContain("rebuild: (input: RelationshipGraphRebuildInput)");
    expect(preload).toContain("refreshCacheStatus: (input: RelationshipGraphStatusInput)");
    expect(preload).toContain("getCacheSettingsStatus: (input: RelationshipGraphStatusInput)");
    expect(preload).toContain("upgradeMissingFromOriginalText: (input: RelationshipGraphUpgradeMissingFromOriginalTextInput)");
    expect(preload).toContain("ipcChannels.relationshipGraph.getGraph");
    expect(preload).toContain("ipcChannels.relationshipGraph.getStatus");
    expect(preload).toContain("ipcChannels.relationshipGraph.rebuild");
    expect(preload).toContain("ipcChannels.relationshipGraph.refreshCacheStatus");
    expect(preload).toContain("ipcChannels.relationshipGraph.getCacheSettingsStatus");
    expect(preload).toContain("ipcChannels.relationshipGraph.upgradeMissingFromOriginalText");
    expect(registerIpc).toContain("registerRelationshipGraphIpc");
    expect(registerIpc).toContain("RelationshipGraphAggregator");
    expect(relationshipIpc).toContain("relationshipGraphGetInputSchema");
    expect(relationshipIpc).toContain("relationshipGraphStatusInputSchema");
    expect(relationshipIpc).toContain("relationshipGraphRebuildInputSchema");
    expect(relationshipIpc).toContain("relationshipGraphUpgradeMissingFromOriginalTextInputSchema");
    expect(relationshipIpc).toContain("createValidatedIpcHandler");
    expect(relationshipIpc).toContain("ipcChannels.relationshipGraph.getGraph");
    expect(relationshipIpc).toContain("ipcChannels.relationshipGraph.getStatus");
    expect(relationshipIpc).toContain("ipcChannels.relationshipGraph.rebuild");
    expect(relationshipIpc).toContain("ipcChannels.relationshipGraph.refreshCacheStatus");
    expect(relationshipIpc).toContain("ipcChannels.relationshipGraph.getCacheSettingsStatus");
    expect(relationshipIpc).toContain("ipcChannels.relationshipGraph.upgradeMissingFromOriginalText");
  });

  it("keeps getGraph read-only and rebuild routed through chapter summary cache", () => {
    const types = readSource("src/main/shared/types.ts");
    const relationshipIpc = readSource("src/main/ipc/relationship-graph-ipc.ts");
    const registerIpc = readSource("src/main/ipc/register-ipc.ts");

    expect(types).toContain("relationshipGraph");
    expect(types).toContain("getGraph");
    expect(types).toContain("getStatus");
    expect(types).toContain("rebuild");
    expect(types).toContain("upgradeMissingFromOriginalText");
    expect(types).not.toContain("saveGraph");
    expect(types).not.toContain("updateRelationship");
    expect(relationshipIpc).not.toContain("OpenRouter");
    expect(relationshipIpc).not.toContain("extractChapterRelationshipsForIndex");
    expect(registerIpc).toContain("refreshRelationshipIndexStateFromSummaries(input.projectId");
    expect(registerIpc).toContain("enqueueLegacyRelationshipOriginalTextUpgrade(input, now)");
    expect(registerIpc).not.toContain("rebuildProjectRelationshipIndex(input.projectId");
    expect(registerIpc).toContain("createSummaryService(projectId).rebuildProjectIndex(input.projectId");
  });
});
