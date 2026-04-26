import crypto from 'node:crypto';
import Database from 'better-sqlite3';

import { getParagraphReferences, resolveSearchMentionReferences } from '../search/search-service';

type SqliteDb = InstanceType<typeof Database>;

export type ContextActionKind = 'ask' | 'polish' | 'expand' | 'proofread' | 'continuity' | 'memory';
export type ContextSourceKind =
  | 'selected_text'
  | 'current_paragraph'
  | 'previous_paragraph'
  | 'next_paragraph'
  | 'reference'
  | 'search_result'
  | 'fact'
  | 'issue'
  | 'outline'
  | 'style_guide';

export interface ContextBuildInput {
  actionKind: ContextActionKind;
  scopeLabel: string;
  selectedText?: string;
  anchorParagraphId?: string;
  currentChapterId?: string;
  referenceParagraphIds?: string[];
  searchMentions?: string[];
  userInstruction?: string;
  maxCharacters?: number;
  neighborParagraphCount?: number;
}

export interface ContextSource {
  id: string;
  kind: ContextSourceKind;
  label: string;
  friendlyLocation?: string;
  paragraphId?: string;
  chapterId?: string;
  textPreview: string;
}

export interface OmittedContextReason {
  code:
    | 'full_book_not_loaded'
    | 'facts_not_available'
    | 'style_guide_not_available'
    | 'issues_not_available'
    | 'outline_not_available'
    | 'context_budget_exceeded'
    | 'missing_anchor_paragraph'
    | 'missing_current_chapter';
  detail: string;
}

export interface ContextPackage {
  action: {
    kind: ContextActionKind;
    scopeLabel: string;
  };
  selectedText: string | null;
  userInstruction: string;
  contextText: string;
  sourceList: ContextSource[];
  tokenEstimate: number;
  characterCount: number;
  maxCharacters: number;
  preflightSummary: string;
  omittedContextReasons: OmittedContextReason[];
}

export interface CreateAiTaskWithContextInput {
  taskType: ContextActionKind | 'chat';
  context: ContextPackage;
  providerId: 'deepseek' | 'openrouter';
  modelName: string;
  reasoningEffort: 'high' | 'max';
  thinkingMode: 'enabled' | 'disabled';
}

export interface AiTaskPreflightResult {
  taskId: string;
  status: 'preflight_ready';
}

interface ParagraphRow {
  paragraphId: string;
  chapterId: string;
  chapterTitle: string;
  chapterIndex: number;
  paragraphIndex: number;
  text: string;
  friendlyLocation: string;
}

interface ContextSection {
  marker: string;
  title: string;
  body: string;
  source?: ContextSource;
}

function openDb(dbPath: string): SqliteDb {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  return db;
}

function previewText(text: string, length = 96): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > length ? `${normalized.slice(0, length)}...` : normalized;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 2));
}

function makeFriendlyLocation(chapterTitle: string, paragraphIndex: number): string {
  return `${chapterTitle} / 第 ${paragraphIndex + 1} 段`;
}

function toParagraphRow(row: Record<string, unknown>): ParagraphRow {
  const chapterTitle = String(row.chapter_title);
  const paragraphIndex = Number(row.paragraph_index);
  return {
    paragraphId: String(row.paragraph_id),
    chapterId: String(row.chapter_id),
    chapterTitle,
    chapterIndex: Number(row.chapter_index),
    paragraphIndex,
    text: String(row.text),
    friendlyLocation: makeFriendlyLocation(chapterTitle, paragraphIndex),
  };
}

function readParagraph(db: SqliteDb, paragraphId: string): ParagraphRow | null {
  const row = db
    .prepare(
      `SELECT paragraphs.id AS paragraph_id,
              paragraphs.chapter_id,
              paragraphs.paragraph_index,
              paragraphs.text,
              chapters.title AS chapter_title,
              chapters.chapter_index
       FROM paragraphs
       JOIN chapters ON chapters.id = paragraphs.chapter_id
       WHERE paragraphs.id = ?`
    )
    .get(paragraphId) as Record<string, unknown> | undefined;
  return row ? toParagraphRow(row) : null;
}

function readChapterAnchor(db: SqliteDb, chapterId: string): ParagraphRow | null {
  const row = db
    .prepare(
      `SELECT paragraphs.id AS paragraph_id,
              paragraphs.chapter_id,
              paragraphs.paragraph_index,
              paragraphs.text,
              chapters.title AS chapter_title,
              chapters.chapter_index
       FROM paragraphs
       JOIN chapters ON chapters.id = paragraphs.chapter_id
       WHERE paragraphs.chapter_id = ?
       ORDER BY paragraphs.paragraph_index ASC
       LIMIT 1`
    )
    .get(chapterId) as Record<string, unknown> | undefined;
  return row ? toParagraphRow(row) : null;
}

function readNeighborParagraphs(db: SqliteDb, anchor: ParagraphRow, count: number): ParagraphRow[] {
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
       WHERE paragraphs.chapter_id = ?
         AND paragraphs.paragraph_index BETWEEN ? AND ?
         AND paragraphs.id != ?
       ORDER BY paragraphs.paragraph_index ASC`
    )
    .all(
      anchor.chapterId,
      Math.max(0, anchor.paragraphIndex - count),
      anchor.paragraphIndex + count,
      anchor.paragraphId
    ) as Array<Record<string, unknown>>;
  return rows.map(toParagraphRow);
}

function sourceFromParagraph(kind: ContextSourceKind, row: ParagraphRow): ContextSource {
  return {
    id: `${kind}:${row.paragraphId}`,
    kind,
    label: kind,
    friendlyLocation: row.friendlyLocation,
    paragraphId: row.paragraphId,
    chapterId: row.chapterId,
    textPreview: previewText(row.text),
  };
}

function sectionFromParagraph(marker: string, title: string, kind: ContextSourceKind, row: ParagraphRow): ContextSection {
  return {
    marker,
    title,
    body: row.text,
    source: sourceFromParagraph(kind, row),
  };
}

function readFacts(db: SqliteDb, paragraphIds: string[]): ContextSection[] {
  if (paragraphIds.length === 0) {
    return [];
  }
  const read = db.prepare(
    `SELECT facts.id,
            facts.predicate,
            facts.object_text,
            facts.fact_type,
            facts.source_paragraph_id,
            facts.quote,
            paragraphs.chapter_id,
            paragraphs.paragraph_index,
            chapters.title AS chapter_title
     FROM facts
     LEFT JOIN paragraphs ON paragraphs.id = facts.source_paragraph_id
     LEFT JOIN chapters ON chapters.id = paragraphs.chapter_id
     WHERE facts.source_paragraph_id = ?
     ORDER BY facts.created_at ASC
     LIMIT 8`
  );
  return paragraphIds.flatMap((paragraphId) => {
    const rows = read.all(paragraphId) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const chapterTitle = row.chapter_title ? String(row.chapter_title) : '来源段落';
      const paragraphIndex = Number(row.paragraph_index ?? 0);
      const text = `${String(row.fact_type)}：${String(row.predicate)} ${String(row.object_text)}\n证据：${String(
        row.quote
      )}`;
      return {
        marker: '[fact]',
        title: String(row.id),
        body: text,
        source: {
          id: `fact:${String(row.id)}`,
          kind: 'fact',
          label: `${String(row.fact_type)} fact`,
          paragraphId: String(row.source_paragraph_id ?? ''),
          chapterId: row.chapter_id ? String(row.chapter_id) : undefined,
          friendlyLocation: row.chapter_title ? makeFriendlyLocation(chapterTitle, paragraphIndex) : undefined,
          textPreview: previewText(text),
        },
      } satisfies ContextSection;
    });
  });
}

function readIssues(db: SqliteDb, paragraphId: string | undefined): ContextSection[] {
  if (!paragraphId) {
    return [];
  }
  const rows = db
    .prepare(
      `SELECT id, type, severity, title, explanation, suggestion
       FROM issues
       WHERE current_paragraph_id = ? AND status = 'open'
       ORDER BY severity DESC, created_at DESC
       LIMIT 6`
    )
    .all(paragraphId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const text = `${String(row.severity)} ${String(row.type)}：${String(row.title)}\n${String(
      row.explanation
    )}\n建议：${String(row.suggestion ?? '')}`;
    return {
      marker: '[issue]',
      title: String(row.id),
      body: text,
      source: {
        id: `issue:${String(row.id)}`,
        kind: 'issue',
        label: `${String(row.severity)} issue`,
        paragraphId,
        textPreview: previewText(text),
      },
    };
  });
}

function readOutlineRecords(db: SqliteDb): ContextSection[] {
  const rows = db
    .prepare(
      `SELECT id, heading_path, record_type, text
       FROM outline_records
       WHERE status != 'rejected'
       ORDER BY created_at DESC
       LIMIT 6`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const text = `${String(row.heading_path)}\n${String(row.text)}`;
    return {
      marker: '[outline]',
      title: String(row.record_type),
      body: text,
      source: {
        id: `outline:${String(row.id)}`,
        kind: 'outline',
        label: String(row.heading_path),
        textPreview: previewText(text),
      },
    };
  });
}

function readStyleGuides(db: SqliteDb, chapterId: string | undefined): ContextSection[] {
  const rows = db
    .prepare(
      `SELECT id, scope_type, scope_id, features_json
       FROM style_guides
       WHERE (scope_type = 'global')
          OR (scope_type = 'chapter' AND scope_id = ?)
       ORDER BY created_at DESC
       LIMIT 3`
    )
    .all(chapterId ?? '') as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    marker: '[style_guide]',
    title: `${String(row.scope_type)}:${String(row.scope_id)}`,
    body: String(row.features_json),
    source: {
      id: `style:${String(row.id)}`,
      kind: 'style_guide',
      label: `${String(row.scope_type)} style`,
      textPreview: previewText(String(row.features_json)),
    },
  }));
}

function appendSection(
  sections: string[],
  sources: ContextSource[],
  omitted: OmittedContextReason[],
  section: ContextSection,
  maxCharacters: number
): void {
  const rendered = `${section.marker} ${section.title}\n${section.body.trim()}`;
  const nextLength = sections.join('\n\n').length + rendered.length + 2;
  if (nextLength > maxCharacters) {
    omitted.push({
      code: 'context_budget_exceeded',
      detail: `${section.marker} ${section.title} 超出本次上下文预算，已省略。`,
    });
    return;
  }
  sections.push(rendered);
  if (section.source) {
    sources.push(section.source);
  }
}

function uniqueParagraphIds(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function makeMetadata(context: ContextPackage): Record<string, unknown> {
  return {
    action: context.action,
    sourceList: context.sourceList.map((source) => ({
      id: source.id,
      kind: source.kind,
      label: source.label,
      friendlyLocation: source.friendlyLocation,
      paragraphId: source.paragraphId,
      chapterId: source.chapterId,
    })),
    tokenEstimate: context.tokenEstimate,
    characterCount: context.characterCount,
    maxCharacters: context.maxCharacters,
    omittedContextReasons: context.omittedContextReasons,
    preflightSummary: context.preflightSummary,
  };
}

export function buildContextPackage(dbPath: string, input: ContextBuildInput): ContextPackage {
  const maxCharacters = input.maxCharacters ?? 6_000;
  const neighborCount = input.neighborParagraphCount ?? 2;
  const sections: string[] = [];
  const sources: ContextSource[] = [];
  const omittedContextReasons: OmittedContextReason[] = [
    {
      code: 'full_book_not_loaded',
      detail: '默认只装入当前作用域、邻近段落、显式引用和检索结果，不把整本书塞进模型上下文。',
    },
  ];

  const db = openDb(dbPath);
  try {
    const anchor =
      input.anchorParagraphId !== undefined
        ? readParagraph(db, input.anchorParagraphId)
        : input.currentChapterId !== undefined
          ? readChapterAnchor(db, input.currentChapterId)
          : null;
    if (!anchor && input.anchorParagraphId) {
      omittedContextReasons.push({
        code: 'missing_anchor_paragraph',
        detail: `找不到锚点段落：${input.anchorParagraphId}`,
      });
    }
    if (!anchor && input.currentChapterId) {
      omittedContextReasons.push({
        code: 'missing_current_chapter',
        detail: `当前章节没有可用段落：${input.currentChapterId}`,
      });
    }

    if (input.userInstruction?.trim()) {
      appendSection(
        sections,
        sources,
        omittedContextReasons,
        {
          marker: '[user_instruction]',
          title: input.actionKind,
          body: input.userInstruction.trim(),
        },
        maxCharacters
      );
    }
    if (input.selectedText?.trim()) {
      appendSection(
        sections,
        sources,
        omittedContextReasons,
        {
          marker: '[selected_text]',
          title: input.scopeLabel,
          body: input.selectedText.trim(),
          source: {
            id: `selected:${input.anchorParagraphId ?? 'manual'}`,
            kind: 'selected_text',
            label: 'selected text',
            paragraphId: input.anchorParagraphId,
            chapterId: input.currentChapterId ?? anchor?.chapterId,
            friendlyLocation: input.scopeLabel,
            textPreview: previewText(input.selectedText),
          },
        },
        maxCharacters
      );
    }
    if (anchor) {
      appendSection(
        sections,
        sources,
        omittedContextReasons,
        sectionFromParagraph('[current_paragraph]', anchor.friendlyLocation, 'current_paragraph', anchor),
        maxCharacters
      );
      for (const neighbor of readNeighborParagraphs(db, anchor, neighborCount)) {
        const kind = neighbor.paragraphIndex < anchor.paragraphIndex ? 'previous_paragraph' : 'next_paragraph';
        appendSection(
          sections,
          sources,
          omittedContextReasons,
          sectionFromParagraph(`[${kind}]`, neighbor.friendlyLocation, kind, neighbor),
          maxCharacters
        );
      }
    }

    for (const reference of getParagraphReferences(dbPath, input.referenceParagraphIds ?? []).references) {
      appendSection(
        sections,
        sources,
        omittedContextReasons,
        {
          marker: '[reference]',
          title: reference.friendlyLocation,
          body: reference.text,
          source: {
            id: `reference:${reference.paragraphId}`,
            kind: 'reference',
            label: 'manual reference',
            friendlyLocation: reference.friendlyLocation,
            paragraphId: reference.paragraphId,
            chapterId: reference.chapterId,
            textPreview: previewText(reference.text),
          },
        },
        maxCharacters
      );
    }

    for (const mention of input.searchMentions ?? []) {
      const references = resolveSearchMentionReferences(dbPath, { mention, limit: 4 }).references;
      for (const reference of references) {
        appendSection(
          sections,
          sources,
          omittedContextReasons,
          {
            marker: '[search_result]',
            title: `${mention} / ${reference.friendlyLocation}`,
            body: reference.text,
            source: {
              id: `search:${mention}:${reference.paragraphId}`,
              kind: 'search_result',
              label: mention,
              friendlyLocation: reference.friendlyLocation,
              paragraphId: reference.paragraphId,
              chapterId: reference.chapterId,
              textPreview: previewText(reference.text),
            },
          },
          maxCharacters
        );
      }
    }

    const paragraphIds = uniqueParagraphIds(sources.map((source) => source.paragraphId));
    const factSections = readFacts(db, paragraphIds);
    if (factSections.length === 0) {
      omittedContextReasons.push({
        code: 'facts_not_available',
        detail: '当前项目还没有可用事实记忆，后续记忆抽取后会加入上下文。',
      });
    }
    for (const section of factSections) {
      appendSection(sections, sources, omittedContextReasons, section, maxCharacters);
    }

    const issueSections = readIssues(db, anchor?.paragraphId);
    if (issueSections.length === 0) {
      omittedContextReasons.push({
        code: 'issues_not_available',
        detail: '当前作用域没有打开的问题卡或尚未运行校对/连续性检查。',
      });
    }
    for (const section of issueSections) {
      appendSection(sections, sources, omittedContextReasons, section, maxCharacters);
    }

    const outlineSections = readOutlineRecords(db);
    if (outlineSections.length === 0) {
      omittedContextReasons.push({
        code: 'outline_not_available',
        detail: '当前项目尚未导入 Markdown 大纲或全局设定。',
      });
    }
    for (const section of outlineSections) {
      appendSection(sections, sources, omittedContextReasons, section, maxCharacters);
    }

    const styleSections = readStyleGuides(db, input.currentChapterId ?? anchor?.chapterId);
    if (styleSections.length === 0) {
      omittedContextReasons.push({
        code: 'style_guide_not_available',
        detail: '当前项目还没有风格指南，润色会先依赖选区和邻近正文。',
      });
    }
    for (const section of styleSections) {
      appendSection(sections, sources, omittedContextReasons, section, maxCharacters);
    }
  } finally {
    db.close();
  }

  const contextText = sections.join('\n\n');
  const sourceList = sources;
  const tokenEstimate = estimateTokens(contextText);
  return {
    action: {
      kind: input.actionKind,
      scopeLabel: input.scopeLabel,
    },
    selectedText: input.selectedText?.trim() ? input.selectedText.trim() : null,
    userInstruction: input.userInstruction?.trim() ?? '',
    contextText,
    sourceList,
    tokenEstimate,
    characterCount: contextText.length,
    maxCharacters,
    preflightSummary: `${input.actionKind} / ${input.scopeLabel} / ${sourceList.length} 个来源 / 约 ${tokenEstimate} tokens / 省略 ${omittedContextReasons.length} 项`,
    omittedContextReasons,
  };
}

export function createAiTaskWithContext(
  dbPath: string,
  input: CreateAiTaskWithContextInput
): AiTaskPreflightResult {
  const db = openDb(dbPath);
  const taskId = `task-${crypto.randomUUID()}`;
  const timestamp = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO ai_tasks
       (id, type, status, input_json, output_json, model_provider, model_name, started_at, finished_at, error, parent_task_id)
       VALUES (?, ?, 'preflight_ready', ?, NULL, ?, ?, NULL, NULL, NULL, NULL)`
    ).run(
      taskId,
      input.taskType,
      JSON.stringify({
        createdAt: timestamp,
        contextMetadata: makeMetadata(input.context),
        reasoning: {
          reasoningEffort: input.reasoningEffort,
          thinkingMode: input.thinkingMode,
        },
      }),
      input.providerId,
      input.modelName
    );
    return { taskId, status: 'preflight_ready' };
  } finally {
    db.close();
  }
}
