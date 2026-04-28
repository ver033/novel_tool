import { createId } from "../../shared/ids";
import type { ImportPreview, ImportPreviewChapter } from "../../shared/types";
import type { SqliteDatabase } from "../database";

type ImportJobRow = {
  readonly id: string;
  readonly project_id: string | null;
  readonly source_path: string;
  readonly source_type: "txt";
  readonly status: string;
  readonly parsed_json: string | null;
  readonly error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

type ImportJobPayload = {
  readonly fileName: string;
  readonly encoding: string;
  readonly rawText: string;
  readonly totalWordCount: number;
  readonly chapters: readonly ImportPreviewChapter[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function parsePayload(row: ImportJobRow): ImportJobPayload {
  if (!row.parsed_json) {
    throw new Error("Import job has no preview payload");
  }
  return JSON.parse(row.parsed_json) as ImportJobPayload;
}

function mapPreview(row: ImportJobRow): ImportPreview {
  const payload = parsePayload(row);
  return {
    importJobId: row.id,
    filePath: row.source_path,
    fileName: payload.fileName,
    encoding: payload.encoding,
    totalWordCount: payload.totalWordCount,
    chapters: payload.chapters,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function statusError(row: ImportJobRow): Error {
  if (row.status === "completed" || row.status === "writing") {
    return new Error("Import job has already been confirmed");
  }
  return new Error(`Import job is not ready for confirmation: ${row.status}`);
}

function assertPreviewStatus(row: ImportJobRow): void {
  if (row.status !== "preview") {
    throw statusError(row);
  }
}

export class ImportJobRepository {
  constructor(private readonly db: SqliteDatabase) {}

  createPreview(input: {
    readonly filePath: string;
    readonly fileName: string;
    readonly encoding: string;
    readonly rawText: string;
    readonly totalWordCount: number;
    readonly chapters: readonly ImportPreviewChapter[];
  }): ImportPreview {
    const createdAt = nowIso();
    const id = createId("import");
    this.db
      .prepare(
        `INSERT INTO import_jobs (
          id, project_id, source_path, source_type, status, parsed_json, error, created_at, updated_at
        ) VALUES (?, ?, ?, 'txt', 'preview', ?, NULL, ?, ?)`
      )
      .run(
        id,
        null,
        input.filePath,
        JSON.stringify({
          fileName: input.fileName,
          encoding: input.encoding,
          rawText: input.rawText,
          totalWordCount: input.totalWordCount,
          chapters: input.chapters
        } satisfies ImportJobPayload),
        createdAt,
        createdAt
      );

    return this.getPreview(id);
  }

  getPreview(importJobId: string): ImportPreview {
    return mapPreview(this.findRowById(importJobId));
  }

  getConfirmablePreview(importJobId: string): ImportPreview {
    const row = this.findRowById(importJobId);
    assertPreviewStatus(row);
    return mapPreview(row);
  }

  getStatus(importJobId: string): string {
    return this.findRowById(importJobId).status;
  }

  findRowById(importJobId: string): ImportJobRow {
    const row = this.db.prepare("SELECT * FROM import_jobs WHERE id = ?").get(importJobId) as ImportJobRow | undefined;
    if (!row) {
      throw new Error("Import job not found");
    }
    return row;
  }

  updatePreview(importJobId: string, chapters: readonly ImportPreviewChapter[]): ImportPreview {
    const current = this.getConfirmablePreview(importJobId);
    const rawText = this.getRawText(importJobId);
    const updatedAt = nowIso();
    this.db
      .prepare("UPDATE import_jobs SET parsed_json = ?, updated_at = ? WHERE id = ?")
      .run(
        JSON.stringify({
          fileName: current.fileName,
          encoding: current.encoding,
          rawText,
          totalWordCount: chapters.reduce((total, chapter) => total + chapter.wordCount, 0),
          chapters
        } satisfies ImportJobPayload),
        updatedAt,
        importJobId
      );

    return this.getPreview(importJobId);
  }

  getRawText(importJobId: string): string {
    return parsePayload(this.findRowById(importJobId)).rawText;
  }

  markWriting(importJobId: string): void {
    const result = this.db.prepare("UPDATE import_jobs SET status = 'writing', updated_at = ? WHERE id = ? AND status = 'preview'").run(nowIso(), importJobId);
    if (result.changes === 0) {
      throw statusError(this.findRowById(importJobId));
    }
  }

  markCompleted(importJobId: string, projectId: string): void {
    const result = this.db
      .prepare("UPDATE import_jobs SET status = 'completed', project_id = ?, updated_at = ? WHERE id = ? AND status = 'writing'")
      .run(projectId, nowIso(), importJobId);
    if (result.changes === 0) {
      throw statusError(this.findRowById(importJobId));
    }
  }
}
