import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import os, { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyChapterContent } from "../../src/main/chapter/default-content";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { SettingsRepository } from "../../src/main/db/repositories/settings-repo";
import { SummaryRepository } from "../../src/main/db/repositories/summary-repo";
import { ExternalBookSyncAutomationStore } from "../../src/main/external-book-sync/book-automation-store";
import { ExternalBookSentChapterStore } from "../../src/main/external-book-sync/book-send-history-store";
import { ExternalBookSyncDeliveryStore } from "../../src/main/external-book-sync/book-sync-delivery-store";
import { ExternalBookSourceStore } from "../../src/main/external-book-sync/book-source-store";
import {
  decryptExternalBookSyncMessage,
  encryptExternalBookSyncMessage
} from "../../src/main/external-book-sync/book-sync-crypto";
import { ExternalBookSyncService, type ExternalBookAiSender, type ExternalBookSyncServiceDeps } from "../../src/main/external-book-sync/external-book-sync-service";
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

function createFixture(options: {
  readonly rootPath?: string | null;
  readonly createChatSession?: ExternalBookAiSender["createChatSession"];
  readonly sendChatMessage?: ExternalBookAiSender["sendChatMessage"];
  readonly searchBookFilesInWindowsIndex?: ExternalBookSyncServiceDeps["searchBookFilesInWindowsIndex"];
  readonly encryptBookSyncMessage?: ExternalBookSyncServiceDeps["encryptBookSyncMessage"];
} = {}) {
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
  let sessionCounter = 0;
  const aiSender: ExternalBookAiSender = {
    createChatSession: options.createChatSession ?? (() => {
      sessionCounter += 1;
      return { id: `session_external_${sessionCounter}`, title: "外部同步检查" };
    }),
    sendChatMessage: options.sendChatMessage ?? (async (input) => {
      sentMessages.push(input.message);
    })
  };
  const sourceStore = new ExternalBookSourceStore(new SettingsRepository(db));
  const automationStore = new ExternalBookSyncAutomationStore(new SettingsRepository(db));
  const deliveryStore = new ExternalBookSyncDeliveryStore(new SettingsRepository(db));
  const service = new ExternalBookSyncService({
    sourceStore,
    automationStore,
    sentChapterStore: new ExternalBookSentChapterStore(new SettingsRepository(db)),
    deliveryStore,
    searchBookFilesInWindowsIndex: options.searchBookFilesInWindowsIndex,
    resolveChapterRepo: () => chapterRepo,
    projectRepo,
    aiSender,
    encryptBookSyncMessage: options.encryptBookSyncMessage ?? ((plaintext) => plaintext)
  });
  return {
    db,
    dir,
    project,
    projectRepo,
    chapterRepo,
    summaryRepo,
    sourceStore,
    deliveryStore,
    service,
    sentMessages
  };
}

function createReopenedService(input: {
  readonly db: SqliteDatabase;
  readonly projectRepo: ProjectRepository;
  readonly sendChatMessage: ExternalBookAiSender["sendChatMessage"];
}): ExternalBookSyncService {
  const chapterRepo = new ChapterRepository(input.db);
  return new ExternalBookSyncService({
    sourceStore: new ExternalBookSourceStore(new SettingsRepository(input.db)),
    automationStore: new ExternalBookSyncAutomationStore(new SettingsRepository(input.db)),
    sentChapterStore: new ExternalBookSentChapterStore(new SettingsRepository(input.db)),
    deliveryStore: new ExternalBookSyncDeliveryStore(new SettingsRepository(input.db)),
    resolveChapterRepo: () => chapterRepo,
    projectRepo: input.projectRepo,
    encryptBookSyncMessage: (plaintext) => plaintext,
    aiSender: {
      createChatSession: () => ({ id: "session_external_reopened", title: "外部同步检查" }),
      sendChatMessage: input.sendChatMessage
    }
  });
}

function createChapter(
  repo: ChapterRepository,
  input: {
    readonly projectId: string;
    readonly title: string;
    readonly sortOrder: number;
    readonly plainText: string;
  }
): void {
  const createdAt = "2026-05-18T00:00:00.000Z";
  repo.create({
    id: createId("chapter"),
    projectId: input.projectId,
    title: input.title,
    volumeTitle: null,
    sortOrder: input.sortOrder,
    contentJson: emptyChapterContent,
    plainText: input.plainText,
    wordCount: countWritingUnits(input.plainText),
    dailyWordCount: 0,
    dailyWordCountDate: null,
    targetWordCount: null,
    status: "draft",
    createdAt,
    updatedAt: createdAt
  });
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function writeFirstAndSecondBookFiles(projectBookDir: string): {
  readonly firstBookFilePath: string;
  readonly secondBookFilePath: string;
} {
  const firstBookFilePath = join(projectBookDir, "qvprnlsx.Book");
  const secondBookFilePath = join(projectBookDir, "xkmbtzha.Book");
  writeFileSync(firstBookFilePath, "第一章\n.Book 里的第一章修订正文。", "utf8");
  writeFileSync(secondBookFilePath, "第二章\n新增正文。", "utf8");
  return { firstBookFilePath, secondBookFilePath };
}

describe("ExternalBookSyncService", () => {
  it("keeps a first-time quick scan away from the filesystem root", async () => {
    const { dir, project, service } = createFixture();
    vi.spyOn(os, "homedir").mockReturnValue(dir);

    const result = await service.scanProject({
      projectId: project.id,
      mode: "quick",
      timeBudgetMs: 1_000
    });

    expect(result.searchedRoots).toContain(dir);
    expect(result.searchedRoots).not.toContain(parse(project.rootPath!).root);
    expect(result.scan?.timedOut).toBe(false);
  });

  it("finds missing chapters without mutating chapters or summary jobs", async () => {
    const { dir, project, chapterRepo, summaryRepo, sourceStore, service } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    const otherBookDir = join(dir, "别的项目");
    mkdirSync(projectBookDir, { recursive: true });
    mkdirSync(otherBookDir, { recursive: true });
    const { firstBookFilePath, secondBookFilePath } = writeFirstAndSecondBookFiles(projectBookDir);
    const realBookFilePaths = [realpathSync(firstBookFilePath), realpathSync(secondBookFilePath)];
    const realBookFolderPath = realpathSync(projectBookDir);
    writeFileSync(join(otherBookDir, "ignored.Book"), "第二章\n不应读取。", "utf8");

    const result = await service.scanProject({
      projectId: project.id,
      mode: "directory",
      directoryPath: dir,
      roots: [dir],
      timeBudgetMs: 10_000
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.flatMap((candidate) => candidate.comparison.missingChapters.map((chapter) => chapter.title))).toEqual(["第二章"]);
    const secondChapter = result.candidates.flatMap((candidate) => candidate.comparison.missingChapters)[0];
    expect("text" in secondChapter).toBe(false);
    expect(sourceStore.listSources(project.id)).toMatchObject([
      {
        bookFolderPath: realBookFolderPath,
        confirmedAt: expect.any(String)
      }
    ]);
    expect("bookFilePath" in sourceStore.listSources(project.id)[0]).toBe(false);

    const second = await service.scanProject({
      projectId: project.id,
      mode: "quick",
      timeBudgetMs: 10_000
    });
    expect(second.scan).not.toBeNull();
    expect(second.candidates.map((candidate) => candidate.filePath).sort()).toEqual(realBookFilePaths.sort());
    expect(chapterRepo.listByProject(project.id)).toHaveLength(1);
    expect(summaryRepo.listSummaryJobs(project.id)).toEqual([]);
  });

  it("sends selected missing chapters to AI without changing the .Book file", async () => {
    const { dir, project, service, sentMessages } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const { secondBookFilePath } = writeFirstAndSecondBookFiles(projectBookDir);
    const before = statSync(secondBookFilePath);
    const beforeFiles = readdirSync(projectBookDir);

    const result = await service.scanProject({
      projectId: project.id,
      mode: "directory",
      directoryPath: dir,
      roots: [dir],
      timeBudgetMs: 10_000
    });
    const candidate = result.candidates.find((item) => item.comparison.missingChapters.length > 0) ?? result.candidates[0];
    const sent = await service.sendMissingChaptersToAi({
      projectId: project.id,
      candidateId: candidate.id,
      chapterKeys: candidate.comparison.missingChapters.map((chapter) => chapter.key)
    });

    expect(sent.sentChapterCount).toBe(1);
    expect(sent.sentMissingChapterCount).toBe(1);
    expect(sent.sentLatestProjectChapter).toBe(false);
    expect(sentMessages.length).toBeGreaterThan(0);
    expect(sentMessages.join("\n")).toContain("第二章");
    expect(sentMessages.join("\n")).not.toContain(secondBookFilePath);
    expect(sentMessages.join("\n")).not.toContain("xkmbtzha.Book");
    expect(statSync(secondBookFilePath).mtimeMs).toBe(before.mtimeMs);
    expect(statSync(secondBookFilePath).size).toBe(before.size);
    expect(readdirSync(projectBookDir)).toEqual(beforeFiles);
  });

  it("sends only AES ciphertext and lets a user with tongbu recover Chinese content exactly", async () => {
    const { dir, project, service, sentMessages } = createFixture({
      encryptBookSyncMessage: encryptExternalBookSyncMessage
    });
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    writeFileSync(
      join(projectBookDir, "chinese.Book"),
      "第二章　雨夜归人\r\n𠮷野撑着油纸伞，说：“山河無恙🌙。”",
      "utf8"
    );

    const scan = await service.scanProject({
      projectId: project.id,
      mode: "directory",
      directoryPath: projectBookDir,
      roots: [projectBookDir],
      timeBudgetMs: 10_000
    });
    const candidate = scan.candidates[0];
    await service.sendMissingChaptersToAi({
      projectId: project.id,
      candidateId: candidate.id,
      chapterKeys: candidate.comparison.missingChapters.map((chapter) => chapter.key)
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).not.toContain("雨夜归人");
    expect(sentMessages[0]).not.toContain("𠮷野");
    expect(sentMessages[0]).not.toContain("tongbu");
    const decrypted = decryptExternalBookSyncMessage(sentMessages[0], "tongbu");
    expect(decrypted).toContain("第二章 雨夜归人");
    expect(decrypted).toContain("𠮷野撑着油纸伞，说：“山河無恙🌙。”");
  });

  it("keeps an emergency-only DeepSeek delivery pending until an observable provider succeeds", async () => {
    const attempts: Array<{ readonly allowEmergency: boolean | undefined; readonly message: string; readonly plaintextMessage: string | undefined }> = [];
    let attempt = 0;
    const { dir, project, service } = createFixture({
      encryptBookSyncMessage: encryptExternalBookSyncMessage,
      async sendChatMessage(input) {
        attempt += 1;
        attempts.push({
          allowEmergency: input.allowEmergency,
          message: input.message,
          plaintextMessage: input.plaintextMessage
        });
        return attempt === 1
          ? { provider: "deepseek", completion: "emergency" as const }
          : { provider: "openrouter", completion: "observable" as const };
      }
    });
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    writeFileSync(join(projectBookDir, "second.Book"), "第二章\n雨落青瓦。", "utf8");

    const scan = await service.scanProject({
      projectId: project.id,
      mode: "directory",
      directoryPath: projectBookDir,
      roots: [projectBookDir],
      timeBudgetMs: 10_000
    });
    const candidate = scan.candidates[0];
    const input = {
      projectId: project.id,
      candidateId: candidate.id,
      chapterKeys: candidate.comparison.missingChapters.map((chapter) => chapter.key)
    };

    const emergency = await service.sendMissingChaptersToAi(input);
    const observable = await service.sendMissingChaptersToAi(input);

    expect(emergency.sentChapterCount).toBe(0);
    expect(observable.sentChapterCount).toBe(1);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ allowEmergency: true });
    expect(attempts[1]).toMatchObject({ allowEmergency: false });
    expect(attempts[0].message).toBe(attempts[1].message);
    expect(attempts[0].plaintextMessage).toContain("第二章\n雨落青瓦。");
  });

  it("resumes a split chapter without resending parts already delivered to an observable provider", async () => {
    const attempts: Array<{ readonly requestId: string; readonly allowEmergency: boolean; readonly message: string }> = [];
    let attempt = 0;
    const { dir, project, service } = createFixture({
      encryptBookSyncMessage: encryptExternalBookSyncMessage,
      async sendChatMessage(input) {
        attempt += 1;
        attempts.push({ requestId: input.requestId, allowEmergency: input.allowEmergency, message: input.message });
        if (attempt === 2) {
          return { provider: "deepseek", completion: "emergency" as const };
        }
        return { provider: "openrouter", completion: "observable" as const };
      }
    });
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const firstHalf = `上半段。${"山河无恙。".repeat(2_500)}`;
    const secondHalf = `下半段。${"灯火可亲。".repeat(2_500)}`;
    writeFileSync(join(projectBookDir, "long.Book"), `第二章\n${firstHalf}\n\n${secondHalf}`, "utf8");
    const scan = await service.scanProject({
      projectId: project.id,
      mode: "directory",
      directoryPath: projectBookDir,
      roots: [projectBookDir],
      timeBudgetMs: 10_000
    });
    const candidate = scan.candidates[0];
    const input = {
      projectId: project.id,
      candidateId: candidate.id,
      chapterKeys: candidate.comparison.missingChapters.map((chapter) => chapter.key)
    };

    const first = await service.sendMissingChaptersToAi(input);
    const resumed = await service.sendMissingChaptersToAi(input);

    expect(first.sentChapterCount).toBe(0);
    expect(resumed.sentChapterCount).toBe(1);
    expect(attempts).toHaveLength(3);
    expect(attempts[0].requestId).not.toBe(attempts[1].requestId);
    expect(attempts[2]).toMatchObject({
      requestId: attempts[1].requestId,
      allowEmergency: false,
      message: attempts[1].message
    });
  });

  it("resumes the same persisted split delivery after the app service is recreated", async () => {
    const firstAttempts: Array<{ readonly requestId: string; readonly message: string }> = [];
    let firstAttempt = 0;
    const { db, dir, project, projectRepo, service } = createFixture({
      encryptBookSyncMessage: encryptExternalBookSyncMessage,
      async sendChatMessage(input) {
        firstAttempt += 1;
        firstAttempts.push({ requestId: input.requestId, message: input.message });
        return firstAttempt === 2
          ? { provider: "deepseek", completion: "emergency" as const }
          : { provider: "openrouter", completion: "observable" as const };
      }
    });
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    writeFileSync(
      join(projectBookDir, "restart-long.Book"),
      `第二章\n${"重启前半段。".repeat(2_200)}\n\n${"重启后半段。".repeat(2_200)}`,
      "utf8"
    );
    const scan = await service.scanProject({
      projectId: project.id,
      mode: "directory",
      directoryPath: projectBookDir,
      roots: [projectBookDir],
      timeBudgetMs: 10_000
    });
    const candidate = scan.candidates[0];
    const first = await service.sendMissingChaptersToAi({
      projectId: project.id,
      candidateId: candidate.id,
      chapterKeys: candidate.comparison.missingChapters.map((chapter) => chapter.key)
    });
    const resumedAttempts: Array<{ readonly requestId: string; readonly allowEmergency: boolean; readonly message: string }> = [];
    const reopened = createReopenedService({
      db,
      projectRepo,
      async sendChatMessage(input) {
        resumedAttempts.push({ requestId: input.requestId, allowEmergency: input.allowEmergency, message: input.message });
        return { provider: "openrouter", completion: "observable" };
      }
    });

    const resumed = await reopened.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 7, 1, 9, 0)
    });

    expect(first.sentChapterCount).toBe(0);
    expect(firstAttempts).toHaveLength(2);
    expect(resumed).toMatchObject({ status: "completed", sentChapterCount: 1 });
    expect(resumedAttempts).toEqual([
      {
        requestId: firstAttempts[1].requestId,
        allowEmergency: false,
        message: firstAttempts[1].message
      }
    ]);
  });

  it("encrypts every message in an automatic external Book sync before the TokenHub sender receives it", async () => {
    const { dir, project, sourceStore, service, sentMessages } = createFixture({
      encryptBookSyncMessage: encryptExternalBookSyncMessage
    });
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    writeFileSync(
      join(projectBookDir, "latest.Book"),
      "第一章\r\n项目最新章的外部修订：长街灯影。",
      "utf8"
    );
    writeFileSync(
      join(projectBookDir, "missing.Book"),
      "第二章\r\n自动同步新增正文：雨落青瓦。",
      "utf8"
    );
    sourceStore.upsertSource({
      projectId: project.id,
      bookFolderPath: realpathSync(projectBookDir),
      displayName: "外部 .Book",
      lastKnownSize: 0,
      lastModifiedAt: null,
      lastContentHash: null,
      lastScanAt: "2026-05-19T07:00:00.000Z",
      confirmedAt: "2026-05-19T07:00:00.000Z"
    });

    const run = await service.runStartupCatchUpSync(
      project.id,
      new Date(2026, 4, 19, 7, 10)
    );

    expect(run).toMatchObject({
      status: "completed",
      sentChapterCount: 2
    });
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages.every((message) => !message.includes("外部修订"))).toBe(true);
    expect(sentMessages.every((message) => !message.includes("自动同步新增正文"))).toBe(true);
    const decryptedMessages = sentMessages.map((message) =>
      decryptExternalBookSyncMessage(message, "tongbu")
    );
    expect(decryptedMessages.join("\n")).toContain("项目最新章的外部修订：长街灯影。");
    expect(decryptedMessages.join("\n")).toContain("自动同步新增正文：雨落青瓦。");
  });

  it("automatically discovers and saves a .Book source on the first startup sync", async () => {
    const { dir, project, sourceStore, service, sentMessages } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const { firstBookFilePath, secondBookFilePath } = writeFirstAndSecondBookFiles(projectBookDir);
    const realBookFolderPath = realpathSync(projectBookDir);

    const run = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 19, 7, 10));

    expect(run).toMatchObject({
      trigger: "startup",
      scheduledLocalTime: "07:10",
      status: "completed",
      candidateCount: 2,
      sentChapterCount: 2,
      sentMissingChapterCount: 1,
      sentLatestProjectChapter: true
    });
    expect(sourceStore.listSources(project.id)).toMatchObject([
      {
        bookFolderPath: realBookFolderPath,
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
    expect(sentMessages.join("\n")).not.toContain(firstBookFilePath);
    expect(sentMessages.join("\n")).not.toContain(secondBookFilePath);
    expect(sentMessages.join("\n")).not.toContain("qvprnlsx.Book");
    expect(sentMessages.join("\n")).not.toContain("xkmbtzha.Book");
  });

  it("automatically sends all one-chapter .Book files from the saved project folder", async () => {
    const { dir, project, sourceStore, service, sentMessages } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const firstBookFileName = "qvprnlsx.Book";
    const firstBookFilePath = join(projectBookDir, firstBookFileName);
    writeFileSync(firstBookFilePath, "第一章\n.Book 里的第一章修订正文。", "utf8");
    writeFileSync(join(projectBookDir, "xkmbtzha.Book"), "第二章\n第二章新增正文。", "utf8");
    const realBookFolderPath = realpathSync(projectBookDir);

    const firstRun = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 19, 7, 10));

    expect(firstRun).toMatchObject({
      trigger: "startup",
      scheduledLocalTime: "07:10",
      status: "completed",
      candidateCount: 2,
      sentChapterCount: 2,
      sentMissingChapterCount: 1,
      sentLatestProjectChapter: true
    });
    expect(sourceStore.listSources(project.id)).toHaveLength(1);
    expect(sourceStore.listSources(project.id)[0]).toMatchObject({
      bookFolderPath: realBookFolderPath,
      confirmedAt: expect.any(String)
    });
    expect(sentMessages.join("\n")).toContain("当前项目最新章在 .Book 中的对应内容");
    expect(sentMessages.join("\n")).toContain(".Book 里的第一章修订正文。");
    expect(sentMessages.join("\n")).toContain("缺失章节：第二章");
    expect(sentMessages.join("\n")).not.toContain(firstBookFilePath);
    expect(sentMessages.join("\n")).not.toContain(firstBookFileName);

    writeFileSync(join(projectBookDir, "nhpwlqrs.Book"), "第三章\n第三章新增正文。", "utf8");
    const secondRun = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 11, 0)
    });

    expect(secondRun).toMatchObject({
      trigger: "scheduled",
      scheduledLocalTime: "11:00",
      status: "completed",
      candidateCount: 3,
      sentChapterCount: 1,
      sentMissingChapterCount: 1,
      sentLatestProjectChapter: false
    });
    expect(sentMessages.join("\n")).toContain("缺失章节：第三章");
  });

  it("automatically sends the latest project chapter and every later one-chapter .Book file", async () => {
    const sentSessionIds: string[] = [];
    const { dir, project, chapterRepo, service, sentMessages } = createFixture({
      async sendChatMessage(input) {
        sentSessionIds.push(input.sessionId);
        sentMessages.push(input.message);
      }
    });
    const latestProjectChapter = chapterRepo.listByProject(project.id)[0];
    chapterRepo.rename(latestProjectChapter.id, "第40章", "2026-05-18T01:00:00.000Z");
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const latestBookFileName = "zzzzalpha.Book";
    const latestBookFilePath = join(projectBookDir, latestBookFileName);
    writeFileSync(latestBookFilePath, "第40章\n.Book 里的第40章正文。", "utf8");
    writeFileSync(join(projectBookDir, "aaaabeta.Book"), "第41章\n第41章新增正文。", "utf8");
    writeFileSync(join(projectBookDir, "mmmmgamma.Book"), "第42章\n第42章新增正文。", "utf8");
    writeFileSync(join(projectBookDir, "bbbbdelta.Book"), "第43章\n第43章新增正文。", "utf8");

    const run = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 19, 7, 10));
    const sentBody = sentMessages.join("\n");

    expect(run).toMatchObject({
      trigger: "startup",
      scheduledLocalTime: "07:10",
      status: "completed",
      candidateCount: 4,
      sentChapterCount: 4,
      sentMissingChapterCount: 3,
      sentLatestProjectChapter: true
    });
    expect(sentBody).toContain("当前项目最新章在 .Book 中的对应内容：第40章");
    expect(sentBody).toContain(".Book 里的第40章正文。");
    expect(sentBody).toContain("缺失章节：第41章");
    expect(sentBody).toContain("缺失章节：第42章");
    expect(sentBody).toContain("缺失章节：第43章");
    expect(sentBody).not.toContain(latestBookFilePath);
    expect(sentBody).not.toContain(latestBookFileName);
    expect(new Set(sentSessionIds).size).toBe(4);
  });

  it("locally verifies a project at chapter 48 sends external Book chapters 48 through 51", async () => {
    const { dir, project, chapterRepo, service, sentMessages } = createFixture();
    const firstChapter = chapterRepo.listByProject(project.id)[0];
    chapterRepo.rename(firstChapter.id, "第1章", "2026-05-18T01:00:00.000Z");
    for (let ordinal = 2; ordinal <= 48; ordinal += 1) {
      createChapter(chapterRepo, {
        projectId: project.id,
        title: `第${ordinal}章`,
        sortOrder: ordinal - 1,
        plainText: `本地第${ordinal}章正文。`
      });
    }
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const bookFileNames = ["zzzzlatest.Book", "aaaamissing.Book", "mmmmmissing.Book", "bbbbmissing.Book"];
    writeFileSync(join(projectBookDir, bookFileNames[0]), "第48章\n.Book 里的第48章正文。", "utf8");
    writeFileSync(join(projectBookDir, bookFileNames[1]), "第49章\n第49章新增正文。", "utf8");
    writeFileSync(join(projectBookDir, bookFileNames[2]), "第50章\n第50章新增正文。", "utf8");
    writeFileSync(join(projectBookDir, bookFileNames[3]), "第51章\n第51章新增正文。", "utf8");

    const run = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 21, 9, 0));
    const sentBody = sentMessages.join("\n");

    expect(run).toMatchObject({
      trigger: "startup",
      scheduledLocalTime: "09:00",
      status: "completed",
      candidateCount: 4,
      sentChapterCount: 4,
      sentMissingChapterCount: 3,
      sentLatestProjectChapter: true
    });
    expect(sentBody).toContain("当前项目最新章在 .Book 中的对应内容：第48章");
    expect(sentBody).toContain(".Book 里的第48章正文。");
    expect(sentBody).toContain("缺失章节：第49章");
    expect(sentBody).toContain("第49章新增正文。");
    expect(sentBody).toContain("缺失章节：第50章");
    expect(sentBody).toContain("第50章新增正文。");
    expect(sentBody).toContain("缺失章节：第51章");
    expect(sentBody).toContain("第51章新增正文。");
    for (const fileName of bookFileNames) {
      expect(sentBody).not.toContain(fileName);
    }
  });

  it("does not send stale nested .Book files from backup folders when direct one-chapter files exist", async () => {
    const { dir, project, chapterRepo, service, sentMessages } = createFixture();
    const firstChapter = chapterRepo.listByProject(project.id)[0];
    chapterRepo.rename(firstChapter.id, "第52章", "2026-05-18T01:00:00.000Z");
    const projectBookDir = join(dir, "举足无措");
    const backupDir = join(projectBookDir, "backup");
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(join(projectBookDir, "direct53.Book"), "第53章\n第53章正确正文。", "utf8");
    writeFileSync(join(projectBookDir, "direct54.Book"), "第54章", "utf8");
    writeFileSync(join(projectBookDir, "direct56.Book"), "第56章\n第56章正确正文。", "utf8");
    writeFileSync(join(backupDir, "stale53.Book"), "第53章\n第56章错误正文。", "utf8");
    writeFileSync(join(backupDir, "stale54.Book"), "第54章\n第53章错误正文。", "utf8");
    writeFileSync(join(backupDir, "stale56.Book"), "第56章\n第53章错误正文。", "utf8");
    utimesSync(join(projectBookDir, "direct53.Book"), new Date("2026-05-19T07:00:00.000Z"), new Date("2026-05-19T07:00:00.000Z"));
    utimesSync(join(projectBookDir, "direct54.Book"), new Date("2026-05-19T07:00:00.000Z"), new Date("2026-05-19T07:00:00.000Z"));
    utimesSync(join(projectBookDir, "direct56.Book"), new Date("2026-05-19T07:00:00.000Z"), new Date("2026-05-19T07:00:00.000Z"));
    utimesSync(join(backupDir, "stale53.Book"), new Date("2026-05-19T09:00:00.000Z"), new Date("2026-05-19T09:00:00.000Z"));
    utimesSync(join(backupDir, "stale54.Book"), new Date("2026-05-19T09:00:00.000Z"), new Date("2026-05-19T09:00:00.000Z"));
    utimesSync(join(backupDir, "stale56.Book"), new Date("2026-05-19T09:00:00.000Z"), new Date("2026-05-19T09:00:00.000Z"));

    const run = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 21, 9, 0));
    const sentBody = sentMessages.join("\n");

    expect(run).toMatchObject({
      trigger: "startup",
      scheduledLocalTime: "09:00",
      status: "completed",
      candidateCount: 3,
      sentChapterCount: 3,
      sentMissingChapterCount: 3
    });
    expect(sentBody).toContain("缺失章节：第53章");
    expect(sentBody).toContain("第53章正确正文。");
    expect(sentBody).toContain("缺失章节：第54章");
    expect(sentBody).not.toContain("第54章错误正文。");
    expect(sentBody).toContain("缺失章节：第56章");
    expect(sentBody).toContain("第56章正确正文。");
    expect(sentBody).not.toContain("第56章错误正文。");
    expect(sentBody).not.toContain("第53章错误正文。");
  });

  it("does not split chapter-looking lines inside a one-chapter .Book body into other chapters", async () => {
    const { dir, project, chapterRepo, service, sentMessages } = createFixture();
    const firstChapter = chapterRepo.listByProject(project.id)[0];
    chapterRepo.rename(firstChapter.id, "第52章", "2026-05-18T01:00:00.000Z");
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const chapter53Path = join(projectBookDir, "random53.Book");
    const chapter54Path = join(projectBookDir, "random54.Book");
    const chapter56Path = join(projectBookDir, "random56.Book");
    writeFileSync(
      chapter53Path,
      "第53章\n第53章正确正文开头。\n\n第54章\n这是第53章正文里的章节样式行，不是第54章正文。\n\n第56章\n这是第53章正文里的章节样式行，不是第56章正文。",
      "utf8"
    );
    writeFileSync(chapter54Path, "第54章", "utf8");
    writeFileSync(chapter56Path, "第56章\n第56章正确正文。", "utf8");
    utimesSync(chapter54Path, new Date("2026-05-19T07:00:00.000Z"), new Date("2026-05-19T07:00:00.000Z"));
    utimesSync(chapter56Path, new Date("2026-05-19T07:00:00.000Z"), new Date("2026-05-19T07:00:00.000Z"));
    utimesSync(chapter53Path, new Date("2026-05-19T09:00:00.000Z"), new Date("2026-05-19T09:00:00.000Z"));

    const run = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 21, 9, 0));
    const chapter53Message = sentMessages.find((message) => message.includes("## 缺失章节：第53章")) ?? "";
    const chapter54Message = sentMessages.find((message) => message.includes("## 缺失章节：第54章")) ?? "";
    const chapter56Message = sentMessages.find((message) => message.includes("## 缺失章节：第56章")) ?? "";

    expect(run).toMatchObject({
      trigger: "startup",
      scheduledLocalTime: "09:00",
      status: "completed",
      candidateCount: 3,
      sentChapterCount: 3,
      sentMissingChapterCount: 3
    });
    expect(chapter53Message).toContain("第53章正确正文开头。");
    expect(chapter53Message).toContain("这是第53章正文里的章节样式行，不是第54章正文。");
    expect(chapter53Message).toContain("这是第53章正文里的章节样式行，不是第56章正文。");
    expect(chapter54Message).not.toContain("这是第53章正文里的章节样式行，不是第54章正文。");
    expect(chapter56Message).toContain("第56章正确正文。");
    expect(chapter56Message).not.toContain("这是第53章正文里的章节样式行，不是第56章正文。");
  });

  it("uses the first non-empty chapter heading in a one-chapter .Book so empty leading markers cannot swap chapter bodies", async () => {
    const { dir, project, chapterRepo, service, sentMessages } = createFixture();
    const firstChapter = chapterRepo.listByProject(project.id)[0];
    chapterRepo.rename(firstChapter.id, "第52章", "2026-05-18T01:00:00.000Z");
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    writeFileSync(join(projectBookDir, "random53.Book"), "第56章\n\n第53章\n第53章真实正文。", "utf8");
    writeFileSync(join(projectBookDir, "random56.Book"), "第53章\n\n第56章\n第56章真实正文。", "utf8");

    const run = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 21, 9, 0));
    const chapter53Message = sentMessages.find((message) => message.includes("## 缺失章节：第53章")) ?? "";
    const chapter56Message = sentMessages.find((message) => message.includes("## 缺失章节：第56章")) ?? "";

    expect(run).toMatchObject({
      trigger: "startup",
      scheduledLocalTime: "09:00",
      status: "completed",
      candidateCount: 2,
      sentChapterCount: 2,
      sentMissingChapterCount: 2
    });
    expect(chapter53Message).toContain("第53章真实正文。");
    expect(chapter53Message).not.toContain("第56章真实正文。");
    expect(chapter56Message).toContain("第56章真实正文。");
    expect(chapter56Message).not.toContain("第53章真实正文。");
  });

  it("sends chapters 53 54 and 56 when they are mixed with other one-chapter .Book files", async () => {
    const { dir, project, chapterRepo, service, sentMessages } = createFixture();
    const firstChapter = chapterRepo.listByProject(project.id)[0];
    chapterRepo.rename(firstChapter.id, "第52章", "2026-05-18T01:00:00.000Z");
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    writeFileSync(
      join(projectBookDir, "random53.Book"),
      "第53章\n第53章正确正文开头。\n\n第54章\n这是第53章正文里的章节样式行，不是第54章正文。\n\n第56章\n这是第53章正文里的章节样式行，不是第56章正文。",
      "utf8"
    );
    writeFileSync(join(projectBookDir, "random54.Book"), "第54章", "utf8");
    writeFileSync(join(projectBookDir, "random55.Book"), "第55章\n第55章正确正文。", "utf8");
    writeFileSync(join(projectBookDir, "random56.Book"), "第56章\n第56章正确正文。", "utf8");
    writeFileSync(join(projectBookDir, "random57.Book"), "第57章\n第57章正确正文。", "utf8");

    const run = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 21, 9, 0));
    const sentBody = sentMessages.join("\n");

    expect(run).toMatchObject({
      trigger: "startup",
      scheduledLocalTime: "09:00",
      status: "completed",
      candidateCount: 5,
      sentChapterCount: 5,
      sentMissingChapterCount: 5
    });
    expect(sentBody).toContain("缺失章节：第53章");
    expect(sentBody).toContain("缺失章节：第54章");
    expect(sentBody).toContain("缺失章节：第55章");
    expect(sentBody).toContain("缺失章节：第56章");
    expect(sentBody).toContain("缺失章节：第57章");
  });

  it("sends missing gap chapters even when the project already has a later chapter", async () => {
    const sentSessionIds: string[] = [];
    const createdSessionTitles: string[] = [];
    const { dir, project, chapterRepo, service, sentMessages } = createFixture({
      createChatSession(input) {
        createdSessionTitles.push(input.title);
        return { id: `session_external_${createdSessionTitles.length}`, title: input.title };
      },
      async sendChatMessage(input) {
        sentSessionIds.push(input.sessionId);
        sentMessages.push(input.message);
      }
    });
    const firstChapter = chapterRepo.listByProject(project.id)[0];
    chapterRepo.rename(firstChapter.id, "第52章", "2026-05-18T01:00:00.000Z");
    createChapter(chapterRepo, {
      projectId: project.id,
      title: "第55章",
      sortOrder: 1,
      plainText: "本地第55章正文。"
    });
    createChapter(chapterRepo, {
      projectId: project.id,
      title: "第57章",
      sortOrder: 2,
      plainText: "本地第57章正文。"
    });
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    writeFileSync(join(projectBookDir, "random53.Book"), "第53章\n第53章正确正文。", "utf8");
    writeFileSync(join(projectBookDir, "random54.Book"), "第54章", "utf8");
    writeFileSync(join(projectBookDir, "random55.Book"), "第55章\n第55章外部正文。", "utf8");
    writeFileSync(join(projectBookDir, "random56.Book"), "第56章\n第56章正确正文。", "utf8");
    writeFileSync(join(projectBookDir, "random57.Book"), "第57章\n第57章外部正文。", "utf8");

    const run = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 21, 9, 0));
    const sentBody = sentMessages.join("\n");
    const chapter53Message = sentMessages.find((message) => message.includes("## 缺失章节：第53章")) ?? "";
    const chapter54Message = sentMessages.find((message) => message.includes("## 缺失章节：第54章")) ?? "";
    const chapter56Message = sentMessages.find((message) => message.includes("## 缺失章节：第56章")) ?? "";

    expect(run).toMatchObject({
      trigger: "startup",
      scheduledLocalTime: "09:00",
      status: "completed",
      candidateCount: 5,
      sentChapterCount: 4,
      sentMissingChapterCount: 3,
      sentLatestProjectChapter: true
    });
    expect(sentBody).toContain("缺失章节：第53章");
    expect(sentBody).toContain("缺失章节：第54章");
    expect(sentBody).toContain("缺失章节：第56章");
    expect(sentBody).toContain("当前项目最新章在 .Book 中的对应内容：第57章");
    expect(sentBody).not.toContain("缺失章节：第55章");
    expect(chapter53Message).toContain("第53章正确正文。");
    expect(chapter54Message).toContain("（本章 .Book 正文为空）");
    expect(chapter54Message).not.toContain("第53章正确正文。");
    expect(chapter54Message).not.toContain("第56章正确正文。");
    expect(chapter56Message).toContain("第56章正确正文。");
    expect(createdSessionTitles).toContain("外部同步检查 - 第53章");
    expect(createdSessionTitles).toContain("外部同步检查 - 第54章");
    expect(createdSessionTitles).toContain("外部同步检查 - 第56章");
    expect(new Set(sentSessionIds).size).toBe(sentSessionIds.length);

    sentMessages.length = 0;
    sentSessionIds.length = 0;
    const unchangedRun = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 21, 11, 0)
    });
    expect(unchangedRun).toMatchObject({
      status: "skipped",
      scheduledLocalTime: "11:00",
      sentChapterCount: 0,
      sentMissingChapterCount: 0
    });
    expect(sentMessages).toEqual([]);
    expect(sentSessionIds).toEqual([]);
  });

  it("ignores Windows Search results from nested project backup folders", async () => {
    const indexSearch = vi.fn<NonNullable<ExternalBookSyncServiceDeps["searchBookFilesInWindowsIndex"]>>();
    const { dir, project, chapterRepo, service, sentMessages } = createFixture({
      searchBookFilesInWindowsIndex: indexSearch
    });
    const firstChapter = chapterRepo.listByProject(project.id)[0];
    chapterRepo.rename(firstChapter.id, "第52章", "2026-05-18T01:00:00.000Z");
    const projectBookDir = join(dir, "举足无措");
    const backupDir = join(projectBookDir, "backup");
    mkdirSync(backupDir, { recursive: true });
    const directFile = join(projectBookDir, "direct53.Book");
    const staleFile = join(backupDir, "stale53.Book");
    writeFileSync(directFile, "第53章\n第53章正确正文。", "utf8");
    writeFileSync(staleFile, "第53章\n第53章错误正文。", "utf8");
    utimesSync(directFile, new Date("2026-05-19T07:00:00.000Z"), new Date("2026-05-19T07:00:00.000Z"));
    utimesSync(staleFile, new Date("2026-05-19T09:00:00.000Z"), new Date("2026-05-19T09:00:00.000Z"));
    indexSearch.mockResolvedValue({ status: "completed", files: [staleFile] });

    const run = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 21, 9, 0));
    const sentBody = sentMessages.join("\n");

    expect(indexSearch).toHaveBeenCalled();
    expect(run).toMatchObject({ status: "completed", scheduledLocalTime: "09:00", candidateCount: 1, sentChapterCount: 1 });
    expect(sentBody).toContain("第53章正确正文。");
    expect(sentBody).not.toContain("第53章错误正文。");
  });

  it("falls back to global discovery when a saved source folder is now filtered as a nested backup folder", async () => {
    const { db, dir, project, chapterRepo, service, sentMessages } = createFixture({ rootPath: null });
    vi.spyOn(os, "homedir").mockReturnValue(dir);
    const firstChapter = chapterRepo.listByProject(project.id)[0];
    chapterRepo.rename(firstChapter.id, "第52章", "2026-05-18T01:00:00.000Z");
    const projectBookDir = join(dir, "举足无措");
    const backupDir = join(projectBookDir, "backup");
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(join(projectBookDir, "direct53.Book"), "第53章\n第53章正确正文。", "utf8");
    writeFileSync(join(backupDir, "stale53.Book"), "第53章\n第53章错误正文。", "utf8");
    new SettingsRepository(db).setJson(`externalBookSyncSources:${project.id}`, [
      {
        id: "external_book_source_nested",
        projectId: project.id,
        bookFolderPath: backupDir,
        displayName: "stale53.Book",
        lastKnownSize: 100,
        lastModifiedAt: "2026-05-19T09:00:00.000Z",
        lastContentHash: "stale-hash",
        lastScanAt: "2026-05-19T09:00:00.000Z",
        confirmedAt: "2026-05-19T09:00:00.000Z",
        selectionVersion: 2
      }
    ]);

    const run = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 21, 9, 0));
    const sentBody = sentMessages.join("\n");

    expect(run).toMatchObject({ status: "completed", scheduledLocalTime: "09:00", candidateCount: 1, sentChapterCount: 1 });
    expect(sentBody).toContain("第53章正确正文。");
    expect(sentBody).not.toContain("第53章错误正文。");
  });

  it("falls back to global discovery when first automatic quick discovery finds no source", async () => {
    const { dir, project, sourceStore, service, sentMessages } = createFixture({ rootPath: null });
    const fakeHome = join(dir, "home");
    const projectBookDir = join(fakeHome, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
    const { firstBookFilePath, secondBookFilePath } = writeFirstAndSecondBookFiles(projectBookDir);
    const realBookFolderPath = realpathSync(projectBookDir);

    const run = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 19, 7, 10));

    expect(run).toMatchObject({
      trigger: "startup",
      scheduledLocalTime: "07:10",
      status: "completed",
      candidateCount: 2,
      sentChapterCount: 2
    });
    expect(sourceStore.listSources(project.id)).toMatchObject([
      {
        bookFolderPath: realBookFolderPath
      }
    ]);
    expect(sentMessages.join("\n")).toContain("缺失章节：第二章");
    expect(sentMessages.join("\n")).not.toContain(firstBookFilePath);
    expect(sentMessages.join("\n")).not.toContain(secondBookFilePath);
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
    writeFirstAndSecondBookFiles(projectBookDir);
    const realBookFolderPath = realpathSync(projectBookDir);
    const secondRun = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 19, 7, 20));

    expect(firstRun).toMatchObject({ trigger: "startup", scheduledLocalTime: "07:10", status: "skipped", candidateCount: 0 });
    expect(secondRun).toMatchObject({ trigger: "startup", scheduledLocalTime: "07:20", status: "completed", candidateCount: 2, sentChapterCount: 2 });
    expect(sourceStore.listSources(project.id)).toMatchObject([
      {
        bookFolderPath: realBookFolderPath
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

  it("checks every due sync slot but skips unchanged chapters that were already sent", async () => {
    const { dir, project, service, sentMessages } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    writeFirstAndSecondBookFiles(projectBookDir);
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
    const halfHour = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 7, 30)
    });
    const second = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 8, 0)
    });

    expect(first).toMatchObject({ status: "completed", trigger: "scheduled", scheduledLocalTime: "07:00", sentChapterCount: 2, sentMissingChapterCount: 1 });
    expect(halfHour).toMatchObject({ status: "skipped", trigger: "scheduled", scheduledLocalTime: "07:30", candidateCount: 2, sentChapterCount: 0, sentMissingChapterCount: 0 });
    expect(second).toMatchObject({ status: "skipped", trigger: "scheduled", scheduledLocalTime: "08:00", candidateCount: 2, sentChapterCount: 0, sentMissingChapterCount: 0 });
    expect(sentMessages.filter((message) => message.includes("缺失章节：第二章"))).toHaveLength(1);
    expect(sentMessages.join("\n")).toContain("当前项目最新章在 .Book 中的对应内容");
  });

  it("serializes concurrent automatic runs so one sync slot cannot send chapters twice", async () => {
    let releaseFirstSend!: () => void;
    let markFirstSendStarted!: () => void;
    const firstSendStarted = new Promise<void>((resolve) => {
      markFirstSendStarted = resolve;
    });
    const firstSendGate = new Promise<void>((resolve) => {
      releaseFirstSend = resolve;
    });
    let sendAttempts = 0;
    const { dir, project, service } = createFixture({
      async sendChatMessage() {
        sendAttempts += 1;
        if (sendAttempts === 1) {
          markFirstSendStarted();
          await firstSendGate;
        }
      }
    });
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    writeFirstAndSecondBookFiles(projectBookDir);
    const now = new Date(2026, 4, 19, 7, 0);

    const firstRunPromise = service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now
    });
    await firstSendStarted;
    const duplicateRunPromise = service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now
    });
    releaseFirstSend();
    const [firstRun, duplicateRun] = await Promise.all([firstRunPromise, duplicateRunPromise]);

    expect(firstRun).toMatchObject({ status: "completed", sentChapterCount: 2 });
    expect(duplicateRun).toBeNull();
    expect(sendAttempts).toBe(2);
  });

  it("sends a previously sent .Book chapter again when the chapter payload hash changes", async () => {
    const { dir, project, service, sentMessages } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const bookFilePath = join(projectBookDir, "chapter-token.Book");
    writeFileSync(bookFilePath, "第二章\n旧的新增正文。", "utf8");
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
    const unchanged = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 9, 0)
    });
    writeFileSync(bookFilePath, "第二章\n修改后的新增正文。", "utf8");
    const changed = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 11, 0)
    });

    expect(first).toMatchObject({ status: "completed", scheduledLocalTime: "07:00", sentChapterCount: 1, sentMissingChapterCount: 1 });
    expect(unchanged).toMatchObject({ status: "skipped", scheduledLocalTime: "09:00", sentChapterCount: 0, sentMissingChapterCount: 0 });
    expect(changed).toMatchObject({ status: "completed", scheduledLocalTime: "11:00", sentChapterCount: 1, sentMissingChapterCount: 1 });
    expect(sentMessages.filter((message) => message.includes("缺失章节：第二章"))).toHaveLength(2);
    expect(sentMessages.join("\n")).toContain("旧的新增正文。");
    expect(sentMessages.join("\n")).toContain("修改后的新增正文。");
  });

  it("detects a changed .Book chapter on the first ten-minute check after startup", async () => {
    const { dir, project, service, sentMessages } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const bookFilePath = join(projectBookDir, "chapter-token.Book");
    writeFileSync(bookFilePath, "第二章\n启动时的正文。", "utf8");

    const startup = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 19, 7, 2));
    sentMessages.length = 0;
    writeFileSync(bookFilePath, "第二章\n十分钟后修改的正文。", "utf8");
    const scheduled = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 7, 12)
    });

    expect(startup).toMatchObject({ status: "completed", scheduledLocalTime: "07:00", sentChapterCount: 1 });
    expect(scheduled).toMatchObject({ status: "completed", scheduledLocalTime: "07:10", sentChapterCount: 1 });
    expect(sentMessages.join("\n")).toContain("十分钟后修改的正文。");
  });

  it("detects a changed .Book chapter across the midnight sync boundary", async () => {
    const { dir, project, service, sentMessages } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const bookFilePath = join(projectBookDir, "chapter-midnight.Book");
    writeFileSync(bookFilePath, "第二章\n午夜前的正文。", "utf8");

    const beforeMidnight = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 19, 23, 58));
    sentMessages.length = 0;
    writeFileSync(bookFilePath, "第二章\n午夜后的正文。", "utf8");
    const afterMidnight = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 20, 0, 8)
    });

    expect(beforeMidnight).toMatchObject({
      status: "completed",
      scheduledLocalTime: "23:50",
      scheduledSlotKey: "2026-05-19T23:50"
    });
    expect(afterMidnight).toMatchObject({
      status: "completed",
      scheduledLocalTime: "00:00",
      scheduledSlotKey: "2026-05-20T00:00",
      sentChapterCount: 1
    });
    expect(sentMessages.join("\n")).toContain("午夜后的正文。");
  });

  it("does not resend when ignored .Book metadata changes but chapter content stays the same", async () => {
    const { dir, project, service, sentMessages } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const bookFilePath = join(projectBookDir, "chapter-with-metadata.Book");
    writeFileSync(bookFilePath, "更新时间: 2026-05-19 07:00\n\n第二章\n第二章正文。", "utf8");

    const first = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 7, 0)
    });
    sentMessages.length = 0;
    writeFileSync(bookFilePath, "更新时间: 2026-05-19 09:00\n\n第二章\n第二章正文。", "utf8");
    const unchangedPayload = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 9, 0)
    });

    expect(first).toMatchObject({ status: "completed", scheduledLocalTime: "07:00", sentChapterCount: 1, sentMissingChapterCount: 1 });
    expect(unchangedPayload).toMatchObject({ status: "skipped", scheduledLocalTime: "09:00", sentChapterCount: 0, sentMissingChapterCount: 0 });
    expect(sentMessages).toEqual([]);
  });

  it("does not trust legacy whole-file sent hashes after the chapter hash format changes", async () => {
    const { db, dir, project, service, sentMessages } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const bookText = "更新时间: 2026-05-19 07:00\n\n第二章\n第二章正文。";
    writeFileSync(join(projectBookDir, "legacy-hash.Book"), bookText, "utf8");
    new SettingsRepository(db).setJson(`externalBookSyncSentChapters:${project.id}`, [
      {
        id: "external_book_sent_legacy",
        projectId: project.id,
        chapterIdentity: "ordinal:2",
        kind: "missing_chapter",
        title: "第二章",
        ordinal: 2,
        sourceContentHash: sha256(bookText),
        sentAt: "2026-05-19T07:00:00.000Z"
      }
    ]);

    const run = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 9, 0)
    });

    expect(run).toMatchObject({ status: "completed", scheduledLocalTime: "09:00", sentChapterCount: 1, sentMissingChapterCount: 1 });
    expect(sentMessages.join("\n")).toContain("缺失章节：第二章");
    expect(sentMessages.join("\n")).toContain("第二章正文。");
  });

  it("clears sent chapter hashes so unchanged chapters can be sent again", async () => {
    const { dir, project, service, sentMessages } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    writeFileSync(join(projectBookDir, "clear-hash.Book"), "第二章\n第二章正文。", "utf8");

    const first = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 7, 0)
    });
    const skipped = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 9, 0)
    });
    const cleared = service.clearSentHistory(project.id);
    const resent = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 11, 0)
    });

    expect(first).toMatchObject({ status: "completed", scheduledLocalTime: "07:00", sentChapterCount: 1 });
    expect(skipped).toMatchObject({ status: "skipped", scheduledLocalTime: "09:00", sentChapterCount: 0 });
    expect(cleared.deletedCount).toBe(1);
    expect(resent).toMatchObject({ status: "completed", scheduledLocalTime: "11:00", sentChapterCount: 1 });
    expect(sentMessages.filter((message) => message.includes("缺失章节：第二章"))).toHaveLength(2);
  });

  it("does not treat a sent hash as unchanged when the stored chapter title does not match", async () => {
    const { db, dir, project, service, sentMessages } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const bookText = "第二章\n第二章正文。";
    writeFileSync(join(projectBookDir, "title-hash.Book"), bookText, "utf8");
    new SettingsRepository(db).setJson(`externalBookSyncSentChapters:${project.id}`, [
      {
        id: "external_book_sent_wrong_title",
        projectId: project.id,
        chapterIdentity: "ordinal:2",
        kind: "missing_chapter",
        title: "第三章",
        ordinal: 2,
        sourceContentHash: sha256(bookText),
        sentAt: "2026-05-19T07:00:00.000Z"
      }
    ]);

    const run = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 9, 0)
    });

    expect(run).toMatchObject({ status: "completed", scheduledLocalTime: "09:00", sentChapterCount: 1, sentMissingChapterCount: 1 });
    expect(sentMessages.join("\n")).toContain("缺失章节：第二章");
  });

  it("sends only the changed one-chapter .Book file after multiple chapters were already sent", async () => {
    const { dir, project, chapterRepo, service, sentMessages } = createFixture();
    const firstChapter = chapterRepo.listByProject(project.id)[0];
    chapterRepo.rename(firstChapter.id, "第52章", "2026-05-18T01:00:00.000Z");
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const chapter53Path = join(projectBookDir, "mxh53random.Book");
    const chapter54Path = join(projectBookDir, "abz54random.Book");
    const chapter55Path = join(projectBookDir, "qpl55random.Book");
    writeFileSync(chapter53Path, "第53章\n第53章初始正文。", "utf8");
    writeFileSync(chapter54Path, "第54章\n第54章初始正文。", "utf8");
    writeFileSync(chapter55Path, "第55章\n第55章初始正文。", "utf8");

    const firstRun = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 7, 0)
    });
    sentMessages.length = 0;
    writeFileSync(chapter54Path, "第54章\n第54章修改后的正文。", "utf8");
    const secondRun = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 9, 0)
    });
    const secondBody = sentMessages.join("\n");

    expect(firstRun).toMatchObject({ status: "completed", scheduledLocalTime: "07:00", sentChapterCount: 3, sentMissingChapterCount: 3 });
    expect(secondRun).toMatchObject({ status: "completed", scheduledLocalTime: "09:00", sentChapterCount: 1, sentMissingChapterCount: 1 });
    expect(secondBody).toContain("缺失章节：第54章");
    expect(secondBody).toContain("第54章修改后的正文。");
    expect(secondBody).not.toContain("缺失章节：第53章");
    expect(secondBody).not.toContain("第53章初始正文。");
    expect(secondBody).not.toContain("缺失章节：第55章");
    expect(secondBody).not.toContain("第55章初始正文。");
  });

  it("revalidates legacy saved source folders instead of staying locked to an old folder", async () => {
    const { db, dir, project, chapterRepo, service, sentMessages } = createFixture();
    const firstChapter = chapterRepo.listByProject(project.id)[0];
    chapterRepo.rename(firstChapter.id, "第55章", "2026-05-18T01:00:00.000Z");
    const wrongBookDir = join(dir, "archive", "举足无措");
    const currentBookDir = join(dir, "举足无措");
    mkdirSync(wrongBookDir, { recursive: true });
    mkdirSync(currentBookDir, { recursive: true });
    const wrongBookPath = join(wrongBookDir, "old-random.Book");
    const currentBookPath = join(currentBookDir, "current-random.Book");
    writeFileSync(wrongBookPath, "第56章\n旧保存目录里的第56章正文。", "utf8");
    writeFileSync(currentBookPath, "第56章\n当前目录里的第56章正文。", "utf8");
    utimesSync(wrongBookPath, new Date("2026-05-19T07:00:00.000Z"), new Date("2026-05-19T07:00:00.000Z"));
    utimesSync(currentBookPath, new Date("2026-05-19T09:00:00.000Z"), new Date("2026-05-19T09:00:00.000Z"));
    new SettingsRepository(db).setJson(`externalBookSyncSources:${project.id}`, [
      {
        id: "external_book_source_legacy",
        projectId: project.id,
        bookFolderPath: wrongBookDir,
        displayName: "old-random.Book",
        lastKnownSize: 100,
        lastModifiedAt: "2026-05-19T07:00:00.000Z",
        lastContentHash: "legacy-hash",
        lastScanAt: "2026-05-19T07:00:00.000Z",
        confirmedAt: "2026-05-19T07:00:00.000Z"
      }
    ]);

    const run = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 9, 0)
    });
    const sentBody = sentMessages.join("\n");

    expect(run).toMatchObject({ status: "completed", scheduledLocalTime: "09:00", sentChapterCount: 1, sentMissingChapterCount: 1 });
    expect(sentBody).toContain("当前目录里的第56章正文。");
    expect(sentBody).not.toContain("旧保存目录里的第56章正文。");
  });

  it("uses the newest .Book file when duplicate random-name files contain the same missing chapter", async () => {
    const { dir, project, chapterRepo, service, sentMessages } = createFixture();
    const firstChapter = chapterRepo.listByProject(project.id)[0];
    chapterRepo.rename(firstChapter.id, "第55章", "2026-05-18T01:00:00.000Z");
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const oldFilePath = join(projectBookDir, "aaaa-old-random.Book");
    const newFilePath = join(projectBookDir, "zzzz-new-random.Book");
    writeFileSync(oldFilePath, "第56章\n旧版第56章正文。", "utf8");
    writeFileSync(newFilePath, "第56章\n最新版第56章正文。", "utf8");
    utimesSync(oldFilePath, new Date("2026-05-19T07:00:00.000Z"), new Date("2026-05-19T07:00:00.000Z"));
    utimesSync(newFilePath, new Date("2026-05-19T09:00:00.000Z"), new Date("2026-05-19T09:00:00.000Z"));

    const run = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 9, 0)
    });
    const sentBody = sentMessages.join("\n");

    expect(run).toMatchObject({ status: "completed", scheduledLocalTime: "09:00", sentChapterCount: 1, sentMissingChapterCount: 1 });
    expect(sentBody).toContain("缺失章节：第56章");
    expect(sentBody).toContain("最新版第56章正文。");
    expect(sentBody).not.toContain("旧版第56章正文。");
  });

  it("uses the newest .Book file when duplicate random-name files contain the current project latest chapter", async () => {
    const { dir, project, chapterRepo, service, sentMessages } = createFixture();
    const firstChapter = chapterRepo.listByProject(project.id)[0];
    chapterRepo.rename(firstChapter.id, "第53章", "2026-05-18T01:00:00.000Z");
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const oldFilePath = join(projectBookDir, "aaaa-old-latest.Book");
    const newFilePath = join(projectBookDir, "zzzz-new-latest.Book");
    writeFileSync(oldFilePath, "第53章\n旧版第53章正文。", "utf8");
    writeFileSync(newFilePath, "第53章\n最新版第53章正文。", "utf8");
    utimesSync(oldFilePath, new Date("2026-05-19T07:00:00.000Z"), new Date("2026-05-19T07:00:00.000Z"));
    utimesSync(newFilePath, new Date("2026-05-19T09:00:00.000Z"), new Date("2026-05-19T09:00:00.000Z"));

    const run = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 9, 0)
    });
    const sentBody = sentMessages.join("\n");

    expect(run).toMatchObject({ status: "completed", scheduledLocalTime: "09:00", sentChapterCount: 1, sentMissingChapterCount: 0, sentLatestProjectChapter: true });
    expect(sentBody).toContain("当前项目最新章在 .Book 中的对应内容：第53章");
    expect(sentBody).toContain("最新版第53章正文。");
    expect(sentBody).not.toContain("旧版第53章正文。");
  });

  it("continues filesystem discovery when Windows Search returns only an older random-name .Book file", async () => {
    const indexSearch = vi.fn<NonNullable<ExternalBookSyncServiceDeps["searchBookFilesInWindowsIndex"]>>();
    const { dir, project, chapterRepo, service, sentMessages } = createFixture({
      searchBookFilesInWindowsIndex: indexSearch
    });
    const firstChapter = chapterRepo.listByProject(project.id)[0];
    chapterRepo.rename(firstChapter.id, "第55章", "2026-05-18T01:00:00.000Z");
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const oldFilePath = join(projectBookDir, "indexed-old-random.Book");
    const newFilePath = join(projectBookDir, "not-indexed-new-random.Book");
    writeFileSync(oldFilePath, "第56章\n索引里的旧版第56章正文。", "utf8");
    writeFileSync(newFilePath, "第56章\n文件系统里的最新版第56章正文。", "utf8");
    utimesSync(oldFilePath, new Date("2026-05-19T07:00:00.000Z"), new Date("2026-05-19T07:00:00.000Z"));
    utimesSync(newFilePath, new Date("2026-05-19T09:00:00.000Z"), new Date("2026-05-19T09:00:00.000Z"));
    indexSearch.mockResolvedValue({ status: "completed", files: [oldFilePath] });

    const run = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 9, 0)
    });
    const sentBody = sentMessages.join("\n");

    expect(indexSearch).toHaveBeenCalled();
    expect(run).toMatchObject({ status: "completed", scheduledLocalTime: "09:00", sentChapterCount: 1, sentMissingChapterCount: 1 });
    expect(sentBody).toContain("文件系统里的最新版第56章正文。");
    expect(sentBody).not.toContain("索引里的旧版第56章正文。");
  });

  it("remembers every sent hash for a chapter so removed newer files do not cause old content to resend", async () => {
    const { dir, project, chapterRepo, service, sentMessages } = createFixture();
    const firstChapter = chapterRepo.listByProject(project.id)[0];
    chapterRepo.rename(firstChapter.id, "第55章", "2026-05-18T01:00:00.000Z");
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    const oldFilePath = join(projectBookDir, "old-random.Book");
    const newFilePath = join(projectBookDir, "new-random.Book");
    writeFileSync(oldFilePath, "第56章\n旧版第56章正文。", "utf8");
    utimesSync(oldFilePath, new Date("2026-05-19T07:00:00.000Z"), new Date("2026-05-19T07:00:00.000Z"));

    const oldRun = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 7, 0)
    });
    writeFileSync(newFilePath, "第56章\n新版第56章正文。", "utf8");
    utimesSync(newFilePath, new Date("2026-05-19T09:00:00.000Z"), new Date("2026-05-19T09:00:00.000Z"));
    const newRun = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 9, 0)
    });
    unlinkSync(newFilePath);
    const staleFallbackRun = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 11, 0)
    });

    expect(oldRun).toMatchObject({ status: "completed", scheduledLocalTime: "07:00", sentChapterCount: 1 });
    expect(newRun).toMatchObject({ status: "completed", scheduledLocalTime: "09:00", sentChapterCount: 1 });
    expect(staleFallbackRun).toMatchObject({ status: "skipped", scheduledLocalTime: "11:00", sentChapterCount: 0 });
    expect(sentMessages.filter((message) => message.includes("缺失章节：第56章"))).toHaveLength(2);
    expect(sentMessages.join("\n")).toContain("旧版第56章正文。");
    expect(sentMessages.join("\n")).toContain("新版第56章正文。");
  });

  it.each([
    ["429 rate limit", "OpenRouter 请求失败 (429)：上游 Provider 限流或暂时不可用。"],
    ["503 provider outage", "OpenRouter 请求失败 (503)：Service Unavailable"],
    ["network timeout", "OpenRouter 请求失败：timeout of 30000ms exceeded"]
  ])("retries retryable automatic send failures after five minutes (%s)", async (_caseName, errorMessage) => {
    const sentMessages: string[] = [];
    let sendAttempts = 0;
    const { dir, project, service } = createFixture({
      async sendChatMessage(input) {
        sendAttempts += 1;
        if (sendAttempts === 1) {
          throw new Error(errorMessage);
        }
        sentMessages.push(input.message);
      }
    });
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    writeFirstAndSecondBookFiles(projectBookDir);
    await service.scanProject({
      projectId: project.id,
      mode: "directory",
      directoryPath: dir,
      roots: [dir],
      timeBudgetMs: 10_000
    });

    const failed = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 7, 0)
    });
    expect(service.hasDueAutomaticSync(project.id, new Date(2026, 4, 19, 7, 4))).toBe(false);
    expect(service.hasDueAutomaticSync(project.id, new Date(2026, 4, 19, 7, 5))).toBe(true);

    const tooSoon = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 7, 4)
    });
    const retried = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 7, 5)
    });

    expect(failed).toMatchObject({ status: "failed", scheduledLocalTime: "07:00", error: errorMessage });
    expect(tooSoon).toBeNull();
    expect(retried).toMatchObject({ status: "completed", scheduledLocalTime: "07:00", sentChapterCount: 2 });
    expect(sendAttempts).toBe(3);
    expect(sentMessages.join("\n")).toContain("缺失章节：第二章");
  });

  it("does not retry non-transient automatic send failures in the same sync slot", async () => {
    let sendAttempts = 0;
    const { dir, project, service } = createFixture({
      async sendChatMessage() {
        sendAttempts += 1;
        throw new Error("没有可用的 OpenRouter API Key。");
      }
    });
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    writeFirstAndSecondBookFiles(projectBookDir);
    await service.scanProject({
      projectId: project.id,
      mode: "directory",
      directoryPath: dir,
      roots: [dir],
      timeBudgetMs: 10_000
    });

    const failed = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 7, 0)
    });
    const retry = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 7, 5)
    });

    expect(failed).toMatchObject({ status: "failed", error: expect.stringContaining("API Key") });
    expect(retry).toBeNull();
    expect(sendAttempts).toBe(1);
  });

  it("retries a persisted retryable failure on startup after reopening the app", async () => {
    const sentMessages: string[] = [];
    let sendAttempts = 0;
    const { db, dir, project, projectRepo, service } = createFixture({
      async sendChatMessage() {
        sendAttempts += 1;
        throw new Error("OpenRouter 请求失败 (429)：上游 Provider 限流或暂时不可用。");
      }
    });
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    writeFirstAndSecondBookFiles(projectBookDir);
    await service.scanProject({
      projectId: project.id,
      mode: "directory",
      directoryPath: dir,
      roots: [dir],
      timeBudgetMs: 10_000
    });

    const failed = await service.runDueAutomaticSync({
      projectId: project.id,
      trigger: "scheduled",
      now: new Date(2026, 4, 19, 7, 0)
    });
    const reopenedService = createReopenedService({
      db,
      projectRepo,
      async sendChatMessage(input) {
        sendAttempts += 1;
        sentMessages.push(input.message);
      }
    });
    const startupRetry = await reopenedService.runStartupCatchUpSync(project.id, new Date(2026, 4, 19, 7, 6));

    expect(failed).toMatchObject({ status: "failed", trigger: "scheduled", scheduledLocalTime: "07:00" });
    expect(startupRetry).toMatchObject({
      status: "completed",
      trigger: "startup",
      scheduledLocalTime: "07:00",
      sentChapterCount: 2,
      sentMissingChapterCount: 1,
      sentLatestProjectChapter: true
    });
    expect(sendAttempts).toBe(3);
    expect(sentMessages.join("\n")).toContain("缺失章节：第二章");
    expect(sentMessages.join("\n")).toContain("当前项目最新章在 .Book 中的对应内容");
  });

  it("checks on every startup but skips unchanged chapters that were already sent", async () => {
    const { dir, project, service, sentMessages } = createFixture();
    const projectBookDir = join(dir, "举足无措");
    mkdirSync(projectBookDir, { recursive: true });
    writeFirstAndSecondBookFiles(projectBookDir);
    await service.scanProject({
      projectId: project.id,
      mode: "directory",
      directoryPath: dir,
      roots: [dir],
      timeBudgetMs: 10_000
    });

    const morning = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 19, 6, 59));
    const startup = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 19, 11, 30));
    const duplicateStartup = await service.runStartupCatchUpSync(project.id, new Date(2026, 4, 19, 11, 45));

    expect(morning).toMatchObject({ trigger: "startup", scheduledLocalTime: "06:50", scheduledSlotKey: "2026-05-19T06:50", sentChapterCount: 2 });
    expect(startup).toMatchObject({ trigger: "startup", scheduledLocalTime: "11:30", status: "skipped", candidateCount: 2, sentChapterCount: 0 });
    expect(duplicateStartup).toMatchObject({ trigger: "startup", scheduledLocalTime: "11:40", status: "skipped", candidateCount: 2, sentChapterCount: 0 });
    expect(sentMessages.filter((message) => message.includes("缺失章节：第二章"))).toHaveLength(1);
  });
});
