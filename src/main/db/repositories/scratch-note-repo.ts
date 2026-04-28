import { createId } from "../../shared/ids";
import type { ScratchDeleteInput, ScratchListInput, ScratchNoteRecord, ScratchUpdateInput } from "../../shared/types";
import type { SqliteDatabase } from "../database";

type ScratchNoteRow = {
  readonly id: string;
  readonly project_id: string;
  readonly chapter_id: string | null;
  readonly content: string;
  readonly pinned: number;
  readonly source_task_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

type ScratchNoteCreateInput = {
  readonly projectId: string;
  readonly chapterId: string | null;
  readonly content: string;
  readonly pinned?: boolean;
  readonly sourceTaskId: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function mapScratchNote(row: ScratchNoteRow): ScratchNoteRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id,
    content: row.content,
    pinned: row.pinned === 1,
    sourceTaskId: row.source_task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class ScratchNoteRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: ScratchNoteCreateInput): ScratchNoteRecord {
    const createdAt = nowIso();
    const note = {
      id: createId("scratch"),
      projectId: input.projectId,
      chapterId: input.chapterId,
      content: input.content,
      pinned: input.pinned ?? false,
      sourceTaskId: input.sourceTaskId,
      createdAt,
      updatedAt: createdAt
    } satisfies ScratchNoteRecord;

    this.db
      .prepare(
        `INSERT INTO scratch_notes (
          id, project_id, chapter_id, content, pinned, source_task_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(note.id, note.projectId, note.chapterId, note.content, note.pinned ? 1 : 0, note.sourceTaskId, note.createdAt, note.updatedAt);

    return this.findById(note.id);
  }

  list(input: ScratchListInput): ScratchNoteRecord[] {
    const rows =
      input.chapterId !== undefined
        ? (this.db
            .prepare(
              `SELECT * FROM scratch_notes
               WHERE project_id = ? AND chapter_id = ?
               ORDER BY pinned DESC, updated_at DESC, rowid DESC`
            )
            .all(input.projectId, input.chapterId) as ScratchNoteRow[])
        : (this.db
            .prepare(
              `SELECT * FROM scratch_notes
               WHERE project_id = ?
               ORDER BY pinned DESC, updated_at DESC, rowid DESC`
            )
            .all(input.projectId) as ScratchNoteRow[]);

    return rows.map(mapScratchNote);
  }

  update(input: ScratchUpdateInput): ScratchNoteRecord {
    const current = this.findById(input.noteId);
    const nextContent = input.patch.content ?? current.content;
    const nextPinned = input.patch.pinned ?? current.pinned;
    const updatedAt = nowIso();

    this.db
      .prepare("UPDATE scratch_notes SET content = ?, pinned = ?, updated_at = ? WHERE id = ?")
      .run(nextContent, nextPinned ? 1 : 0, updatedAt, input.noteId);

    return this.findById(input.noteId);
  }

  delete(input: ScratchDeleteInput): void {
    this.db.prepare("DELETE FROM scratch_notes WHERE id = ?").run(input.noteId);
  }

  findById(noteId: string): ScratchNoteRecord {
    const row = this.db.prepare("SELECT * FROM scratch_notes WHERE id = ?").get(noteId) as ScratchNoteRow | undefined;
    if (!row) {
      throw new Error("Scratch note not found");
    }
    return mapScratchNote(row);
  }
}
