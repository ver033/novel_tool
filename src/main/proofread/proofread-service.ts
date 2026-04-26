import crypto from 'node:crypto';
import Database from 'better-sqlite3';

type SqliteDb = InstanceType<typeof Database>;

export type IssueStatus =
  | 'open'
  | 'fixed'
  | 'ignored'
  | 'false_positive'
  | 'marked_as_foreshadowing'
  | 'marked_as_lie'
  | 'marked_as_unreliable_narration'
  | 'author_confirmed_exception';

export type ProofreadIssueType =
  | 'proofread_quote_mismatch'
  | 'proofread_repeated_punctuation'
  | 'proofread_repeated_word'
  | 'proofread_mixed_width_punctuation'
  | 'proofread_name_consistency';

export interface IssueEvidenceCard {
  paragraphId: string | null;
  quote: string;
  role: 'current' | 'conflicting' | 'supporting';
  note: string;
}

export interface IssueCard {
  id: string;
  type: ProofreadIssueType | string;
  severity: 'low' | 'medium' | 'high';
  title: string;
  explanation: string;
  suggestion: string;
  status: IssueStatus;
  currentParagraphId: string | null;
  sourceTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  evidence: IssueEvidenceCard[];
}

export interface ParagraphProofreadInput {
  paragraphId: string;
  friendlyLocation: string;
  text: string;
}

export interface RunRuleBasedProofreadInput {
  paragraphIds: string[];
  sourceTaskId?: string;
}

export interface IssueListFilter {
  currentParagraphId?: string;
  status?: IssueStatus;
  limit?: number;
}

const repeatedCharacterAllowlist = new Set([
  '看看',
  '想想',
  '听听',
  '走走',
  '说说',
  '笑笑',
  '人人',
  '天天',
  '慢慢',
  '轻轻',
  '渐渐',
  '偏偏',
  '明明',
  '隐隐',
  '微微',
]);

function openDb(dbPath: string): SqliteDb {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  return db;
}

function shortHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 14);
}

function issueIdFor(paragraphId: string, type: string, quote: string): string {
  return `issue-${shortHash(`${paragraphId}:${type}:${quote}`)}`;
}

function evidenceIdFor(issueId: string, paragraphId: string | null, quote: string): string {
  return `iev-${shortHash(`${issueId}:${paragraphId ?? ''}:${quote}`)}`;
}

function quoteAround(text: string, start: number, end: number): string {
  const safeStart = Math.max(0, start - 24);
  const safeEnd = Math.min(text.length, end + 24);
  return text.slice(safeStart, safeEnd).trim();
}

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function makeIssue(
  input: ParagraphProofreadInput,
  issue: Omit<IssueCard, 'id' | 'status' | 'currentParagraphId' | 'sourceTaskId' | 'createdAt' | 'updatedAt' | 'evidence'> & {
    quote: string;
    note: string;
  }
): IssueCard {
  const timestamp = new Date().toISOString();
  const id = issueIdFor(input.paragraphId, issue.type, issue.quote);
  return {
    id,
    type: issue.type,
    severity: issue.severity,
    title: issue.title,
    explanation: `${input.friendlyLocation}：${issue.explanation}`,
    suggestion: issue.suggestion,
    status: 'open',
    currentParagraphId: input.paragraphId,
    sourceTaskId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    evidence: [
      {
        paragraphId: input.paragraphId,
        quote: issue.quote,
        role: 'current',
        note: issue.note,
      },
    ],
  };
}

export function proofreadParagraphText(input: ParagraphProofreadInput): IssueCard[] {
  const issues: IssueCard[] = [];
  const text = input.text;

  const openDouble = countMatches(text, /“/g);
  const closeDouble = countMatches(text, /”/g);
  const openSingle = countMatches(text, /‘/g);
  const closeSingle = countMatches(text, /’/g);
  const straightDouble = countMatches(text, /"/g);
  if (openDouble !== closeDouble || openSingle !== closeSingle || straightDouble % 2 !== 0) {
    issues.push(
      makeIssue(input, {
        type: 'proofread_quote_mismatch',
        severity: 'medium',
        title: '引号可能未闭合',
        explanation: '中文引号或英文双引号数量不成对，可能会影响对白边界。',
        suggestion: '检查这一段的对白起止位置，补齐或删除多余引号。',
        quote: quoteAround(text, 0, Math.min(text.length, 80)),
        note: '引号配对检查',
      })
    );
  }

  for (const match of text.matchAll(/[！？!?。；;，,：:]{2,}/g)) {
    const quote = quoteAround(text, match.index ?? 0, (match.index ?? 0) + match[0].length);
    issues.push(
      makeIssue(input, {
        type: 'proofread_repeated_punctuation',
        severity: 'low',
        title: '重复标点可能过重',
        explanation: '连续标点可能是输入误触，也可能让语气显得过满。',
        suggestion: '如果不是刻意强调，建议改为单个中文标点。',
        quote,
        note: `重复标点：${match[0]}`,
      })
    );
  }

  for (const match of text.matchAll(/([\u4e00-\u9fff])\1/g)) {
    const pair = match[0];
    if (repeatedCharacterAllowlist.has(pair)) {
      continue;
    }
    const quote = quoteAround(text, match.index ?? 0, (match.index ?? 0) + pair.length);
    issues.push(
      makeIssue(input, {
        type: 'proofread_repeated_word',
        severity: 'medium',
        title: '疑似重复字',
        explanation: '同一个汉字连续重复，可能是输入时多打了一次。',
        suggestion: '确认是否为刻意叠词；如果不是，删除重复字。',
        quote,
        note: `重复字：${pair}`,
      })
    );
  }

  for (const match of text.matchAll(/[\u4e00-\u9fff][,;:!?][\u4e00-\u9fff]/g)) {
    const quote = quoteAround(text, match.index ?? 0, (match.index ?? 0) + match[0].length);
    issues.push(
      makeIssue(input, {
        type: 'proofread_mixed_width_punctuation',
        severity: 'low',
        title: '中文句中混入半角标点',
        explanation: '中文正文中夹了半角标点，排版和阅读节奏可能不统一。',
        suggestion: '改为对应中文全角标点。',
        quote,
        note: `半角标点片段：${match[0]}`,
      })
    );
  }

  return issues;
}

function readParagraphsForProofread(db: SqliteDb, paragraphIds: string[]): ParagraphProofreadInput[] {
  if (paragraphIds.length === 0) {
    throw new Error('请先选择要校对的段落或引用范围');
  }

  const rows = db
    .prepare(
      `SELECT paragraphs.id,
              paragraphs.text,
              paragraphs.paragraph_index,
              chapters.title AS chapter_title
       FROM paragraphs
       JOIN chapters ON chapters.id = paragraphs.chapter_id
       WHERE paragraphs.id IN (${paragraphIds.map(() => '?').join(',')})
       ORDER BY chapters.chapter_index, paragraphs.paragraph_index`
    )
    .all(...paragraphIds) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    paragraphId: String(row.id),
    friendlyLocation: `${String(row.chapter_title)} / 第 ${Number(row.paragraph_index) + 1} 段`,
    text: String(row.text),
  }));
}

function toStoredIssue(row: Record<string, unknown>, evidence: IssueEvidenceCard[]): IssueCard {
  return {
    id: String(row.id),
    type: String(row.type),
    severity: String(row.severity) as IssueCard['severity'],
    title: String(row.title),
    explanation: String(row.explanation),
    suggestion: row.suggestion == null ? '' : String(row.suggestion),
    status: String(row.status) as IssueStatus,
    currentParagraphId: row.current_paragraph_id == null ? null : String(row.current_paragraph_id),
    sourceTaskId: row.source_task_id == null ? null : String(row.source_task_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    evidence,
  };
}

function listEvidence(db: SqliteDb, issueIds: string[]): Map<string, IssueEvidenceCard[]> {
  const map = new Map<string, IssueEvidenceCard[]>();
  if (issueIds.length === 0) {
    return map;
  }
  const rows = db
    .prepare(
      `SELECT issue_id, paragraph_id, quote, role, note
       FROM issue_evidence
       WHERE issue_id IN (${issueIds.map(() => '?').join(',')})
       ORDER BY id`
    )
    .all(...issueIds) as Array<Record<string, unknown>>;
  for (const row of rows) {
    const issueId = String(row.issue_id);
    const list = map.get(issueId) ?? [];
    list.push({
      paragraphId: row.paragraph_id == null ? null : String(row.paragraph_id),
      quote: String(row.quote),
      role: String(row.role) as IssueEvidenceCard['role'],
      note: row.note == null ? '' : String(row.note),
    });
    map.set(issueId, list);
  }
  return map;
}

function getIssueById(db: SqliteDb, issueId: string): IssueCard | undefined {
  const row = db
    .prepare(
      `SELECT id, type, severity, title, explanation, suggestion, status, current_paragraph_id, source_task_id, created_at, updated_at
       FROM issues
       WHERE id = ?`
    )
    .get(issueId) as Record<string, unknown> | undefined;
  if (!row) {
    return undefined;
  }
  const evidence = listEvidence(db, [issueId]);
  return toStoredIssue(row, evidence.get(issueId) ?? []);
}

function persistIssues(dbPath: string, db: SqliteDb, issues: IssueCard[], sourceTaskId?: string): IssueCard[] {
  const timestamp = new Date().toISOString();
  const write = db.transaction(() => {
    for (const issue of issues) {
      db.prepare(
        `INSERT INTO issues
         (id, type, severity, title, explanation, suggestion, status, current_paragraph_id, source_task_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           severity = excluded.severity,
           title = excluded.title,
           explanation = excluded.explanation,
           suggestion = excluded.suggestion,
           source_task_id = excluded.source_task_id,
           updated_at = excluded.updated_at`
      ).run(
        issue.id,
        issue.type,
        issue.severity,
        issue.title,
        issue.explanation,
        issue.suggestion,
        issue.currentParagraphId,
        sourceTaskId ?? issue.sourceTaskId,
        timestamp,
        timestamp
      );
      for (const evidence of issue.evidence) {
        db.prepare(
          `INSERT OR IGNORE INTO issue_evidence
           (id, issue_id, paragraph_id, quote, role, note)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(evidenceIdFor(issue.id, evidence.paragraphId, evidence.quote), issue.id, evidence.paragraphId, evidence.quote, evidence.role, evidence.note);
      }
    }
  });
  write();
  return listIssues(dbPath, {
    status: 'open',
    limit: Math.max(issues.length, 1),
  }).filter((issue) => issues.some((candidate) => candidate.id === issue.id));
}

export function runRuleBasedProofread(
  dbPath: string,
  input: RunRuleBasedProofreadInput
): { issues: IssueCard[]; checkedParagraphCount: number } {
  const db = openDb(dbPath);
  try {
    const paragraphs = readParagraphsForProofread(db, input.paragraphIds);
    const issues = paragraphs.flatMap((paragraph) => proofreadParagraphText(paragraph));
    return {
      issues: persistIssues(dbPath, db, issues, input.sourceTaskId),
      checkedParagraphCount: paragraphs.length,
    };
  } finally {
    db.close();
  }
}

export function listIssues(dbPath: string, filter: IssueListFilter = {}): IssueCard[] {
  const db = openDb(dbPath);
  try {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.currentParagraphId) {
      clauses.push('current_paragraph_id = ?');
      params.push(filter.currentParagraphId);
    }
    if (filter.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT id, type, severity, title, explanation, suggestion, status, current_paragraph_id, source_task_id, created_at, updated_at
         FROM issues
         ${where}
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(...params, filter.limit ?? 100) as Array<Record<string, unknown>>;
    const evidence = listEvidence(
      db,
      rows.map((row) => String(row.id))
    );
    return rows.map((row) => toStoredIssue(row, evidence.get(String(row.id)) ?? []));
  } finally {
    db.close();
  }
}

export function updateIssueStatus(
  dbPath: string,
  input: { issueId: string; status: IssueStatus }
): IssueCard {
  const db = openDb(dbPath);
  try {
    const timestamp = new Date().toISOString();
    const result = db
      .prepare('UPDATE issues SET status = ?, updated_at = ? WHERE id = ?')
      .run(input.status, timestamp, input.issueId);
    if (result.changes === 0) {
      throw new Error('问题卡不存在');
    }
    const issue = getIssueById(db, input.issueId);
    if (!issue) {
      throw new Error('问题卡读取失败');
    }
    return issue;
  } finally {
    db.close();
  }
}
