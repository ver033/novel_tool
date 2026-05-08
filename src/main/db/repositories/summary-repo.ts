import { createId } from "../../shared/ids";
import {
  arcAiSummaryPayloadSchema,
  bookAiSummaryPayloadSchema,
  chapterAiSummaryChunkPayloadSchema,
  chapterAiSummaryPayloadSchema,
  type ArcAiSummaryPayload,
  type BookAiSummaryPayload,
  type ChapterAiSummaryChunkPayload,
  type ChapterAiSummaryPayload,
  type SummaryJobStatus,
  type SummaryJobType,
  type SummaryStatus
} from "../../shared/summary-index";
import type { SqliteDatabase } from "../database";

type ChapterSummaryRow = {
  readonly id: string;
  readonly project_id: string;
  readonly chapter_id: string;
  readonly chapter_title: string;
  readonly chapter_order: number;
  readonly content_hash: string;
  readonly summary_short: string;
  readonly summary_long: string;
  readonly structured_json: string;
  readonly token_count: number;
  readonly status: SummaryStatus;
  readonly error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

type ChapterSummaryChunkRow = {
  readonly id: string;
  readonly project_id: string;
  readonly chapter_id: string;
  readonly chunk_index: number;
  readonly chunk_count: number;
  readonly content_hash: string;
  readonly text_start: number;
  readonly text_end: number;
  readonly summary_short: string;
  readonly structured_json: string;
  readonly token_count: number;
  readonly status: Exclude<SummaryStatus, "skipped_too_short">;
  readonly error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

type ArcSummaryRow = {
  readonly id: string;
  readonly project_id: string;
  readonly arc_key: string;
  readonly chapter_from: number;
  readonly chapter_to: number;
  readonly source_hash: string;
  readonly summary: string;
  readonly structured_json: string;
  readonly status: Exclude<SummaryStatus, "skipped_too_short">;
  readonly error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

type BookSummaryRow = {
  readonly id: string;
  readonly project_id: string;
  readonly source_hash: string;
  readonly summary_short: string;
  readonly summary_long: string;
  readonly structured_json: string;
  readonly status: Exclude<SummaryStatus, "skipped_too_short">;
  readonly error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

type SummaryJobRow = {
  readonly id: string;
  readonly project_id: string;
  readonly job_type: SummaryJobType;
  readonly target_id: string | null;
  readonly source_hash: string;
  readonly status: SummaryJobStatus;
  readonly priority: number;
  readonly attempt_count: number;
  readonly next_run_at: string | null;
  readonly error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly started_at: string | null;
  readonly finished_at: string | null;
};

const BACKGROUND_INDEX_ENABLED_KEY_PREFIX = "summaryIndex.backgroundEnabled:";

export type ChapterAiSummaryRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly chapterOrder: number;
  readonly contentHash: string;
  readonly summaryShort: string;
  readonly summaryLong: string;
  readonly structured: ChapterAiSummaryPayload;
  readonly tokenCount: number;
  readonly status: SummaryStatus;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ChapterAiSummaryChunkRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly chapterId: string;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly contentHash: string;
  readonly textStart: number;
  readonly textEnd: number;
  readonly summaryShort: string;
  readonly structured: ChapterAiSummaryChunkPayload;
  readonly tokenCount: number;
  readonly status: Exclude<SummaryStatus, "skipped_too_short">;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ArcAiSummaryRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly arcKey: string;
  readonly chapterFrom: number;
  readonly chapterTo: number;
  readonly sourceHash: string;
  readonly summary: string;
  readonly structured: ArcAiSummaryPayload;
  readonly status: Exclude<SummaryStatus, "skipped_too_short">;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type BookAiSummaryRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly sourceHash: string;
  readonly summaryShort: string;
  readonly summaryLong: string;
  readonly structured: BookAiSummaryPayload;
  readonly status: Exclude<SummaryStatus, "skipped_too_short">;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type SummaryJobRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly jobType: SummaryJobType;
  readonly targetId: string | null;
  readonly sourceHash: string;
  readonly status: SummaryJobStatus;
  readonly priority: number;
  readonly attemptCount: number;
  readonly nextRunAt: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
};

export type UpsertChapterSummaryInput = Omit<ChapterAiSummaryRecord, "structured"> & {
  readonly structured: ChapterAiSummaryPayload;
};

export type UpsertChapterSummaryChunkInput = Omit<ChapterAiSummaryChunkRecord, "structured"> & {
  readonly structured: ChapterAiSummaryChunkPayload;
};

export type UpsertArcSummaryInput = Omit<ArcAiSummaryRecord, "structured"> & {
  readonly structured: ArcAiSummaryPayload;
};

export type UpsertBookSummaryInput = Omit<BookAiSummaryRecord, "structured"> & {
  readonly structured: BookAiSummaryPayload;
};

export type EnqueueSummaryJobInput = {
  readonly projectId: string;
  readonly jobType: SummaryJobType;
  readonly targetId: string | null;
  readonly sourceHash: string;
  readonly priority: number;
  readonly attemptCount?: number;
  readonly now: string;
  readonly nextRunAt?: string | null;
};

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function mapChapterSummary(row: ChapterSummaryRow): ChapterAiSummaryRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    chapterOrder: row.chapter_order,
    contentHash: row.content_hash,
    summaryShort: row.summary_short,
    summaryLong: row.summary_long,
    structured: chapterAiSummaryPayloadSchema.parse(parseJson(row.structured_json)),
    tokenCount: row.token_count,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapChapterSummaryChunk(row: ChapterSummaryChunkRow): ChapterAiSummaryChunkRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id,
    chunkIndex: row.chunk_index,
    chunkCount: row.chunk_count,
    contentHash: row.content_hash,
    textStart: row.text_start,
    textEnd: row.text_end,
    summaryShort: row.summary_short,
    structured: chapterAiSummaryChunkPayloadSchema.parse(parseJson(row.structured_json)),
    tokenCount: row.token_count,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapArcSummary(row: ArcSummaryRow): ArcAiSummaryRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    arcKey: row.arc_key,
    chapterFrom: row.chapter_from,
    chapterTo: row.chapter_to,
    sourceHash: row.source_hash,
    summary: row.summary,
    structured: arcAiSummaryPayloadSchema.parse(parseJson(row.structured_json)),
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapBookSummary(row: BookSummaryRow): BookAiSummaryRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceHash: row.source_hash,
    summaryShort: row.summary_short,
    summaryLong: row.summary_long,
    structured: bookAiSummaryPayloadSchema.parse(parseJson(row.structured_json)),
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSummaryJob(row: SummaryJobRow): SummaryJobRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    jobType: row.job_type,
    targetId: row.target_id,
    sourceHash: row.source_hash,
    status: row.status,
    priority: row.priority,
    attemptCount: row.attempt_count,
    nextRunAt: row.next_run_at,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

function targetWhereClause(targetId: string | null): { readonly sql: string; readonly params: readonly string[] } {
  return targetId === null ? { sql: "target_id IS NULL", params: [] } : { sql: "target_id = ?", params: [targetId] };
}

function backgroundIndexEnabledKey(projectId: string): string {
  return `${BACKGROUND_INDEX_ENABLED_KEY_PREFIX}${projectId}`;
}

export class SummaryRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getBackgroundIndexEnabled(projectId: string): boolean {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key = ?").get(backgroundIndexEnabledKey(projectId)) as
      | { readonly value_json: string }
      | undefined;
    if (!row) {
      return true;
    }
    try {
      const value = JSON.parse(row.value_json) as unknown;
      if (typeof value === "boolean") {
        return value;
      }
      if (value && typeof value === "object" && "enabled" in value && typeof (value as { readonly enabled?: unknown }).enabled === "boolean") {
        return Boolean((value as { readonly enabled: boolean }).enabled);
      }
    } catch {
      return true;
    }
    return true;
  }

  setBackgroundIndexEnabled(projectId: string, enabled: boolean, now: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(backgroundIndexEnabledKey(projectId), JSON.stringify({ enabled }), now);
  }

  getChapterSummary(projectId: string, chapterId: string): ChapterAiSummaryRecord | null {
    const row = this.db
      .prepare("SELECT * FROM chapter_ai_summaries WHERE project_id = ? AND chapter_id = ?")
      .get(projectId, chapterId) as ChapterSummaryRow | undefined;
    return row ? mapChapterSummary(row) : null;
  }

  listChapterSummaries(projectId: string): ChapterAiSummaryRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM chapter_ai_summaries WHERE project_id = ? ORDER BY chapter_order ASC, updated_at ASC")
        .all(projectId) as ChapterSummaryRow[]
    ).map(mapChapterSummary);
  }

  deleteChapterSummary(projectId: string, chapterId: string): void {
    this.db.prepare("DELETE FROM chapter_ai_summaries WHERE project_id = ? AND chapter_id = ?").run(projectId, chapterId);
    this.deleteChapterSummaryChunks(projectId, chapterId);
  }

  upsertChapterSummary(input: UpsertChapterSummaryInput): ChapterAiSummaryRecord {
    this.db
      .prepare(
        `INSERT INTO chapter_ai_summaries
         (id, project_id, chapter_id, chapter_title, chapter_order, content_hash, summary_short, summary_long,
          structured_json, token_count, status, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, chapter_id) DO UPDATE SET
           id = excluded.id,
           chapter_title = excluded.chapter_title,
           chapter_order = excluded.chapter_order,
           content_hash = excluded.content_hash,
           summary_short = excluded.summary_short,
           summary_long = excluded.summary_long,
           structured_json = excluded.structured_json,
           token_count = excluded.token_count,
           status = excluded.status,
           error = excluded.error,
           updated_at = excluded.updated_at`
      )
      .run(
        input.id,
        input.projectId,
        input.chapterId,
        input.chapterTitle,
        input.chapterOrder,
        input.contentHash,
        input.summaryShort,
        input.summaryLong,
        JSON.stringify(input.structured),
        input.tokenCount,
        input.status,
        input.error,
        input.createdAt,
        input.updatedAt
      );

    const summary = this.getChapterSummary(input.projectId, input.chapterId);
    if (!summary) {
      throw new Error("章节摘要写入失败。");
    }
    return summary;
  }

  markChapterStale(projectId: string, chapterId: string, contentHash: string, updatedAt: string): void {
    this.db
      .prepare(
        `UPDATE chapter_ai_summaries
         SET content_hash = ?, status = 'stale', error = NULL, updated_at = ?
         WHERE project_id = ? AND chapter_id = ?`
      )
      .run(contentHash, updatedAt, projectId, chapterId);
    this.markChapterSummaryChunksStale(projectId, chapterId, updatedAt);
  }

  upsertChapterSummaryChunk(input: UpsertChapterSummaryChunkInput): ChapterAiSummaryChunkRecord {
    this.db
      .prepare(
        `INSERT INTO chapter_ai_summary_chunks
         (id, project_id, chapter_id, chunk_index, chunk_count, content_hash, text_start, text_end,
          summary_short, structured_json, token_count, status, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, chapter_id, content_hash, chunk_index) DO UPDATE SET
           id = excluded.id,
           chunk_count = excluded.chunk_count,
           text_start = excluded.text_start,
           text_end = excluded.text_end,
           summary_short = excluded.summary_short,
           structured_json = excluded.structured_json,
           token_count = excluded.token_count,
           status = excluded.status,
           error = excluded.error,
           updated_at = excluded.updated_at`
      )
      .run(
        input.id,
        input.projectId,
        input.chapterId,
        input.chunkIndex,
        input.chunkCount,
        input.contentHash,
        input.textStart,
        input.textEnd,
        input.summaryShort,
        JSON.stringify(input.structured),
        input.tokenCount,
        input.status,
        input.error,
        input.createdAt,
        input.updatedAt
      );

    const row = this.db
      .prepare(
        `SELECT * FROM chapter_ai_summary_chunks
         WHERE project_id = ? AND chapter_id = ? AND content_hash = ? AND chunk_index = ?`
      )
      .get(input.projectId, input.chapterId, input.contentHash, input.chunkIndex) as ChapterSummaryChunkRow | undefined;
    if (!row) {
      throw new Error("章节片段摘要写入失败。");
    }
    return mapChapterSummaryChunk(row);
  }

  listChapterSummaryChunks(projectId: string, chapterId: string, contentHash: string): ChapterAiSummaryChunkRecord[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM chapter_ai_summary_chunks
           WHERE project_id = ? AND chapter_id = ? AND content_hash = ?
           ORDER BY chunk_index ASC`
        )
        .all(projectId, chapterId, contentHash) as ChapterSummaryChunkRow[]
    ).map(mapChapterSummaryChunk);
  }

  deleteChapterSummaryChunks(projectId: string, chapterId: string, contentHash?: string): void {
    if (contentHash) {
      this.db
        .prepare("DELETE FROM chapter_ai_summary_chunks WHERE project_id = ? AND chapter_id = ? AND content_hash = ?")
        .run(projectId, chapterId, contentHash);
      return;
    }
    this.db.prepare("DELETE FROM chapter_ai_summary_chunks WHERE project_id = ? AND chapter_id = ?").run(projectId, chapterId);
  }

  markChapterSummaryChunksStale(projectId: string, chapterId: string, updatedAt: string): void {
    this.db
      .prepare(
        `UPDATE chapter_ai_summary_chunks
         SET status = 'stale', error = NULL, updated_at = ?
         WHERE project_id = ? AND chapter_id = ? AND status != 'stale'`
      )
      .run(updatedAt, projectId, chapterId);
  }

  listArcSummaries(projectId: string): ArcAiSummaryRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM arc_ai_summaries WHERE project_id = ? ORDER BY chapter_from ASC, chapter_to ASC")
        .all(projectId) as ArcSummaryRow[]
    ).map(mapArcSummary);
  }

  upsertArcSummary(input: UpsertArcSummaryInput): ArcAiSummaryRecord {
    this.db
      .prepare(
        `INSERT INTO arc_ai_summaries
         (id, project_id, arc_key, chapter_from, chapter_to, source_hash, summary, structured_json, status, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, arc_key) DO UPDATE SET
           id = excluded.id,
           chapter_from = excluded.chapter_from,
           chapter_to = excluded.chapter_to,
           source_hash = excluded.source_hash,
           summary = excluded.summary,
           structured_json = excluded.structured_json,
           status = excluded.status,
           error = excluded.error,
           updated_at = excluded.updated_at`
      )
      .run(
        input.id,
        input.projectId,
        input.arcKey,
        input.chapterFrom,
        input.chapterTo,
        input.sourceHash,
        input.summary,
        JSON.stringify(input.structured),
        input.status,
        input.error,
        input.createdAt,
        input.updatedAt
      );

    const row = this.db
      .prepare("SELECT * FROM arc_ai_summaries WHERE project_id = ? AND arc_key = ?")
      .get(input.projectId, input.arcKey) as ArcSummaryRow | undefined;
    if (!row) {
      throw new Error("阶段摘要写入失败。");
    }
    return mapArcSummary(row);
  }

  getLatestBookSummary(projectId: string): BookAiSummaryRecord | null {
    const row = this.db
      .prepare("SELECT * FROM book_ai_summaries WHERE project_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1")
      .get(projectId) as BookSummaryRow | undefined;
    return row ? mapBookSummary(row) : null;
  }

  deleteDerivedSummaries(projectId: string): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM arc_ai_summaries WHERE project_id = ?").run(projectId);
      this.db.prepare("DELETE FROM book_ai_summaries WHERE project_id = ?").run(projectId);
      this.db
        .prepare("DELETE FROM summary_jobs WHERE project_id = ? AND job_type IN ('arc_summary', 'book_summary') AND status != 'running'")
        .run(projectId);
    });
    transaction();
  }

  upsertBookSummary(input: UpsertBookSummaryInput): BookAiSummaryRecord {
    this.db
      .prepare(
        `INSERT INTO book_ai_summaries
         (id, project_id, source_hash, summary_short, summary_long, structured_json, status, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           source_hash = excluded.source_hash,
           summary_short = excluded.summary_short,
           summary_long = excluded.summary_long,
           structured_json = excluded.structured_json,
           status = excluded.status,
           error = excluded.error,
           updated_at = excluded.updated_at`
      )
      .run(
        input.id,
        input.projectId,
        input.sourceHash,
        input.summaryShort,
        input.summaryLong,
        JSON.stringify(input.structured),
        input.status,
        input.error,
        input.createdAt,
        input.updatedAt
      );

    const summary = this.getLatestBookSummary(input.projectId);
    if (!summary) {
      throw new Error("全书摘要写入失败。");
    }
    return summary;
  }

  enqueueSummaryJob(input: EnqueueSummaryJobInput): SummaryJobRecord {
    const target = targetWhereClause(input.targetId);
    const existing = this.db
      .prepare(
        `SELECT * FROM summary_jobs
         WHERE project_id = ? AND job_type = ? AND ${target.sql} AND status IN ('queued', 'running')
         ORDER BY CASE status WHEN 'queued' THEN 0 ELSE 1 END, updated_at DESC, rowid DESC
         LIMIT 1`
      )
      .get(input.projectId, input.jobType, ...target.params) as SummaryJobRow | undefined;

    if (existing?.status === "running") {
      return mapSummaryJob(existing);
    }

    if (existing?.status === "queued") {
      this.db
        .prepare(
          `UPDATE summary_jobs
           SET source_hash = ?, priority = ?, next_run_at = ?, error = NULL, updated_at = ?
           WHERE id = ?`
        )
        .run(input.sourceHash, Math.max(existing.priority, input.priority), input.nextRunAt ?? null, input.now, existing.id);
      const updated = this.getJobById(existing.id);
      if (!updated) {
        throw new Error("摘要任务更新失败。");
      }
      return updated;
    }

    this.db
      .prepare(
        `DELETE FROM summary_jobs
         WHERE project_id = ? AND job_type = ? AND ${target.sql} AND status = 'cancelled'`
      )
      .run(input.projectId, input.jobType, ...target.params);

    const job: SummaryJobRecord = {
      id: createId("summary_job"),
      projectId: input.projectId,
      jobType: input.jobType,
      targetId: input.targetId,
      sourceHash: input.sourceHash,
      status: "queued",
      priority: input.priority,
      attemptCount: input.attemptCount ?? 0,
      nextRunAt: input.nextRunAt ?? null,
      error: null,
      createdAt: input.now,
      updatedAt: input.now,
      startedAt: null,
      finishedAt: null
    };

    this.db
      .prepare(
        `INSERT INTO summary_jobs
         (id, project_id, job_type, target_id, source_hash, status, priority, attempt_count, next_run_at,
          error, created_at, updated_at, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        job.id,
        job.projectId,
        job.jobType,
        job.targetId,
        job.sourceHash,
        job.status,
        job.priority,
        job.attemptCount,
        job.nextRunAt,
        job.error,
        job.createdAt,
        job.updatedAt,
        job.startedAt,
        job.finishedAt
      );

    return job;
  }

  claimNextSummaryJob(projectId: string, now: string): SummaryJobRecord | null {
    const row = this.findNextRunnableJobRow(projectId, now);
    if (!row) {
      return null;
    }

    this.db
      .prepare(
        `UPDATE summary_jobs
         SET status = 'running', attempt_count = attempt_count + 1, error = NULL, started_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(now, now, row.id);
    return this.getJobById(row.id);
  }

  peekNextSummaryJob(projectId: string, now: string): SummaryJobRecord | null {
    const row = this.findNextRunnableJobRow(projectId, now);
    return row ? mapSummaryJob(row) : null;
  }

  listSummaryJobs(projectId: string): SummaryJobRecord[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM summary_jobs
           WHERE project_id = ?
           ORDER BY
             CASE status
               WHEN 'running' THEN 0
               WHEN 'queued' THEN 1
               WHEN 'failed' THEN 2
               ELSE 3
             END,
             priority DESC,
             updated_at DESC,
             rowid DESC`
        )
        .all(projectId) as SummaryJobRow[]
    ).map(mapSummaryJob);
  }

  hasRunningSummaryJob(projectId: string): boolean {
    const row = this.db.prepare("SELECT 1 AS found FROM summary_jobs WHERE project_id = ? AND status = 'running' LIMIT 1").get(projectId) as
      | { readonly found: number }
      | undefined;
    return Boolean(row);
  }

  completeSummaryJob(jobId: string, now: string): void {
    this.db
      .prepare("UPDATE summary_jobs SET status = 'completed', finished_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, jobId);
  }

  failSummaryJob(jobId: string, error: string, nextRunAt: string | null, now: string): void {
    this.db
      .prepare("UPDATE summary_jobs SET status = 'failed', error = ?, next_run_at = ?, finished_at = ?, updated_at = ? WHERE id = ?")
      .run(error, nextRunAt, now, now, jobId);
  }

  cancelSummaryJob(jobId: string, error: string, now: string): void {
    this.db
      .prepare("UPDATE summary_jobs SET status = 'cancelled', error = ?, next_run_at = NULL, finished_at = ?, updated_at = ? WHERE id = ?")
      .run(error, now, now, jobId);
  }

  cancelRunningJobs(projectId: string, error: string, now: string): number {
    const result = this.db
      .prepare(
        `UPDATE summary_jobs
         SET status = 'cancelled', error = ?, next_run_at = NULL, finished_at = ?, updated_at = ?
         WHERE project_id = ? AND status = 'running'`
      )
      .run(error, now, now, projectId);
    return result.changes;
  }

  cancelQueuedAndRunningJobs(projectId: string, error: string, now: string): number {
    const result = this.db
      .prepare(
        `UPDATE summary_jobs
         SET status = 'cancelled', error = ?, next_run_at = NULL, finished_at = ?, updated_at = ?
         WHERE project_id = ? AND status IN ('queued', 'running')`
      )
      .run(error, now, now, projectId);
    return result.changes;
  }

  resetRunningJobs(projectId: string, now: string): void {
    this.db
      .prepare(
        `UPDATE summary_jobs
         SET status = 'queued', started_at = NULL, updated_at = ?
         WHERE project_id = ? AND status = 'running'`
      )
      .run(now, projectId);
  }

  private getJobById(jobId: string): SummaryJobRecord | null {
    const row = this.db.prepare("SELECT * FROM summary_jobs WHERE id = ?").get(jobId) as SummaryJobRow | undefined;
    return row ? mapSummaryJob(row) : null;
  }

  private findNextRunnableJobRow(projectId: string, now: string): SummaryJobRow | null {
    const row = this.db
      .prepare(
        `SELECT summary_jobs.*
         FROM summary_jobs
         LEFT JOIN chapters ON summary_jobs.job_type = 'chapter_summary'
          AND summary_jobs.target_id = chapters.id
          AND summary_jobs.project_id = chapters.project_id
         WHERE summary_jobs.project_id = ? AND summary_jobs.status = 'queued' AND (summary_jobs.next_run_at IS NULL OR summary_jobs.next_run_at <= ?)
         ORDER BY
           summary_jobs.priority DESC,
           CASE WHEN summary_jobs.job_type = 'chapter_summary' THEN COALESCE(chapters.sort_order, -1) ELSE -1 END DESC,
           summary_jobs.created_at ASC,
           summary_jobs.rowid ASC
         LIMIT 1`
      )
      .get(projectId, now) as SummaryJobRow | undefined;
    return row ?? null;
  }
}
