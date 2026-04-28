import { parseContentJson, serializeContentJson } from "../../chapter/default-content";
import type { SqliteDatabase } from "../database";
import type { ChapterContent, ChapterSnapshot, ChapterSummary } from "../../shared/types";

type ChapterRow = {
  readonly id: string;
  readonly project_id: string;
  readonly title: string;
  readonly volume_title: string | null;
  readonly sort_order: number;
  readonly content_json: string;
  readonly plain_text: string;
  readonly word_count: number;
  readonly daily_word_count: number;
  readonly target_word_count: number | null;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
};

type SnapshotRow = {
  readonly id: string;
  readonly chapter_id: string;
  readonly content_json: string;
  readonly plain_text: string;
  readonly reason: string | null;
  readonly created_at: string;
};

function mapSummary(row: ChapterRow): ChapterSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    volumeTitle: row.volume_title,
    sortOrder: row.sort_order,
    wordCount: row.word_count,
    dailyWordCount: row.daily_word_count,
    targetWordCount: row.target_word_count,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapContent(row: ChapterRow): ChapterContent {
  return {
    ...mapSummary(row),
    contentJson: parseContentJson(row.content_json),
    plainText: row.plain_text
  };
}

function mapSnapshot(row: SnapshotRow): ChapterSnapshot {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    contentJson: parseContentJson(row.content_json),
    plainText: row.plain_text,
    reason: row.reason,
    createdAt: row.created_at
  };
}

export class ChapterRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(chapter: ChapterContent): ChapterSummary {
    this.db
      .prepare(
        `INSERT INTO chapters (
          id, project_id, title, volume_title, sort_order, content_json, plain_text,
          word_count, daily_word_count, target_word_count, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        chapter.id,
        chapter.projectId,
        chapter.title,
        chapter.volumeTitle,
        chapter.sortOrder,
        serializeContentJson(chapter.contentJson),
        chapter.plainText,
        chapter.wordCount,
        chapter.dailyWordCount,
        chapter.targetWordCount,
        chapter.status,
        chapter.createdAt,
        chapter.updatedAt
      );

    return mapSummary(this.findRowById(chapter.id));
  }

  listByProject(projectId: string): ChapterSummary[] {
    return (
      this.db.prepare("SELECT * FROM chapters WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC").all(projectId) as ChapterRow[]
    ).map(mapSummary);
  }

  getContent(chapterId: string): ChapterContent | null {
    const row = this.db.prepare("SELECT * FROM chapters WHERE id = ?").get(chapterId) as ChapterRow | undefined;
    return row ? mapContent(row) : null;
  }

  rename(chapterId: string, title: string, updatedAt: string): ChapterSummary {
    this.db.prepare("UPDATE chapters SET title = ?, updated_at = ? WHERE id = ?").run(title, updatedAt, chapterId);
    return mapSummary(this.findRowById(chapterId));
  }

  delete(chapterId: string): void {
    this.db.prepare("DELETE FROM chapters WHERE id = ?").run(chapterId);
  }

  saveContent(chapterId: string, contentJson: unknown, plainText: string, wordCount: number, updatedAt: string): ChapterContent {
    this.db
      .prepare("UPDATE chapters SET content_json = ?, plain_text = ?, word_count = ?, updated_at = ? WHERE id = ?")
      .run(serializeContentJson(contentJson), plainText, wordCount, updatedAt, chapterId);

    const content = this.getContent(chapterId);
    if (!content) {
      throw new Error("Chapter not found");
    }
    return content;
  }

  createSnapshot(snapshot: ChapterSnapshot): ChapterSnapshot {
    this.db
      .prepare("INSERT INTO chapter_snapshots (id, chapter_id, content_json, plain_text, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(snapshot.id, snapshot.chapterId, serializeContentJson(snapshot.contentJson), snapshot.plainText, snapshot.reason, snapshot.createdAt);

    const row = this.db.prepare("SELECT * FROM chapter_snapshots WHERE id = ?").get(snapshot.id) as SnapshotRow | undefined;
    if (!row) {
      throw new Error("Chapter snapshot not found");
    }
    return mapSnapshot(row);
  }

  nextSortOrder(projectId: string): number {
    const row = this.db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextSortOrder FROM chapters WHERE project_id = ?").get(projectId) as
      | { nextSortOrder: number }
      | undefined;
    return row?.nextSortOrder ?? 0;
  }

  findRowById(chapterId: string): ChapterRow {
    const row = this.db.prepare("SELECT * FROM chapters WHERE id = ?").get(chapterId) as ChapterRow | undefined;
    if (!row) {
      throw new Error("Chapter not found");
    }
    return row;
  }

  transact<T>(fn: () => T): T {
    const transaction = this.db.transaction(fn);
    return transaction();
  }
}
