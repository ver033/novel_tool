import type { SummaryIndexInvalidationInput } from "../chapter/chapter-service";
import type { ChapterRepository } from "../db/repositories/chapter-repo";
import { RelationshipIndexRepository, type RelationshipIndexChapterRecord, type RelationshipIndexJobRecord } from "../db/repositories/relationship-index-repo";
import { estimateTextTokens } from "../ai/token-estimator";
import { computeChapterContentHash } from "../shared/summary-index";
import { countWritingUnits } from "../shared/text";
import type { ChapterContent, ChapterSummary } from "../shared/types";
import type { RelationshipGraphIndexStatus, RelationshipIndexExtractionPayload } from "../shared/relationship-index";
import type { RelationshipIndexKnownEntity, RelationshipIndexSummaryInput } from "./relationship-index-prompts";

export const RELATIONSHIP_INDEX_STABLE_IDLE_MS = 60 * 60 * 1000;
export const RELATIONSHIP_INDEX_MIN_AUTO_UNITS = 200;
export const RELATIONSHIP_INDEX_MIN_MANUAL_UNITS = 80;
export const RELATIONSHIP_INDEX_EXTRACTOR_VERSION = "relationship-index-v1";

type RelationshipRebuildOptions = {
  readonly force?: boolean;
};

export type RelationshipIndexGenerator = {
  readonly extractChapterRelationshipsForIndex: (
    input: RelationshipIndexSummaryInput,
    options?: { readonly signal?: AbortSignal }
  ) => Promise<RelationshipIndexExtractionPayload>;
};

type RelationshipIndexServiceOptions = {
  readonly generator?: RelationshipIndexGenerator;
};

const DEFAULT_RELATIONSHIP_JOB_PRIORITY = 1;
const MANUAL_RELATIONSHIP_JOB_PRIORITY = 5;
const IMPORT_RELATIONSHIP_JOB_PRIORITY = 2;
const OLD_HASH_CANCEL_REASON = "章节内容已更新，旧关系索引任务已取消。";

export class RelationshipSourceChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelationshipSourceChangedError";
  }
}

function addMilliseconds(isoTime: string, milliseconds: number): string {
  const parsed = Date.parse(isoTime);
  const base = Number.isFinite(parsed) ? parsed : Date.now();
  return new Date(base + milliseconds).toISOString();
}

function chapterOrder(chapter: ChapterSummary): number {
  return chapter.sortOrder + 1;
}

function hasReached(time: string | null, now: string): boolean {
  if (!time) {
    return true;
  }
  return time <= now;
}

function isQueuedOrRunning(status: RelationshipIndexChapterRecord["status"]): boolean {
  return status === "queued" || status === "running";
}

export class RelationshipIndexService {
  constructor(
    private readonly relationshipRepo: RelationshipIndexRepository,
    private readonly chapterRepo: ChapterRepository,
    private readonly options: RelationshipIndexServiceOptions = {}
  ) {}

  markChapterContentChanged(input: SummaryIndexInvalidationInput): void {
    const previousHash = computeChapterContentHash(input.previousPlainText);
    const nextHash = computeChapterContentHash(input.nextPlainText);
    if (previousHash === nextHash) {
      return;
    }

    const content = this.getProjectChapter(input.projectId, input.chapterId);
    this.relationshipRepo.markChapterStale({
      projectId: content.projectId,
      chapterId: content.id,
      chapterTitle: content.title,
      chapterOrder: chapterOrder(content),
      contentHash: nextHash,
      extractorVersion: RELATIONSHIP_INDEX_EXTRACTOR_VERSION,
      now: input.updatedAt
    });
    this.relationshipRepo.cancelQueuedChapterJobsExceptHash(input.projectId, input.chapterId, nextHash, OLD_HASH_CANCEL_REASON, input.updatedAt);
  }

  /**
   * Development fallback only. Production relationship cache is derived from SummaryService.
   */
  enqueueEligibleStableChapters(projectId: string, now: string): RelationshipIndexJobRecord[] {
    const jobs: RelationshipIndexJobRecord[] = [];
    for (const chapter of this.chapterRepo.listByProject(projectId)) {
      const content = this.chapterRepo.getContent(chapter.id);
      if (!content || content.projectId !== projectId) {
        continue;
      }
      const sourceHash = computeChapterContentHash(content.plainText);
      const state = this.ensureStateForCurrentContent(content, sourceHash, now);
      if (state.status === "ready" && state.contentHash === sourceHash) {
        continue;
      }
      if (isQueuedOrRunning(state.status) && state.contentHash === sourceHash) {
        continue;
      }
      if (!hasReached(state.eligibleAt, now)) {
        continue;
      }
      if (countWritingUnits(content.plainText) < RELATIONSHIP_INDEX_MIN_AUTO_UNITS) {
        this.markSkippedTooShort(content, sourceHash, now);
        continue;
      }
      jobs.push(
        this.relationshipRepo.enqueueChapterJob({
          projectId,
          chapterId: content.id,
          sourceHash,
          priority: DEFAULT_RELATIONSHIP_JOB_PRIORITY,
          eligibleAt: state.eligibleAt ?? now,
          now
        })
      );
    }
    return jobs;
  }

  enqueueImportedChapters(projectId: string, chapterIds: readonly string[], now: string): RelationshipIndexJobRecord[] {
    const jobs: RelationshipIndexJobRecord[] = [];
    for (const chapterId of chapterIds) {
      const content = this.getProjectChapter(projectId, chapterId);
      const sourceHash = computeChapterContentHash(content.plainText);
      if (countWritingUnits(content.plainText) < RELATIONSHIP_INDEX_MIN_AUTO_UNITS) {
        this.markSkippedTooShort(content, sourceHash, now);
        continue;
      }
      this.markWaitingStable(content, sourceHash, now, now);
      jobs.push(
        this.relationshipRepo.enqueueChapterJob({
          projectId,
          chapterId,
          sourceHash,
          priority: IMPORT_RELATIONSHIP_JOB_PRIORITY,
          eligibleAt: now,
          now
        })
      );
    }
    return jobs;
  }

  /**
   * Development fallback only. Production relationship cache is derived from SummaryService.
   */
  rebuildProjectRelationshipIndex(projectId: string, now: string, options: RelationshipRebuildOptions = {}): RelationshipGraphIndexStatus {
    for (const chapter of this.chapterRepo.listByProject(projectId)) {
      const content = this.chapterRepo.getContent(chapter.id);
      if (!content || content.projectId !== projectId) {
        continue;
      }
      const sourceHash = computeChapterContentHash(content.plainText);
      if (countWritingUnits(content.plainText) < RELATIONSHIP_INDEX_MIN_MANUAL_UNITS) {
        this.markSkippedTooShort(content, sourceHash, now);
        continue;
      }
      const state = this.relationshipRepo.getChapterIndexState(projectId, content.id);
      if (!options.force && state?.status === "ready" && state.contentHash === sourceHash) {
        continue;
      }
      this.markWaitingStable(content, sourceHash, now, now);
      this.relationshipRepo.enqueueChapterJob({
        projectId,
        chapterId: content.id,
        sourceHash,
        priority: MANUAL_RELATIONSHIP_JOB_PRIORITY,
        eligibleAt: now,
        now
      });
    }
    return this.getRelationshipIndexStatus(projectId, now);
  }

  getRelationshipIndexStatus(projectId: string, _now: string): RelationshipGraphIndexStatus {
    return this.relationshipRepo.getIndexStatus(projectId);
  }

  /**
   * Development fallback only. Production relationship cache is derived from SummaryService.
   */
  peekNextRelationshipJob(projectId: string, now: string): RelationshipIndexJobRecord | null {
    return this.relationshipRepo.peekNextRelationshipJob(projectId, now);
  }

  /**
   * Development fallback only. Production relationship cache is derived from SummaryService.
   */
  claimNextRelationshipJob(projectId: string, now: string): RelationshipIndexJobRecord | null {
    return this.relationshipRepo.claimNextRelationshipJob(projectId, now);
  }

  completeRelationshipJob(jobId: string, now: string): void {
    this.relationshipRepo.completeRelationshipJob(jobId, now);
  }

  failRelationshipJob(jobId: string, error: string, nextRunAt: string | null, now: string): void {
    this.relationshipRepo.failRelationshipJob(jobId, error, nextRunAt, now);
  }

  cancelRelationshipJob(jobId: string, error: string, now: string): void {
    this.relationshipRepo.cancelRelationshipJob(jobId, error, now);
  }

  requeueRelationshipJob(job: RelationshipIndexJobRecord, nextRunAt: string, now: string): RelationshipIndexJobRecord {
    return this.relationshipRepo.enqueueChapterJob({
      projectId: job.projectId,
      chapterId: job.chapterId,
      sourceHash: job.sourceHash,
      priority: job.priority,
      attemptCount: job.attemptCount,
      eligibleAt: job.eligibleAt,
      nextRunAt,
      now
    });
  }

  /**
   * Development fallback only. Production relationship cache is derived from SummaryService.
   */
  async indexRelationshipJob(job: RelationshipIndexJobRecord, now: string, options: { readonly signal?: AbortSignal } = {}): Promise<void> {
    const generator = this.options.generator;
    if (!generator) {
      throw new Error("AI 人物关系索引生成器未配置。");
    }

    const content = this.getProjectChapter(job.projectId, job.chapterId);
    const currentHash = computeChapterContentHash(content.plainText);
    if (currentHash !== job.sourceHash) {
      this.requeueCurrentContentAfterSourceChange(content, currentHash, now);
      throw new RelationshipSourceChangedError("章节内容已变化，已重新排队最新人物关系索引任务。");
    }

    const payload = await generator.extractChapterRelationshipsForIndex(
      {
        projectId: job.projectId,
        chapterId: job.chapterId,
        title: content.title,
        ordinal: chapterOrder(content),
        plainText: content.plainText,
        knownEntities: this.getKnownEntities(job.projectId)
      },
      options
    );

    const latestContent = this.getProjectChapter(job.projectId, job.chapterId);
    const latestHash = computeChapterContentHash(latestContent.plainText);
    if (latestHash !== job.sourceHash) {
      this.requeueCurrentContentAfterSourceChange(latestContent, latestHash, now);
      throw new RelationshipSourceChangedError("章节内容已变化，已重新排队最新人物关系索引任务。");
    }

    this.relationshipRepo.replaceChapterExtraction({
      projectId: job.projectId,
      chapterId: job.chapterId,
      chapterTitle: latestContent.title,
      chapterOrder: chapterOrder(latestContent),
      sourceHash: job.sourceHash,
      payload,
      tokenCount: estimateTextTokens(JSON.stringify(payload)),
      stableAfterMs: RELATIONSHIP_INDEX_STABLE_IDLE_MS,
      extractorVersion: RELATIONSHIP_INDEX_EXTRACTOR_VERSION,
      extractionSource: "original_text_enhancement",
      evidenceSource: "original_text",
      indexedAt: now,
      now
    });
  }

  private ensureStateForCurrentContent(content: ChapterContent, sourceHash: string, now: string): RelationshipIndexChapterRecord {
    const existing = this.relationshipRepo.getChapterIndexState(content.projectId, content.id);
    if (existing?.contentHash === sourceHash) {
      return existing;
    }
    const eligibleAt = addMilliseconds(content.contentUpdatedAt ?? content.updatedAt, RELATIONSHIP_INDEX_STABLE_IDLE_MS);
    const state = this.markWaitingStable(content, sourceHash, eligibleAt, now);
    this.relationshipRepo.cancelQueuedChapterJobsExceptHash(content.projectId, content.id, sourceHash, OLD_HASH_CANCEL_REASON, now);
    return state;
  }

  private markWaitingStable(content: ChapterContent, sourceHash: string, eligibleAt: string, now: string): RelationshipIndexChapterRecord {
    return this.relationshipRepo.markChapterWaitingStable({
      projectId: content.projectId,
      chapterId: content.id,
      chapterTitle: content.title,
      chapterOrder: chapterOrder(content),
      contentHash: sourceHash,
      stableAfterMs: RELATIONSHIP_INDEX_STABLE_IDLE_MS,
      extractorVersion: RELATIONSHIP_INDEX_EXTRACTOR_VERSION,
      eligibleAt,
      now
    });
  }

  private markSkippedTooShort(content: ChapterContent, sourceHash: string, now: string): RelationshipIndexChapterRecord {
    return this.relationshipRepo.markChapterSkippedTooShort({
      projectId: content.projectId,
      chapterId: content.id,
      chapterTitle: content.title,
      chapterOrder: chapterOrder(content),
      contentHash: sourceHash,
      stableAfterMs: RELATIONSHIP_INDEX_STABLE_IDLE_MS,
      extractorVersion: RELATIONSHIP_INDEX_EXTRACTOR_VERSION,
      now
    });
  }

  private getProjectChapter(projectId: string, chapterId: string): ChapterContent {
    const content = this.chapterRepo.getContent(chapterId);
    if (!content || content.projectId !== projectId) {
      throw new Error("找不到需要建立人物关系索引的章节。");
    }
    return content;
  }

  private getKnownEntities(projectId: string): RelationshipIndexKnownEntity[] {
    return this.relationshipRepo.listEntities(projectId).map((entity) => ({
      canonicalName: entity.canonicalName,
      aliases: entity.aliases,
      entityKind: entity.entityKind,
      importance: entity.importance,
      roleSummary: entity.roleSummary,
      faction: entity.faction
    }));
  }

  private requeueCurrentContentAfterSourceChange(content: ChapterContent, sourceHash: string, now: string): void {
    this.relationshipRepo.cancelQueuedChapterJobsExceptHash(content.projectId, content.id, sourceHash, OLD_HASH_CANCEL_REASON, now);
    if (countWritingUnits(content.plainText) < RELATIONSHIP_INDEX_MIN_AUTO_UNITS) {
      this.markSkippedTooShort(content, sourceHash, now);
      return;
    }

    const eligibleAt = addMilliseconds(content.contentUpdatedAt ?? content.updatedAt, RELATIONSHIP_INDEX_STABLE_IDLE_MS);
    const state = this.markWaitingStable(content, sourceHash, eligibleAt, now);
    if (!hasReached(state.eligibleAt, now)) {
      return;
    }
    this.relationshipRepo.enqueueChapterJob({
      projectId: content.projectId,
      chapterId: content.id,
      sourceHash,
      priority: DEFAULT_RELATIONSHIP_JOB_PRIORITY,
      eligibleAt: state.eligibleAt ?? now,
      now
    });
  }
}
