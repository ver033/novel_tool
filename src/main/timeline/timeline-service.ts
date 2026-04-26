import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { z } from 'zod';

import type { LlmTaskRequest, ParsedProviderResponse, ReasoningEffort, ThinkingMode } from '../llm/provider-adapters';

export interface TimelineNode {
  id: string;
  chapterId: string | null;
  paragraphId: string | null;
  chapterTitle: string | null;
  friendlyLocation: string | null;
  eventOrder: number | null;
  timeExpression: string | null;
  normalizedTime: string | null;
  summary: string;
  participants: string[];
  confidence: number;
  status: string;
  sourceQuote: string;
}

export interface TimelineQueryResult {
  nodes: TimelineNode[];
}

export interface TimelineAnalyzeResult extends TimelineQueryResult {
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  warnings: string[];
}

export interface TimelineModelRequest {
  model: string;
  reasoningEffort: ReasoningEffort;
  thinkingMode: ThinkingMode;
  sendModelRequest: (request: LlmTaskRequest) => Promise<Pick<ParsedProviderResponse, 'content'>>;
}

const timelineEventSchema = z.object({
  paragraph_id: z.string().min(1),
  event_type: z.string().min(1),
  summary: z.string().min(1),
  quote: z.string().min(1),
  participants: z.array(z.string().min(1)).default([]),
  time_expression: z.string().default(''),
  confidence: z.number().min(0).max(1).default(0.72),
});

const timelineStructuredOutputSchema = z.object({
  events: z.array(timelineEventSchema).default([]),
});

interface TimelineParagraph {
  paragraphId: string;
  chapterId: string;
  chapterTitle: string;
  chapterIndex: number;
  paragraphIndex: number;
  friendlyLabel: string;
  text: string;
}

function parseParticipants(value: unknown): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function toTimelineNode(row: Record<string, unknown>): TimelineNode {
  const paragraphIndex = row.paragraph_index === null || row.paragraph_index === undefined ? null : Number(row.paragraph_index);
  const chapterTitle = row.chapter_title ? String(row.chapter_title) : null;
  return {
    id: String(row.id),
    chapterId: row.chapter_id ? String(row.chapter_id) : null,
    paragraphId: row.paragraph_id ? String(row.paragraph_id) : null,
    chapterTitle,
    friendlyLocation: chapterTitle && paragraphIndex !== null ? `${chapterTitle} / 第 ${paragraphIndex + 1} 段` : null,
    eventOrder: row.event_order === null || row.event_order === undefined ? null : Number(row.event_order),
    timeExpression: row.time_expression ? String(row.time_expression) : null,
    normalizedTime: row.normalized_time ? String(row.normalized_time) : null,
    summary: String(row.summary),
    participants: parseParticipants(row.participants_json),
    confidence: Number(row.confidence ?? 0),
    status: String(row.status),
    sourceQuote: row.paragraph_text ? String(row.paragraph_text) : '',
  };
}

export function queryTimeline(
  dbPath: string,
  filter: { entityId?: string; chapterId?: string } = {}
): TimelineQueryResult {
  const db = new Database(dbPath);
  try {
    const clauses: string[] = ["events.id NOT LIKE 'auto-timeline-%'"];
    const params: string[] = [];
    if (filter.chapterId) {
      clauses.push('events.chapter_id = ?');
      params.push(filter.chapterId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT events.*,
                paragraphs.text AS paragraph_text,
                paragraphs.paragraph_index,
                chapters.title AS chapter_title
         FROM events
         LEFT JOIN paragraphs ON paragraphs.id = events.paragraph_id
         LEFT JOIN chapters ON chapters.id = events.chapter_id
         ${where}
         ORDER BY COALESCE(events.event_order, 999999), chapters.chapter_index, paragraphs.paragraph_index, events.id`
      )
      .all(...params) as Array<Record<string, unknown>>;
    return { nodes: rows.map(toTimelineNode) };
  } finally {
    db.close();
  }
}

function shortText(value: string, length = 96): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > length ? `${normalized.slice(0, length)}...` : normalized;
}

function shortHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 14);
}

function normalizeEvidenceText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/……/g, '...')
    .replace(/…/g, '...')
    .replace(/\s+/g, '');
}

function resolveEvidenceQuote(paragraphText: string, quote: string): string | null {
  const trimmed = quote.trim();
  if (!trimmed) {
    return null;
  }
  if (paragraphText.includes(trimmed)) {
    return trimmed;
  }
  const normalizedParagraph = normalizeEvidenceText(paragraphText);
  const normalizedQuote = normalizeEvidenceText(trimmed);
  if (normalizedQuote.length >= 4 && normalizedParagraph.includes(normalizedQuote)) {
    return trimmed;
  }
  return null;
}

function parseJsonObject(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('时间线分析输出结构无效：不是合法 JSON');
  }
}

function readTimelineParagraphs(db: InstanceType<typeof Database>): TimelineParagraph[] {
  const rows = db
    .prepare(
      `SELECT paragraphs.id AS paragraph_id,
              paragraphs.chapter_id,
              paragraphs.paragraph_index,
              paragraphs.text,
              chapters.title AS chapter_title,
              chapters.chapter_index
       FROM paragraphs
       JOIN chapters ON chapters.id = paragraphs.chapter_id
       ORDER BY chapters.chapter_index ASC, paragraphs.paragraph_index ASC`
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    paragraphId: String(row.paragraph_id),
    chapterId: String(row.chapter_id),
    chapterTitle: String(row.chapter_title),
    chapterIndex: Number(row.chapter_index),
    paragraphIndex: Number(row.paragraph_index),
    friendlyLabel: `第 ${Number(row.paragraph_index) + 1} 段`,
    text: String(row.text ?? ''),
  }));
}

function eventSignalScore(paragraph: TimelineParagraph): number {
  const text = paragraph.text;
  const actionHits = (text.match(/测试|公布|宣布|知道|发现|来到|进入|离开|答应|拒绝|决定|承诺|出现|消失|发光|突破|凝聚|受伤|死亡|交给|拿出|丢|摔|辱|嘲|退婚|相求|秘密/g) ?? []).length;
  const dialogueHits = (text.match(/“|”|道：|说道|问道|笑道/g) ?? []).length;
  const stateHits = (text.match(/实力|身份|秘密|关系|父亲|族长|戒指|斗之气|斗者|功法|规则|期限|一年/g) ?? []).length;
  const expositionPenalty = /月如银盘|漫天繁星|床榻之上/.test(text) && actionHits === 0 ? 4 : 0;
  return actionHits * 3 + dialogueHits + stateHits * 2 - expositionPenalty;
}

function selectTimelineContextParagraphs(paragraphs: TimelineParagraph[], maxCount = 180): TimelineParagraph[] {
  if (paragraphs.length <= maxCount) {
    return paragraphs;
  }
  const required = new Map<string, TimelineParagraph>();
  for (const paragraph of paragraphs) {
    if (paragraph.paragraphIndex < 2) {
      required.set(paragraph.paragraphId, paragraph);
    }
  }
  const scored = paragraphs
    .map((paragraph) => ({ paragraph, score: eventSignalScore(paragraph) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCount - required.size);
  for (const item of scored) {
    required.set(item.paragraph.paragraphId, item.paragraph);
  }
  return [...required.values()].sort((a, b) => a.chapterIndex - b.chapterIndex || a.paragraphIndex - b.paragraphIndex);
}

function buildTimelinePromptMessages(paragraphs: TimelineParagraph[]) {
  const context = paragraphs
    .map(
      (paragraph) =>
        [
          `paragraph_id=${paragraph.paragraphId}`,
          `location=${paragraph.chapterTitle} / ${paragraph.friendlyLabel}`,
          `text=${shortText(paragraph.text, 420)}`,
        ].join('\n')
    )
    .join('\n\n');

  return [
    {
      role: 'system' as const,
      content:
        '你是中文长篇小说时间线分析器。任务是从正文段落中抽取真正发生或改变叙事状态的事件，而不是按章节列清单。只返回 JSON。',
    },
    {
      role: 'user' as const,
      content: [
        '请从下面段落中抽取时间线事件。',
        '',
        '抽取标准：',
        '- 只保留会改变人物状态、实力、关系、认知、道具归属/状态、世界规则、主线压力或伏笔状态的事件。',
        '- 不要把章节开头、景物描写、纯设定说明、普通心理描写当成事件；除非它揭示秘密、规则或状态变化。',
        '- 一个章节可以没有事件，也可以有多个事件。',
        '- quote 必须是对应 paragraph_id 中连续出现的原文片段。',
        '- event_type 使用短中文标签，例如：实力状态变化、隐藏身份揭示、关系压力、道具异常、世界规则、伏笔埋设、外部冲突。',
        '',
        '返回 JSON：',
        '{"events":[{"paragraph_id":"string","event_type":"string","summary":"string","quote":"string","participants":["string"],"time_expression":"string","confidence":0.0}]}',
        '',
        '可用段落：',
        context || '无正文段落。',
      ].join('\n'),
    },
  ];
}

function parseTimelineStructuredOutput(raw: string | unknown) {
  const parsed = timelineStructuredOutputSchema.safeParse(typeof raw === 'string' ? parseJsonObject(raw) : raw);
  if (!parsed.success) {
    throw new Error(`时间线分析输出结构无效：${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }
  return parsed.data.events;
}

type ParsedTimelineEvent = ReturnType<typeof parseTimelineStructuredOutput>[number];

interface ValidTimelineEvent {
  event: ParsedTimelineEvent;
  paragraph: TimelineParagraph;
  quote: string;
}

export async function analyzeTimeline(
  dbPath: string,
  options: { modelRequest?: TimelineModelRequest } = {}
): Promise<TimelineAnalyzeResult> {
  if (!options.modelRequest) {
    throw new Error('时间线分析需要可用模型。请先在模型设置中连接当前供应商。');
  }

  const db = new Database(dbPath);
  try {
    const paragraphs = readTimelineParagraphs(db);
    const paragraphMap = new Map(paragraphs.map((paragraph) => [paragraph.paragraphId, paragraph]));
    const response = await options.modelRequest.sendModelRequest({
      model: options.modelRequest.model,
      messages: buildTimelinePromptMessages(selectTimelineContextParagraphs(paragraphs)),
      reasoningEffort: options.modelRequest.reasoningEffort,
      thinkingMode: options.modelRequest.thinkingMode,
      stream: false,
      responseFormat: 'json_object',
    });
    const extracted = parseTimelineStructuredOutput(response.content);
    const validEvents: ValidTimelineEvent[] = [];
    const warnings: string[] = [];
    for (const event of extracted) {
      const paragraph = paragraphMap.get(event.paragraph_id);
      if (!paragraph) {
        warnings.push(`引用段落不存在，已跳过：${event.paragraph_id}`);
        continue;
      }
      const quote = resolveEvidenceQuote(paragraph.text, event.quote);
      if (!quote) {
        warnings.push(`引用无法定位，已跳过：${paragraph.chapterTitle} / ${paragraph.friendlyLabel}（${shortText(event.quote, 48)}）`);
        continue;
      }
      validEvents.push({ event, paragraph, quote });
    }

    let createdCount = 0;
    let updatedCount = 0;
    const existing = new Set(
      (
        db
          .prepare("SELECT id FROM events WHERE id LIKE 'llm-timeline-%'")
          .all() as Array<Record<string, unknown>>
      ).map((row) => String(row.id))
    );

    const upsert = db.prepare(
      `INSERT INTO events
       (id, chapter_id, paragraph_id, event_order, time_expression, normalized_time, summary, participants_json, confidence, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai_extracted')
       ON CONFLICT(id) DO UPDATE SET
         chapter_id = excluded.chapter_id,
         paragraph_id = excluded.paragraph_id,
         event_order = excluded.event_order,
         time_expression = excluded.time_expression,
         normalized_time = excluded.normalized_time,
         summary = excluded.summary,
         participants_json = excluded.participants_json,
         confidence = CASE WHEN events.status = 'user_confirmed' THEN events.confidence ELSE excluded.confidence END,
         status = CASE WHEN events.status = 'user_confirmed' THEN events.status ELSE excluded.status END`
    );

    const write = db.transaction(() => {
      if (validEvents.length > 0 || extracted.length === 0) {
        db.prepare("DELETE FROM events WHERE id LIKE 'auto-timeline-%'").run();
        db.prepare("DELETE FROM events WHERE id LIKE 'llm-timeline-%' AND status != 'user_confirmed'").run();
      }
      const seen = new Set<string>();
      for (const [index, item] of validEvents.entries()) {
        const { event, paragraph, quote } = item;
        const eventId = `llm-timeline-${shortHash(`${event.paragraph_id}:${event.event_type}:${quote}`)}`;
        if (seen.has(eventId)) {
          continue;
        }
        seen.add(eventId);
        const friendlyLocation = `${paragraph.chapterTitle} / ${paragraph.friendlyLabel}`;
        upsert.run(
          eventId,
          paragraph.chapterId,
          paragraph.paragraphId,
          paragraph.chapterIndex * 10_000 + paragraph.paragraphIndex * 100 + index,
          event.event_type,
          friendlyLocation,
          event.summary,
          JSON.stringify([...new Set(event.participants.map((item) => item.trim()).filter(Boolean))]),
          event.confidence
        );
        if (existing.has(eventId)) {
          updatedCount += 1;
        } else {
          createdCount += 1;
        }
      }
    });
    write();

    return {
      ...queryTimeline(dbPath, {}),
      createdCount,
      updatedCount,
      skippedCount: extracted.length - validEvents.length,
      warnings,
    };
  } finally {
    db.close();
  }
}
