import { describe, expect, it } from "vitest";
import { formatRelationshipOverviewMetric, getRelationshipCacheStatusText, getRelationshipUpgradeActionLabel } from "../../src/renderer/routes/SettingsPage";
import type { RelationshipCacheSettingsStatus, SummaryIndexStatus } from "../../src/main/shared/types";

function summaryStatus(patch: Partial<SummaryIndexStatus> = {}): SummaryIndexStatus {
  return {
    projectId: "project_1",
    totalChapterCount: 2,
    readyChapterCount: 0,
    staleChapterCount: 0,
    missingChapterCount: 2,
    skippedTooShortChapterCount: 0,
    failedJobCount: 0,
    cancelledJobCount: 0,
    queuedJobCount: 0,
    runningJobLabel: null,
    nextRetryAt: null,
    nextRetryJobLabel: null,
    backgroundEnabled: true,
    retryingJobs: [],
    recentFailedJobs: [],
    pausedReason: null,
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...patch
  };
}

function relationshipStatus(patch: {
  readonly chapterCache?: Partial<RelationshipCacheSettingsStatus["chapterCache"]>;
  readonly relationshipCache?: Partial<RelationshipCacheSettingsStatus["relationshipCache"]>;
} = {}): RelationshipCacheSettingsStatus {
  return {
    chapterCache: {
      total: 2,
      ready: 0,
      queuedOrRunning: 0,
      stale: 0,
      failed: 0,
      missing: 2,
      skippedTooShort: 0,
      ...patch.chapterCache
    },
    relationshipCache: {
      ready: 0,
      stale: 0,
      legacyMissingRelationships: 0,
      waitingStable: 0,
      queued: 0,
      running: 0,
      failed: 0,
      skippedTooShort: 0,
      total: 0,
      sourceSummaryEmbedded: 0,
      sourceLegacyOriginalTextUpgrade: 0,
      sourceOriginalTextEnhancement: 0,
      sourceLegacySummaryDerived: 0,
      queuedOriginalTextUpgrades: 0,
      waitingForChapterCache: false,
      ...patch.relationshipCache
    },
    activeJob: null
  };
}

describe("settings relationship cache status display", () => {
  it("uses chapter totals instead of registered relationship rows for a fresh project", () => {
    expect(formatRelationshipOverviewMetric(summaryStatus(), relationshipStatus())).toEqual({
      value: "0/2",
      detail: "等待章节缓存完成"
    });
  });

  it("keeps chapter-cache success and relationship-cache failure visible at the same time", () => {
    const status = relationshipStatus({
      chapterCache: { total: 1, ready: 1, missing: 0 },
      relationshipCache: { failed: 1, total: 1 }
    });

    expect(formatRelationshipOverviewMetric(summaryStatus({ totalChapterCount: 1, readyChapterCount: 1, missingChapterCount: 0 }), status)).toEqual({
      value: "0/1",
      detail: "失败 1 章，需重试"
    });
    expect(getRelationshipCacheStatusText(status)).toBe("部分人物关系缓存失败，可以手动加入原文补齐队列重试。");
    expect(getRelationshipUpgradeActionLabel(status)).toBe("重试失败关系缓存");
  });

  it("shows the pending relationship-generation state after chapter cache is already ready", () => {
    const status = relationshipStatus({
      chapterCache: { total: 1, ready: 1, missing: 0 }
    });

    expect(formatRelationshipOverviewMetric(summaryStatus({ totalChapterCount: 1, readyChapterCount: 1, missingChapterCount: 0 }), status)).toEqual({
      value: "0/1",
      detail: "章节缓存已完成，人物关系缓存尚未生成"
    });
    expect(getRelationshipCacheStatusText(status)).toBe("章节缓存已完成，人物关系缓存尚未生成，后台会继续处理。");
  });

  it("does not show 0/0 as a meaningful relationship cache state when the project has no chapters", () => {
    expect(formatRelationshipOverviewMetric(summaryStatus({ totalChapterCount: 0, missingChapterCount: 0 }), relationshipStatus({ chapterCache: { total: 0, missing: 0 } }))).toEqual({
      value: "未开始",
      detail: "还没有章节"
    });
  });
});
