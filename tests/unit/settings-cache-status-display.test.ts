import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatRelationshipOverviewMetric, getRelationshipSourceStatusText } from "../../src/renderer/routes/SettingsPage";
import type { RelationshipGraphSourceStatus } from "../../src/main/shared/relationship-graph";
import type { SummaryIndexStatus } from "../../src/main/shared/types";

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

function sourceStatus(patch: Partial<RelationshipGraphSourceStatus> = {}): RelationshipGraphSourceStatus {
  return {
    state: "needs_arc_summary",
    nodeCount: 0,
    edgeCount: 0,
    chapterRange: null,
    arcSummary: {
      total: 2,
      readyForGraph: 0,
      missingGraphFields: 0,
      failed: 0,
      blocked: 0
    },
    bookSummary: {
      exists: false,
      hasRelationshipGraph: false,
      failed: false
    },
    message: "等待阶段摘要生成。",
    latestFailure: null,
    ...patch
  };
}

describe("settings relationship graph source status display", () => {
  it("does not show 0/0 as a meaningful graph state when the project has no chapters", () => {
    expect(formatRelationshipOverviewMetric(summaryStatus({ totalChapterCount: 0, missingChapterCount: 0 }), sourceStatus())).toEqual({
      value: "未开始",
      detail: "还没有章节"
    });
  });

  it("shows ready graph node and edge counts", () => {
    const status = sourceStatus({
      state: "ready",
      nodeCount: 12,
      edgeCount: 20,
      message: "人物关系图已可用。"
    });

    expect(formatRelationshipOverviewMetric(summaryStatus({ readyChapterCount: 2, missingChapterCount: 0 }), status)).toEqual({
      value: "12/20",
      detail: "人物 / 关系"
    });
    expect(getRelationshipSourceStatusText(status)).toBe("人物关系图已可用。");
  });

  it("keeps summary failures visible in the overview metric", () => {
    const status = sourceStatus({
      state: "failed",
      latestFailure: "阶段摘要输出被截断",
      message: "阶段摘要失败，人物关系图不可用。"
    });

    expect(formatRelationshipOverviewMetric(summaryStatus({ readyChapterCount: 2, missingChapterCount: 0, failedJobCount: 1 }), status)).toEqual({
      value: "失败",
      detail: "阶段摘要输出被截断"
    });
  });

  it("links relationship graph source refresh to the summary cache refresh action", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/routes/SettingsPage.tsx"), "utf8");

    expect(source).toContain("refreshToken");
    expect(source).toContain("setRelationshipRefreshToken");
    expect(source).toContain("<RelationshipGraphCacheSettingsBlock");
    expect(source).not.toContain('{loading ? "读取中" : "刷新"}');
  });
});
