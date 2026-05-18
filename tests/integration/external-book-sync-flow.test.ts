import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyChapterContent } from "../../src/main/chapter/default-content";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { SettingsRepository } from "../../src/main/db/repositories/settings-repo";
import { SummaryRepository } from "../../src/main/db/repositories/summary-repo";
import { ExternalBookSourceStore } from "../../src/main/external-book-sync/book-source-store";
import { ExternalBookSyncService, type ExternalBookAiSender } from "../../src/main/external-book-sync/external-book-sync-service";
import { createId } from "../../src/main/shared/ids";
import { countWritingUnits } from "../../src/main/shared/text";

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

function createFixture() {
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
    rootPath: join(dir, "举足无措.noveltool"),
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
  const service = new ExternalBookSyncService({
    sourceStore: new ExternalBookSourceStore(new SettingsRepository(db)),
    resolveChapterRepo: () => chapterRepo,
    projectRepo,
    aiSender
  });
  return {
    dir,
    project,
    chapterRepo,
    summaryRepo,
    service,
    sentMessages
  };
}

describe("ExternalBookSyncService", () => {
  it("finds missing chapters without mutating chapters or summary jobs", async () => {
    const { dir, project, chapterRepo, summaryRepo, service } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    const otherBookDir = join(dir, "别的项目");
    mkdirSync(projectBookDir, { recursive: true });
    mkdirSync(otherBookDir, { recursive: true });
    writeFileSync(join(projectBookDir, "story.Book"), "第一章\n已有。\n\n第二章\n新增正文。", "utf8");
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
    expect(chapterRepo.listByProject(project.id)).toHaveLength(1);
    expect(summaryRepo.listSummaryJobs(project.id)).toEqual([]);
  });

  it("sends selected missing chapters to AI as bounded messages", async () => {
    const { dir, project, service, sentMessages } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    writeFileSync(join(projectBookDir, "story.Book"), "第一章\n已有。\n\n第二章\n新增正文。", "utf8");

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

    expect(sent.sentChapterCount).toBe(1);
    expect(sentMessages.length).toBeGreaterThan(0);
    expect(sentMessages.every((message) => message.length <= 7000)).toBe(true);
    expect(sentMessages.join("\n")).toContain("第二章");
  });
});
