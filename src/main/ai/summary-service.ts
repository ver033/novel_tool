import type { SummaryIndexInvalidationInput, SummaryIndexInvalidator } from "../chapter/chapter-service";
import type { ChapterRepository } from "../db/repositories/chapter-repo";
import {
  SummaryRepository,
  type ArcAiSummaryRecord,
  type BookAiSummaryRecord,
  type ChapterAiSummaryRecord,
  type SummaryJobRecord
} from "../db/repositories/summary-repo";
import { createId } from "../shared/ids";
import {
  computeChapterContentHash,
  computeSourceHash,
  type ArcAiSummaryPayload,
  type BookAiSummaryPayload,
  type ChapterAiSummaryPayload,
  type SummaryJobType
} from "../shared/summary-index";
import { countWritingUnits } from "../shared/text";
import type { ChapterContent, SummaryIndexPausedReason, SummaryIndexStatus } from "../shared/types";
import { estimateTextTokens } from "./token-estimator";
import type { ArcIndexSummaryInput, BookIndexSummaryInput, ChapterIndexSummaryInput } from "./summary-prompts";

export const MIN_AUTO_SUMMARY_UNITS = 500;
export const MIN_MANUAL_SUMMARY_UNITS = 80;
export const ACTIVE_CHAPTER_IDLE_MS = 5 * 60 * 1000;
export const MIN_HIGH_PRIORITY_DELTA_UNITS = 500;
export const MIN_NORMAL_PRIORITY_DELTA_UNITS = 100;
export const AUTO_ARC_CHAPTER_COUNT = 20;

export class SummarySourceChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SummarySourceChangedError";
  }
}

export type ChapterSummaryQueueTrigger = "auto_idle" | "chapter_inactive" | "import" | "manual_rebuild";

export type SummaryIndexGenerator = {
  readonly summarizeChapterForIndex: (input: ChapterIndexSummaryInput, options?: { readonly signal?: AbortSignal }) => Promise<ChapterAiSummaryPayload>;
  readonly summarizeArcForIndex?: (input: ArcIndexSummaryInput, options?: { readonly signal?: AbortSignal }) => Promise<ArcAiSummaryPayload>;
  readonly summarizeBookForIndex?: (input: BookIndexSummaryInput, options?: { readonly signal?: AbortSignal }) => Promise<BookAiSummaryPayload>;
};

type SummaryServiceOptions = {
  readonly generator?: SummaryIndexGenerator;
};

export type MaybeEnqueueChapterSummaryInput = {
  readonly projectId: string;
  readonly chapterId: string;
  readonly trigger: ChapterSummaryQueueTrigger;
  readonly now: string;
};

type SummaryIndexStatusOptions = {
  readonly pausedReason?: SummaryIndexPausedReason;
};

function keyFor(projectId: string, chapterId: string): string {
  return `${projectId}:${chapterId}`;
}

function parseTime(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function skippedTooShortPayload(): ChapterAiSummaryPayload {
  return {
    oneLine: "章节内容过短，未建立摘要。",
    synopsis: "章节内容过短，未建立摘要。",
    keyEvents: [],
    characterMentions: [],
    relationshipHints: [],
    timeAndPlace: [],
    foreshadowingHints: [],
    unresolvedQuestions: [],
    emotionalArc: "内容过短，未分析。",
    importantQuotes: []
  };
}

function priorityFor(trigger: ChapterSummaryQueueTrigger, changedWritingUnits: number | null): number {
  if (trigger === "manual_rebuild") {
    return 10;
  }
  if (trigger === "import") {
    return 8;
  }
  const delta = changedWritingUnits ?? MIN_HIGH_PRIORITY_DELTA_UNITS;
  if (delta >= MIN_HIGH_PRIORITY_DELTA_UNITS) {
    return 8;
  }
  if (delta >= MIN_NORMAL_PRIORITY_DELTA_UNITS) {
    return 5;
  }
  return 1;
}

function formatAutoArcKey(chapterFrom: number, chapterTo: number): string {
  return `auto:${String(chapterFrom).padStart(3, "0")}-${String(chapterTo).padStart(3, "0")}`;
}

export class SummaryService implements SummaryIndexInvalidator {
  private readonly activeChapterEditTimes = new Map<string, string>();
  private readonly changedWritingUnits = new Map<string, number>();

  constructor(
    private readonly summaryRepo: SummaryRepository,
    private readonly chapterRepo: ChapterRepository,
    private readonly options: SummaryServiceOptions = {}
  ) {}

  markChapterContentChanged(input: SummaryIndexInvalidationInput): void {
    const previousHash = computeChapterContentHash(input.previousPlainText);
    const nextHash = computeChapterContentHash(input.nextPlainText);
    if (previousHash === nextHash) {
      return;
    }

    this.summaryRepo.markChapterStale(input.projectId, input.chapterId, nextHash, input.updatedAt);
    this.recordActiveChapterEdit(input.projectId, input.chapterId, input.updatedAt);
    this.changedWritingUnits.set(keyFor(input.projectId, input.chapterId), Math.abs(input.nextWordCount - input.previousWordCount));
  }

  recordActiveChapterEdit(projectId: string, chapterId: string, editedAt: string): void {
    this.activeChapterEditTimes.set(keyFor(projectId, chapterId), editedAt);
  }

  onChapterBecameInactive(projectId: string, chapterId: string, now: string): SummaryJobRecord | null {
    this.activeChapterEditTimes.delete(keyFor(projectId, chapterId));
    return this.maybeEnqueueChapterSummary({
      projectId,
      chapterId,
      trigger: "chapter_inactive",
      now
    });
  }

  maybeEnqueueChapterSummary(input: MaybeEnqueueChapterSummaryInput): SummaryJobRecord | null {
    const content = this.chapterRepo.getContent(input.chapterId);
    if (!content || content.projectId !== input.projectId) {
      throw new Error("找不到需要建立摘要的章节。");
    }

    const writingUnits = countWritingUnits(content.plainText);
    const sourceHash = computeChapterContentHash(content.plainText);
    if (input.trigger === "manual_rebuild" && writingUnits < MIN_MANUAL_SUMMARY_UNITS) {
      this.markSkippedTooShort(content, sourceHash, input.now);
      return null;
    }
    if (input.trigger !== "manual_rebuild" && writingUnits < MIN_AUTO_SUMMARY_UNITS) {
      return null;
    }
    if (input.trigger === "auto_idle" && !this.isIdle(input.projectId, input.chapterId, input.now)) {
      return null;
    }
    const existingSummary = this.summaryRepo.getChapterSummary(input.projectId, input.chapterId);
    if (input.trigger !== "manual_rebuild" && existingSummary?.contentHash === sourceHash && existingSummary.status === "ready") {
      return null;
    }

    return this.summaryRepo.enqueueSummaryJob({
      projectId: input.projectId,
      jobType: "chapter_summary" satisfies SummaryJobType,
      targetId: input.chapterId,
      sourceHash,
      priority: priorityFor(input.trigger, this.changedWritingUnits.get(keyFor(input.projectId, input.chapterId)) ?? null),
      now: input.now
    });
  }

  enqueueEligibleStaleChapterSummaries(projectId: string, now: string): SummaryJobRecord[] {
    const jobs: SummaryJobRecord[] = [];
    const summaries = this.summaryRepo.listChapterSummaries(projectId);
    const summaryChapterIds = new Set(summaries.map((summary) => summary.chapterId));
    for (const summary of summaries) {
      if (summary.status !== "stale") {
        continue;
      }
      const job = this.maybeEnqueueChapterSummary({
        projectId,
        chapterId: summary.chapterId,
        trigger: "auto_idle",
        now
      });
      if (job) {
        jobs.push(job);
      }
    }
    for (const chapter of this.chapterRepo.listByProject(projectId)) {
      if (summaryChapterIds.has(chapter.id) || !this.activeChapterEditTimes.has(keyFor(projectId, chapter.id))) {
        continue;
      }
      const job = this.maybeEnqueueChapterSummary({
        projectId,
        chapterId: chapter.id,
        trigger: "auto_idle",
        now
      });
      if (job) {
        jobs.push(job);
      }
    }
    return jobs;
  }

  getIndexStatus(projectId: string, now: string, options: SummaryIndexStatusOptions = {}): SummaryIndexStatus {
    const chapters = this.chapterRepo.listByProject(projectId);
    const summaries = new Map(this.summaryRepo.listChapterSummaries(projectId).map((summary) => [summary.chapterId, summary]));
    let readyChapterCount = 0;
    let staleChapterCount = 0;
    let skippedTooShortChapterCount = 0;
    let missingChapterCount = 0;

    for (const chapter of chapters) {
      const summary = summaries.get(chapter.id);
      if (!summary) {
        missingChapterCount += 1;
        continue;
      }
      if (summary.status === "ready") {
        readyChapterCount += 1;
        continue;
      }
      if (summary.status === "skipped_too_short") {
        skippedTooShortChapterCount += 1;
        continue;
      }
      staleChapterCount += 1;
    }

    const jobs = this.summaryRepo.listSummaryJobs(projectId);
    const runningJob = jobs.find((job) => job.status === "running") ?? null;

    return {
      projectId,
      totalChapterCount: chapters.length,
      readyChapterCount,
      staleChapterCount,
      missingChapterCount,
      skippedTooShortChapterCount,
      failedJobCount: jobs.filter((job) => job.status === "failed").length,
      queuedJobCount: jobs.filter((job) => job.status === "queued").length,
      runningJobLabel: runningJob ? this.formatRunningJobLabel(projectId, runningJob) : null,
      pausedReason: options.pausedReason ?? null,
      updatedAt: now
    };
  }

  rebuildProjectIndex(projectId: string, now: string, options: SummaryIndexStatusOptions = {}): SummaryIndexStatus {
    for (const chapter of this.chapterRepo.listByProject(projectId)) {
      this.maybeEnqueueChapterSummary({
        projectId,
        chapterId: chapter.id,
        trigger: "manual_rebuild",
        now
      });
    }
    return this.getIndexStatus(projectId, now, options);
  }

  async summarizeChapter(projectId: string, chapterId: string, sourceHash: string, now: string, options: { readonly signal?: AbortSignal } = {}): Promise<ChapterAiSummaryRecord> {
    const generator = this.options.generator;
    if (!generator) {
      throw new Error("AI 摘要生成器未配置。");
    }

    const content = this.requireChapterContent(projectId, chapterId);
    const currentHash = computeChapterContentHash(content.plainText);
    if (currentHash !== sourceHash) {
      this.requeueChapterSummary(projectId, chapterId, currentHash, now);
      throw new SummarySourceChangedError("章节内容已变化，已重新排队最新摘要任务。");
    }

    const structured = await generator.summarizeChapterForIndex(
      {
        projectId,
        chapterId,
        title: content.title,
        ordinal: content.sortOrder + 1,
        plainText: content.plainText
      },
      options
    );
    const latestContent = this.requireChapterContent(projectId, chapterId);
    const latestHash = computeChapterContentHash(latestContent.plainText);
    if (latestHash !== sourceHash) {
      this.requeueChapterSummary(projectId, chapterId, latestHash, now);
      throw new SummarySourceChangedError("章节内容已变化，已重新排队最新摘要任务。");
    }

    const summary = this.summaryRepo.upsertChapterSummary({
      id: createId("summary"),
      projectId,
      chapterId,
      chapterTitle: latestContent.title,
      chapterOrder: latestContent.sortOrder + 1,
      contentHash: sourceHash,
      summaryShort: structured.oneLine,
      summaryLong: structured.synopsis,
      structured,
      tokenCount: estimateTextTokens(JSON.stringify(structured)),
      status: "ready",
      error: null,
      createdAt: now,
      updatedAt: now
    });
    this.enqueueArcForChapterIfReady(projectId, summary.chapterOrder, now);
    return summary;
  }

  async summarizeArc(
    projectId: string,
    arcKey: string,
    chapterFrom: number,
    chapterTo: number,
    sourceHash: string,
    now: string,
    options: { readonly signal?: AbortSignal } = {}
  ): Promise<ArcAiSummaryRecord> {
    const generator = this.options.generator?.summarizeArcForIndex;
    if (!generator) {
      throw new Error("AI 阶段摘要生成器未配置。");
    }
    const readySummaries = this.collectReadyChapterSummariesForArc(projectId, chapterFrom, chapterTo);
    const currentSourceHash = computeSourceHash(readySummaries.map((summary) => summary.contentHash));
    if (currentSourceHash !== sourceHash) {
      this.requeueArcSummary(projectId, arcKey, currentSourceHash, now);
      throw new SummarySourceChangedError("阶段摘要来源已变化，已重新排队最新摘要任务。");
    }

    const structured = await generator(
      {
        arcKey,
        chapterFrom,
        chapterTo,
        chapters: readySummaries.map((summary) => ({
          chapterId: summary.chapterId,
          title: summary.chapterTitle,
          ordinal: summary.chapterOrder,
          summaryShort: summary.summaryShort,
          summaryLong: summary.summaryLong,
          structured: summary.structured
        }))
      },
      options
    );
    const latestReadySummaries = this.collectReadyChapterSummariesForArc(projectId, chapterFrom, chapterTo);
    const latestSourceHash = computeSourceHash(latestReadySummaries.map((summary) => summary.contentHash));
    if (latestSourceHash !== sourceHash) {
      this.requeueArcSummary(projectId, arcKey, latestSourceHash, now);
      throw new SummarySourceChangedError("阶段摘要来源已变化，已重新排队最新摘要任务。");
    }

    const summary = this.summaryRepo.upsertArcSummary({
      id: createId("arc_summary"),
      projectId,
      arcKey,
      chapterFrom,
      chapterTo,
      sourceHash,
      summary: structured.synopsis,
      structured,
      status: "ready",
      error: null,
      createdAt: now,
      updatedAt: now
    });
    this.enqueueBookIfReady(projectId, now);
    return summary;
  }

  async summarizeBook(projectId: string, sourceHash: string, now: string, options: { readonly signal?: AbortSignal } = {}): Promise<BookAiSummaryRecord> {
    const generator = this.options.generator?.summarizeBookForIndex;
    if (!generator) {
      throw new Error("AI 全书摘要生成器未配置。");
    }
    const coverage = this.buildBookCoverage(projectId);
    const readyArcs = this.summaryRepo.listArcSummaries(projectId).filter((summary) => summary.status === "ready");
    if (readyArcs.length === 0) {
      throw new Error("全书摘要等待阶段摘要完成。");
    }
    const currentSourceHash = this.computeBookSourceHash(readyArcs.map((summary) => summary.sourceHash), coverage);
    if (currentSourceHash !== sourceHash) {
      this.requeueBookSummary(projectId, currentSourceHash, now);
      throw new SummarySourceChangedError("全书摘要来源已变化，已重新排队最新摘要任务。");
    }

    const generated = await generator(
      {
        arcs: readyArcs.map((summary) => ({
          arcKey: summary.arcKey,
          chapterFrom: summary.chapterFrom,
          chapterTo: summary.chapterTo,
          summary: summary.summary,
          structured: summary.structured
        })),
        coverage
      },
      options
    );
    const latestCoverage = this.buildBookCoverage(projectId);
    const latestReadyArcs = this.summaryRepo.listArcSummaries(projectId).filter((summary) => summary.status === "ready");
    const latestSourceHash = this.computeBookSourceHash(latestReadyArcs.map((summary) => summary.sourceHash), latestCoverage);
    if (latestSourceHash !== sourceHash) {
      this.requeueBookSummary(projectId, latestSourceHash, now);
      throw new SummarySourceChangedError("全书摘要来源已变化，已重新排队最新摘要任务。");
    }
    const structured = {
      ...generated,
      coverage: latestCoverage
    };

    return this.summaryRepo.upsertBookSummary({
      id: createId("book_summary"),
      projectId,
      sourceHash,
      summaryShort: structured.synopsis,
      summaryLong: structured.synopsis,
      structured,
      status: "ready",
      error: null,
      createdAt: now,
      updatedAt: now
    });
  }

  private isIdle(projectId: string, chapterId: string, now: string): boolean {
    const editedAt = this.activeChapterEditTimes.get(keyFor(projectId, chapterId));
    if (!editedAt) {
      return true;
    }
    return parseTime(now) - parseTime(editedAt) >= ACTIVE_CHAPTER_IDLE_MS;
  }

  private requireChapterContent(projectId: string, chapterId: string): ChapterContent {
    const content = this.chapterRepo.getContent(chapterId);
    if (!content || content.projectId !== projectId) {
      throw new Error("找不到需要建立摘要的章节。");
    }
    return content;
  }

  private requeueChapterSummary(projectId: string, chapterId: string, sourceHash: string, now: string): SummaryJobRecord {
    return this.summaryRepo.enqueueSummaryJob({
      projectId,
      jobType: "chapter_summary",
      targetId: chapterId,
      sourceHash,
      priority: 8,
      now
    });
  }

  private collectReadyChapterSummariesForArc(projectId: string, chapterFrom: number, chapterTo: number): ChapterAiSummaryRecord[] {
    const chapters = this.chapterRepo.listByProject(projectId).filter((chapter) => {
      const ordinal = chapter.sortOrder + 1;
      return ordinal >= chapterFrom && ordinal <= chapterTo;
    });
    if (chapters.length === 0) {
      throw new Error("阶段摘要缺少章节范围。");
    }
    const summaries = new Map(this.summaryRepo.listChapterSummaries(projectId).map((summary) => [summary.chapterId, summary]));
    const blocking = chapters.filter((chapter) => {
      const summary = summaries.get(chapter.id);
      return !summary || (summary.status !== "ready" && summary.status !== "skipped_too_short");
    });
    if (blocking.length > 0) {
      throw new Error("阶段摘要等待章节摘要完成。");
    }
    const readySummaries = chapters
      .map((chapter) => summaries.get(chapter.id))
      .filter((summary): summary is ChapterAiSummaryRecord => summary !== undefined && summary.status === "ready");
    if (readySummaries.length === 0) {
      throw new Error("阶段摘要缺少可用章节摘要。");
    }
    return readySummaries;
  }

  private requeueArcSummary(projectId: string, arcKey: string, sourceHash: string, now: string): SummaryJobRecord {
    return this.summaryRepo.enqueueSummaryJob({
      projectId,
      jobType: "arc_summary",
      targetId: arcKey,
      sourceHash,
      priority: 6,
      now
    });
  }

  private enqueueArcForChapterIfReady(projectId: string, chapterOrder: number, now: string): SummaryJobRecord | null {
    const chapters = this.chapterRepo.listByProject(projectId);
    const totalChapters = chapters.length;
    if (totalChapters === 0) {
      return null;
    }
    const chapterFrom = Math.floor((chapterOrder - 1) / AUTO_ARC_CHAPTER_COUNT) * AUTO_ARC_CHAPTER_COUNT + 1;
    const chapterTo = Math.min(chapterFrom + AUTO_ARC_CHAPTER_COUNT - 1, totalChapters);
    const arcKey = formatAutoArcKey(chapterFrom, chapterTo);
    let readySummaries: ChapterAiSummaryRecord[];
    try {
      readySummaries = this.collectReadyChapterSummariesForArc(projectId, chapterFrom, chapterTo);
    } catch {
      return null;
    }
    const sourceHash = computeSourceHash(readySummaries.map((summary) => summary.contentHash));
    const existing = this.summaryRepo.listArcSummaries(projectId).find((summary) => summary.arcKey === arcKey);
    if (existing?.status === "ready" && existing.sourceHash === sourceHash) {
      return null;
    }
    return this.summaryRepo.enqueueSummaryJob({
      projectId,
      jobType: "arc_summary",
      targetId: arcKey,
      sourceHash,
      priority: 6,
      now
    });
  }

  private buildBookCoverage(projectId: string): BookAiSummaryPayload["coverage"] {
    const chapters = this.chapterRepo.listByProject(projectId);
    const summaries = new Map(this.summaryRepo.listChapterSummaries(projectId).map((summary) => [summary.chapterId, summary]));
    const staleChapterIds: string[] = [];
    const missingChapterIds: string[] = [];
    const skippedTooShortChapterIds: string[] = [];
    let indexedChapterCount = 0;

    for (const chapter of chapters) {
      const summary = summaries.get(chapter.id);
      if (!summary) {
        missingChapterIds.push(chapter.id);
        continue;
      }
      if (summary.status === "ready") {
        indexedChapterCount += 1;
        continue;
      }
      if (summary.status === "skipped_too_short") {
        skippedTooShortChapterIds.push(chapter.id);
        continue;
      }
      staleChapterIds.push(chapter.id);
    }

    return {
      totalChapterCount: chapters.length,
      indexedChapterCount,
      staleChapterIds,
      missingChapterIds,
      skippedTooShortChapterIds
    };
  }

  private computeBookSourceHash(arcSourceHashes: readonly string[], coverage: BookAiSummaryPayload["coverage"]): string {
    return computeSourceHash([
      ...arcSourceHashes,
      JSON.stringify({
        indexed: coverage.indexedChapterCount,
        total: coverage.totalChapterCount,
        stale: coverage.staleChapterIds,
        missing: coverage.missingChapterIds,
        skipped: coverage.skippedTooShortChapterIds
      })
    ]);
  }

  private enqueueBookIfReady(projectId: string, now: string): SummaryJobRecord | null {
    const coverage = this.buildBookCoverage(projectId);
    const readyArcs = this.summaryRepo.listArcSummaries(projectId).filter((summary) => summary.status === "ready");
    if (readyArcs.length === 0) {
      return null;
    }
    const sourceHash = this.computeBookSourceHash(readyArcs.map((summary) => summary.sourceHash), coverage);
    const existing = this.summaryRepo.getLatestBookSummary(projectId);
    if (existing?.status === "ready" && existing.sourceHash === sourceHash) {
      return null;
    }
    return this.summaryRepo.enqueueSummaryJob({
      projectId,
      jobType: "book_summary",
      targetId: null,
      sourceHash,
      priority: 4,
      now
    });
  }

  private requeueBookSummary(projectId: string, sourceHash: string, now: string): SummaryJobRecord {
    return this.summaryRepo.enqueueSummaryJob({
      projectId,
      jobType: "book_summary",
      targetId: null,
      sourceHash,
      priority: 4,
      now
    });
  }

  private formatRunningJobLabel(projectId: string, job: SummaryJobRecord): string {
    if (job.jobType === "chapter_summary" && job.targetId) {
      const content = this.chapterRepo.getContent(job.targetId);
      if (content?.projectId === projectId) {
        return `正在摘要：${content.title}`;
      }
      return "正在摘要章节";
    }
    if (job.jobType === "arc_summary") {
      return "正在整理阶段摘要";
    }
    if (job.jobType === "book_summary") {
      return "正在整理全书摘要";
    }
    return "正在建立全书索引";
  }

  private markSkippedTooShort(content: ChapterContent, contentHash: string, now: string): void {
    this.summaryRepo.upsertChapterSummary({
      id: createId("summary"),
      projectId: content.projectId,
      chapterId: content.id,
      chapterTitle: content.title,
      chapterOrder: content.sortOrder + 1,
      contentHash,
      summaryShort: "章节内容过短，未建立摘要。",
      summaryLong: "章节内容过短，未建立摘要。",
      structured: skippedTooShortPayload(),
      tokenCount: 0,
      status: "skipped_too_short",
      error: null,
      createdAt: now,
      updatedAt: now
    });
  }
}
