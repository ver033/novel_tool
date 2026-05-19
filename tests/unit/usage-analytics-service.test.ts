import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { UsageAnalyticsRepository } from "../../src/main/db/repositories/usage-analytics-repo";
import {
  buildUsageAnalyticsMessages,
  UsageAnalyticsService,
  type UsageAnalyticsProjectContext,
  type UsageAnalyticsReporter,
  type UsageAnalyticsSnapshot
} from "../../src/main/usage/usage-analytics-service";

const tempDirs: string[] = [];
const databases: SqliteDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createHarness(reporter?: UsageAnalyticsReporter, getProjectContext?: () => UsageAnalyticsProjectContext | null) {
  const dir = mkdtempSync(join(tmpdir(), "usage-analytics-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "usage.sqlite3"));
  databases.push(db);
  runMigrations(db);
  const snapshots: UsageAnalyticsSnapshot[] = [];
  const service = new UsageAnalyticsService({
    repo: new UsageAnalyticsRepository(db),
    reporter:
      reporter ?? {
        async generateReport(snapshot) {
          snapshots.push(snapshot);
          return "产品使用分析报告";
        }
      },
    appVersion: "1.5.2",
    platform: "darwin",
    ...(getProjectContext ? { getProjectContext } : {})
  });
  return { service, snapshots };
}

describe("UsageAnalyticsService", () => {
  it("builds an anonymized usage snapshot from local events", () => {
    const { service } = createHarness();

    service.recordEvent({ eventType: "app_opened", feature: "app", occurredAt: new Date(2026, 4, 19, 8, 50) });
    service.recordEvent({ eventType: "page_view", feature: "writing", occurredAt: new Date(2026, 4, 19, 8, 51) });
    service.recordEvent({ eventType: "page_active", feature: "writing", durationMs: 125_000, occurredAt: new Date(2026, 4, 19, 8, 53) });
    service.recordEvent({ eventType: "feature_used", feature: "ai_chat", occurredAt: new Date(2026, 4, 19, 8, 54) });

    const snapshot = service.buildSnapshot({ now: new Date(2026, 4, 19, 9, 0), rangeDays: 14 });
    const serialized = JSON.stringify(snapshot);

    expect(snapshot).toMatchObject({
      appVersion: "1.5.2",
      platform: "darwin",
      rangeDays: 14,
      activeDays: 1,
      totalActiveMinutes: 2
    });
    expect(snapshot.pageViews.writing).toBe(1);
    expect(snapshot.pageActiveMinutes.writing).toBe(2);
    expect(snapshot.featureCounts.ai_chat).toBe(1);
    expect(serialized).not.toContain("举足无措");
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("API Key");
    expect(snapshot.privacy.excludedFields).not.toContain("novel_text");
    expect(snapshot.privacy.excludedFields).not.toContain("chapter_title");
    expect(snapshot.privacy.excludedFields).not.toContain("project_name");
    expect(snapshot.privacy.excludedFields).toContain("local_file_path");
  });

  it("includes the active project name and latest chapter content when available", () => {
    const { service } = createHarness(undefined, () => ({
      projectName: "举足无措",
      latestChapterTitle: "第十二章 夜雨",
      latestChapterText: "雨声里，林远停下脚步。",
      latestChapterWordCount: 12
    }));

    const snapshot = service.buildSnapshot({ now: new Date(2026, 4, 19, 9, 0), rangeDays: 14 });
    const serialized = JSON.stringify(snapshot);

    expect(snapshot).toMatchObject({
      latestProjectContext: {
        projectName: "举足无措",
        latestChapterTitle: "第十二章 夜雨",
        latestChapterText: "雨声里，林远停下脚步。",
        latestChapterWordCount: 12
      }
    });
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("API Key");
  });

  it("describes the allowed writing context in the LLM prompt", () => {
    const { service } = createHarness(undefined, () => ({
      projectName: "举足无措",
      latestChapterTitle: "第十二章 夜雨",
      latestChapterText: "雨声里，林远停下脚步。",
      latestChapterWordCount: 12
    }));
    const snapshot = service.buildSnapshot({ now: new Date(2026, 4, 19, 9, 0), rangeDays: 14 });

    const [systemMessage, userMessage] = buildUsageAnalyticsMessages(snapshot);

    expect(systemMessage.content).toContain("当前项目名、最新章节标题和最新章节正文");
    expect(systemMessage.content).not.toContain("不要假设你看到了正文、章节标题、项目名");
    expect(userMessage.content).toContain("举足无措");
    expect(userMessage.content).toContain("雨声里，林远停下脚步。");
  });

  it("includes lightweight chapter update events without duplicating saved body text", () => {
    const { service } = createHarness(undefined, () => ({
      projectName: "举足无措",
      latestChapterTitle: "第十二章 夜雨",
      latestChapterText: "雨声里，林远停下脚步。",
      latestChapterWordCount: 12
    }));

    service.recordWritingUpdate({
      projectId: "project_1",
      projectName: "举足无措",
      chapterId: "chapter_12",
      chapterTitle: "第十二章 夜雨",
      chapterSortOrder: 11,
      source: "manual",
      previousWordCount: 1000,
      nextWordCount: 1120,
      occurredAt: new Date(2026, 4, 19, 8, 55)
    });

    const snapshot = service.buildSnapshot({ now: new Date(2026, 4, 19, 9, 0), rangeDays: 14 });
    const serializedUpdates = JSON.stringify(snapshot.chapterUpdates);

    expect(snapshot.writingUpdateSummary).toMatchObject({
      sentUpdateCount: 1,
      omittedUpdateCount: 0,
      totalUpdateCount: 1
    });
    expect(snapshot.chapterUpdates).toEqual([
      {
        projectName: "举足无措",
        chapterTitle: "第十二章 夜雨",
        chapterOrder: 12,
        source: "manual",
        occurredAt: new Date(2026, 4, 19, 8, 55).toISOString(),
        previousWordCount: 1000,
        nextWordCount: 1120,
        wordDelta: 120
      }
    ]);
    expect(serializedUpdates).not.toContain("雨声里，林远停下脚步。");
  });

  it("caps chapter update events in each report while counting omitted updates", () => {
    const { service } = createHarness();

    for (let index = 0; index < 125; index += 1) {
      service.recordWritingUpdate({
        projectId: "project_1",
        projectName: "举足无措",
        chapterId: `chapter_${index}`,
        chapterTitle: `第${index + 1}章`,
        chapterSortOrder: index,
        source: "manual",
        previousWordCount: index,
        nextWordCount: index + 10,
        occurredAt: new Date(2026, 4, 19, 8, index)
      });
    }

    const snapshot = service.buildSnapshot({ now: new Date(2026, 4, 19, 11, 0), rangeDays: 14 });

    expect(snapshot.chapterUpdates).toHaveLength(120);
    expect(snapshot.writingUpdateSummary).toMatchObject({
      sentUpdateCount: 120,
      omittedUpdateCount: 5,
      totalUpdateCount: 125
    });
    expect(snapshot.chapterUpdates[0]?.chapterTitle).toBe("第6章");
    expect(snapshot.chapterUpdates.at(-1)?.chapterTitle).toBe("第125章");
  });

  it("runs each automatic schedule slot once and stores the local report", async () => {
    const { service, snapshots } = createHarness();
    service.recordEvent({ eventType: "page_active", feature: "writing", durationMs: 60_000, occurredAt: new Date(2026, 4, 19, 8, 58) });

    const first = await service.runDueAutomaticReport(new Date(2026, 4, 19, 9, 0));
    const duplicate = await service.runDueAutomaticReport(new Date(2026, 4, 19, 9, 30));
    const status = service.getStatus(new Date(2026, 4, 19, 9, 31));
    const noon = await service.runDueAutomaticReport(new Date(2026, 4, 19, 12, 0));

    expect(first).toMatchObject({ status: "completed", trigger: "automatic", scheduledLocalTime: "09:00" });
    expect(duplicate).toBeNull();
    expect(noon).toMatchObject({ status: "completed", trigger: "automatic", scheduledLocalTime: "12:00" });
    expect(snapshots).toHaveLength(2);
    expect(status.scheduleLocalTimes).toEqual(["00:00", "09:00", "12:00"]);
    expect(status.nextScheduledAt).toBe(new Date(2026, 4, 19, 12, 0).toISOString());
    expect(status.lastSuccessAt).toBe(first?.completedAt);
    expect(status.latestReportText).toBe("产品使用分析报告");
  });

  it("sends one catch-up report when the app opens after a missed schedule slot", async () => {
    const { service, snapshots } = createHarness();

    const catchUp = await service.runStartupCatchUpReport(new Date(2026, 4, 19, 10, 0));
    const duplicateOpen = await service.runStartupCatchUpReport(new Date(2026, 4, 19, 10, 30));

    expect(catchUp).toMatchObject({ status: "completed", trigger: "automatic", scheduledLocalTime: "09:00" });
    expect(duplicateOpen).toBeNull();
    expect(snapshots).toHaveLength(1);
  });

  it("uses the latest missed schedule slot when both midnight and morning were missed", async () => {
    const { service } = createHarness();

    const catchUp = await service.runStartupCatchUpReport(new Date(2026, 4, 19, 10, 0));

    expect(catchUp).toMatchObject({ scheduledLocalTime: "09:00" });
  });

  it("uses the noon slot when the app opens after the noon schedule was missed", async () => {
    const { service } = createHarness();

    const catchUp = await service.runStartupCatchUpReport(new Date(2026, 4, 19, 13, 0));

    expect(catchUp).toMatchObject({ scheduledLocalTime: "12:00" });
  });

  it("upgrades the previous default schedule with the noon slot", async () => {
    const { service } = createHarness();

    service.updateSettings({ scheduleLocalTimes: ["00:00", "09:00"] });
    const status = service.getStatus(new Date(2026, 4, 19, 10, 0));
    const noon = await service.runDueAutomaticReport(new Date(2026, 4, 19, 12, 0));

    expect(status.scheduleLocalTimes).toEqual(["00:00", "09:00", "12:00"]);
    expect(noon).toMatchObject({ scheduledLocalTime: "12:00" });
  });

  it("does not send a startup catch-up report before the first configured schedule", async () => {
    const { service, snapshots } = createHarness();
    service.updateSettings({ scheduleLocalTimes: ["09:00"] });

    const earlyOpen = await service.runStartupCatchUpReport(new Date(2026, 4, 19, 8, 30));

    expect(earlyOpen).toBeNull();
    expect(snapshots).toHaveLength(0);
  });

  it("does not retry a failed automatic slot until the next scheduled slot", async () => {
    const { service } = createHarness({
      async generateReport() {
        throw new Error("OpenRouter API Key 未配置。");
      }
    });

    const first = await service.runDueAutomaticReport(new Date(2026, 4, 19, 9, 0));
    const duplicate = await service.runDueAutomaticReport(new Date(2026, 4, 19, 9, 20));
    const nextSlot = await service.runDueAutomaticReport(new Date(2026, 4, 19, 12, 0));

    expect(first).toMatchObject({ status: "failed", scheduledLocalTime: "09:00" });
    expect(duplicate).toBeNull();
    expect(nextSlot).toMatchObject({ status: "failed", scheduledLocalTime: "12:00" });
  });

  it("respects the automatic report setting while keeping manual reports available", async () => {
    const { service, snapshots } = createHarness();
    service.updateSettings({ automaticReportsEnabled: false });

    await expect(service.runDueAutomaticReport(new Date(2026, 4, 19, 9, 0))).resolves.toBeNull();
    await expect(service.sendReportNow(new Date(2026, 4, 19, 9, 1))).resolves.toMatchObject({ status: "completed", trigger: "manual" });
    expect(snapshots).toHaveLength(1);
  });
});
