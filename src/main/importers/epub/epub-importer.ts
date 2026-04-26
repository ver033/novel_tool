import crypto from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { parse } from 'parse5';

import type { createJobQueue } from '../../jobs/job-queue';
import { rebuildParagraphSearchIndexForDb } from '../../search/search-service';

interface EpubPreviewChapter {
  title: string;
  index: number;
  paragraphCount: number;
  suspiciousHeadingMarkers: string[];
  previewSnippets: string[];
  paragraphs: string[];
  sourceHref: string;
}

export interface EpubImportPreview {
  sourceFilePath: string;
  fileName: string;
  suggestedProjectName: string;
  detectedEncoding: 'EPUB';
  chapters: EpubPreviewChapter[];
  warnings: string[];
}

export interface CommitEpubImportInput {
  projectPath: string;
  db: InstanceType<typeof Database>;
  queue: ReturnType<typeof createJobQueue>;
  preview: EpubImportPreview;
}

export interface CommitEpubImportResult {
  bookId: string;
  chapterCount: number;
  paragraphCount: number;
  originalCopyPath: string;
}

type Archive = Record<string, Uint8Array>;
type HtmlNode = {
  nodeName?: string;
  tagName?: string;
  value?: string;
  childNodes?: HtmlNode[];
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: true,
});

const blockTags = new Set(['p', 'li', 'blockquote']);
const headingTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function shortHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 10);
}

function padded(value: number): string {
  return String(value).padStart(4, '0');
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function makeBookId(projectName: string): string {
  return `book-${shortHash(projectName)}`;
}

function makeChapterId(chapterIndex: number, title: string): string {
  return `chap-${padded(chapterIndex + 1)}-${shortHash(title)}`;
}

function makeParagraphId(chapterIndex: number, paragraphIndex: number, text: string): string {
  return `para-${padded(chapterIndex + 1)}-${padded(paragraphIndex + 1)}-${shortHash(text)}`;
}

function arrayify<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function normalizeArchivePath(value: string): string {
  return value.replace(/^\/+/, '').replace(/\\/g, '/');
}

function dirnamePosix(value: string): string {
  const normalized = normalizeArchivePath(value);
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '';
}

function joinArchivePath(baseDir: string, href: string): string {
  return normalizeArchivePath(path.posix.normalize(path.posix.join(baseDir, href)));
}

function archiveText(archive: Archive, filePath: string): string {
  const normalized = normalizeArchivePath(filePath);
  const value = archive[normalized];
  if (!value) {
    throw new Error(`EPUB 缺少文件：${normalized}`);
  }
  return strFromU8(value);
}

function readContainerOpfPath(archive: Archive): string {
  const container = xmlParser.parse(archiveText(archive, 'META-INF/container.xml')) as Record<string, unknown>;
  const rootfiles = (container.container as Record<string, unknown> | undefined)?.rootfiles as
    | Record<string, unknown>
    | undefined;
  const rootfile = arrayify(rootfiles?.rootfile as Record<string, unknown> | Record<string, unknown>[] | undefined)[0];
  const fullPath = rootfile?.['full-path'];
  if (typeof fullPath !== 'string' || !fullPath) {
    throw new Error('EPUB container.xml 未声明 OPF 文件');
  }
  return normalizeArchivePath(fullPath);
}

function readBookTitle(opf: Record<string, unknown>, fallback: string): string {
  const metadata = (opf.package as Record<string, unknown> | undefined)?.metadata as Record<string, unknown> | undefined;
  const title = metadata?.['dc:title'] ?? metadata?.title;
  if (typeof title === 'string' && title.trim()) {
    return title.trim();
  }
  return stripExtension(fallback);
}

function readSpineHrefs(opf: Record<string, unknown>, opfPath: string): string[] {
  const pkg = opf.package as Record<string, unknown> | undefined;
  const manifest = pkg?.manifest as Record<string, unknown> | undefined;
  const spine = pkg?.spine as Record<string, unknown> | undefined;
  const items = arrayify(manifest?.item as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const itemRefs = arrayify(spine?.itemref as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const byId = new Map<string, string>();
  const opfDir = dirnamePosix(opfPath);
  for (const item of items) {
    if (typeof item.id === 'string' && typeof item.href === 'string') {
      byId.set(item.id, joinArchivePath(opfDir, item.href));
    }
  }
  const hrefs = itemRefs
    .map((ref) => (typeof ref.idref === 'string' ? byId.get(ref.idref) : undefined))
    .filter((value): value is string => Boolean(value));
  if (hrefs.length === 0) {
    throw new Error('EPUB spine 中没有可导入的正文文件');
  }
  return hrefs;
}

function textContent(node: HtmlNode): string {
  if (node.nodeName === '#text') {
    return node.value ?? '';
  }
  return (node.childNodes ?? []).map(textContent).join('');
}

function normalizeBlockText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hasChildBlock(node: HtmlNode): boolean {
  return (node.childNodes ?? []).some((child) => {
    const tag = child.tagName?.toLowerCase();
    return Boolean(tag && (blockTags.has(tag) || headingTags.has(tag) || hasChildBlock(child)));
  });
}

function collectBlocks(node: HtmlNode, output: Array<{ tag: string; text: string }>): void {
  const tag = node.tagName?.toLowerCase();
  if (tag && (headingTags.has(tag) || blockTags.has(tag) || (tag === 'div' && !hasChildBlock(node)))) {
    const text = normalizeBlockText(textContent(node));
    if (text) {
      output.push({ tag, text });
    }
    return;
  }
  for (const child of node.childNodes ?? []) {
    collectBlocks(child, output);
  }
}

function xhtmlToChapter(xhtml: string, sourceHref: string, index: number): EpubPreviewChapter {
  const document = parse(xhtml) as HtmlNode;
  const blocks: Array<{ tag: string; text: string }> = [];
  collectBlocks(document, blocks);
  const titleBlock = blocks.find((block) => headingTags.has(block.tag));
  const title = titleBlock?.text || `第 ${index + 1} 章`;
  const paragraphs = blocks
    .filter((block) => !headingTags.has(block.tag))
    .map((block) => block.text)
    .filter(Boolean);
  return {
    title,
    index,
    paragraphCount: paragraphs.length,
    suspiciousHeadingMarkers: paragraphs.length === 0 ? ['empty_chapter'] : [],
    previewSnippets: paragraphs.slice(0, 2).map((paragraph) => paragraph.slice(0, 90)),
    paragraphs,
    sourceHref,
  };
}

function importableChapters(chapters: EpubPreviewChapter[]): EpubPreviewChapter[] {
  return chapters
    .filter((chapter) => chapter.paragraphs.length > 0)
    .map((chapter, index) => ({
      ...chapter,
      index,
      suspiciousHeadingMarkers: chapter.suspiciousHeadingMarkers.filter((marker) => marker !== 'empty_chapter'),
    }));
}

export async function previewEpubImport(filePath: string): Promise<EpubImportPreview> {
  if (!/\.epub$/i.test(filePath)) {
    throw new Error('请选择 EPUB 文件');
  }
  const archive = unzipSync(new Uint8Array(await readFile(filePath)));
  const opfPath = readContainerOpfPath(archive);
  const opf = xmlParser.parse(archiveText(archive, opfPath)) as Record<string, unknown>;
  const hrefs = readSpineHrefs(opf, opfPath);
  const fileName = path.basename(filePath);
  const title = readBookTitle(opf, fileName);
  const parsedChapters = hrefs.map((href, index) => xhtmlToChapter(archiveText(archive, href), href, index));
  const skippedEmptyCount = parsedChapters.filter((chapter) => chapter.paragraphs.length === 0).length;
  const chapters = importableChapters(parsedChapters);
  if (chapters.length === 0) {
    throw new Error('EPUB 中没有可导入的正文段落');
  }
  return {
    sourceFilePath: filePath,
    fileName,
    suggestedProjectName: title,
    detectedEncoding: 'EPUB',
    chapters,
    warnings: [
      ...Array.from({ length: skippedEmptyCount }, () => 'skipped_empty_spine_entry'),
      ...chapters.flatMap((chapter) => chapter.suspiciousHeadingMarkers),
    ],
  };
}

export async function commitEpubImport(input: CommitEpubImportInput): Promise<CommitEpubImportResult> {
  const originalsPath = path.join(input.projectPath, 'originals');
  await mkdir(originalsPath, { recursive: true });
  const originalCopyPath = path.join(originalsPath, input.preview.fileName);
  await copyFile(input.preview.sourceFilePath, originalCopyPath);

  const projectRow = input.db.prepare('SELECT id FROM projects ORDER BY created_at LIMIT 1').get() as
    | { id: string }
    | undefined;
  if (!projectRow) {
    throw new Error('Project row is missing; create or open a project before committing EPUB import');
  }

  const bookId = makeBookId(input.preview.suggestedProjectName);
  const timestamp = new Date().toISOString();
  let paragraphCount = 0;

  const writeImport = input.db.transaction(() => {
    input.db
      .prepare(
        `INSERT INTO books (id, project_id, title, language, created_at, updated_at)
         VALUES (?, ?, ?, 'zh-CN', ?, ?)`
      )
      .run(bookId, projectRow.id, input.preview.suggestedProjectName, timestamp, timestamp);

    for (const chapter of input.preview.chapters) {
      const chapterId = makeChapterId(chapter.index, chapter.title);
      const wordCount = chapter.paragraphs.reduce((total, paragraph) => total + paragraph.length, 0);
      input.db
        .prepare(
          `INSERT INTO chapters
           (id, book_id, title, chapter_index, source_type, source_href, word_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'epub', ?, ?, ?, ?)`
        )
        .run(chapterId, bookId, chapter.title, chapter.index, chapter.sourceHref, wordCount, timestamp, timestamp);

      for (const [paragraphIndex, paragraph] of chapter.paragraphs.entries()) {
        const paragraphId = makeParagraphId(chapter.index, paragraphIndex, paragraph);
        const textHash = shortHash(paragraph);
        input.db
          .prepare(
            `INSERT INTO paragraphs
             (id, chapter_id, paragraph_index, text, text_hash, version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
          )
          .run(paragraphId, chapterId, paragraphIndex, paragraph, textHash, timestamp, timestamp);
        input.db
          .prepare(
            `INSERT INTO paragraph_versions (id, paragraph_id, version, text, change_reason, created_by, created_at)
             VALUES (?, ?, 1, ?, 'initial_import', 'importer', ?)`
          )
          .run(`pver-${paragraphId}-0001`, paragraphId, paragraph, timestamp);
        paragraphCount += 1;
      }
    }
  });

  writeImport();
  const indexJob = input.queue.enqueue({
    type: 'index_fts',
    inputSummary: {
      source: input.preview.fileName,
      chapterCount: input.preview.chapters.length,
      paragraphCount,
    },
    cancellable: true,
  });
  const indexedParagraphs = rebuildParagraphSearchIndexForDb(input.db);
  input.queue.complete(indexJob.id, { indexedParagraphs });

  return {
    bookId,
    chapterCount: input.preview.chapters.length,
    paragraphCount,
    originalCopyPath,
  };
}
