import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseIpcPayload, relationshipGraphGetInputSchema, relationshipGraphSourceStatusInputSchema } from "../../src/main/shared/schemas";

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
});
