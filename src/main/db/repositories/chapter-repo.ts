import { parseContentJson, serializeContentJson } from "../../chapter/default-content";
import type { SqliteDatabase } from "../database";
import type { ChapterContent, ChapterSnapshot, ChapterSummary } from "../../shared/types";
import { countWritingUnits } from "../../shared/text";

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
  readonly daily_word_count_date: string | null;
  readonly target_word_count: number | null;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
};

type ExpectedChapterSaveRow = {
  readonly contentJson: string;
  readonly dailyWordCount: number;
  readonly dailyWordCountDate: string;
  readonly plainText: string;
  readonly updatedAt: string;
  readonly wordCount: number;
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
  const wordCount = countWritingUnits(row.plain_text);
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    volumeTitle: row.volume_title,
    sortOrder: row.sort_order,
    wordCount,
    dailyWordCount: row.daily_word_count,
    dailyWordCountDate: row.daily_word_count_date,
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

function assertSavedRowMatches(row: ChapterRow, expected: ExpectedChapterSaveRow): void {
  const mismatches: string[] = [];
  if (row.content_json !== expected.contentJson) {
    mismatches.push("格式内容");
  }
  if (row.plain_text !== expected.plainText) {
    mismatches.push("纯文本");
  }
  if (row.word_count !== expected.wordCount) {
    mismatches.push("字数");
  }
  if (row.daily_word_count !== expected.dailyWordCount) {
    mismatches.push("今日字数");
  }
  if (row.daily_word_count_date !== expected.dailyWordCountDate) {
    mismatches.push("今日字数日期");
  }
  if (row.updated_at !== expected.updatedAt) {
    mismatches.push("更新时间");
  }
  if (mismatches.length > 0) {
    throw new Error(`章节保存后读回校验失败：${mismatches.join("、")}不一致。为防止丢稿，本次保存已中止。`);
  }
}

export class ChapterRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(chapter: ChapterContent, options: { readonly shiftExistingAtSortOrder?: boolean } = {}): ChapterSummary {
    const insertChapter = () => {
      if (options.shiftExistingAtSortOrder) {
        this.db
          .prepare("UPDATE chapters SET sort_order = sort_order + 1, updated_at = ? WHERE project_id = ? AND sort_order >= ?")
          .run(chapter.updatedAt, chapter.projectId, chapter.sortOrder);
      }
      this.db
        .prepare(
          `INSERT INTO chapters (
          id, project_id, title, volume_title, sort_order, content_json, plain_text,
          word_count, daily_word_count, daily_word_count_date, target_word_count, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          chapter.dailyWordCountDate,
          chapter.targetWordCount,
          chapter.status,
          chapter.createdAt,
          chapter.updatedAt
        );
    };

    if (options.shiftExistingAtSortOrder) {
      this.db.transaction(insertChapter)();
    } else {
      insertChapter();
    }

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

  saveContent(
    chapterId: string,
    contentJson: unknown,
    plainText: string,
    wordCount: number,
    dailyWordCount: number,
    dailyWordCountDate: string,
    updatedAt: string,
    expectedUpdatedAt?: string
  ): ChapterContent {
    const serializedContent = serializeContentJson(contentJson);
    return this.db.transaction(() => {
      const result = expectedUpdatedAt
        ? this.db
            .prepare(
              `UPDATE chapters
               SET content_json = ?, plain_text = ?, word_count = ?, daily_word_count = ?, daily_word_count_date = ?, updated_at = ?
               WHERE id = ? AND updated_at = ?`
            )
            .run(serializedContent, plainText, wordCount, dailyWordCount, dailyWordCountDate, updatedAt, chapterId, expectedUpdatedAt)
        : this.db
            .prepare(
              "UPDATE chapters SET content_json = ?, plain_text = ?, word_count = ?, daily_word_count = ?, daily_word_count_date = ?, updated_at = ? WHERE id = ?"
            )
            .run(serializedContent, plainText, wordCount, dailyWordCount, dailyWordCountDate, updatedAt, chapterId);
      if (expectedUpdatedAt && result.changes === 0) {
        throw new Error("章节内容已被其他操作更新，请重新载入后再保存。");
      }

      const row = this.findRowById(chapterId);
      assertSavedRowMatches(row, {
        contentJson: serializedContent,
        dailyWordCount,
        dailyWordCountDate,
        plainText,
        updatedAt,
        wordCount
      });
      return mapContent(row);
    })();
  }

  updateTargetWordCount(chapterId: string, targetWordCount: number | null, updatedAt: string): ChapterSummary {
    this.db.prepare("UPDATE chapters SET target_word_count = ?, updated_at = ? WHERE id = ?").run(targetWordCount, updatedAt, chapterId);
    return mapSummary(this.findRowById(chapterId));
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
