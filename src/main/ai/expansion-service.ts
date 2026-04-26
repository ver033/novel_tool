import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { z } from 'zod';

import { rebuildParagraphSearchIndexForDb } from '../search/search-service';

type SqliteDb = InstanceType<typeof Database>;

const expansionStructuredOutputSchema = z.object({
  draft_text: z.string().min(1),
  covered_beats: z
    .array(
      z.object({
        beat: z.string().min(1),
        covered: z.boolean(),
        note: z.string(),
      })
    )
    .default([]),
  new_facts: z
    .array(
      z.object({
        fact: z.string().min(1),
        importance: z.enum(['low', 'medium', 'high']),
      })
    )
    .default([]),
  risk_flags: z
    .array(
      z.object({
        type: z.string().min(1),
        description: z.string().min(1),
      })
    )
    .default([]),
  revision_notes: z.string().default(''),
});

export interface ExpansionStructuredOutput {
  draftText: string;
  paragraphs: string[];
  coveredBeats: Array<{ beat: string; covered: boolean; note: string }>;
  newFacts: Array<{ fact: string; importance: 'low' | 'medium' | 'high' }>;
  riskFlags: Array<{ type: string; description: string }>;
  revisionNotes: string;
}

export interface ExpansionPromptOptions {
  previousContext?: string;
  nextBeats?: string;
  focusDetails?: string;
  forbiddenChanges?: string;
  pov?: string;
  targetLength?: string;
  styleStrength?: string;
}

export interface CreateExpansionRevisionCandidateInput {
  anchorParagraphId: string;
  sourceTaskId: string;
  structuredOutput: ExpansionStructuredOutput;
}

export interface ExpansionRevisionCandidate {
  kind: 'expand';
  revisionId: string;
  anchorParagraphId: string;
  chapterId: string;
  draftText: string;
  paragraphs: string[];
  status: 'candidate';
  coveredBeats: Array<{ beat: string; covered: boolean; note: string }>;
  newFacts: Array<{ fact: string; importance: 'low' | 'medium' | 'high' }>;
  riskFlags: Array<{ type: string; description: string }>;
  revisionNotes: string;
}

export interface ExpansionCandidateAcceptResult {
  revisionId: string;
  status: 'applied';
  anchorParagraphId: string;
  chapterId: string;
  insertedParagraphIds: string[];
  insertedCount: number;
  updatedAt: string;
}

export interface CandidateDecisionInput {
  revisionId: string;
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
    throw new Error('扩写输出结构无效：不是合法 JSON');
  }
}

function splitDraftIntoParagraphs(value: string): string[] {
  return value
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function updateChapterWordCount(db: SqliteDb, chapterId: string): void {
  db.prepare(
    `UPDATE chapters
     SET word_count = COALESCE((SELECT SUM(LENGTH(text)) FROM paragraphs WHERE chapter_id = ?), 0),
         updated_at = ?
     WHERE id = ?`
  ).run(chapterId, new Date().toISOString(), chapterId);
}

function makeInsertedParagraphId(chapterIndex: number, paragraphIndex: number, text: string): string {
  return `para-ins-${padded(chapterIndex + 1)}-${padded(paragraphIndex + 1)}-${shortHash(text)}-${crypto
    .randomUUID()
    .slice(0, 8)}`;
}

export function parseExpansionStructuredOutput(raw: string | unknown): ExpansionStructuredOutput {
  const parsed = expansionStructuredOutputSchema.safeParse(typeof raw === 'string' ? parseJsonObject(raw) : raw);
  if (!parsed.success) {
    throw new Error(`扩写输出结构无效：${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }
  const paragraphs = splitDraftIntoParagraphs(parsed.data.draft_text);
  if (paragraphs.length === 0) {
    throw new Error('扩写输出结构无效：draft_text 没有可插入段落');
  }
  return {
    draftText: parsed.data.draft_text.trim(),
    paragraphs,
    coveredBeats: parsed.data.covered_beats,
    newFacts: parsed.data.new_facts,
    riskFlags: parsed.data.risk_flags,
    revisionNotes: parsed.data.revision_notes,
  };
}

export function buildExpansionPromptMessages(
  context: { contextText: string; selectedText: string | null; userInstruction: string },
  options: ExpansionPromptOptions = {}
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content:
        '你是中文长篇小说扩写助手。根据作者给出的后续事件扩写成可插入正文的场景。必须保留既有事实、人物认知、POV、时间线和世界规则。只返回 JSON，不要输出解释文本。',
    },
    {
      role: 'user',
      content: [
        '任务：在锚点后扩写一个小说场景草稿。',
        `前置语境：${options.previousContext?.trim() || '见上下文'}`,
        `接下来发生：${options.nextBeats?.trim() || '按用户要求推进'}`,
        `重点描写：${options.focusDetails?.trim() || '动作、环境、人物反应'}`,
        `禁止改动：${options.forbiddenChanges?.trim() || '不得改变已有剧情事实、人物关系、地点、时间和世界规则'}`,
        `POV：${options.pov?.trim() || '沿用当前段落'}`,
        `目标长度：${options.targetLength?.trim() || '按情节需要控制'}`,
        `风格强度：${options.styleStrength?.trim() || '贴近原文'}`,
        `用户要求：${context.userInstruction || '无'}`,
        '',
        '上下文：',
        context.contextText,
        '',
        '锚点文本：',
        context.selectedText ?? '',
        '',
        '只返回符合以下字段的 JSON：',
        JSON.stringify(
          {
            draft_text: 'string',
            covered_beats: [{ beat: 'string', covered: true, note: 'string' }],
            new_facts: [{ fact: 'string', importance: 'low|medium|high' }],
            risk_flags: [{ type: 'continuity|pov|style|forbidden_change|other', description: 'string' }],
            revision_notes: 'string',
          },
          null,
          2
        ),
      ].join('\n'),
    },
  ];
}

export function createExpansionRevisionCandidate(
  dbPath: string,
  input: CreateExpansionRevisionCandidateInput
): ExpansionRevisionCandidate {
  const db = openDb(dbPath);
  try {
    const anchor = db
      .prepare(
        `SELECT paragraphs.id,
                paragraphs.chapter_id,
                paragraphs.text,
                paragraphs.paragraph_index,
                chapters.chapter_index
         FROM paragraphs
         JOIN chapters ON chapters.id = paragraphs.chapter_id
         WHERE paragraphs.id = ?`
      )
      .get(input.anchorParagraphId) as Record<string, unknown> | undefined;
    if (!anchor) {
      throw new Error('锚点段落不存在，无法创建扩写候选');
    }

    const revisionId = `rev-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO revisions
       (id, scope_type, scope_id, before_text, after_text, diff_json, source_task_id, status, created_at)
       VALUES (?, 'insertion_after_paragraph', ?, '', ?, ?, ?, 'candidate', ?)`
    ).run(
      revisionId,
      input.anchorParagraphId,
      input.structuredOutput.draftText,
      JSON.stringify({
        kind: 'expand',
        anchorParagraphId: input.anchorParagraphId,
        chapterId: String(anchor.chapter_id),
        anchorParagraphIndex: Number(anchor.paragraph_index),
        chapterIndex: Number(anchor.chapter_index),
        paragraphs: input.structuredOutput.paragraphs,
        coveredBeats: input.structuredOutput.coveredBeats,
        newFacts: input.structuredOutput.newFacts,
        riskFlags: input.structuredOutput.riskFlags,
        revisionNotes: input.structuredOutput.revisionNotes,
      }),
      input.sourceTaskId,
      new Date().toISOString()
    );

    return {
      kind: 'expand',
      revisionId,
      anchorParagraphId: input.anchorParagraphId,
      chapterId: String(anchor.chapter_id),
      draftText: input.structuredOutput.draftText,
      paragraphs: input.structuredOutput.paragraphs,
      status: 'candidate',
      coveredBeats: input.structuredOutput.coveredBeats,
      newFacts: input.structuredOutput.newFacts,
      riskFlags: input.structuredOutput.riskFlags,
      revisionNotes: input.structuredOutput.revisionNotes,
    };
  } finally {
    db.close();
  }
}

export function acceptExpansionRevisionCandidate(
  dbPath: string,
  input: CandidateDecisionInput
): ExpansionCandidateAcceptResult {
  const db = openDb(dbPath);
  try {
    const revision = db
      .prepare('SELECT id, scope_type, scope_id, after_text, diff_json, status FROM revisions WHERE id = ?')
      .get(input.revisionId) as Record<string, unknown> | undefined;
    if (!revision) {
      throw new Error('扩写候选不存在');
    }
    if (String(revision.status) !== 'candidate') {
      throw new Error('只能接受待确认的扩写候选');
    }
    if (String(revision.scope_type) !== 'insertion_after_paragraph') {
      throw new Error('扩写候选不是插入修改');
    }

    const metadata = JSON.parse(String(revision.diff_json)) as {
      kind?: string;
      paragraphs?: string[];
      chapterId?: string;
      chapterIndex?: number;
    };
    if (metadata.kind !== 'expand' || !Array.isArray(metadata.paragraphs) || metadata.paragraphs.length === 0) {
      throw new Error('扩写候选数据不完整');
    }

    const anchorParagraphId = String(revision.scope_id);
    const anchor = db
      .prepare(
        `SELECT paragraphs.id,
                paragraphs.chapter_id,
                paragraphs.paragraph_index,
                chapters.chapter_index
         FROM paragraphs
         JOIN chapters ON chapters.id = paragraphs.chapter_id
         WHERE paragraphs.id = ?`
      )
      .get(anchorParagraphId) as Record<string, unknown> | undefined;
    if (!anchor) {
      throw new Error('锚点段落不存在，无法插入扩写');
    }

    const timestamp = new Date().toISOString();
    const chapterId = String(anchor.chapter_id);
    const chapterIndex = Number(anchor.chapter_index);
    const anchorIndex = Number(anchor.paragraph_index);
    const insertIndex = anchorIndex + 1;
    const insertedParagraphIds: string[] = [];

    const write = db.transaction(() => {
      db.prepare(
        `UPDATE paragraphs
         SET paragraph_index = paragraph_index + ?, updated_at = ?
         WHERE chapter_id = ? AND paragraph_index >= ?`
      ).run(metadata.paragraphs?.length ?? 0, timestamp, chapterId, insertIndex);

      for (const [offset, paragraphText] of metadata.paragraphs!.entries()) {
        const paragraphIndex = insertIndex + offset;
        const paragraphId = makeInsertedParagraphId(chapterIndex, paragraphIndex, paragraphText);
        insertedParagraphIds.push(paragraphId);
        const textHash = shortHash(paragraphText);
        db.prepare(
          `INSERT INTO paragraphs
           (id, chapter_id, paragraph_index, text, text_hash, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
        ).run(paragraphId, chapterId, paragraphIndex, paragraphText, textHash, timestamp, timestamp);
        db.prepare(
          `INSERT INTO paragraph_versions (id, paragraph_id, version, text, change_reason, created_by, created_at)
           VALUES (?, ?, 1, ?, 'ai_expand_accept', 'ai', ?)`
        ).run(`pver-${paragraphId}-0001`, paragraphId, paragraphText, timestamp);
      }

      db.prepare('UPDATE revisions SET status = ? WHERE id = ?').run('applied', input.revisionId);
      updateChapterWordCount(db, chapterId);
    });

    write();
    rebuildParagraphSearchIndexForDb(db);
    return {
      revisionId: input.revisionId,
      status: 'applied',
      anchorParagraphId,
      chapterId,
      insertedParagraphIds,
      insertedCount: insertedParagraphIds.length,
      updatedAt: timestamp,
    };
  } finally {
    db.close();
  }
}

export function rejectExpansionRevisionCandidate(
  dbPath: string,
  input: CandidateDecisionInput
): { revisionId: string; status: 'rejected' } {
  const db = openDb(dbPath);
  try {
    const result = db
      .prepare(
        "UPDATE revisions SET status = 'rejected' WHERE id = ? AND status = 'candidate' AND scope_type = 'insertion_after_paragraph'"
      )
      .run(input.revisionId);
    if (result.changes === 0) {
      throw new Error('只能拒绝待确认的扩写候选');
    }
    return { revisionId: input.revisionId, status: 'rejected' };
  } finally {
    db.close();
  }
}
