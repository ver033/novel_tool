import crypto from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';

import type { LlmTaskRequest, ParsedProviderResponse, ReasoningEffort, ThinkingMode } from '../llm/provider-adapters';

type SqliteDb = InstanceType<typeof Database>;
type CanonSourceKind = 'markdown_outline' | 'generated_control_doc';

export interface CanonImportRecord {
  id: string;
  headingPath: string;
  recordType: string;
  text: string;
  status: string;
}

export interface CanonListRecord extends CanonImportRecord {
  sourceId: string;
  sourceFileName: string;
  createdAt: string;
}

export interface CanonListSource {
  id: string;
  fileName: string;
  sourceKind: CanonSourceKind;
  importedAt: string;
  recordCount: number;
}

export interface CanonListResult {
  sources: CanonListSource[];
  records: CanonListRecord[];
}

export interface CanonImportResult {
  sourceId: string;
  fileName: string;
  sourceKind: 'markdown_outline';
  copiedPath: string;
  recordCount: number;
  records: CanonImportRecord[];
}

export interface CanonAnalyzeResult {
  sourceKind: 'generated_control_doc';
  fileNames: string[];
  recordCount: number;
  records: CanonImportRecord[];
}

export interface CanonModelRequest {
  model: string;
  reasoningEffort: ReasoningEffort;
  thinkingMode: ThinkingMode;
  sendModelRequest: (request: LlmTaskRequest) => Promise<Pick<ParsedProviderResponse, 'content'>>;
}

interface ParsedMarkdownSection {
  headingPath: string;
  recordType: string;
  text: string;
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function shortHash(value: string): string {
  return hash(value).slice(0, 12);
}

function classifySection(headingPath: string, text: string): string {
  const value = `${headingPath}\n${text}`;
  const currentHeading = headingPath.split(' > ').at(-1) ?? headingPath;
  if (/^项目概览$/.test(currentHeading)) {
    return 'overview';
  }
  if (/^主题与命题$/.test(currentHeading)) {
    return 'theme';
  }
  if (/^风格指南$/.test(currentHeading)) {
    return 'style';
  }
  if (/^角色人设$/.test(currentHeading)) {
    return 'character';
  }
  if (/^世界观$/.test(currentHeading)) {
    return 'world_rule';
  }
  if (/^关系图谱?$/.test(currentHeading)) {
    return 'relationship';
  }
  if (/^动态状态$/.test(currentHeading)) {
    return 'dynamic_state';
  }
  if (/^主线与支线$/.test(currentHeading)) {
    return 'plotline';
  }
  if (/伏笔|foreshadow/i.test(value)) {
    return 'foreshadowing';
  }
  if (/第[零〇一二三四五六七八九十百千万两0-9]+[章节回部]|章节|大纲|roadmap/i.test(value)) {
    return 'chapter_roadmap';
  }
  if (/主线|支线|plotline/i.test(value)) {
    return 'plotline';
  }
  if (/角色|人物|cast|character/i.test(value)) {
    return 'character';
  }
  if (/世界|规则|world|rule/i.test(value)) {
    return 'world_rule';
  }
  if (/关系|relationship/i.test(value)) {
    return 'relationship';
  }
  if (/风格|style/i.test(value)) {
    return 'style';
  }
  return 'note';
}

function parseMarkdownSections(content: string): ParsedMarkdownSection[] {
  const sections: ParsedMarkdownSection[] = [];
  const headingStack: string[] = [];
  let currentHeadingLevel = 0;
  let currentBody: string[] = [];

  function flush(): void {
    if (headingStack.length === 0) {
      currentBody = [];
      return;
    }
    const headingPath = headingStack.join(' > ');
    const text = currentBody.join('\n').trim() || headingStack[headingStack.length - 1];
    sections.push({
      headingPath,
      recordType: classifySection(headingPath, text),
      text,
    });
    currentBody = [];
  }

  for (const rawLine of content.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(rawLine);
    if (heading) {
      flush();
      currentHeadingLevel = heading[1].length;
      headingStack.splice(currentHeadingLevel - 1);
      headingStack[currentHeadingLevel - 1] = heading[2].trim();
      continue;
    }
    const trimmed = rawLine.trim();
    if (trimmed) {
      currentBody.push(trimmed);
    }
  }
  flush();

  return sections.filter((section) => section.headingPath.trim());
}

const controlDocumentNames = [
  '00-project-overview.md',
  '01-theme-and-proposition.md',
  '02-worldbuilding.md',
  '03-cast-bible.md',
  '04-relationship-map.md',
  '05-main-plotlines.md',
  '06-foreshadow-ledger.md',
  '07-chapter-roadmap.md',
  '08-dynamic-state.md',
  '09-style-guide.md',
] as const;

const generatedControlDocumentSchema = z.object({
  file_name: z.enum(controlDocumentNames),
  markdown: z.string().min(20),
});

const generatedControlDocumentOutputSchema = z.object({
  documents: z.array(generatedControlDocumentSchema).length(controlDocumentNames.length),
});

interface AnalysisParagraphSnapshot {
  paragraphId: string;
  chapterTitle: string;
  chapterIndex: number;
  paragraphIndex: number;
  text: string;
}

function openDb(dbPath: string): SqliteDb {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  return db;
}

function writeCanonRows(
  db: SqliteDb,
  input: {
    sourceId: string;
    fileName: string;
    filePath: string;
    hash: string;
    sourceKind: CanonSourceKind;
    records: ParsedMarkdownSection[];
  }
): CanonImportRecord[] {
  const timestamp = new Date().toISOString();
  const rows: CanonImportRecord[] = input.records.map((record, index) => ({
    id: `outline-record-${shortHash(`${input.sourceId}:${index}:${record.headingPath}`)}`,
    headingPath: record.headingPath,
    recordType: record.recordType,
    text: record.text,
    status: 'ai_extracted',
  }));

  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO canon_sources (id, file_name, source_path, source_kind, imported_at, content_hash)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(input.sourceId, input.fileName, input.filePath, input.sourceKind, timestamp, input.hash);
    for (const row of rows) {
      db.prepare(
        `INSERT INTO outline_records (id, source_id, heading_path, record_type, text, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(row.id, input.sourceId, row.headingPath, row.recordType, row.text, row.status, timestamp);
    }
  });
  insert();

  return rows;
}

export async function importMarkdownCanon(input: {
  projectPath: string;
  dbPath: string;
  filePath: string;
}): Promise<CanonImportResult> {
  if (!/\.md$/i.test(input.filePath)) {
    throw new Error('只支持导入 Markdown 大纲或设定文件');
  }

  const content = await readFile(input.filePath, 'utf8');
  const records = parseMarkdownSections(content);
  if (records.length === 0) {
    throw new Error('Markdown 中没有可导入的标题结构');
  }

  const fileName = path.basename(input.filePath);
  const outlineDir = path.join(input.projectPath, 'outlines');
  await mkdir(outlineDir, { recursive: true });
  const copiedPath = path.join(outlineDir, fileName);
  await copyFile(input.filePath, copiedPath);

  const sourceId = `canon-source-${shortHash(`${copiedPath}:${Date.now()}:${content.length}`)}`;
  const db = new Database(input.dbPath);
  try {
    const savedRecords = writeCanonRows(db, {
      sourceId,
      fileName,
      filePath: copiedPath,
      hash: hash(content),
      sourceKind: 'markdown_outline',
      records,
    });
    return {
      sourceId,
      fileName,
      sourceKind: 'markdown_outline',
      copiedPath,
      recordCount: savedRecords.length,
      records: savedRecords,
    };
  } finally {
    db.close();
  }
}

interface ChapterSnapshot {
  id: string;
  title: string;
  index: number;
  wordCount: number;
  paragraphCount: number;
  firstParagraph: string;
}

interface EntitySnapshot {
  type: string;
  name: string;
  description: string;
  status: string;
}

interface ProjectSnapshot {
  projectName: string;
  bookTitle: string;
  chapterCount: number;
  paragraphCount: number;
  wordCount: number;
  chapters: ChapterSnapshot[];
  entities: EntitySnapshot[];
}

function readProjectSnapshot(db: SqliteDb): ProjectSnapshot {
  const project = db.prepare('SELECT name FROM projects ORDER BY created_at ASC LIMIT 1').get() as
    | Record<string, unknown>
    | undefined;
  const book = db.prepare('SELECT title FROM books ORDER BY created_at ASC LIMIT 1').get() as
    | Record<string, unknown>
    | undefined;
  const aggregate = db
    .prepare(
      `SELECT COUNT(DISTINCT chapters.id) AS chapterCount,
              COUNT(paragraphs.id) AS paragraphCount,
              COALESCE(SUM(LENGTH(paragraphs.text)), 0) AS wordCount
       FROM chapters
       LEFT JOIN paragraphs ON paragraphs.chapter_id = chapters.id`
    )
    .get() as Record<string, unknown>;
  const chapters = db
    .prepare(
      `SELECT chapters.id,
              chapters.title,
              chapters.chapter_index AS chapterIndex,
              chapters.word_count AS wordCount,
              COUNT(paragraphs.id) AS paragraphCount,
              COALESCE((
                SELECT first_para.text
                FROM paragraphs AS first_para
                WHERE first_para.chapter_id = chapters.id
                ORDER BY first_para.paragraph_index ASC
                LIMIT 1
              ), '') AS firstParagraph
       FROM chapters
       LEFT JOIN paragraphs ON paragraphs.chapter_id = chapters.id
       GROUP BY chapters.id
       ORDER BY chapters.chapter_index ASC`
    )
    .all() as Array<Record<string, unknown>>;
  const entities = db
    .prepare(
      `SELECT type, canonical_name AS name, COALESCE(description, '') AS description, status
       FROM entities
       ORDER BY updated_at DESC, canonical_name ASC
       LIMIT 40`
    )
    .all() as Array<Record<string, unknown>>;

  return {
    projectName: String(project?.name ?? book?.title ?? '未命名项目'),
    bookTitle: String(book?.title ?? project?.name ?? '未命名作品'),
    chapterCount: Number(aggregate.chapterCount ?? 0),
    paragraphCount: Number(aggregate.paragraphCount ?? 0),
    wordCount: Number(aggregate.wordCount ?? 0),
    chapters: chapters.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      index: Number(row.chapterIndex),
      wordCount: Number(row.wordCount ?? 0),
      paragraphCount: Number(row.paragraphCount ?? 0),
      firstParagraph: String(row.firstParagraph ?? ''),
    })),
    entities: entities.map((row) => ({
      type: String(row.type),
      name: String(row.name),
      description: String(row.description),
      status: String(row.status),
    })),
  };
}

function shortText(value: string, length = 96): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > length ? `${normalized.slice(0, length)}...` : normalized;
}

function parseJsonObject(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('全局设定分析输出结构无效：不是合法 JSON');
  }
}

function readAnalysisParagraphs(db: SqliteDb, maxCount = 180): AnalysisParagraphSnapshot[] {
  const rows = db
    .prepare(
      `SELECT paragraphs.id AS paragraph_id,
              paragraphs.paragraph_index,
              paragraphs.text,
              chapters.title AS chapter_title,
              chapters.chapter_index
       FROM paragraphs
       JOIN chapters ON chapters.id = paragraphs.chapter_id
       ORDER BY chapters.chapter_index ASC, paragraphs.paragraph_index ASC`
    )
    .all() as Array<Record<string, unknown>>;

  const paragraphs = rows.map((row) => ({
    paragraphId: String(row.paragraph_id),
    chapterTitle: String(row.chapter_title),
    chapterIndex: Number(row.chapter_index),
    paragraphIndex: Number(row.paragraph_index),
    text: String(row.text ?? ''),
  }));
  if (paragraphs.length <= maxCount) {
    return paragraphs;
  }

  const scored = paragraphs
    .map((paragraph) => {
      const text = paragraph.text;
      const score =
        (text.match(/萧炎|主角|父亲|薰儿|戒指|斗之气|斗者|功法|家族|云岚宗|退婚|秘密|规则|伏笔|发光|消失/g) ?? []).length * 2 +
        (text.match(/“|”|说道|问道|笑道|宣布|决定|知道|发现/g) ?? []).length;
      return { paragraph, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCount);
  return scored.map((item) => item.paragraph).sort((a, b) => a.chapterIndex - b.chapterIndex || a.paragraphIndex - b.paragraphIndex);
}

function paragraphIdPrefix(paragraphId: string): string | null {
  return /^para-\d{4}-\d{4}/.exec(paragraphId)?.[0] ?? null;
}

function readParagraphLocationMap(db: SqliteDb): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT paragraphs.id AS paragraph_id,
              paragraphs.paragraph_index,
              chapters.title AS chapter_title
       FROM paragraphs
       JOIN chapters ON chapters.id = paragraphs.chapter_id
       ORDER BY chapters.chapter_index ASC, paragraphs.paragraph_index ASC`
    )
    .all() as Array<Record<string, unknown>>;
  const locations = new Map<string, string>();
  for (const row of rows) {
    const paragraphId = String(row.paragraph_id);
    const location = `${String(row.chapter_title)} / 第 ${Number(row.paragraph_index) + 1} 段`;
    locations.set(paragraphId, location);
    const prefix = paragraphIdPrefix(paragraphId);
    if (prefix && !locations.has(prefix)) {
      locations.set(prefix, location);
    }
  }
  return locations;
}

const canonFieldLabelReplacements: Array<[RegExp, string]> = [
  [/\brole(?:\s+in\s+story)?\b\s*[:：]/gi, '角色定位：'],
  [/\bvisible\s+goal\b\s*[:：]/gi, '明面目标：'],
  [/\bhidden\s+need\b\s*[:：]/gi, '内在需求：'],
  [/\bfear\s*\/\s*shame\s*\/\s*debt\b\s*[:：]/gi, '恐惧 / 羞耻 / 债：'],
  [/\bspeech\s+signature\b\s*[:：]/gi, '说话方式：'],
  [/\barc\s+direction\b\s*[:：]/gi, '变化方向：'],
  [/\bcurrent\s+state\b\s*[:：]/gi, '当前关系：'],
  [/\bhidden\s+tension\b\s*[:：]/gi, '隐性张力：'],
  [/\bunresolved\s+debt\b\s*[:：]/gi, '未偿关系债：'],
  [/\bcore\s+conflict\b\s*[:：]/gi, '核心冲突：'],
  [/\bcurrent\s+objective\b\s*[:：]/gi, '当前目标：'],
  [/\bcurrent\s+obstacle\b\s*[:：]/gi, '当前阻碍：'],
  [/\bstage\s+target\b\s*[:：]/gi, '阶段目标：'],
  [/\bkey\s+conflict\b\s*[:：]/gi, '关键冲突：'],
  [/\bplanted\s+in\s+chapter\b\s*[:：]/gi, '埋设章节：'],
  [/\bsurface\s+form\b\s*[:：]/gi, '表层形式：'],
  [/\bhidden\s+meaning\b\s*[:：]/gi, '潜在含义：'],
  [/\bexpected\s+payoff\s+window\b\s*[:：]/gi, '预计回收窗口：'],
  [/\bparagraph\s+mode\b\s*[:：]/gi, '段落模式：'],
  [/\bnarrative\s+distance\b\s*[:：]/gi, '叙述距离：'],
  [/\blanguage\s+taboos\b\s*[:：]/gi, '语言禁忌：'],
];

function normalizeGeneratedCanonMarkdown(markdown: string, paragraphLocations: Map<string, string>): string {
  let output = markdown.replace(/\*\*([^*\n]+)\*\*\s*[:：]/g, '$1：');
  for (const [pattern, replacement] of canonFieldLabelReplacements) {
    output = output.replace(pattern, replacement);
  }
  output = output.replace(
    /para-(\d{4})-(\d{4})(?:-[a-f0-9]{8,})?((?:\s*[,，、]\s*\d{4})+)/gi,
    (match: string, chapterIndex: string, paragraphIndex: string, tail: string) => {
      const references = [`para-${chapterIndex}-${paragraphIndex}`, ...(tail.match(/\d{4}/g) ?? []).map((index) => `para-${chapterIndex}-${index}`)];
      const resolved = references.map((reference) => paragraphLocations.get(reference) ?? reference);
      return resolved.join('、') || match;
    }
  );
  output = output.replace(/para-\d{4}-\d{4}(?:-[a-f0-9]{8,})?/gi, (match) => paragraphLocations.get(match) ?? match);
  output = output.replace(/（([^）]*第 \d+ 段[^）]*)）/g, (_match: string, inner: string) => {
    const parts = inner
      .split(/[，,、]\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    return `（${[...new Set(parts)].join('、')}）`;
  });
  return output;
}

function buildCanonPromptMessages(snapshot: ProjectSnapshot, paragraphs: AnalysisParagraphSnapshot[]) {
  const chapterSummary = snapshot.chapters
    .map((chapter) => `- ${chapter.title}：${chapter.paragraphCount} 段，约 ${chapter.wordCount} 字；首段：${shortText(chapter.firstParagraph, 120)}`)
    .join('\n');
  const entitySummary =
    snapshot.entities.length > 0
      ? snapshot.entities.map((entity) => `- ${entity.name}（${entity.type}）：${entity.description || '待补'}`).join('\n')
      : '- 暂无已确认记忆卡。';
  const paragraphContext = paragraphs
    .map(
      (paragraph) =>
        [
          `paragraph_id=${paragraph.paragraphId}`,
          `location=${paragraph.chapterTitle} / 第 ${paragraph.paragraphIndex + 1} 段`,
          `text=${shortText(paragraph.text, 420)}`,
        ].join('\n')
    )
    .join('\n\n');

  return [
    {
      role: 'system' as const,
      content:
        '你是中文长篇小说项目控制文档分析器。你需要按 novel-control-station 的 00-09 控制文档结构，从正文证据中生成作者可确认的全局设定。只返回 JSON。',
    },
    {
      role: 'user' as const,
      content: [
        '任务：根据当前正文生成 10 个控制文档。不要写成章节统计清单，也不要只复述每章首段。',
        '',
        '必须生成这些 file_name：',
        controlDocumentNames.map((name) => `- ${name}`).join('\n'),
        '',
        '每个 markdown 的要求：',
        '- 使用中文标题，页面名称不要带文件编号。',
        '- 把明确证据写成可供作者确认的设定、人物、关系、主线、伏笔、动态状态和风格规则。',
        '- 不确定的地方可以写“待作者确认”，但不能把整页都写成空模板。',
        '- 重要判断尽量附可读来源位置，例如“第1章 陨落的天才 / 第 12 段”；不要在正文文档中输出 paragraph_id。',
        '- 03 角色人设必须尽量覆盖：角色定位、明面目标、内在需求、恐惧/羞耻/债、说话方式、变化方向。',
        '- 不要使用 role、visible goal、hidden need、fear/shame/debt、speech signature、arc direction 等英文标签。',
        '- 05 主线支线必须写核心冲突、当前目标、阻碍、下一步压力。',
        '- 06 伏笔台账必须识别可能的伏笔或明确说明暂无强证据。',
        '- 08 动态状态必须记录最新人物/道具/认知状态变化。',
        '',
        '返回 JSON 结构：',
        '{"documents":[{"file_name":"00-project-overview.md","markdown":"# 项目概览\\n..."}]}',
        '',
        `项目：${snapshot.bookTitle}`,
        `章节数：${snapshot.chapterCount}；段落数：${snapshot.paragraphCount}；字数：${snapshot.wordCount}`,
        '',
        '章节概览：',
        chapterSummary || '暂无章节。',
        '',
        '已有记忆卡：',
        entitySummary,
        '',
        '正文证据段落：',
        paragraphContext || '暂无正文段落。',
      ].join('\n'),
    },
  ];
}

function parseGeneratedControlDocuments(raw: string | unknown): Map<(typeof controlDocumentNames)[number], string> {
  const parsed = generatedControlDocumentOutputSchema.safeParse(typeof raw === 'string' ? parseJsonObject(raw) : raw);
  if (!parsed.success) {
    throw new Error(`全局设定分析输出结构无效：${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }

  const documents = new Map<(typeof controlDocumentNames)[number], string>();
  for (const doc of parsed.data.documents) {
    documents.set(doc.file_name, doc.markdown);
  }
  for (const fileName of controlDocumentNames) {
    if (!documents.has(fileName)) {
      throw new Error(`全局设定分析缺少控制文档：${fileName}`);
    }
  }
  return documents;
}

export async function analyzeProjectCanon(input: {
  projectPath: string;
  dbPath: string;
  modelRequest?: CanonModelRequest;
}): Promise<CanonAnalyzeResult> {
  if (!input.modelRequest) {
    throw new Error('全局设定分析需要可用模型。请先在模型设置中连接当前供应商。');
  }

  const canonDir = path.join(input.projectPath, 'canon');
  await mkdir(canonDir, { recursive: true });
  const db = openDb(input.dbPath);
  try {
    const snapshot = readProjectSnapshot(db);
    const providerResponse = await input.modelRequest.sendModelRequest({
      model: input.modelRequest.model,
      messages: buildCanonPromptMessages(snapshot, readAnalysisParagraphs(db)),
      reasoningEffort: input.modelRequest.reasoningEffort,
      thinkingMode: input.modelRequest.thinkingMode,
      stream: false,
      responseFormat: 'json_object',
    });
    const generatedMarkdown = parseGeneratedControlDocuments(providerResponse.content);
    const paragraphLocations = readParagraphLocationMap(db);
    const generated = controlDocumentNames.map((fileName) => ({
      fileName,
      filePath: path.join(canonDir, fileName),
      content: normalizeGeneratedCanonMarkdown(generatedMarkdown.get(fileName) ?? '', paragraphLocations),
    }));

    for (const doc of generated) {
      await writeFile(doc.filePath, doc.content, 'utf8');
    }

    const timestampKey = new Date().toISOString();
    const savedRecords = db.transaction(() => {
      const generatedSourceRows = db
        .prepare("SELECT id FROM canon_sources WHERE source_kind = 'generated_control_doc'")
        .all() as Array<Record<string, unknown>>;
      for (const row of generatedSourceRows) {
        db.prepare('DELETE FROM outline_records WHERE source_id = ?').run(String(row.id));
      }
      db.prepare("DELETE FROM canon_sources WHERE source_kind = 'generated_control_doc'").run();

      const rows: CanonImportRecord[] = [];
      for (const [index, doc] of generated.entries()) {
        rows.push(
          ...writeCanonRows(db, {
            sourceId: `control-doc-${String(index).padStart(2, '0')}-${shortHash(doc.fileName)}`,
            fileName: doc.fileName,
            filePath: doc.filePath,
            hash: hash(doc.content + timestampKey),
            sourceKind: 'generated_control_doc',
            records: parseMarkdownSections(doc.content),
          })
        );
      }
      return rows;
    })();

    return {
      sourceKind: 'generated_control_doc',
      fileNames: [...controlDocumentNames],
      recordCount: savedRecords.length,
      records: savedRecords,
    };
  } finally {
    db.close();
  }
}

export function listMarkdownCanon(dbPath: string): CanonListResult {
  const db = openDb(dbPath);
  try {
    const sources = db
      .prepare(
        `SELECT canon_sources.id,
                canon_sources.file_name AS fileName,
                canon_sources.source_kind AS sourceKind,
                canon_sources.imported_at AS importedAt,
                COUNT(outline_records.id) AS recordCount
         FROM canon_sources
         LEFT JOIN outline_records ON outline_records.source_id = canon_sources.id
         GROUP BY canon_sources.id
         ORDER BY canon_sources.imported_at DESC`
      )
      .all() as Array<Record<string, unknown>>;
    const records = db
      .prepare(
        `SELECT outline_records.id,
                outline_records.source_id AS sourceId,
                canon_sources.file_name AS sourceFileName,
                canon_sources.source_kind AS sourceKind,
                outline_records.heading_path AS headingPath,
                outline_records.record_type AS recordType,
                outline_records.text,
                outline_records.status,
                outline_records.created_at AS createdAt
         FROM outline_records
         JOIN canon_sources ON canon_sources.id = outline_records.source_id
         WHERE outline_records.status != 'rejected'
         ORDER BY outline_records.created_at DESC, outline_records.rowid ASC`
      )
      .all() as Array<Record<string, unknown>>;
    const legacyGeneratedSourceIds = new Set(
      records
        .filter((row) => {
          const isGenerated = String(row.sourceKind) === 'generated_control_doc';
          const isOverview = String(row.sourceFileName) === '00-project-overview.md';
          const text = String(row.text ?? '');
          return (
            isGenerated &&
            isOverview &&
            text.includes('操作模式：作者控制的本地写作工作台') &&
            text.includes('章节数量：')
          );
        })
        .map((row) => String(row.sourceId))
    );
    if (legacyGeneratedSourceIds.size > 0) {
      for (const source of sources) {
        if (String(source.sourceKind) === 'generated_control_doc') {
          legacyGeneratedSourceIds.add(String(source.id));
        }
      }
    }

    return {
      sources: sources
        .filter((row) => !legacyGeneratedSourceIds.has(String(row.id)))
        .map((row) => ({
          id: String(row.id),
          fileName: String(row.fileName),
          sourceKind: String(row.sourceKind) === 'generated_control_doc' ? 'generated_control_doc' : 'markdown_outline',
          importedAt: String(row.importedAt),
          recordCount: Number(row.recordCount ?? 0),
        })),
      records: records
        .filter((row) => !legacyGeneratedSourceIds.has(String(row.sourceId)))
        .map((row) => ({
          id: String(row.id),
          sourceId: String(row.sourceId),
          sourceFileName: String(row.sourceFileName),
          headingPath: String(row.headingPath),
          recordType: String(row.recordType),
          text: String(row.text),
          status: String(row.status),
          createdAt: String(row.createdAt),
        })),
    };
  } finally {
    db.close();
  }
}
