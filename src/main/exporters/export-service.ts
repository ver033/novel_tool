import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { strToU8, zipSync } from 'fflate';
import { createJobQueue } from '../jobs/job-queue';
import { isLegacyEmptyEpubSpinePlaceholder } from '../manuscript/chapter-artifacts';

type SqliteDb = InstanceType<typeof Database>;
type ExportFormat = 'txt' | 'epub';

interface ExportInput {
  format: ExportFormat;
  chapterIds?: string[];
}

interface RunExportInput extends ExportInput {
  outputPath: string;
}

interface ExportChapter {
  id: string;
  title: string;
  index: number;
  paragraphs: string[];
}

export interface ExportArtifactPreview {
  format: ExportFormat;
  fileName: string;
  outputPath: string;
  description: string;
  status: 'ready';
}

export interface ExportPreviewResult {
  format: ExportFormat;
  chapterCount: number;
  characterCount: number;
  unresolvedHighRiskIssueCount: number;
  defaultOutputPath: string;
  artifacts: ExportArtifactPreview[];
}

export interface ExportRunResult {
  format: ExportFormat;
  outputPath: string;
  artifactPath: string;
  chapterCount: number;
  characterCount: number;
  unresolvedHighRiskIssueCount: number;
  bytesWritten: number;
  jobId: string;
}

function safeFilePart(value: string): string {
  return value.trim().replace(/[/:\\]/g, '-').replace(/\s+/g, '-') || 'novel';
}

function isoDatePart(): string {
  return new Date().toISOString().slice(0, 10);
}

function readBookTitle(db: SqliteDb): string {
  const row = db.prepare('SELECT title FROM books ORDER BY created_at ASC LIMIT 1').get() as
    | { title: string }
    | undefined;
  return row?.title ?? 'novel';
}

function readExportChapters(db: SqliteDb, chapterIds?: string[]): ExportChapter[] {
  const params: string[] = [];
  let where = '';
  if (chapterIds && chapterIds.length > 0) {
    where = `WHERE chapters.id IN (${chapterIds.map(() => '?').join(', ')})`;
    params.push(...chapterIds);
  }
  const chapterRows = db
    .prepare(
      `SELECT chapters.id,
              chapters.title,
              chapters.chapter_index,
              chapters.source_type,
              COUNT(paragraphs.id) AS paragraph_count
       FROM chapters
       LEFT JOIN paragraphs ON paragraphs.chapter_id = chapters.id
       ${where}
       GROUP BY chapters.id
       ORDER BY chapter_index ASC`
    )
    .all(...params) as Array<Record<string, unknown>>;

  return chapterRows.filter((chapter) =>
    !isLegacyEmptyEpubSpinePlaceholder({
      paragraphCount: Number(chapter.paragraph_count),
      sourceType: String(chapter.source_type),
      title: String(chapter.title),
    })
  ).map((chapter) => {
    const paragraphRows = db
      .prepare('SELECT text FROM paragraphs WHERE chapter_id = ? ORDER BY paragraph_index ASC')
      .all(String(chapter.id)) as Array<{ text: string }>;
    return {
      id: String(chapter.id),
      title: String(chapter.title),
      index: Number(chapter.chapter_index),
      paragraphs: paragraphRows.map((row) => String(row.text)),
    };
  });
}

function countHighRiskIssues(db: SqliteDb): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM issues WHERE severity = 'high' AND status = 'open'").get() as
    | { count: number }
    | undefined;
  return Number(row?.count ?? 0);
}

function renderTxt(chapters: ExportChapter[]): string {
  return chapters.map((chapter) => [chapter.title, ...chapter.paragraphs].join('\n\n')).join('\n\n\n');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderEpub(title: string, chapters: ExportChapter[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    ),
    'OEBPS/styles.css': strToU8('body{font-family:serif;line-height:1.8;} p{text-indent:2em;}'),
  };
  const manifestItems = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'];
  const spineItems: string[] = [];
  const navItems: string[] = [];

  chapters.forEach((chapter, index) => {
    const fileName = `chapter-${index + 1}.xhtml`;
    const itemId = `chapter-${index + 1}`;
    manifestItems.push(`<item id="${itemId}" href="${fileName}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="${itemId}"/>`);
    navItems.push(`<li><a href="${fileName}">${escapeXml(chapter.title)}</a></li>`);
    files[`OEBPS/${fileName}`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN"><head><title>${escapeXml(chapter.title)}</title><link rel="stylesheet" href="styles.css" type="text/css"/></head><body><h1>${escapeXml(chapter.title)}</h1>${chapter.paragraphs
        .map((paragraph) => `<p>${escapeXml(paragraph)}</p>`)
        .join('')}</body></html>`
    );
  });

  files['OEBPS/nav.xhtml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN"><head><title>${escapeXml(title)}</title></head><body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>${escapeXml(title)}</h1><ol>${navItems.join('')}</ol></nav></body></html>`
  );
  files['OEBPS/content.opf'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">novel-tool-${Date.now()}</dc:identifier><dc:title>${escapeXml(title)}</dc:title><dc:language>zh-CN</dc:language></metadata><manifest>${manifestItems.join('')}<item id="style" href="styles.css" media-type="text/css"/></manifest><spine>${spineItems.join('')}</spine></package>`
  );

  return zipSync(files);
}

function buildPreview(db: SqliteDb, projectPath: string, input: ExportInput): ExportPreviewResult {
  const title = readBookTitle(db);
  const chapters = readExportChapters(db, input.chapterIds);
  const characterCount = chapters.reduce(
    (total, chapter) => total + chapter.title.length + chapter.paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0),
    0
  );
  const fileName = `${safeFilePart(title)}-${isoDatePart()}.${input.format}`;
  const outputPath = path.join(projectPath, 'exports', fileName);
  return {
    format: input.format,
    chapterCount: chapters.length,
    characterCount,
    unresolvedHighRiskIssueCount: countHighRiskIssues(db),
    defaultOutputPath: outputPath,
    artifacts: [
      {
        format: input.format,
        fileName,
        outputPath,
        description:
          input.format === 'txt'
            ? '保留章节标题和段落换行'
            : '生成 EPUB 目录、正文页面和基础样式',
        status: 'ready',
      },
    ],
  };
}

export function previewExport(dbPath: string, projectPath: string, input: ExportInput): ExportPreviewResult {
  const db = new Database(dbPath);
  try {
    return buildPreview(db, projectPath, input);
  } finally {
    db.close();
  }
}

export async function runExport(dbPath: string, projectPath: string, input: RunExportInput): Promise<ExportRunResult> {
  const db = new Database(dbPath);
  try {
    const queue = createJobQueue(db);
    const preview = buildPreview(db, projectPath, input);
    const job = queue.enqueue({
      type: input.format === 'txt' ? 'export_txt' : 'export_epub',
      inputSummary: {
        format: input.format,
        chapterCount: preview.chapterCount,
        outputPath: input.outputPath,
      },
      cancellable: true,
    });
    queue.start(job.id);
    try {
      const title = readBookTitle(db);
      const chapters = readExportChapters(db, input.chapterIds);
      await mkdir(path.dirname(input.outputPath), { recursive: true });
      const content = input.format === 'txt' ? Buffer.from(renderTxt(chapters), 'utf8') : Buffer.from(renderEpub(title, chapters));
      await writeFile(input.outputPath, content);
      queue.complete(job.id, {
        outputPath: input.outputPath,
        bytesWritten: content.byteLength,
      });
      return {
        format: input.format,
        outputPath: input.outputPath,
        artifactPath: input.outputPath,
        chapterCount: preview.chapterCount,
        characterCount: preview.characterCount,
        unresolvedHighRiskIssueCount: preview.unresolvedHighRiskIssueCount,
        bytesWritten: content.byteLength,
        jobId: job.id,
      };
    } catch (error) {
      queue.fail(job.id, error instanceof Error ? error : new Error('导出失败'));
      throw error;
    }
  } finally {
    db.close();
  }
}
