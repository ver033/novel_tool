import crypto from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as chardet from 'chardet';
import iconv from 'iconv-lite';
import type { createJobQueue } from '../../jobs/job-queue';
import { rebuildParagraphSearchIndexForDb } from '../../search/search-service';

export interface TxtImportPreviewChapter {
  title: string;
  index: number;
  paragraphCount: number;
  suspiciousHeadingMarkers: string[];
  previewSnippets: string[];
  paragraphs: string[];
}

export interface TxtImportPreview {
  sourceFilePath: string;
  fileName: string;
  suggestedProjectName: string;
  detectedEncoding: string;
  chapters: TxtImportPreviewChapter[];
  warnings: string[];
}

interface ParseOptions {
  fileName: string;
  sourceFilePath: string;
  detectedEncoding: string;
}

interface WorkingChapter {
  title: string;
  suspiciousHeadingMarkers: string[];
  lines: string[];
}

export interface CommitTxtImportInput {
  projectPath: string;
  db: InstanceType<typeof Database>;
  queue: ReturnType<typeof createJobQueue>;
  preview: TxtImportPreview;
}

export interface CommitTxtImportResult {
  bookId: string;
  chapterCount: number;
  paragraphCount: number;
  originalCopyPath: string;
}

const chineseNumber = '零〇一二三四五六七八九十百千万两';
const chapterHeadingPattern = new RegExp(
  [
    `^第[${chineseNumber}0-9]+[章节回部卷](?:\\s+.*|.*)?$`,
    `^卷[${chineseNumber}0-9]+(?:\\s+.*|.*)?$`,
    '^楔子(?:\\s+.*)?$',
    '^序章(?:\\s+.*)?$',
    '^前言(?:\\s+.*)?$',
    '^番外(?:\\s+.*)?$',
    '^后记(?:\\s+.*)?$',
    '^Chapter\\s+[0-9]+(?:\\s+.*)?$',
    '^[0-9]{1,4}$',
  ].join('|'),
  'i'
);

function stripTxtExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function shortHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 10);
}

function padded(value: number): string {
  return String(value).padStart(4, '0');
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

function normalizeText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u3000/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isChapterHeading(line: string): boolean {
  if (line.length > 48) {
    return false;
  }
  return chapterHeadingPattern.test(line);
}

function headingMarkers(line: string): string[] {
  return /^[0-9]{1,4}$/.test(line) ? ['numeric_heading'] : [];
}

function linesToParagraphs(lines: string[]): string[] {
  return lines.map((line) => line.trim()).filter(Boolean);
}

function toPreviewChapter(chapter: WorkingChapter, index: number): TxtImportPreviewChapter {
  const paragraphs = linesToParagraphs(chapter.lines);
  return {
    title: chapter.title,
    index,
    paragraphCount: paragraphs.length,
    suspiciousHeadingMarkers: chapter.suspiciousHeadingMarkers,
    previewSnippets: paragraphs.slice(0, 2).map((paragraph) => paragraph.slice(0, 90)),
    paragraphs,
  };
}

function detectEncodingName(buffer: Buffer): string {
  const detected = chardet.detect(buffer);
  if (typeof detected === 'string' && iconv.encodingExists(detected)) {
    return detected;
  }
  return 'UTF-8';
}

export function parseTxtManuscript(text: string, options: ParseOptions): TxtImportPreview {
  const normalized = normalizeText(text);
  const suggestedProjectName = stripTxtExtension(options.fileName);
  const chapters: WorkingChapter[] = [];
  let current: WorkingChapter | null = null;

  for (const line of normalized.split('\n')) {
    if (!line) {
      continue;
    }

    if (isChapterHeading(line)) {
      current = {
        title: line,
        suspiciousHeadingMarkers: headingMarkers(line),
        lines: [],
      };
      chapters.push(current);
      continue;
    }

    if (!current) {
      current = {
        title: suggestedProjectName,
        suspiciousHeadingMarkers: ['no_chapter_heading'],
        lines: [],
      };
      chapters.push(current);
    }

    current.lines.push(line);
  }

  if (chapters.length === 0) {
    chapters.push({
      title: suggestedProjectName,
      suspiciousHeadingMarkers: ['empty_file'],
      lines: [],
    });
  }

  return {
    sourceFilePath: options.sourceFilePath,
    fileName: options.fileName,
    suggestedProjectName,
    detectedEncoding: options.detectedEncoding,
    chapters: chapters.map(toPreviewChapter),
    warnings: chapters.flatMap((chapter) => chapter.suspiciousHeadingMarkers),
  };
}

export async function previewTxtImport(filePath: string): Promise<TxtImportPreview> {
  const buffer = await readFile(filePath);
  const detectedEncoding = detectEncodingName(buffer);
  const text = iconv.decode(buffer, detectedEncoding);
  return parseTxtManuscript(text, {
    fileName: path.basename(filePath),
    sourceFilePath: filePath,
    detectedEncoding,
  });
}

export async function commitTxtImport(input: CommitTxtImportInput): Promise<CommitTxtImportResult> {
  const originalsPath = path.join(input.projectPath, 'originals');
  await mkdir(originalsPath, { recursive: true });
  const originalCopyPath = path.join(originalsPath, input.preview.fileName);
  await copyFile(input.preview.sourceFilePath, originalCopyPath);

  const projectRow = input.db.prepare('SELECT id FROM projects ORDER BY created_at LIMIT 1').get() as
    | { id: string }
    | undefined;
  if (!projectRow) {
    throw new Error('Project row is missing; create or open a project before committing TXT import');
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
           VALUES (?, ?, ?, ?, 'txt', ?, ?, ?, ?)`
        )
        .run(chapterId, bookId, chapter.title, chapter.index, input.preview.fileName, wordCount, timestamp, timestamp);

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
