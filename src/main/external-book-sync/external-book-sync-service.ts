import { createHash } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChapterRepository } from "../db/repositories/chapter-repo";
import type { ProjectRepository } from "../db/repositories/project-repo";
import { detectTxtChapters, normalizeTxtContent } from "../import/chapter-detector";
import { readTextFile } from "../import/txt-reader";
import { createId } from "../shared/ids";
import { countWritingUnits } from "../shared/text";
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
import { ExternalBookSentChapterStore } from "./book-send-history-store";
import { CURRENT_EXTERNAL_BOOK_SOURCE_SELECTION_VERSION, ExternalBookSourceStore, type ExternalBookSyncSource } from "./book-source-store";
import { isBookFilePath, isProjectBookFolderPath } from "./book-project-folder";
import { parseChapterOrdinal } from "./book-chapter-ordinal";
import { scanBookFiles, type BookFileScanProgress, type BookFileScanResult } from "./filesystem-book-scanner";
import { searchWindowsIndexForBookFiles } from "./windows-index-search";

const DEFAULT_SCAN_BUDGET_MS = 180_000;
const WINDOWS_INDEX_TIMEOUT_MS = 15_000;
const MAX_BOOK_BYTES = 20 * 1024 * 1024;
const AUTOMATIC_SYNC_SCHEDULE_LOCAL_TIMES = ["07:00", "09:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:00", "23:00"] as const;
const RETRYABLE_AUTOMATIC_SYNC_DELAY_MS = 5 * 60 * 1000;

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
  readonly sentChapterStore: ExternalBookSentChapterStore;
  readonly searchBookFilesInWindowsIndex?: typeof searchWindowsIndexForBookFiles;
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

function chapterPayloadHash(chapter: Pick<ImportPreviewChapter, "title" | "text">): string {
  return contentHash(normalizeTxtContent(`${chapter.title}\n${chapter.text}`));
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

function isRetryableAutomaticSyncError(error: string | null): boolean {
  if (!error) {
    return false;
  }
  const normalized = error.toLowerCase();
  return (
    normalized.includes("429") ||
    normalized.includes("限流") ||
    normalized.includes("rate limit") ||
    normalized.includes("rate-limit") ||
    normalized.includes("rate_limited") ||
    normalized.includes("too many requests") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("超时") ||
    normalized.includes("network") ||
    normalized.includes("network_error") ||
    normalized.includes("fetch failed") ||
    normalized.includes("econnreset") ||
    normalized.includes("econnaborted") ||
    normalized.includes("econnrefused") ||
    normalized.includes("etimedout") ||
    normalized.includes("enotfound") ||
    normalized.includes("eai_again") ||
    normalized.includes("socket hang up") ||
    normalized.includes("temporarily unavailable") ||
    normalized.includes("暂时不可用")
  );
}

function canRetryFailedAutomaticRun(run: ExternalBookSyncAutomaticRunRecord, now: Date): boolean {
  if (run.status !== "failed" || !isRetryableAutomaticSyncError(run.error)) {
    return false;
  }
  const retryFrom = new Date(run.completedAt ?? run.requestedAt);
  return !Number.isNaN(retryFrom.getTime()) && now.getTime() - retryFrom.getTime() >= RETRYABLE_AUTOMATIC_SYNC_DELAY_MS;
}

type CandidateComparisonStats = Pick<ExternalBookComparisonResult, "currentLatestOrdinal" | "currentChapterCount" | "externalLatestOrdinal"> & {
  readonly missingChapters: readonly unknown[];
};

type LoadedExternalBookCandidate = {
  readonly candidate: ExternalBookSyncCandidate;
  readonly fullComparison: ExternalBookComparisonResult;
};

type ExternalBookChapterSendEntry =
  | {
      readonly kind: "latest_project_chapter";
      readonly chapter: ExternalBookReferenceChapter;
      readonly chapterIdentity: string;
      readonly sourceContentHash: string;
      readonly sourceModifiedAt: string | null;
      readonly sourceFilePath: string;
    }
  | {
      readonly kind: "missing_chapter";
      readonly chapter: ExternalBookMissingChapter;
      readonly chapterIdentity: string;
      readonly sourceContentHash: string;
      readonly sourceModifiedAt: string | null;
      readonly sourceFilePath: string;
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

function sourceBookFilePath(source: ExternalBookSyncSource): string | null {
  if (!isBookFilePath(source.displayName)) {
    return null;
  }
  const joiner = source.bookFolderPath.includes("\\") ? path.win32 : path;
  return joiner.join(source.bookFolderPath, source.displayName);
}

function shouldSendCandidateToAi(candidate: ExternalBookSyncCandidate): boolean {
  return candidate.comparison.missingChapters.length > 0 || candidate.comparison.latestProjectChapterInExternal !== null;
}

function missingChapterIdentity(chapter: ExternalBookMissingChapter): string {
  if (chapter.ordinal !== null) {
    return `ordinal:${chapter.ordinal}`;
  }
  return `title:${chapter.title.trim().toLocaleLowerCase("zh-CN")}`;
}

function externalBookChapterIdentity(chapter: Pick<ExternalBookMissingChapter | ExternalBookReferenceChapter, "ordinal" | "title">): string {
  if (chapter.ordinal !== null) {
    return `ordinal:${chapter.ordinal}`;
  }
  return `title:${chapter.title.trim().toLocaleLowerCase("zh-CN")}`;
}

function compareMissingChapters(a: ExternalBookMissingChapter, b: ExternalBookMissingChapter): number {
  if (a.ordinal !== null && b.ordinal !== null && a.ordinal !== b.ordinal) {
    return a.ordinal - b.ordinal;
  }
  if (a.ordinal !== null && b.ordinal === null) {
    return -1;
  }
  if (a.ordinal === null && b.ordinal !== null) {
    return 1;
  }
  return a.title.localeCompare(b.title, "zh-CN") || a.order - b.order;
}

function modifiedTimeValue(value: string | null): number {
  if (!value) {
    return 0;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function compareSendEntryFreshness(a: ExternalBookChapterSendEntry, b: ExternalBookChapterSendEntry): number {
  return (
    modifiedTimeValue(a.sourceModifiedAt) - modifiedTimeValue(b.sourceModifiedAt) ||
    a.sourceContentHash.localeCompare(b.sourceContentHash) ||
    a.sourceFilePath.localeCompare(b.sourceFilePath)
  );
}

function newerSendEntry<T extends ExternalBookChapterSendEntry>(current: T | null | undefined, next: T): T {
  if (!current) {
    return next;
  }
  return compareSendEntryFreshness(next, current) >= 0 ? next : current;
}

function detectSingleChapterBookFile(content: string): ImportPreviewChapter[] {
  const normalized = normalizeTxtContent(content);
  if (!normalized) {
    return detectTxtChapters(content);
  }
  const lines = normalized.split("\n");
  const detected = detectTxtChapters(normalized).filter((chapter: ImportPreviewChapter) => chapter.title.trim() || chapter.text.trim());
  const chapter = detected.find((item) => parseChapterOrdinal(item.title) !== null) ?? detected[0];
  if (!chapter) {
    return [];
  }
  const chapterOrdinal = parseChapterOrdinal(chapter.title);
  let titleIndex = lines.findIndex((line) => line.trim() === chapter.title);
  if (titleIndex < 0 && chapterOrdinal !== null) {
    titleIndex = lines.findIndex((line) => {
      const title = line.trim();
      return title ? parseChapterOrdinal(title) === chapterOrdinal : false;
    });
  }
  if (titleIndex < 0) {
    const text = normalizeTxtContent(chapter.text);
    return [
      {
        ...chapter,
        order: 0,
        wordCount: countWritingUnits(text),
        text
      }
    ];
  }
  const title = chapter.title;
  const text = normalizeTxtContent(lines.slice(titleIndex + 1).join("\n"));
  return [
    {
      ...chapter,
      title,
      text,
      wordCount: countWritingUnits(text),
      lineStart: titleIndex + 1,
      lineEnd: lines.length
    }
  ];
}

function detectExternalBookChapters(content: string): ImportPreviewChapter[] {
  return detectSingleChapterBookFile(content);
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

  clearSentHistory(projectId: string): { readonly ok: true; readonly deletedCount: number } {
    return {
      ok: true,
      deletedCount: this.deps.sentChapterStore.clear(projectId)
    };
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
    const existing = this.deps.sourceStore.listSources(candidate.projectId).find((source) => source.bookFolderPath === bookFolderPath);
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

  private hasSentUnchanged(projectId: string, entry: ExternalBookChapterSendEntry): boolean {
    return this.deps.sentChapterStore.hasSentUnchanged({
      projectId,
      kind: entry.kind,
      chapterIdentity: entry.chapterIdentity,
      title: entry.chapter.title,
      sourceContentHash: entry.sourceContentHash
    });
  }

  private markSendEntrySent(projectId: string, entry: ExternalBookChapterSendEntry, sentAt: string): void {
    this.deps.sentChapterStore.markSent({
      projectId,
      chapterIdentity: entry.chapterIdentity,
      kind: entry.kind,
      title: entry.chapter.title,
      ordinal: entry.chapter.ordinal,
      sourceContentHash: entry.sourceContentHash,
      sentAt
    });
  }

  hasDueAutomaticSync(projectId: string, now = new Date()): boolean {
    if (this.deps.sourceStore.listSources(projectId).length === 0) {
      return true;
    }
    const dueSlot = latestDueSyncSlot(now);
    const existingRun = this.deps.automationStore.getRunBySlot(projectId, scheduledSyncSlotKey(dueSlot.slotDate, dueSlot.localTime));
    return !existingRun || canRetryFailedAutomaticRun(existingRun, now);
  }

  runStartupCatchUpSync(projectId: string, now = new Date()): Promise<ExternalBookSyncAutomaticRunRecord | null> {
    return this.runDueAutomaticSync({ projectId, trigger: "startup", now });
  }

  async runDueAutomaticSync(input: ExternalBookSyncAutomaticInput): Promise<ExternalBookSyncAutomaticRunRecord | null> {
    const now = input.now ?? new Date();
    const dueSlot = latestDueSyncSlot(now);
    const slotKey = scheduledSyncSlotKey(dueSlot.slotDate, dueSlot.localTime);
    const savedSourcesBeforeRun = this.deps.sourceStore.listSources(input.projectId);
    const existingRun = this.deps.automationStore.getRunBySlot(input.projectId, slotKey);
    if (input.trigger !== "startup" && existingRun && !canRetryFailedAutomaticRun(existingRun, now)) {
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

    const completedAt = (): Date => input.now ?? new Date();

    try {
      const savedSources = savedSourcesBeforeRun;
      const project = this.deps.projectRepo.findById(input.projectId);
      let scan = await this.scanProject({
        projectId: input.projectId,
        mode: "quick",
        ...(savedSources.length > 0 ? {} : { roots: automaticDiscoveryRoots(project?.rootPath ?? null) }),
        searchTrigger: input.trigger
      });
      if (scan.candidates.length === 0) {
        scan = await this.scanProject({
          projectId: input.projectId,
          mode: "global",
          roots: defaultRoots(project?.rootPath ?? null),
          searchTrigger: input.trigger
        });
      }
      const candidatesToSend = scan.candidates.filter(shouldSendCandidateToAi);
      if (candidatesToSend.length === 0) {
        return this.completeAutomaticRun(running, "skipped", {
          candidateCount: scan.candidates.length,
          sentMessageCount: 0,
          sentChapterCount: 0,
          sentMissingChapterCount: 0,
          sentLatestProjectChapter: false,
          error: null
        }, completedAt());
      }
      const sent = await this.sendAutomaticCandidatesToAi({
        projectId: input.projectId,
        candidates: candidatesToSend
      });
      return this.completeAutomaticRun(running, sent.sentChapterCount > 0 ? "completed" : "skipped", {
        candidateCount: scan.candidates.length,
        sentMessageCount: sent.sentMessageCount,
        sentChapterCount: sent.sentChapterCount,
        sentMissingChapterCount: sent.sentMissingChapterCount,
        sentLatestProjectChapter: sent.sentLatestProjectChapter,
        error: null
      }, completedAt());
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason);
      return this.completeAutomaticRun(running, "failed", {
        candidateCount: 0,
        sentMessageCount: 0,
        sentChapterCount: 0,
        sentMissingChapterCount: 0,
        sentLatestProjectChapter: false,
        error
      }, completedAt());
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
    },
    completedAt = new Date()
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
      completedAt: completedAt.toISOString()
    });
  }

  private async sendAutomaticCandidatesToAi(input: {
    readonly projectId: string;
    readonly candidates: readonly ExternalBookSyncCandidate[];
  }): Promise<ExternalBookSyncSendResult> {
    const project = this.deps.projectRepo.findById(input.projectId);
    if (!project) {
      throw new Error("项目不存在，无法发送外部章节。");
    }
    const missingByIdentity = new Map<string, Extract<ExternalBookChapterSendEntry, { readonly kind: "missing_chapter" }>>();
    const sentCandidates: ExternalBookSyncCandidate[] = [];
    let latestProjectChapterInExternal: Extract<ExternalBookChapterSendEntry, { readonly kind: "latest_project_chapter" }> | null = null;

    for (const candidate of input.candidates) {
      const loaded = this.loadCandidate({
        projectId: input.projectId,
        projectName: project.name,
        filePath: candidate.filePath
      });
      if (!loaded) {
        throw new Error("外部 .Book 候选已不可用，请重新扫描。");
      }
      if (loaded.candidate.contentHash !== candidate.contentHash) {
        throw new Error("外部 .Book 文件已变化，请重新扫描后再发送。");
      }
      sentCandidates.push(loaded.candidate);
      for (const chapter of selectedChapters(loaded.fullComparison, candidate.comparison.missingChapters.map((item) => item.key))) {
        const chapterIdentity = missingChapterIdentity(chapter);
        const entry = {
          kind: "missing_chapter",
          chapter,
          chapterIdentity,
          sourceContentHash: chapterPayloadHash(chapter),
          sourceModifiedAt: loaded.candidate.modifiedAt,
          sourceFilePath: loaded.candidate.filePath
        } satisfies Extract<ExternalBookChapterSendEntry, { readonly kind: "missing_chapter" }>;
        const existing = missingByIdentity.get(chapterIdentity);
        missingByIdentity.set(chapterIdentity, newerSendEntry(existing, entry));
      }
      if (loaded.fullComparison.latestProjectChapterInExternal) {
        const chapter = loaded.fullComparison.latestProjectChapterInExternal;
        const entry = {
          kind: "latest_project_chapter",
          chapter,
          chapterIdentity: externalBookChapterIdentity(chapter),
          sourceContentHash: chapterPayloadHash(chapter),
          sourceModifiedAt: loaded.candidate.modifiedAt,
          sourceFilePath: loaded.candidate.filePath
        } satisfies Extract<ExternalBookChapterSendEntry, { readonly kind: "latest_project_chapter" }>;
        latestProjectChapterInExternal = newerSendEntry(latestProjectChapterInExternal, entry);
      }
    }

    const missingChapterEntries = [...missingByIdentity.values()].sort((a, b) => compareMissingChapters(a.chapter, b.chapter));
    const entries = [
      ...(latestProjectChapterInExternal ? [latestProjectChapterInExternal] : []),
      ...missingChapterEntries
    ].filter((entry) => !this.hasSentUnchanged(input.projectId, entry));
    if (missingChapterEntries.length === 0 && !latestProjectChapterInExternal) {
      throw new Error("没有可发送的外部章节。");
    }
    if (entries.length === 0) {
      const scannedAt = new Date().toISOString();
      for (const candidate of sentCandidates) {
        this.rememberCandidateSource(candidate, scannedAt);
      }
      return {
        sessionId: "",
        sessionTitle: "外部同步检查",
        sentMessageCount: 0,
        sentChapterCount: 0,
        sentMissingChapterCount: 0,
        sentLatestProjectChapter: false
      };
    }

    const comparison = input.candidates[0]?.comparison;
    const session = await this.deps.aiSender.createChatSession({
      projectId: input.projectId,
      title: "外部同步检查"
    });
    let sentMessageCount = 0;
    let sentMissingChapterCount = 0;
    let sentLatestProjectChapter = false;
    const currentLatestLabel = comparison?.currentLatestOrdinal ? `第${comparison.currentLatestOrdinal}章` : `${comparison?.currentChapterCount ?? 0} 章`;
    for (const entry of entries) {
      const messages = buildExternalBookSyncChatMessages({
        projectName: project.name,
        currentLatestLabel,
        latestProjectChapterInExternal: entry.kind === "latest_project_chapter" ? entry.chapter : null,
        missingChapters: entry.kind === "missing_chapter" ? [entry.chapter] : []
      });
      for (const message of messages) {
        await this.deps.aiSender.sendChatMessage({
          requestId: createId("external_book_sync_chat"),
          projectId: input.projectId,
          sessionId: session.id,
          message
        });
        sentMessageCount += 1;
      }
      this.markSendEntrySent(input.projectId, entry, new Date().toISOString());
      if (entry.kind === "latest_project_chapter") {
        sentLatestProjectChapter = true;
      } else {
        sentMissingChapterCount += 1;
      }
    }
    const scannedAt = new Date().toISOString();
    for (const candidate of sentCandidates) {
      this.rememberCandidateSource(candidate, scannedAt);
    }
    return {
      sessionId: session.id,
      sessionTitle: session.title,
      sentMessageCount,
      sentChapterCount: sentMissingChapterCount + (sentLatestProjectChapter ? 1 : 0),
      sentMissingChapterCount,
      sentLatestProjectChapter
    };
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
      const savedSourceRoots: string[] = [];
      const savedSources = this.deps.sourceStore.listSources(input.projectId);
      const hasLegacySavedSources = savedSources.some((source) => source.selectionVersion < CURRENT_EXTERNAL_BOOK_SOURCE_SELECTION_VERSION);
      for (const source of savedSources) {
        if (source.bookFolderPath) {
          savedSourceRoots.push(source.bookFolderPath);
        }
        const sourceFilePath = sourceBookFilePath(source);
        if (sourceFilePath) {
          candidatePaths.add(sourceFilePath);
        }
      }

      const shouldSearchIndex = input.mode !== "directory" && (input.mode === "global" || (candidatePaths.size === 0 && savedSourceRoots.length === 0));
      const indexSearch = this.deps.searchBookFilesInWindowsIndex ?? searchWindowsIndexForBookFiles;
      const indexResult = shouldSearchIndex ? await indexSearch({ projectName: project.name, timeoutMs: WINDOWS_INDEX_TIMEOUT_MS }) : null;
      if (indexResult?.status === "failed") {
        warnings.push(`Windows Search 查询失败：${indexResult.error}`);
      }
      for (const filePath of indexResult?.files ?? []) {
        candidatePaths.add(filePath);
      }

      const hasExplicitRoots = input.roots !== undefined || Boolean(input.directoryPath);
      const savedRoots = hasLegacySavedSources ? [...new Set([...savedSourceRoots, ...automaticDiscoveryRoots(project.rootPath)])] : savedSourceRoots;
      const roots =
        input.roots ??
        (input.directoryPath
          ? [input.directoryPath]
          : input.mode === "global"
            ? defaultRoots(project.rootPath)
            : savedRoots.length > 0
              ? savedRoots
              : defaultRoots(project.rootPath));
      const shouldScanFileSystem =
        input.mode === "global" ||
        input.mode === "directory" ||
        savedSourceRoots.length === 0 ||
        candidatePaths.size === 0 ||
        (savedSourceRoots.length > 0 && !hasExplicitRoots);
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
          modifiedTimeValue(b.modifiedAt) - modifiedTimeValue(a.modifiedAt) ||
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
    const missingEntries = selectedChapters(loaded.fullComparison, input.chapterKeys).map((chapter) => ({
      kind: "missing_chapter" as const,
      chapter,
      chapterIdentity: missingChapterIdentity(chapter),
      sourceContentHash: chapterPayloadHash(chapter),
      sourceModifiedAt: candidate.modifiedAt,
      sourceFilePath: candidate.filePath
    }));
    const latestProjectChapterEntry = loaded.fullComparison.latestProjectChapterInExternal
      ? {
          kind: "latest_project_chapter" as const,
          chapter: loaded.fullComparison.latestProjectChapterInExternal,
          chapterIdentity: externalBookChapterIdentity(loaded.fullComparison.latestProjectChapterInExternal),
          sourceContentHash: chapterPayloadHash(loaded.fullComparison.latestProjectChapterInExternal),
          sourceModifiedAt: candidate.modifiedAt,
          sourceFilePath: candidate.filePath
        }
      : null;
    const allEntries = [...(latestProjectChapterEntry ? [latestProjectChapterEntry] : []), ...missingEntries];
    if (allEntries.length === 0) {
      throw new Error("没有可发送的外部章节。");
    }
    const entries = allEntries.filter((entry) => !this.hasSentUnchanged(input.projectId, entry));
    if (entries.length === 0) {
      this.rememberCandidateSource(candidate, new Date().toISOString());
      return {
        sessionId: "",
        sessionTitle: "外部同步检查",
        sentMessageCount: 0,
        sentChapterCount: 0,
        sentMissingChapterCount: 0,
        sentLatestProjectChapter: false
      };
    }
    const session = await this.deps.aiSender.createChatSession({
      projectId: input.projectId,
      title: "外部同步检查"
    });
    let sentMessageCount = 0;
    let sentMissingChapterCount = 0;
    let sentLatestProjectChapter = false;
    const currentLatestLabel = candidate.comparison.currentLatestOrdinal ? `第${candidate.comparison.currentLatestOrdinal}章` : `${candidate.comparison.currentChapterCount} 章`;
    for (const entry of entries) {
      const messages = buildExternalBookSyncChatMessages({
        projectName: project.name,
        currentLatestLabel,
        latestProjectChapterInExternal: entry.kind === "latest_project_chapter" ? entry.chapter : null,
        missingChapters: entry.kind === "missing_chapter" ? [entry.chapter] : []
      });
      for (const message of messages) {
        await this.deps.aiSender.sendChatMessage({
          requestId: createId("external_book_sync_chat"),
          projectId: input.projectId,
          sessionId: session.id,
          message
        });
        sentMessageCount += 1;
      }
      this.markSendEntrySent(input.projectId, entry, new Date().toISOString());
      if (entry.kind === "latest_project_chapter") {
        sentLatestProjectChapter = true;
      } else {
        sentMissingChapterCount += 1;
      }
    }
    this.rememberCandidateSource(candidate, new Date().toISOString());
    return {
      sessionId: session.id,
      sessionTitle: session.title,
      sentMessageCount,
      sentChapterCount: sentMissingChapterCount + (sentLatestProjectChapter ? 1 : 0),
      sentMissingChapterCount,
      sentLatestProjectChapter
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
    if (!isBookFilePath(realFilePath) || !isProjectBookFolderPath(path.dirname(realFilePath), input.projectName)) {
      return null;
    }
    const info = statSync(realFilePath);
    if (!info.isFile() || info.size > MAX_BOOK_BYTES) {
      return null;
    }
    const read = readTextFile(realFilePath, { label: ".Book 文件", maxBytes: MAX_BOOK_BYTES });
    const chapters = detectExternalBookChapters(read.text).filter((chapter: ImportPreviewChapter) => chapter.title.trim() || chapter.text.trim());
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
