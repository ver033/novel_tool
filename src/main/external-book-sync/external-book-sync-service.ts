import { createHash } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChapterRepository } from "../db/repositories/chapter-repo";
import type { ProjectRepository } from "../db/repositories/project-repo";
import { detectTxtChapters } from "../import/chapter-detector";
import { readTextFile } from "../import/txt-reader";
import { createId } from "../shared/ids";
import type { ImportPreviewChapter } from "../shared/types";
import {
  compareExternalBookChapters,
  type ExternalBookComparisonResult,
  type ExternalBookMissingChapter,
  type ExternalBookReferenceChapter
} from "./book-chapter-compare";
import { buildExternalBookSyncChatMessages } from "./book-prompt-builder";
import {
  ExternalBookSyncAutomationStore,
  type ExternalBookSyncAutomaticRunRecord,
  type ExternalBookSyncAutomaticRunStatus,
  type ExternalBookSyncAutomaticTrigger
} from "./book-automation-store";
import { ExternalBookSourceStore, type ExternalBookSyncSource } from "./book-source-store";
import { isBookFilePath, isPathInsideProjectBookFolder } from "./book-project-folder";
import { scanBookFiles, type BookFileScanProgress, type BookFileScanResult } from "./filesystem-book-scanner";
import { searchWindowsIndexForBookFiles } from "./windows-index-search";

const DEFAULT_SCAN_BUDGET_MS = 180_000;
const WINDOWS_INDEX_TIMEOUT_MS = 15_000;
const MAX_BOOK_BYTES = 20 * 1024 * 1024;
const AUTOMATIC_SYNC_SCHEDULE_LOCAL_TIMES = ["07:00", "11:00", "23:00"] as const;

export type ExternalBookSyncMode = "quick" | "global" | "directory";
export type ExternalBookSyncSearchTrigger = ExternalBookSyncAutomaticTrigger | "manual";

export type ExternalBookMissingChapterPreview = Omit<ExternalBookMissingChapter, "text"> & {
  readonly textLength: number;
};

export type ExternalBookReferenceChapterPreview = Omit<ExternalBookReferenceChapter, "text"> & {
  readonly textLength: number;
};

export type ExternalBookComparisonPreviewResult = Omit<ExternalBookComparisonResult, "missingChapters" | "latestProjectChapterInExternal"> & {
  readonly latestProjectChapterInExternal: ExternalBookReferenceChapterPreview | null;
  readonly missingChapters: readonly ExternalBookMissingChapterPreview[];
};

export type ExternalBookSyncCandidate = {
  readonly id: string;
  readonly projectId: string;
  readonly filePath: string;
  readonly fileName: string;
  readonly size: number;
  readonly modifiedAt: string | null;
  readonly contentHash: string;
  readonly encoding: string;
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
  readonly detectedChapterCount: number;
  readonly comparison: ExternalBookComparisonPreviewResult;
};

export type ExternalBookSyncStatus = {
  readonly projectId: string;
  readonly sources: readonly ExternalBookSyncSource[];
  readonly search: ExternalBookSyncSearchStatus;
  readonly latestAutomaticRun: ExternalBookSyncAutomaticRunRecord | null;
};

export type ExternalBookSyncSearchStatus = {
  readonly isRunning: boolean;
  readonly mode: ExternalBookSyncMode | null;
  readonly trigger: ExternalBookSyncSearchTrigger | null;
  readonly startedAt: string | null;
};

export type ExternalBookSyncScanInput = {
  readonly projectId: string;
  readonly mode: ExternalBookSyncMode;
  readonly directoryPath?: string;
  readonly roots?: readonly string[];
  readonly timeBudgetMs?: number;
  readonly searchTrigger?: ExternalBookSyncSearchTrigger;
};

export type ExternalBookSyncScanResult = {
  readonly projectId: string;
  readonly candidates: readonly ExternalBookSyncCandidate[];
  readonly scan: BookFileScanResult | null;
  readonly warnings: readonly string[];
  readonly searchedRoots: readonly string[];
  readonly completedAt: string;
};

export type ExternalBookSyncSendResult = {
  readonly sessionId: string;
  readonly sessionTitle: string;
  readonly sentMessageCount: number;
  readonly sentChapterCount: number;
  readonly sentMissingChapterCount: number;
  readonly sentLatestProjectChapter: boolean;
};

export type ExternalBookSyncAutomaticInput = {
  readonly projectId: string;
  readonly trigger: ExternalBookSyncAutomaticTrigger;
  readonly now?: Date;
};

export type ExternalBookAiSender = {
  readonly createChatSession: (input: { readonly projectId: string; readonly title: string }) => Promise<{ readonly id: string; readonly title: string }> | { readonly id: string; readonly title: string };
  readonly sendChatMessage: (input: { readonly requestId: string; readonly projectId: string; readonly sessionId: string; readonly message: string }) => Promise<void>;
};

export type ExternalBookSyncServiceDeps = {
  readonly sourceStore: ExternalBookSourceStore;
  readonly automationStore: ExternalBookSyncAutomationStore;
  readonly resolveChapterRepo: (projectId: string) => ChapterRepository;
  readonly projectRepo: ProjectRepository;
  readonly aiSender: ExternalBookAiSender;
};

export type ExternalBookSyncHandlers = {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: BookFileScanProgress) => void;
};

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

function parseScheduleMinutes(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(value);
  if (!match) {
    throw new Error(`自动同步检查时间无效：${value}`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToLocalTime(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

function latestDueSyncSlot(now: Date): { readonly localTime: string; readonly slotDate: Date } {
  const current = now.getHours() * 60 + now.getMinutes();
  const sorted = AUTOMATIC_SYNC_SCHEDULE_LOCAL_TIMES.map(parseScheduleMinutes).sort((a, b) => a - b);
  const due = sorted.filter((minutes) => minutes <= current).at(-1);
  if (due !== undefined) {
    return {
      localTime: minutesToLocalTime(due),
      slotDate: now
    };
  }
  const previousDate = new Date(now);
  previousDate.setDate(previousDate.getDate() - 1);
  return {
    localTime: minutesToLocalTime(sorted.at(-1) ?? 0),
    slotDate: previousDate
  };
}

function scheduledSyncSlotKey(slotDate: Date, localTimeValue: string): string {
  return `${localDateKey(slotDate)}T${localTimeValue}`;
}

type CandidateComparisonStats = Pick<ExternalBookComparisonResult, "currentLatestOrdinal" | "currentChapterCount" | "externalLatestOrdinal"> & {
  readonly missingChapters: readonly unknown[];
};

type LoadedExternalBookCandidate = {
  readonly candidate: ExternalBookSyncCandidate;
  readonly fullComparison: ExternalBookComparisonResult;
};

type ActiveExternalBookSearch = {
  readonly projectId: string;
  readonly mode: ExternalBookSyncMode;
  readonly trigger: ExternalBookSyncSearchTrigger;
  readonly startedAt: string;
};

function candidateReasons(comparison: CandidateComparisonStats): string[] {
  const reasons: string[] = [];
  if (comparison.externalLatestOrdinal !== null) {
    reasons.push(`外部最新章节序号：${comparison.externalLatestOrdinal}`);
  }
  if (comparison.currentLatestOrdinal !== null) {
    reasons.push(`当前项目最新章节序号：${comparison.currentLatestOrdinal}`);
  } else {
    reasons.push(`当前项目章节数：${comparison.currentChapterCount}`);
  }
  reasons.push(`检测到 ${comparison.missingChapters.length} 个缺失章节`);
  return reasons;
}

function candidateIdForPath(projectId: string, filePath: string): string {
  const hash = createHash("sha1").update(`${projectId}:${filePath}`).digest("hex").slice(0, 24);
  return `external_book_candidate_${hash}`;
}

function defaultRoots(projectRootPath: string | null): string[] {
  const roots = new Set<string>();
  if (projectRootPath) {
    roots.add(path.dirname(projectRootPath));
    roots.add(path.parse(projectRootPath).root);
  }
  const home = os.homedir();
  if (home) {
    roots.add(path.join(home, "Documents"));
    roots.add(path.join(home, "Desktop"));
    roots.add(path.join(home, "Downloads"));
    roots.add(home);
  }
  return [...roots].filter((root) => root && existsSync(root));
}

function automaticDiscoveryRoots(projectRootPath: string | null): string[] {
  const roots = new Set<string>();
  if (projectRootPath) {
    roots.add(path.dirname(projectRootPath));
  }
  const home = os.homedir();
  if (home) {
    roots.add(path.join(home, "Documents"));
    roots.add(path.join(home, "Desktop"));
    roots.add(path.join(home, "Downloads"));
  }
  return [...roots].filter((root) => root && existsSync(root));
}

function redactChapterText<T extends { readonly text: string }>(chapter: T): Omit<T, "text"> & { readonly textLength: number } {
  const { text: _text, ...preview } = chapter;
  return {
    ...preview,
    textLength: chapter.text.length
  };
}

function redactComparison(comparison: ExternalBookComparisonResult): ExternalBookComparisonPreviewResult {
  return {
    ...comparison,
    latestProjectChapterInExternal: comparison.latestProjectChapterInExternal ? redactChapterText(comparison.latestProjectChapterInExternal) : null,
    missingChapters: comparison.missingChapters.map((chapter) => redactChapterText(chapter))
  };
}

function selectedChapters(comparison: ExternalBookComparisonResult, chapterKeys: readonly string[]): ExternalBookMissingChapter[] {
  const keySet = new Set(chapterKeys);
  return comparison.missingChapters.filter((chapter) => keySet.has(chapter.key));
}

function sourceBookFilePath(source: ExternalBookSyncSource): string {
  const joiner = source.bookFolderPath.includes("\\") ? path.win32 : path;
  return joiner.join(source.bookFolderPath, source.displayName);
}

function shouldSendCandidateToAi(candidate: ExternalBookSyncCandidate): boolean {
  return candidate.comparison.missingChapters.length > 0 || candidate.comparison.latestProjectChapterInExternal !== null;
}

export class ExternalBookSyncService {
  private readonly candidatesById = new Map<string, ExternalBookSyncCandidate>();
  private readonly activeSearchesById = new Map<string, ActiveExternalBookSearch>();

  constructor(private readonly deps: ExternalBookSyncServiceDeps) {}

  getStatus(projectId: string): ExternalBookSyncStatus {
    return {
      projectId,
      sources: this.deps.sourceStore.listSources(projectId),
      search: this.getActiveSearchStatus(projectId),
      latestAutomaticRun: this.deps.automationStore.listRuns(projectId)[0] ?? null
    };
  }

  previewCandidate(projectId: string, candidateId: string): ExternalBookSyncCandidate {
    const candidate = this.candidatesById.get(candidateId);
    if (!candidate || candidate.projectId !== projectId) {
      throw new Error("外部 .Book 候选不存在，请重新扫描。");
    }
    return candidate;
  }

  forgetSource(projectId: string, sourceId: string): { readonly ok: true } {
    this.deps.sourceStore.forgetSource(projectId, sourceId);
    return { ok: true };
  }

  private getActiveSearchStatus(projectId: string): ExternalBookSyncSearchStatus {
    const activeSearch = [...this.activeSearchesById.values()].find((search) => search.projectId === projectId);
    if (!activeSearch) {
      return {
        isRunning: false,
        mode: null,
        trigger: null,
        startedAt: null
      };
    }
    return {
      isRunning: true,
      mode: activeSearch.mode,
      trigger: activeSearch.trigger,
      startedAt: activeSearch.startedAt
    };
  }

  private beginSearch(input: {
    readonly projectId: string;
    readonly mode: ExternalBookSyncMode;
    readonly trigger: ExternalBookSyncSearchTrigger;
  }): () => void {
    const searchId = createId("external_book_search");
    this.activeSearchesById.set(searchId, {
      projectId: input.projectId,
      mode: input.mode,
      trigger: input.trigger,
      startedAt: new Date().toISOString()
    });
    return () => {
      this.activeSearchesById.delete(searchId);
    };
  }

  private rememberCandidateSource(candidate: ExternalBookSyncCandidate, scannedAt: string): void {
    const bookFolderPath = path.dirname(candidate.filePath);
    const existing = this.deps.sourceStore.listSources(candidate.projectId).find((source) => sourceBookFilePath(source) === candidate.filePath);
    this.deps.sourceStore.upsertSource({
      id: existing?.id,
      projectId: candidate.projectId,
      bookFolderPath,
      displayName: candidate.fileName,
      lastKnownSize: candidate.size,
      lastModifiedAt: candidate.modifiedAt,
      lastContentHash: candidate.contentHash,
      lastScanAt: scannedAt,
      confirmedAt: existing?.confirmedAt ?? scannedAt
    });
  }

  hasDueAutomaticSync(projectId: string, now = new Date()): boolean {
    if (this.deps.sourceStore.listSources(projectId).length === 0) {
      return true;
    }
    const dueSlot = latestDueSyncSlot(now);
    return !this.deps.automationStore.getRunBySlot(projectId, scheduledSyncSlotKey(dueSlot.slotDate, dueSlot.localTime));
  }

  runStartupCatchUpSync(projectId: string, now = new Date()): Promise<ExternalBookSyncAutomaticRunRecord | null> {
    return this.runDueAutomaticSync({ projectId, trigger: "startup", now });
  }

  async runDueAutomaticSync(input: ExternalBookSyncAutomaticInput): Promise<ExternalBookSyncAutomaticRunRecord | null> {
    const now = input.now ?? new Date();
    const dueSlot = latestDueSyncSlot(now);
    const slotKey = scheduledSyncSlotKey(dueSlot.slotDate, dueSlot.localTime);
    const savedSourcesBeforeRun = this.deps.sourceStore.listSources(input.projectId);
    const shouldRetryStartupDiscovery = input.trigger === "startup" && savedSourcesBeforeRun.length === 0;
    if (!shouldRetryStartupDiscovery && this.deps.automationStore.getRunBySlot(input.projectId, slotKey)) {
      return null;
    }

    const startedAt = now.toISOString();
    const running = this.deps.automationStore.upsertRun({
      projectId: input.projectId,
      trigger: input.trigger,
      scheduledSlotKey: slotKey,
      scheduledLocalTime: dueSlot.localTime,
      status: "running",
      candidateCount: 0,
      sentMessageCount: 0,
      sentChapterCount: 0,
      sentMissingChapterCount: 0,
      sentLatestProjectChapter: false,
      error: null,
      requestedAt: startedAt,
      completedAt: null
    });

    try {
      const savedSources = savedSourcesBeforeRun;
      const project = savedSources.length === 0 ? this.deps.projectRepo.findById(input.projectId) : null;
      let scan = await this.scanProject({
        projectId: input.projectId,
        mode: "quick",
        roots: savedSources.length > 0 ? [] : automaticDiscoveryRoots(project?.rootPath ?? null),
        searchTrigger: input.trigger
      });
      if (savedSources.length === 0 && scan.candidates.length === 0) {
        scan = await this.scanProject({
          projectId: input.projectId,
          mode: "global",
          roots: defaultRoots(project?.rootPath ?? null),
          searchTrigger: input.trigger
        });
      }
      const candidate = scan.candidates.find(shouldSendCandidateToAi);
      if (!candidate) {
        return this.completeAutomaticRun(running, "skipped", {
          candidateCount: scan.candidates.length,
          sentMessageCount: 0,
          sentChapterCount: 0,
          sentMissingChapterCount: 0,
          sentLatestProjectChapter: false,
          error: null
        });
      }
      const sent = await this.sendMissingChaptersToAi({
        projectId: input.projectId,
        candidateId: candidate.id,
        chapterKeys: candidate.comparison.missingChapters.map((chapter) => chapter.key)
      });
      return this.completeAutomaticRun(running, "completed", {
        candidateCount: scan.candidates.length,
        sentMessageCount: sent.sentMessageCount,
        sentChapterCount: sent.sentChapterCount,
        sentMissingChapterCount: sent.sentMissingChapterCount,
        sentLatestProjectChapter: sent.sentLatestProjectChapter,
        error: null
      });
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason);
      return this.completeAutomaticRun(running, "failed", {
        candidateCount: 0,
        sentMessageCount: 0,
        sentChapterCount: 0,
        sentMissingChapterCount: 0,
        sentLatestProjectChapter: false,
        error
      });
    }
  }

  private completeAutomaticRun(
    run: ExternalBookSyncAutomaticRunRecord,
    status: ExternalBookSyncAutomaticRunStatus,
    result: {
      readonly candidateCount: number;
      readonly sentMessageCount: number;
      readonly sentChapterCount: number;
      readonly sentMissingChapterCount: number;
      readonly sentLatestProjectChapter: boolean;
      readonly error: string | null;
    }
  ): ExternalBookSyncAutomaticRunRecord {
    return this.deps.automationStore.upsertRun({
      ...run,
      status,
      candidateCount: result.candidateCount,
      sentMessageCount: result.sentMessageCount,
      sentChapterCount: result.sentChapterCount,
      sentMissingChapterCount: result.sentMissingChapterCount,
      sentLatestProjectChapter: result.sentLatestProjectChapter,
      error: result.error,
      completedAt: new Date().toISOString()
    });
  }

  async scanProject(input: ExternalBookSyncScanInput, handlers: ExternalBookSyncHandlers = {}): Promise<ExternalBookSyncScanResult> {
    const project = this.deps.projectRepo.findById(input.projectId);
    if (!project) {
      throw new Error("项目不存在，无法检查外部 .Book。");
    }
    const finishSearch = this.beginSearch({
      projectId: input.projectId,
      mode: input.mode,
      trigger: input.searchTrigger ?? "manual"
    });

    try {
      const warnings: string[] = [];
      const candidatePaths = new Set<string>();
      for (const source of this.deps.sourceStore.listSources(input.projectId)) {
        candidatePaths.add(sourceBookFilePath(source));
      }

      const shouldSearchIndex = input.mode !== "directory" && (input.mode === "global" || candidatePaths.size === 0);
      const indexResult = shouldSearchIndex ? await searchWindowsIndexForBookFiles({ projectName: project.name, timeoutMs: WINDOWS_INDEX_TIMEOUT_MS }) : null;
      if (indexResult?.status === "failed") {
        warnings.push(`Windows Search 查询失败：${indexResult.error}`);
      }
      for (const filePath of indexResult?.files ?? []) {
        candidatePaths.add(filePath);
      }

      const roots = input.roots ?? (input.directoryPath ? [input.directoryPath] : defaultRoots(project.rootPath));
      const shouldScanFileSystem = input.mode === "global" || input.mode === "directory" || candidatePaths.size === 0;
      const scan = shouldScanFileSystem
        ? await scanBookFiles({
            projectName: project.name,
            roots,
            timeBudgetMs: input.timeBudgetMs ?? DEFAULT_SCAN_BUDGET_MS,
            signal: handlers.signal ?? new AbortController().signal,
            onProgress: handlers.onProgress
          })
        : null;
      for (const file of scan?.files ?? []) {
        candidatePaths.add(file.path);
      }

      const candidates: ExternalBookSyncCandidate[] = [];
      const completedAt = new Date().toISOString();
      for (const [candidateId, candidate] of this.candidatesById) {
        if (candidate.projectId === input.projectId) {
          this.candidatesById.delete(candidateId);
        }
      }
      for (const filePath of candidatePaths) {
        const loaded = this.loadCandidate({
          projectId: input.projectId,
          projectName: project.name,
          filePath
        });
        if (loaded) {
          candidates.push(loaded.candidate);
          this.rememberCandidateSource(loaded.candidate, completedAt);
          this.candidatesById.set(loaded.candidate.id, loaded.candidate);
        }
      }

      candidates.sort((a, b) => {
        return (
          b.comparison.missingChapters.length - a.comparison.missingChapters.length ||
          b.detectedChapterCount - a.detectedChapterCount ||
          a.fileName.localeCompare(b.fileName, "zh-CN")
        );
      });

      if (candidates.length === 0) {
        warnings.push("没有在项目同名文件夹下找到可用的 .Book 文件。");
      }

      return {
        projectId: input.projectId,
        candidates,
        scan,
        warnings,
        searchedRoots: roots,
        completedAt
      };
    } finally {
      finishSearch();
    }
  }

  async sendMissingChaptersToAi(input: {
    readonly projectId: string;
    readonly candidateId: string;
    readonly chapterKeys: readonly string[];
  }): Promise<ExternalBookSyncSendResult> {
    const project = this.deps.projectRepo.findById(input.projectId);
    if (!project) {
      throw new Error("项目不存在，无法发送外部章节。");
    }
    const cachedCandidate = this.previewCandidate(input.projectId, input.candidateId);
    const loaded = this.loadCandidate({
      projectId: input.projectId,
      projectName: project.name,
      filePath: cachedCandidate.filePath
    });
    if (!loaded) {
      throw new Error("外部 .Book 候选已不可用，请重新扫描。");
    }
    if (loaded.candidate.contentHash !== cachedCandidate.contentHash) {
      throw new Error("外部 .Book 文件已变化，请重新扫描后再发送。");
    }
    const candidate = loaded.candidate;
    const chapters = selectedChapters(loaded.fullComparison, input.chapterKeys);
    const latestProjectChapterInExternal = loaded.fullComparison.latestProjectChapterInExternal;
    if (chapters.length === 0 && !latestProjectChapterInExternal) {
      throw new Error("没有可发送的外部章节。");
    }
    const session = await this.deps.aiSender.createChatSession({
      projectId: input.projectId,
      title: "外部同步检查"
    });
    const messages = buildExternalBookSyncChatMessages({
      projectName: project.name,
      currentLatestLabel: candidate.comparison.currentLatestOrdinal ? `第${candidate.comparison.currentLatestOrdinal}章` : `${candidate.comparison.currentChapterCount} 章`,
      latestProjectChapterInExternal,
      missingChapters: chapters
    });
    for (const message of messages) {
      await this.deps.aiSender.sendChatMessage({
        requestId: createId("external_book_sync_chat"),
        projectId: input.projectId,
        sessionId: session.id,
        message
      });
    }
    this.rememberCandidateSource(candidate, new Date().toISOString());
    return {
      sessionId: session.id,
      sessionTitle: session.title,
      sentMessageCount: messages.length,
      sentChapterCount: chapters.length + (latestProjectChapterInExternal ? 1 : 0),
      sentMissingChapterCount: chapters.length,
      sentLatestProjectChapter: Boolean(latestProjectChapterInExternal)
    };
  }

  private loadCandidate(input: { readonly projectId: string; readonly projectName: string; readonly filePath: string }): LoadedExternalBookCandidate | null {
    const resolvedFilePath = path.resolve(input.filePath);
    if (!isBookFilePath(resolvedFilePath) || !existsSync(resolvedFilePath)) {
      return null;
    }
    let realFilePath: string;
    try {
      realFilePath = realpathSync(resolvedFilePath);
    } catch {
      return null;
    }
    if (!isBookFilePath(realFilePath) || !isPathInsideProjectBookFolder(realFilePath, input.projectName)) {
      return null;
    }
    const info = statSync(realFilePath);
    if (!info.isFile() || info.size > MAX_BOOK_BYTES) {
      return null;
    }
    const read = readTextFile(realFilePath, { label: ".Book 文件", maxBytes: MAX_BOOK_BYTES });
    const chapters = detectTxtChapters(read.text).filter((chapter: ImportPreviewChapter) => chapter.title.trim() || chapter.text.trim());
    if (chapters.length === 0) {
      return null;
    }
    const fullComparison = compareExternalBookChapters({
      projectChapters: this.deps.resolveChapterRepo(input.projectId).listByProject(input.projectId),
      externalChapters: chapters
    });
    const comparison = redactComparison(fullComparison);
    const warnings = comparison.warnings;
    const candidate: ExternalBookSyncCandidate = {
      id: candidateIdForPath(input.projectId, realFilePath),
      projectId: input.projectId,
      filePath: realFilePath,
      fileName: path.basename(realFilePath),
      size: info.size,
      modifiedAt: info.mtime ? info.mtime.toISOString() : null,
      contentHash: contentHash(read.text),
      encoding: read.encoding,
      reasons: candidateReasons(comparison),
      warnings,
      detectedChapterCount: chapters.length,
      comparison
    };
    return {
      candidate,
      fullComparison
    };
  }
}
