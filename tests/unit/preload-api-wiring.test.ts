import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("summary index preload and IPC wiring", () => {
  it("exposes typed summary index status and rebuild APIs through preload", () => {
    const types = readSource("src/main/shared/types.ts");
    const schemas = readSource("src/main/shared/schemas.ts");
    const preload = readSource("src/preload/api.ts");

    expect(types).toContain("SummaryIndexStatusInput");
    expect(types).toContain("SummaryRebuildProjectIndexInput");
    expect(types).toContain("SummaryIndexStatus");
    expect(types).toContain("summary: {");
    expect(types).toContain('getIndexStatus: "novelTool:summary:getIndexStatus"');
    expect(types).toContain('rebuildProjectIndex: "novelTool:summary:rebuildProjectIndex"');
    expect(schemas).toContain("summaryIndexStatusInputSchema");
    expect(schemas).toContain("summaryRebuildProjectIndexInputSchema");
    expect(preload).toContain("readonly summary");
    expect(preload).toContain("getIndexStatus: (input: SummaryIndexStatusInput)");
    expect(preload).toContain("rebuildProjectIndex: (input: SummaryRebuildProjectIndexInput)");
    expect(preload).toContain("ipcChannels.summary.getIndexStatus");
    expect(preload).toContain("ipcChannels.summary.rebuildProjectIndex");
  });

  it("registers summary index IPC handlers behind the common validation wrapper", () => {
    const registerIpc = readSource("src/main/ipc/register-ipc.ts");

    expect(registerIpc).toContain("summaryIndexStatusInputSchema");
    expect(registerIpc).toContain("summaryRebuildProjectIndexInputSchema");
    expect(registerIpc).toMatch(/ipcChannels\.summary\.getIndexStatus[\s\S]*createValidatedIpcHandler/);
    expect(registerIpc).toMatch(/ipcChannels\.summary\.rebuildProjectIndex[\s\S]*createValidatedIpcHandler/);
  });

  it("recovers stale running summary jobs once when a project becomes active", () => {
    const registerIpc = readSource("src/main/ipc/register-ipc.ts");

    expect(registerIpc).toContain("recoveredSummaryJobProjects");
    expect(registerIpc).toMatch(/if \(!recoveredSummaryJobProjects\.has\(currentProject\.id\)\)/);
    expect(registerIpc).toContain("summaryRepo.resetRunningJobs(currentProject.id, now)");
    expect(registerIpc).toContain("recoveredSummaryJobProjects.add(currentProject.id)");
  });
});
