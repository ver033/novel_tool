import { createId } from "../../shared/ids";
import type { ChapterReviewAiToneRisk, ChapterReviewChapterResult, ChapterReviewRunRecord, ChapterReviewStatus } from "../../shared/chapter-review";
import { chapterReviewModelResponseSchema } from "../../shared/chapter-review";
import type { ProofreadIssue } from "../../shared/proofread";
import type { SqliteDatabase } from "../database";

type ChapterReviewRunRow = {
  readonly id: string;
  readonly project_id: string;
  readonly chapter_ids_json: string;
  readonly status: ChapterReviewStatus;
  readonly requested_at: string;
  readonly completed_at: string | null;
  readonly error: string | null;
};

type ChapterReviewChapterRow = {
  readonly id: string;
  readonly run_id: string;
  readonly project_id: string;
  readonly chapter_id: string;
  readonly chapter_title: string;
  readonly chapter_sort_order: number;
  readonly summary: string;
  readonly readability_score: number;
  readonly ai_tone_risk: ChapterReviewAiToneRisk;
  readonly issues_json: string;
  readonly issue_count: number;
  readonly chunk_count: number;
  readonly reviewed_at: string;
};

export type ChapterReviewRunInsert = {
  readonly id?: string;
  readonly projectId: string;
  readonly chapterIds: readonly string[];
  readonly status: ChapterReviewStatus;
  readonly requestedAt: string;
};

export type ChapterReviewChapterResultInsert = Omit<ChapterReviewChapterResult, "issueCount"> & {
  readonly id?: string;
};

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseIssues(value: string): ProofreadIssue[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return chapterReviewModelResponseSchema.shape.issues.parse(parsed);
  } catch {
    return [];
  }
}

function mapChapter(row: ChapterReviewChapterRow): ChapterReviewChapterResult {
  const issues = parseIssues(row.issues_json);
  return {
    id: row.id,
    runId: row.run_id,
    projectId: row.project_id,
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    chapterSortOrder: row.chapter_sort_order,
    summary: row.summary,
    readabilityScore: row.readability_score,
    aiToneRisk: row.ai_tone_risk,
    issues,
    issueCount: row.issue_count,
    chunkCount: row.chunk_count,
    reviewedAt: row.reviewed_at
  };
}

function mapRun(row: ChapterReviewRunRow, chapters: readonly ChapterReviewChapterResult[]): ChapterReviewRunRecord {
  const issueCount = chapters.reduce((total, chapter) => total + chapter.issueCount, 0);
  return {
    id: row.id,
    projectId: row.project_id,
    chapterIds: parseStringArray(row.chapter_ids_json),
    status: row.status,
    issueCount,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    error: row.error,
    chapters
  };
}

export class ChapterReviewRepository {
  constructor(private readonly db: SqliteDatabase) {}

  createRun(input: ChapterReviewRunInsert): ChapterReviewRunRecord {
    const id = input.id ?? createId("chapter_review_run");
    this.db
      .prepare(
        `INSERT INTO chapter_review_runs
         (id, project_id, chapter_ids_json, status, requested_at, completed_at, error)
         VALUES (?, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(id, input.projectId, JSON.stringify(input.chapterIds), input.status, input.requestedAt);
    const run = this.getRun(input.projectId, id);
    if (!run) {
      throw new Error("AI审稿记录创建失败。");
    }
    return run;
  }

  saveChapterResult(input: ChapterReviewChapterResultInsert): ChapterReviewChapterResult {
    const id = input.id ?? createId("chapter_review_chapter");
    const issueCount = input.issues.length;
    this.db
      .prepare(
        `INSERT INTO chapter_review_chapters
         (id, run_id, project_id, chapter_id, chapter_title, chapter_sort_order, summary, readability_score, ai_tone_risk, issues_json, issue_count, chunk_count, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, chapter_id) DO UPDATE SET
           chapter_title = excluded.chapter_title,
           chapter_sort_order = excluded.chapter_sort_order,
           summary = excluded.summary,
           readability_score = excluded.readability_score,
           ai_tone_risk = excluded.ai_tone_risk,
           issues_json = excluded.issues_json,
           issue_count = excluded.issue_count,
           chunk_count = excluded.chunk_count,
           reviewed_at = excluded.reviewed_at`
      )
      .run(
        id,
        input.runId,
        input.projectId,
        input.chapterId,
        input.chapterTitle,
        input.chapterSortOrder,
        input.summary,
        input.readabilityScore,
        input.aiToneRisk,
        JSON.stringify(input.issues),
        issueCount,
        input.chunkCount,
        input.reviewedAt
      );
    const saved = this.getChapterResult(input.projectId, input.runId, input.chapterId);
    if (!saved) {
      throw new Error("AI审稿章节结果保存失败。");
    }
    return saved;
  }

  completeRun(runId: string, projectId: string, completedAt: string): void {
    this.db
      .prepare("UPDATE chapter_review_runs SET status = 'completed', completed_at = ?, error = NULL WHERE id = ? AND project_id = ?")
      .run(completedAt, runId, projectId);
  }

  failRun(runId: string, projectId: string, error: string, completedAt: string): void {
    this.db
      .prepare("UPDATE chapter_review_runs SET status = 'failed', completed_at = ?, error = ? WHERE id = ? AND project_id = ?")
      .run(completedAt, error, runId, projectId);
  }

  getRun(projectId: string, runId: string): ChapterReviewRunRecord | null {
    const row = this.db.prepare("SELECT * FROM chapter_review_runs WHERE project_id = ? AND id = ?").get(projectId, runId) as
      | ChapterReviewRunRow
      | undefined;
    if (!row) {
      return null;
    }
    return mapRun(row, this.listChapterResults(projectId, runId));
  }

  listRuns(projectId: string, limit = 20): ChapterReviewRunRecord[] {
    return (this.db
      .prepare("SELECT * FROM chapter_review_runs WHERE project_id = ? ORDER BY requested_at DESC, rowid DESC LIMIT ?")
      .all(projectId, limit) as ChapterReviewRunRow[]).map((row) => mapRun(row, this.listChapterResults(projectId, row.id)));
  }

  deleteRun(projectId: string, runId: string): void {
    this.db.prepare("DELETE FROM chapter_review_runs WHERE project_id = ? AND id = ?").run(projectId, runId);
  }

  private getChapterResult(projectId: string, runId: string, chapterId: string): ChapterReviewChapterResult | null {
    const row = this.db
      .prepare("SELECT * FROM chapter_review_chapters WHERE project_id = ? AND run_id = ? AND chapter_id = ?")
      .get(projectId, runId, chapterId) as ChapterReviewChapterRow | undefined;
    return row ? mapChapter(row) : null;
  }

  private listChapterResults(projectId: string, runId: string): ChapterReviewChapterResult[] {
    return (this.db
      .prepare("SELECT * FROM chapter_review_chapters WHERE project_id = ? AND run_id = ? ORDER BY chapter_sort_order ASC, reviewed_at ASC")
      .all(projectId, runId) as ChapterReviewChapterRow[]).map(mapChapter);
  }
}
