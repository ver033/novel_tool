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
    expect(types).toContain("SummaryListCacheEntriesInput");
    expect(types).toContain("SummaryGetChapterCacheInput");
    expect(types).toContain("SummaryClearAndRetryChapterCacheInput");
    expect(types).toContain("SummaryIndexStatus");
    expect(types).toContain("SummaryChapterCacheEntry");
    expect(types).toContain("SummaryChapterCacheDetail");
    expect(types).toContain("summary: {");
    expect(types).toContain('getIndexStatus: "novelTool:summary:getIndexStatus"');
    expect(types).toContain('rebuildProjectIndex: "novelTool:summary:rebuildProjectIndex"');
    expect(types).toContain('listCacheEntries: "novelTool:summary:listCacheEntries"');
    expect(types).toContain('getChapterCache: "novelTool:summary:getChapterCache"');
    expect(types).toContain('clearAndRetryChapterCache: "novelTool:summary:clearAndRetryChapterCache"');
    expect(schemas).toContain("summaryIndexStatusInputSchema");
    expect(schemas).toContain("summaryRebuildProjectIndexInputSchema");
    expect(schemas).toContain("summaryGetChapterCacheInputSchema");
    expect(schemas).toContain("summaryClearAndRetryChapterCacheInputSchema");
    expect(preload).toContain("readonly summary");
    expect(preload).toContain("getIndexStatus: (input: SummaryIndexStatusInput)");
    expect(preload).toContain("rebuildProjectIndex: (input: SummaryRebuildProjectIndexInput)");
    expect(preload).toContain("listCacheEntries: (input: SummaryListCacheEntriesInput)");
    expect(preload).toContain("getChapterCache: (input: SummaryGetChapterCacheInput)");
    expect(preload).toContain("clearAndRetryChapterCache: (input: SummaryClearAndRetryChapterCacheInput)");
    expect(preload).toContain("ipcChannels.summary.getIndexStatus");
    expect(preload).toContain("ipcChannels.summary.rebuildProjectIndex");
    expect(preload).toContain("ipcChannels.summary.listCacheEntries");
    expect(preload).toContain("ipcChannels.summary.getChapterCache");
    expect(preload).toContain("ipcChannels.summary.clearAndRetryChapterCache");
  });

  it("registers summary index IPC handlers behind the common validation wrapper", () => {
    const registerIpc = readSource("src/main/ipc/register-ipc.ts");

    expect(registerIpc).toContain("summaryIndexStatusInputSchema");
    expect(registerIpc).toContain("summaryRebuildProjectIndexInputSchema");
    expect(registerIpc).toContain("summaryGetChapterCacheInputSchema");
    expect(registerIpc).toContain("summaryClearAndRetryChapterCacheInputSchema");
    expect(registerIpc).toMatch(/ipcChannels\.summary\.getIndexStatus[\s\S]*createValidatedIpcHandler/);
    expect(registerIpc).toMatch(/ipcChannels\.summary\.rebuildProjectIndex[\s\S]*createValidatedIpcHandler/);
    expect(registerIpc).toMatch(/ipcChannels\.summary\.listCacheEntries[\s\S]*createValidatedIpcHandler/);
    expect(registerIpc).toMatch(/ipcChannels\.summary\.getChapterCache[\s\S]*createValidatedIpcHandler/);
    expect(registerIpc).toMatch(/ipcChannels\.summary\.clearAndRetryChapterCache[\s\S]*createValidatedIpcHandler/);
  });

  it("recovers stale running summary jobs once when a project becomes active", () => {
    const registerIpc = readSource("src/main/ipc/register-ipc.ts");

    expect(registerIpc).toContain("recoveredSummaryJobProjects");
    expect(registerIpc).toMatch(/if \(!recoveredSummaryJobProjects\.has\(currentProject\.id\)\)/);
    expect(registerIpc).toContain("summaryRepo.resetRunningJobs(currentProject.id, now)");
    expect(registerIpc).toContain("recoveredSummaryJobProjects.add(currentProject.id)");
  });
});
