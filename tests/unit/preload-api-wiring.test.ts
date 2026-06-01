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
    expect(types).toContain("SummaryClearAndRetryBookCacheInput");
    expect(types).toContain("SummaryIndexStatus");
    expect(types).toContain("SummaryChapterCacheEntry");
    expect(types).toContain("SummaryChapterCacheDetail");
    expect(types).toContain("summary: {");
    expect(types).toContain('getIndexStatus: "novelTool:summary:getIndexStatus"');
    expect(types).toContain('rebuildProjectIndex: "novelTool:summary:rebuildProjectIndex"');
    expect(types).toContain('listCacheEntries: "novelTool:summary:listCacheEntries"');
    expect(types).toContain('getChapterCache: "novelTool:summary:getChapterCache"');
    expect(types).toContain('clearAndRetryChapterCache: "novelTool:summary:clearAndRetryChapterCache"');
    expect(types).toContain('clearAndRetryBookCache: "novelTool:summary:clearAndRetryBookCache"');
    expect(schemas).toContain("summaryIndexStatusInputSchema");
    expect(schemas).toContain("summaryRebuildProjectIndexInputSchema");
    expect(schemas).toContain("summaryGetChapterCacheInputSchema");
    expect(schemas).toContain("summaryClearAndRetryChapterCacheInputSchema");
    expect(schemas).toContain("summaryClearAndRetryBookCacheInputSchema");
    expect(preload).toContain("readonly summary");
    expect(preload).toContain("getIndexStatus: (input: SummaryIndexStatusInput)");
    expect(preload).toContain("rebuildProjectIndex: (input: SummaryRebuildProjectIndexInput)");
    expect(preload).toContain("listCacheEntries: (input: SummaryListCacheEntriesInput)");
    expect(preload).toContain("getChapterCache: (input: SummaryGetChapterCacheInput)");
    expect(preload).toContain("clearAndRetryChapterCache: (input: SummaryClearAndRetryChapterCacheInput)");
    expect(preload).toContain("clearAndRetryBookCache: (input: SummaryClearAndRetryBookCacheInput)");
    expect(preload).toContain("ipcChannels.summary.getIndexStatus");
    expect(preload).toContain("ipcChannels.summary.rebuildProjectIndex");
    expect(preload).toContain("ipcChannels.summary.listCacheEntries");
    expect(preload).toContain("ipcChannels.summary.getChapterCache");
    expect(preload).toContain("ipcChannels.summary.clearAndRetryChapterCache");
    expect(preload).toContain("ipcChannels.summary.clearAndRetryBookCache");
  });

  it("registers summary index IPC handlers behind the common validation wrapper", () => {
    const registerIpc = readSource("src/main/ipc/register-ipc.ts");

    expect(registerIpc).toContain("summaryIndexStatusInputSchema");
    expect(registerIpc).toContain("summaryRebuildProjectIndexInputSchema");
    expect(registerIpc).toContain("summaryGetChapterCacheInputSchema");
    expect(registerIpc).toContain("summaryClearAndRetryChapterCacheInputSchema");
    expect(registerIpc).toContain("summaryClearAndRetryBookCacheInputSchema");
    expect(registerIpc).toMatch(/ipcChannels\.summary\.getIndexStatus[\s\S]*createValidatedIpcHandler/);
    expect(registerIpc).toMatch(/ipcChannels\.summary\.rebuildProjectIndex[\s\S]*createValidatedIpcHandler/);
    expect(registerIpc).toMatch(/ipcChannels\.summary\.listCacheEntries[\s\S]*createValidatedIpcHandler/);
    expect(registerIpc).toMatch(/ipcChannels\.summary\.getChapterCache[\s\S]*createValidatedIpcHandler/);
    expect(registerIpc).toMatch(/ipcChannels\.summary\.clearAndRetryChapterCache[\s\S]*createValidatedIpcHandler/);
    expect(registerIpc).toMatch(/ipcChannels\.summary\.clearAndRetryBookCache[\s\S]*createValidatedIpcHandler/);
  });

  it("exposes external Book sync scan and AI-send APIs through validated IPC", () => {
    const types = readSource("src/main/shared/types.ts");
    const schemas = readSource("src/main/shared/schemas.ts");
    const preload = readSource("src/preload/api.ts");
    const registerIpc = readSource("src/main/ipc/register-ipc.ts");
    const externalIpc = readSource("src/main/ipc/external-book-sync-ipc.ts");

    expect(types).toContain("ExternalBookSyncStatusInput");
    expect(types).toContain("ExternalBookSyncScanResult");
    expect(types).toContain('scan: "novelTool:externalBookSync:scan"');
    expect(types).toContain('sendMissingChaptersToAi: "novelTool:externalBookSync:sendMissingChaptersToAi"');
    expect(types).toContain('clearSentHistory: "novelTool:externalBookSync:clearSentHistory"');
    expect(schemas).toContain("externalBookSyncScanInputSchema");
    expect(schemas).toContain("externalBookSyncClearSentHistoryInputSchema");
    expect(schemas).toContain("directoryPath is required for directory scan");
    expect(preload).toContain("readonly externalBookSync");
    expect(preload).toContain("subscribeScan: (requestId: string");
    expect(preload).toContain("ipcChannels.externalBookSync.scanProgress");
    expect(preload).toContain("sendMissingChaptersToAi: (input: ExternalBookSyncSendToAiInput)");
    expect(preload).toContain("clearSentHistory: (input: ExternalBookSyncClearSentHistoryInput)");
    expect(registerIpc).toContain("registerExternalBookSyncIpc(externalBookSyncService)");
    expect(registerIpc).toContain("new ExternalBookSyncService");
    expect(registerIpc).toContain('runDueExternalBookSync("startup")');
    expect(registerIpc).toContain("EXTERNAL_BOOK_SYNC_INTERVAL_MS");
    expect(registerIpc).toContain('runDueExternalBookSync("scheduled")');
    expect(registerIpc).not.toContain('app.on("before-quit"');
    expect(registerIpc).not.toContain('runDueExternalBookSync("shutdown")');
    expect(registerIpc).not.toContain("EXTERNAL_BOOK_SYNC_SHUTDOWN_TIMEOUT_MS");
    expect(externalIpc).toContain("createValidatedIpcHandler(externalBookSyncScanInputSchema");
    expect(externalIpc).toContain("createValidatedIpcHandler(externalBookSyncClearSentHistoryInputSchema");
    expect(externalIpc).toContain("ipcChannels.externalBookSync.scanDone");
    expect(externalIpc).toContain("ipcChannels.externalBookSync.scanError");
    expect(externalIpc).toContain("dialog.showOpenDialog");
  });

  it("recovers stale running summary jobs once when a project becomes active", () => {
    const registerIpc = readSource("src/main/ipc/register-ipc.ts");

    expect(registerIpc).toContain("recoveredSummaryJobProjects");
    expect(registerIpc).toMatch(/if \(!recoveredSummaryJobProjects\.has\(currentProject\.id\)\)/);
    expect(registerIpc).toContain("summaryRepo.resetRunningJobs(currentProject.id, now)");
    expect(registerIpc).toContain("recoveredSummaryJobProjects.add(currentProject.id)");
  });
});
