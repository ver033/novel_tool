import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { diffWordsWithSpace } from 'diff';
import { isLegacyEmptyEpubSpinePlaceholder } from './chapter-artifacts';
import { upsertParagraphSearchIndexForDb } from '../search/search-service';

type SqliteDb = InstanceType<typeof Database>;

export interface ChapterListItem {
  id: string;
  title: string;
  index: number;
  wordCount: number;
  paragraphCount: number;
}

export interface EditableParagraph {
  id: string;
  index: number;
  friendlyLabel: string;
  text: string;
  version: number;
}

export interface EditableChapter {
  id: string;
  title: string;
  index: number;
  paragraphs: EditableParagraph[];
}

export interface UpdateParagraphInput {
  paragraphId: string;
  text: string;
  changeReason?: string;
}

export interface UpdateParagraphResult {
  paragraphId: string;
  version: number;
  changed: boolean;
  updatedAt: string;
}

export interface RevisionListFilter {
  scopeType?: string;
  scopeId?: string;
}

export interface RevisionListItem {
  id: string;
  scopeType: string;
  scopeId: string;
  beforeText: string;
  afterText: string;
  diffJson: unknown;
  status: string;
  createdAt: string;
}

export interface RestoreRevisionInput {
  revisionId: string;
}

function shortHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 10);
}

function padded(value: number): string {
  return String(value).padStart(4, '0');
}

function openDb(dbPath: string): SqliteDb {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  return db;
}

function toChapterListItem(row: Record<string, unknown>): ChapterListItem {
  return {
    id: String(row.id),
    title: String(row.title),
    index: Number(row.chapter_index),
    wordCount: Number(row.word_count),
    paragraphCount: Number(row.paragraph_count),
  };
}

function toEditableParagraph(row: Record<string, unknown>): EditableParagraph {
  const index = Number(row.paragraph_index);
  return {
    id: String(row.id),
    index,
    friendlyLabel: `第 ${index + 1} 段`,
    text: String(row.text),
    version: Number(row.version),
  };
}

function toRevisionListItem(row: Record<string, unknown>): RevisionListItem {
  return {
    id: String(row.id),
    scopeType: String(row.scope_type),
    scopeId: String(row.scope_id),
    beforeText: String(row.before_text),
    afterText: String(row.after_text),
    diffJson: JSON.parse(String(row.diff_json)),
    status: String(row.status),
    createdAt: String(row.created_at),
  };
}

function updateChapterWordCount(db: SqliteDb, chapterId: string): void {
  db.prepare(
    `UPDATE chapters
     SET word_count = COALESCE((SELECT SUM(LENGTH(text)) FROM paragraphs WHERE chapter_id = ?), 0),
         updated_at = ?
     WHERE id = ?`
  ).run(chapterId, new Date().toISOString(), chapterId);
}

export function listChaptersForProject(dbPath: string): ChapterListItem[] {
  const db = openDb(dbPath);
  try {
    const rows = db
      .prepare(
        `SELECT chapters.id,
                chapters.title,
                chapters.chapter_index,
                chapters.source_type,
                chapters.word_count,
                COUNT(paragraphs.id) AS paragraph_count
         FROM chapters
         LEFT JOIN paragraphs ON paragraphs.chapter_id = chapters.id
         GROUP BY chapters.id
         ORDER BY chapters.chapter_index ASC`
      )
      .all() as Array<Record<string, unknown>>;
    return rows
      .filter(
        (row) =>
          !isLegacyEmptyEpubSpinePlaceholder({
            paragraphCount: Number(row.paragraph_count),
            sourceType: String(row.source_type),
            title: String(row.title),
          })
      )
      .map(toChapterListItem);
  } finally {
    db.close();
  }
}

export function getChapterForEditing(dbPath: string, chapterId: string): EditableChapter {
  const db = openDb(dbPath);
  try {
    const chapter = db.prepare('SELECT id, title, chapter_index FROM chapters WHERE id = ?').get(chapterId) as
      | Record<string, unknown>
      | undefined;
    if (!chapter) {
      throw new Error('章节不存在');
    }

    const rows = db
      .prepare(
        `SELECT id, paragraph_index, text, version
         FROM paragraphs
         WHERE chapter_id = ?
         ORDER BY paragraph_index ASC`
      )
      .all(chapterId) as Array<Record<string, unknown>>;

    return {
      id: String(chapter.id),
      title: String(chapter.title),
      index: Number(chapter.chapter_index),
      paragraphs: rows.map(toEditableParagraph),
    };
  } finally {
    db.close();
  }
}

export function updateParagraphText(dbPath: string, input: UpdateParagraphInput): UpdateParagraphResult {
  const db = openDb(dbPath);
  try {
    const current = db
      .prepare('SELECT id, chapter_id, text, version, updated_at FROM paragraphs WHERE id = ?')
      .get(input.paragraphId) as Record<string, unknown> | undefined;
    if (!current) {
      throw new Error('段落不存在');
    }

    const currentText = String(current.text);
    const currentVersion = Number(current.version);
    if (currentText === input.text) {
      return {
        paragraphId: input.paragraphId,
        version: currentVersion,
        changed: false,
        updatedAt: String(current.updated_at),
      };
    }

    const nextVersion = currentVersion + 1;
    const timestamp = new Date().toISOString();
    const chapterId = String(current.chapter_id);
    const diffJson = JSON.stringify(diffWordsWithSpace(currentText, input.text));

    const writeUpdate = db.transaction(() => {
      db.prepare(
        `UPDATE paragraphs
         SET text = ?, text_hash = ?, version = ?, updated_at = ?
         WHERE id = ?`
      ).run(input.text, shortHash(input.text), nextVersion, timestamp, input.paragraphId);
      db.prepare(
        `INSERT INTO paragraph_versions (id, paragraph_id, version, text, change_reason, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'author', ?)`
      ).run(
        `pver-${input.paragraphId}-${padded(nextVersion)}`,
        input.paragraphId,
        nextVersion,
        input.text,
        input.changeReason ?? 'manual_edit',
        timestamp
      );
      db.prepare(
        `INSERT INTO revisions
         (id, scope_type, scope_id, before_text, after_text, diff_json, source_task_id, status, created_at)
         VALUES (?, 'paragraph', ?, ?, ?, ?, NULL, 'applied', ?)`
      ).run(`rev-${crypto.randomUUID()}`, input.paragraphId, currentText, input.text, diffJson, timestamp);
      updateChapterWordCount(db, chapterId);
    });

    writeUpdate();
    upsertParagraphSearchIndexForDb(db, input.paragraphId);
    return {
      paragraphId: input.paragraphId,
      version: nextVersion,
      changed: true,
      updatedAt: timestamp,
    };
  } finally {
    db.close();
  }
}

export function listRevisions(dbPath: string, filter: RevisionListFilter = {}): RevisionListItem[] {
  const db = openDb(dbPath);
  try {
    const clauses: string[] = ["status = 'applied'"];
    const params: string[] = [];
    if (filter.scopeType) {
      clauses.push('scope_type = ?');
      params.push(filter.scopeType);
    }
    if (filter.scopeId) {
      clauses.push('scope_id = ?');
      params.push(filter.scopeId);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT id, scope_type, scope_id, before_text, after_text, diff_json, status, created_at
         FROM revisions
         ${where}
         ORDER BY created_at DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map(toRevisionListItem);
  } finally {
    db.close();
  }
}

export function restoreRevision(dbPath: string, input: RestoreRevisionInput): UpdateParagraphResult {
  const db = openDb(dbPath);
  let revision: Record<string, unknown> | undefined;
  try {
    revision = db
      .prepare("SELECT id, scope_type, scope_id, before_text FROM revisions WHERE id = ? AND status = 'applied'")
      .get(input.revisionId) as Record<string, unknown> | undefined;
  } finally {
    db.close();
  }

  if (!revision) {
    throw new Error('版本记录不存在');
  }
  if (String(revision.scope_type) !== 'paragraph') {
    throw new Error('当前只支持恢复段落版本');
  }

  return updateParagraphText(dbPath, {
    paragraphId: String(revision.scope_id),
    text: String(revision.before_text),
    changeReason: `restore:${String(revision.id)}`,
  });
}
