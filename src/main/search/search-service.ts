import Database from 'better-sqlite3';

type SqliteDb = InstanceType<typeof Database>;

export interface SearchParagraphInput {
  query: string;
  limit: number;
}

export interface SearchResultItem {
  paragraphId: string;
  chapterId: string;
  chapterTitle: string;
  friendlyLocation: string;
  snippet: string;
  text: string;
}

export interface SearchParagraphResult {
  query: string;
  results: SearchResultItem[];
}

export interface SearchReferenceItem {
  paragraphId: string;
  chapterId: string;
  chapterTitle: string;
  friendlyLocation: string;
  text: string;
}

export interface SearchReferencesResult {
  references: SearchReferenceItem[];
}

export interface SearchReferencesWithMissingResult extends SearchReferencesResult {
  missingParagraphIds: string[];
}

export type ReferenceBasketMode = 'add' | 'replace' | 'clear';

const cjkPattern = /[\u3400-\u9fff\uf900-\ufaff]/u;
const tokenPattern = /[\u3400-\u9fff\uf900-\ufaff]|[A-Za-z0-9_]+/gu;

function openDb(dbPath: string): SqliteDb {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  return db;
}

function tokenizeForFts(value: string): string {
  return Array.from(value.matchAll(tokenPattern), (match) => match[0]).join(' ');
}

function toFtsQuery(value: string): string {
  const tokens = Array.from(value.matchAll(tokenPattern), (match) => match[0]).filter(Boolean);
  if (tokens.length === 0) {
    throw new Error('请输入可搜索的关键词');
  }
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' ');
}

function cjkExactTerms(value: string): string[] {
  if (!cjkPattern.test(value)) {
    return [];
  }
  const terms = value
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && cjkPattern.test(term));
  if (terms.length > 0) {
    return terms;
  }
  const compact = value.replace(/\s+/g, '');
  return compact.length >= 2 && cjkPattern.test(compact) ? [compact] : [];
}

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function makeFriendlyLocation(chapterTitle: string, paragraphIndex: number): string {
  return `${chapterTitle} / 第 ${paragraphIndex + 1} 段`;
}

function makeSnippet(text: string, query: string): string {
  const directIndex = text.indexOf(query);
  const index = directIndex >= 0 ? directIndex : 0;
  const start = Math.max(0, index - 28);
  const end = Math.min(text.length, index + Math.max(query.length, 36));
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function indexRows(db: SqliteDb, paragraphId?: string): number {
  const where = paragraphId ? 'WHERE paragraphs.id = ?' : '';
  const params = paragraphId ? [paragraphId] : [];
  const rows = db
    .prepare(
      `SELECT paragraphs.id AS paragraph_id,
              paragraphs.chapter_id,
              paragraphs.paragraph_index,
              paragraphs.text,
              chapters.title AS chapter_title
       FROM paragraphs
       JOIN chapters ON chapters.id = paragraphs.chapter_id
       ${where}
       ORDER BY chapters.chapter_index ASC, paragraphs.paragraph_index ASC`
    )
    .all(...params) as Array<Record<string, unknown>>;

  const insert = db.prepare(
    `INSERT INTO paragraphs_fts (paragraph_id, chapter_id, chapter_title, friendly_location, text)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const row of rows) {
    const text = String(row.text);
    const chapterTitle = String(row.chapter_title);
    const paragraphIndex = Number(row.paragraph_index);
    insert.run(
      String(row.paragraph_id),
      String(row.chapter_id),
      tokenizeForFts(chapterTitle),
      makeFriendlyLocation(chapterTitle, paragraphIndex),
      tokenizeForFts(text)
    );
  }
  return rows.length;
}

export function rebuildParagraphSearchIndexForDb(db: SqliteDb): number {
  const rebuild = db.transaction(() => {
    db.prepare('DELETE FROM paragraphs_fts').run();
    return indexRows(db);
  });
  return rebuild();
}

export function rebuildParagraphSearchIndex(dbPath: string): number {
  const db = openDb(dbPath);
  try {
    return rebuildParagraphSearchIndexForDb(db);
  } finally {
    db.close();
  }
}

export function upsertParagraphSearchIndexForDb(db: SqliteDb, paragraphId: string): number {
  const upsert = db.transaction(() => {
    db.prepare('DELETE FROM paragraphs_fts WHERE paragraph_id = ?').run(paragraphId);
    return indexRows(db, paragraphId);
  });
  return upsert();
}

export function upsertParagraphSearchIndex(dbPath: string, paragraphId: string): number {
  const db = openDb(dbPath);
  try {
    return upsertParagraphSearchIndexForDb(db, paragraphId);
  } finally {
    db.close();
  }
}

export function searchParagraphs(dbPath: string, input: SearchParagraphInput): SearchParagraphResult {
  const query = input.query.trim();
  if (!query) {
    throw new Error('请输入搜索关键词');
  }
  const exactTerms = cjkExactTerms(query);
  const ftsQuery = exactTerms.length > 0 ? '' : toFtsQuery(query);
  const db = openDb(dbPath);
  try {
    const rows = exactTerms.length > 0
      ? (db
          .prepare(
            `SELECT paragraphs.id AS paragraph_id,
                    chapters.id AS chapter_id,
                    chapters.title AS chapter_title,
                    paragraphs.paragraph_index,
                    paragraphs.text
             FROM paragraphs
             JOIN chapters ON chapters.id = paragraphs.chapter_id
             WHERE ${exactTerms.map(() => "paragraphs.text LIKE ? ESCAPE '\\'").join(' AND ')}
             ORDER BY chapters.chapter_index ASC, paragraphs.paragraph_index ASC
             LIMIT ?`
          )
          .all(...exactTerms.map((term) => `%${escapeSqlLike(term)}%`), input.limit) as Array<Record<string, unknown>>)
      : (db
          .prepare(
            `SELECT paragraphs.id AS paragraph_id,
                    chapters.id AS chapter_id,
                    chapters.title AS chapter_title,
                    paragraphs.paragraph_index,
                    paragraphs.text,
                    bm25(paragraphs_fts) AS rank
             FROM paragraphs_fts
             JOIN paragraphs ON paragraphs.id = paragraphs_fts.paragraph_id
             JOIN chapters ON chapters.id = paragraphs.chapter_id
             WHERE paragraphs_fts MATCH ?
             ORDER BY rank ASC
             LIMIT ?`
          )
          .all(ftsQuery, input.limit) as Array<Record<string, unknown>>);

    return {
      query,
      results: rows.map((row) => {
        const text = String(row.text);
        const chapterTitle = String(row.chapter_title);
        const paragraphIndex = Number(row.paragraph_index);
        const snippetQuery = exactTerms[0] ?? query;
        return {
          paragraphId: String(row.paragraph_id),
          chapterId: String(row.chapter_id),
          chapterTitle,
          friendlyLocation: makeFriendlyLocation(chapterTitle, paragraphIndex),
          snippet: makeSnippet(text, snippetQuery),
          text,
        };
      }),
    };
  } finally {
    db.close();
  }
}

export function getParagraphReferencesWithMissing(dbPath: string, paragraphIds: string[]): SearchReferencesWithMissingResult {
  const db = openDb(dbPath);
  try {
    const read = db.prepare(
      `SELECT paragraphs.id AS paragraph_id,
              chapters.id AS chapter_id,
              chapters.title AS chapter_title,
              paragraphs.paragraph_index,
              paragraphs.text
       FROM paragraphs
       JOIN chapters ON chapters.id = paragraphs.chapter_id
       WHERE paragraphs.id = ?`
    );
    const missingParagraphIds: string[] = [];
    const references: SearchReferenceItem[] = [];
    for (const paragraphId of paragraphIds) {
      const row = read.get(paragraphId) as Record<string, unknown> | undefined;
      if (!row) {
        missingParagraphIds.push(paragraphId);
        continue;
      }
      const chapterTitle = String(row.chapter_title);
      references.push({
        paragraphId: String(row.paragraph_id),
        chapterId: String(row.chapter_id),
        chapterTitle,
        friendlyLocation: makeFriendlyLocation(chapterTitle, Number(row.paragraph_index)),
        text: String(row.text),
      });
    }
    return {
      references,
      missingParagraphIds,
    };
  } finally {
    db.close();
  }
}

export function getParagraphReferences(dbPath: string, paragraphIds: string[]): SearchReferencesResult {
  const result = getParagraphReferencesWithMissing(dbPath, paragraphIds);
  if (result.missingParagraphIds.length > 0) {
    throw new Error(`段落不存在：${result.missingParagraphIds[0]}`);
  }
  return { references: result.references };
}

export function updateReferenceBasketIds(
  currentParagraphIds: string[],
  incomingParagraphIds: string[],
  mode: ReferenceBasketMode
): string[] {
  if (mode === 'clear') {
    return [];
  }
  if (mode === 'replace') {
    return [...new Set(incomingParagraphIds)];
  }
  return [...new Set([...currentParagraphIds, ...incomingParagraphIds])];
}

export function resolveSearchMentionReferences(
  dbPath: string,
  input: { mention: string; limit: number }
): SearchReferencesResult {
  const prefix = '@search:';
  if (!input.mention.startsWith(prefix)) {
    throw new Error('搜索引用必须使用 @search:关键词 格式');
  }
  const query = input.mention.slice(prefix.length).trim();
  if (!query) {
    throw new Error('请输入 @search 的关键词');
  }
  const result = searchParagraphs(dbPath, { query, limit: input.limit });
  return getParagraphReferences(
    dbPath,
    result.results.map((item) => item.paragraphId)
  );
}
