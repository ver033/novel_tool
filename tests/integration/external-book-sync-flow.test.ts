import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import os, { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyChapterContent } from "../../src/main/chapter/default-content";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { SettingsRepository } from "../../src/main/db/repositories/settings-repo";
import { SummaryRepository } from "../../src/main/db/repositories/summary-repo";
import { ExternalBookSyncAutomationStore } from "../../src/main/external-book-sync/book-automation-store";
import { ExternalBookSourceStore } from "../../src/main/external-book-sync/book-source-store";
import { ExternalBookSyncService, type ExternalBookAiSender } from "../../src/main/external-book-sync/external-book-sync-service";
import { createId } from "../../src/main/shared/ids";
import { countWritingUnits } from "../../src/main/shared/text";

const tempDirs: string[] = [];
const databases: SqliteDatabase[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createFixture(options: { readonly rootPath?: string | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "external-book-sync-"));
  tempDirs.push(dir);
  const db = createDatabase(":memory:");
  databases.push(db);
  runMigrations(db);
  const projectRepo = new ProjectRepository(db);
  const chapterRepo = new ChapterRepository(db);
  const summaryRepo = new SummaryRepository(db);
  const project = projectRepo.create({
    id: createId("project"),
    name: "举足无措",
    rootPath: options.rootPath === undefined ? join(dir, "举足无措.noveltool") : options.rootPath,
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z"
  });
  chapterRepo.create({
    id: createId("chapter"),
    projectId: project.id,
    title: "第一章",
    volumeTitle: null,
    sortOrder: 0,
    contentJson: emptyChapterContent,
    plainText: "第一章正文。",
    wordCount: countWritingUnits("第一章正文。"),
    dailyWordCount: 0,
    dailyWordCountDate: null,
    targetWordCount: null,
    status: "draft",
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z"
  });
  const sentMessages: string[] = [];
  const aiSender: ExternalBookAiSender = {
    createChatSession: () => ({ id: "session_external", title: "外部同步检查" }),
    sendChatMessage: async (input) => {
      sentMessages.push(input.message);
    }
  };
  const sourceStore = new ExternalBookSourceStore(new SettingsRepository(db));
  const automationStore = new ExternalBookSyncAutomationStore(new SettingsRepository(db));
  const service = new ExternalBookSyncService({
    sourceStore,
    automationStore,
    resolveChapterRepo: () => chapterRepo,
    projectRepo,
    aiSender
  });
  return {
    dir,
    project,
    chapterRepo,
    summaryRepo,
    sourceStore,
    service,
    sentMessages
  };
}

describe("ExternalBookSyncService", () => {
  it("finds missing chapters without mutating chapters or summary jobs", async () => {
    const { dir, project, chapterRepo, summaryRepo, sourceStore, service } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    const otherBookDir = join(dir, "别的项目");
    mkdirSync(projectBookDir, { recursive: true });
    mkdirSync(otherBookDir, { recursive: true });
    const bookFilePath = join(projectBookDir, "story.Book");
    writeFileSync(bookFilePath, "第一章\n已有。\n\n第二章\n新增正文。", "utf8");
    const realBookFilePath = realpathSync(bookFilePath);
    const realBookFolderPath = realpathSync(projectBookDir);
    writeFileSync(join(otherBookDir, "ignored.Book"), "第二章\n不应读取。", "utf8");

    const result = await service.scanProject({
      projectId: project.id,
      mode: "directory",
      directoryPath: dir,
      roots: [dir],
      timeBudgetMs: 10_000
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].comparison.missingChapters.map((chapter) => chapter.title)).toEqual(["第二章"]);
    expect("text" in result.candidates[0].comparison.missingChapters[0]).toBe(false);
    expect(sourceStore.listSources(project.id)).toMatchObject([
      {
        bookFolderPath: realBookFolderPath,
        displayName: "story.Book",
        confirmedAt: expect.any(String)
      }
    ]);
    expect("bookFilePath" in sourceStore.listSources(project.id)[0]).toBe(false);

    const second = await service.scanProject({
      projectId: project.id,
      mode: "quick",
      roots: [],
      timeBudgetMs: 1
    });
    expect(second.scan).toBeNull();
    expect(second.candidates.map((candidate) => candidate.filePath)).toEqual([realBookFilePath]);
    expect(chapterRepo.listByProject(project.id)).toHaveLength(1);
    expect(summaryRepo.listSummaryJobs(project.id)).toEqual([]);
  });

  it("sends selected missing chapters to AI as bounded messages without changing the .Book file", async () => {
    const { dir, project, service, sentMessages } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const bookFilePath = join(projectBookDir, "story.Book");
    writeFileSync(bookFilePath, "第一章\n.Book 里的第一章修订正文。\n\n第二章\n新增正文。", "utf8");
    const before = statSync(bookFilePath);
    const beforeFiles = readdirSync(projectBookDir);

    const result = await service.scanProject({
      projectId: project.id,
      mode: "directory",
      directoryPath: dir,
      roots: [dir],
      timeBudgetMs: 10_000
    });
    const candidate = result.candidates[0];
    const sent = await service.sendMissingChaptersToAi({
      projectId: project.id,
      candidateId: candidate.id,
      chapterKeys: candidate.comparison.missingChapters.map((chapter) => chapter.key)
    });

    expect(sent.sentChapterCount).toBe(2);
    expect(sent.sentMissingChapterCount).toBe(1);
    expect(sent.sentLatestProjectChapter).toBe(true);
    expect(sentMessages.length).toBeGreaterThan(0);
    expect(sentMessages.every((message) => message.length <= 7000)).toBe(true);
    expect(sentMessages.join("\n")).toContain("当前项目最新章在 .Book 中的对应内容");
    expect(sentMessages.join("\n")).toContain(".Book 里的第一章修订正文。");
    expect(sentMessages.join("\n")).toContain("第二章");
    expect(sentMessages.join("\n")).not.toContain(bookFilePath);
    expect(sentMessages.join("\n")).not.toContain("story.Book");
    expect(statSync(bookFilePath).mtimeMs).toBe(before.mtimeMs);
    expect(statSync(bookFilePath).size).toBe(before.size);
    expect(readdirSync(projectBookDir)).toEqual(beforeFiles);
  });

  it("automatically discovers and saves a .Book source on the first startup sync", async () => {
    const { dir, project, sourceStore, service, sentMessages } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const bookFilePath = join(projectBookDir, "story.Book");
    writeFileSync(bookFilePath, "第一章\n.Book 里的第一章修订正文。\n\n第二章\n新增正文。", "utf8");
    const realBookFolderPath = realpathSync(projectBookDir);

    const run = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 19, 7, 10));

    expect(run).toMatchObject({
      trigger: "startup",
      scheduledLocalTime: "07:00",
      status: "completed",
      candidateCount: 1,
      sentChapterCount: 2,
      sentMissingChapterCount: 1,
      sentLatestProjectChapter: true
    });
    expect(sourceStore.listSources(project.id)).toMatchObject([
      {
        bookFolderPath: realBookFolderPath,
        displayName: "story.Book",
        confirmedAt: expect.any(String)
      }
    ]);
    expect(service.getStatus(project.id).latestAutomaticRun).toMatchObject({
      status: "completed",
      sentChapterCount: 2,
      sentMissingChapterCount: 1,
      sentLatestProjectChapter: true
    });
    expect(sentMessages.join("\n")).toContain("缺失章节：第二章");
    expect(sentMessages.join("\n")).not.toContain(bookFilePath);
    expect(sentMessages.join("\n")).not.toContain("story.Book");
  });

  it("falls back to global discovery when first automatic quick discovery finds no source", async () => {
    const { dir, project, sourceStore, service, sentMessages } = createFixture({ rootPath: null });
    const fakeHome = join(dir, "home");
    const projectBookDir = join(fakeHome, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
    const bookFilePath = join(projectBookDir, "story.Book");
    writeFileSync(bookFilePath, "第一章\n.Book 里的第一章修订正文。\n\n第二章\n新增正文。", "utf8");
    const realBookFolderPath = realpathSync(projectBookDir);

    const run = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 19, 7, 10));

    expect(run).toMatchObject({
      trigger: "startup",
      scheduledLocalTime: "07:00",
      status: "completed",
      candidateCount: 1,
      sentChapterCount: 2
    });
    expect(sourceStore.listSources(project.id)).toMatchObject([
      {
        bookFolderPath: realBookFolderPath,
        displayName: "story.Book"
      }
    ]);
    expect(sentMessages.join("\n")).toContain("缺失章节：第二章");
    expect(sentMessages.join("\n")).not.toContain(bookFilePath);
  });

  it("retries automatic startup discovery while no .Book source has been saved", async () => {
    const { dir, project, sourceStore, service, sentMessages } = createFixture({ rootPath: null });
    const fakeHome = join(dir, "home");
    mkdirSync(join(fakeHome, "Documents"), { recursive: true });
    mkdirSync(join(fakeHome, "Desktop"), { recursive: true });
    mkdirSync(join(fakeHome, "Downloads"), { recursive: true });
    vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
    const firstRun = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 19, 7, 10));

    const projectBookDir = join(fakeHome, "Documents", "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const bookFilePath = join(projectBookDir, "story.Book");
    writeFileSync(bookFilePath, "第一章\n.Book 里的第一章修订正文。\n\n第二章\n新增正文。", "utf8");
    const realBookFolderPath = realpathSync(projectBookDir);
    const secondRun = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 19, 7, 20));

    expect(firstRun).toMatchObject({ trigger: "startup", scheduledLocalTime: "07:00", status: "skipped", candidateCount: 0 });
    expect(secondRun).toMatchObject({ trigger: "startup", scheduledLocalTime: "07:00", status: "completed", candidateCount: 1, sentChapterCount: 2 });
    expect(sourceStore.listSources(project.id)).toMatchObject([
      {
        bookFolderPath: realBookFolderPath,
        displayName: "story.Book"
      }
    ]);
    expect(sentMessages.join("\n")).toContain("缺失章节：第二章");
  });

  it("reports active .Book search status while scanning", async () => {
    const { dir, project, service } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const statusSnapshots: ReturnType<typeof service.getStatus>["search"][] = [];

    await service.scanProject(
      {
        projectId: project.id,
        mode: "directory",
        directoryPath: dir,
        roots: [dir],
        timeBudgetMs: 10_000
      },
      {
        onProgress() {
          statusSnapshots.push(service.getStatus(project.id).search);
        }
      }
    );

    expect(statusSnapshots).toContainEqual(expect.objectContaining({ isRunning: true, mode: "directory" }));
    expect(service.getStatus(project.id).search).toEqual({
      isRunning: false,
      mode: null,
      trigger: null,
      startedAt: null
    });
  });

  it("automatically sends the latest project chapter from .Book even when no chapters are missing", async () => {
    const { dir, project, sourceStore, service, sentMessages } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    writeFileSync(join(projectBookDir, "story.Book"), "第一章\n.Book 里的第一章修订正文。", "utf8");

    const run = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 19, 7, 10));

    expect(run).toMatchObject({
      status: "completed",
      sentChapterCount: 1,
      sentMissingChapterCount: 0,
      sentLatestProjectChapter: true
    });
    expect(sourceStore.listSources(project.id)).toMatchObject([
      {
        bookFolderPath: realpathSync(projectBookDir),
        displayName: "story.Book"
      }
    ]);
    expect(sentMessages.join("\n")).toContain("当前项目最新章在 .Book 中的对应内容");
    expect(sentMessages.join("\n")).toContain(".Book 里的第一章修订正文。");
    expect(sentMessages.join("\n")).toContain("本批缺失章节：无");
  });

  it("automatically sends missing chapters once for each due sync slot", async () => {
    const { dir, project, service, sentMessages } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    writeFileSync(join(projectBookDir, "story.Book"), "第一章\n.Book 里的第一章修订正文。\n\n第二章\n新增正文。", "utf8");
    await service.scanProject({
      projectId: project.id,
      mode: "directory",
      directoryPath: dir,
      roots: [dir],
      timeBudgetMs: 10_000
    });

    const first = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 7, 0)
    });
    const duplicate = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 7, 30)
    });
    const second = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 11, 0)
    });

    expect(first).toMatchObject({ status: "completed", trigger: "scheduled", scheduledLocalTime: "07:00", sentChapterCount: 2, sentMissingChapterCount: 1 });
    expect(duplicate).toBeNull();
    expect(second).toMatchObject({ status: "completed", trigger: "scheduled", scheduledLocalTime: "11:00", sentChapterCount: 2, sentMissingChapterCount: 1 });
    expect(sentMessages.filter((message) => message.includes("缺失章节：第二章"))).toHaveLength(2);
    expect(sentMessages.join("\n")).toContain("当前项目最新章在 .Book 中的对应内容");
  });

  it("uses startup catch-up for the latest missed sync slot without blocking shutdown", async () => {
    const { dir, project, service, sentMessages } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    writeFileSync(join(projectBookDir, "story.Book"), "第一章\n.Book 里的第一章修订正文。\n\n第二章\n新增正文。", "utf8");
    await service.scanProject({
      projectId: project.id,
      mode: "directory",
      directoryPath: dir,
      roots: [dir],
      timeBudgetMs: 10_000
    });

    const previousNight = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 19, 6, 59));
    const startup = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 19, 11, 30));
    const duplicateStartup = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 19, 11, 45));

    expect(previousNight).toMatchObject({ trigger: "startup", scheduledLocalTime: "23:00", scheduledSlotKey: "2026-05-18T23:00", sentChapterCount: 2 });
    expect(startup).toMatchObject({ trigger: "startup", scheduledLocalTime: "11:00", sentChapterCount: 2 });
    expect(duplicateStartup).toBeNull();
    expect(sentMessages.filter((message) => message.includes("缺失章节：第二章"))).toHaveLength(2);
  });
});
