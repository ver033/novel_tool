import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { diffWordsWithSpace } from 'diff';
import { z } from 'zod';

import { upsertParagraphSearchIndexForDb } from '../search/search-service';

type SqliteDb = InstanceType<typeof Database>;

const polishStructuredOutputSchema = z.object({
  revised_text: z.string().min(1),
  edit_summary: z.string().min(1),
  changed_facts: z.array(z.unknown()).default([]),
  risk_flags: z
    .array(
      z.object({
        type: z.string().min(1),
        description: z.string().min(1),
      })
    )
    .default([]),
});

export interface PolishStructuredOutput {
  revisedText: string;
  editSummary: string;
  changedFacts: unknown[];
  riskFlags: Array<{ type: string; description: string }>;
}

export interface PolishPromptOptions {
  strength?: 'light' | 'medium' | 'heavy';
  focus?: string;
  forbiddenChanges?: string;
}

export interface CreatePolishRevisionCandidateInput {
  paragraphId: string;
  sourceTaskId: string;
  structuredOutput: PolishStructuredOutput;
}

export interface PolishRevisionCandidate {
  kind: 'polish';
  revisionId: string;
  paragraphId: string;
  beforeText: string;
  afterText: string;
  diffJson: unknown[];
  status: 'candidate';
  editSummary: string;
  changedFacts: unknown[];
  riskFlags: Array<{ type: string; description: string }>;
}

export interface AcceptPolishRevisionCandidateInput {
  revisionId: string;
}

export interface PolishCandidateUpdateResult {
  paragraphId: string;
  version: number;
  changed: boolean;
  updatedAt: string;
}

function openDb(dbPath: string): SqliteDb {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  return db;
}

function shortHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 10);
}

function padded(value: number): string {
  return String(value).padStart(4, '0');
}

function parseJsonObject(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('润色输出结构无效：不是合法 JSON');
  }
}

function updateChapterWordCount(db: SqliteDb, chapterId: string): void {
  db.prepare(
    `UPDATE chapters
     SET word_count = COALESCE((SELECT SUM(LENGTH(text)) FROM paragraphs WHERE chapter_id = ?), 0),
         updated_at = ?
     WHERE id = ?`
  ).run(chapterId, new Date().toISOString(), chapterId);
}

export function parsePolishStructuredOutput(raw: string | unknown): PolishStructuredOutput {
  const parsed = polishStructuredOutputSchema.safeParse(typeof raw === 'string' ? parseJsonObject(raw) : raw);
  if (!parsed.success) {
    throw new Error(`润色输出结构无效：${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }
  return {
    revisedText: parsed.data.revised_text,
    editSummary: parsed.data.edit_summary,
    changedFacts: parsed.data.changed_facts,
    riskFlags: parsed.data.risk_flags,
  };
}

export function buildPolishPromptMessages(
  context: { contextText: string; selectedText: string | null; userInstruction: string },
  options: PolishPromptOptions = {}
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content:
        '你是中文长篇小说润色助手。保留事实、人物认知、POV、时间线和作者语气。不要新增设定。只返回 JSON，不要输出解释文本。',
    },
    {
      role: 'user',
      content: [
        '任务：润色用户指定的中文小说片段。',
        `强度：${options.strength ?? 'light'}`,
        `重点：${options.focus?.trim() || '保持原意，改善节奏和表达'}`,
        `禁止改动：${options.forbiddenChanges?.trim() || '不得改变剧情事实、人物关系、地点、时间和世界规则'}`,
        `用户要求：${context.userInstruction || '无'}`,
        '',
        '上下文：',
        context.contextText,
        '',
        '目标文本：',
        context.selectedText ?? '',
        '',
        '只返回符合以下字段的 JSON：',
        JSON.stringify(
          {
            revised_text: 'string',
            edit_summary: 'string',
            changed_facts: [],
            risk_flags: [{ type: 'continuity|pov|style|forbidden_change|other', description: 'string' }],
          },
          null,
          2
        ),
      ].join('\n'),
    },
  ];
}

export function createPolishRevisionCandidate(
  dbPath: string,
  input: CreatePolishRevisionCandidateInput
): PolishRevisionCandidate {
  const db = openDb(dbPath);
  try {
    const paragraph = db
      .prepare('SELECT id, text FROM paragraphs WHERE id = ?')
      .get(input.paragraphId) as Record<string, unknown> | undefined;
    if (!paragraph) {
      throw new Error('段落不存在，无法创建润色候选');
    }

    const beforeText = String(paragraph.text);
    const afterText = input.structuredOutput.revisedText;
    if (beforeText === afterText) {
      throw new Error('润色结果与原文一致，没有可创建的候选修改');
    }

    const revisionId = `rev-${crypto.randomUUID()}`;
    const diffJson = diffWordsWithSpace(beforeText, afterText);
    db.prepare(
      `INSERT INTO revisions
       (id, scope_type, scope_id, before_text, after_text, diff_json, source_task_id, status, created_at)
       VALUES (?, 'paragraph', ?, ?, ?, ?, ?, 'candidate', ?)`
    ).run(
      revisionId,
      input.paragraphId,
      beforeText,
      afterText,
      JSON.stringify({
        kind: 'polish',
        editSummary: input.structuredOutput.editSummary,
        changedFacts: input.structuredOutput.changedFacts,
        riskFlags: input.structuredOutput.riskFlags,
        diff: diffJson,
      }),
      input.sourceTaskId,
      new Date().toISOString()
    );

    return {
      kind: 'polish',
      revisionId,
      paragraphId: input.paragraphId,
      beforeText,
      afterText,
      diffJson,
      status: 'candidate',
      editSummary: input.structuredOutput.editSummary,
      changedFacts: input.structuredOutput.changedFacts,
      riskFlags: input.structuredOutput.riskFlags,
    };
  } finally {
    db.close();
  }
}

export function acceptPolishRevisionCandidate(
  dbPath: string,
  input: AcceptPolishRevisionCandidateInput
): PolishCandidateUpdateResult {
  const db = openDb(dbPath);
  try {
    const revision = db
      .prepare('SELECT id, scope_type, scope_id, before_text, after_text, status FROM revisions WHERE id = ?')
      .get(input.revisionId) as Record<string, unknown> | undefined;
    if (!revision) {
      throw new Error('润色候选不存在');
    }
    if (String(revision.status) !== 'candidate') {
      throw new Error('只能接受待确认的润色候选');
    }
    if (String(revision.scope_type) !== 'paragraph') {
      throw new Error('润色候选不是段落修改');
    }

    const paragraphId = String(revision.scope_id);
    const current = db
      .prepare('SELECT id, chapter_id, text, version FROM paragraphs WHERE id = ?')
      .get(paragraphId) as Record<string, unknown> | undefined;
    if (!current) {
      throw new Error('候选段落不存在');
    }
    if (String(current.text) !== String(revision.before_text)) {
      throw new Error('正文已变化，请重新生成润色候选');
    }

    const timestamp = new Date().toISOString();
    const nextVersion = Number(current.version) + 1;
    const afterText = String(revision.after_text);
    const chapterId = String(current.chapter_id);
    const write = db.transaction(() => {
      db.prepare(
        `UPDATE paragraphs
         SET text = ?, text_hash = ?, version = ?, updated_at = ?
         WHERE id = ?`
      ).run(afterText, shortHash(afterText), nextVersion, timestamp, paragraphId);
      db.prepare(
        `INSERT INTO paragraph_versions (id, paragraph_id, version, text, change_reason, created_by, created_at)
         VALUES (?, ?, ?, ?, 'ai_polish_accept', 'ai', ?)`
      ).run(`pver-${paragraphId}-${padded(nextVersion)}`, paragraphId, nextVersion, afterText, timestamp);
      db.prepare('UPDATE revisions SET status = ? WHERE id = ?').run('applied', input.revisionId);
      updateChapterWordCount(db, chapterId);
    });

    write();
    upsertParagraphSearchIndexForDb(db, paragraphId);
    return {
      paragraphId,
      version: nextVersion,
      changed: true,
      updatedAt: timestamp,
    };
  } finally {
    db.close();
  }
}

export function rejectPolishRevisionCandidate(
  dbPath: string,
  input: AcceptPolishRevisionCandidateInput
): { revisionId: string; status: 'rejected' } {
  const db = openDb(dbPath);
  try {
    const result = db
      .prepare("UPDATE revisions SET status = 'rejected' WHERE id = ? AND status = 'candidate'")
      .run(input.revisionId);
    if (result.changes === 0) {
      throw new Error('只能拒绝待确认的润色候选');
    }
    return { revisionId: input.revisionId, status: 'rejected' };
  } finally {
    db.close();
  }
}
