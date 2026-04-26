import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { createProject } from '../../../src/main/projects/project-service';
import { createJobQueue } from '../../../src/main/jobs/job-queue';
import { commitTxtImport, parseTxtManuscript, previewTxtImport } from '../../../src/main/importers/txt/txt-importer';

describe('TXT importer preview', () => {
  test('detects common Chinese chapter heading formats', () => {
    const preview = parseTxtManuscript(
      [
        '楔子',
        '雨夜里，有人敲门。',
        '',
        '第一章 旧约',
        '沈照把灯芯拨低。',
        '',
        '第12章 归途',
        '城门在雪里合上。',
        '',
        '卷一',
        '山河初定。',
        '',
        '番外 雪后',
        '她终于把伞收起。',
        '',
        '001',
        '无名章节。',
      ].join('\n'),
      { fileName: '长夜.txt', sourceFilePath: '/tmp/长夜.txt', detectedEncoding: 'UTF-8' }
    );

    expect(preview.suggestedProjectName).toBe('长夜');
    expect(preview.chapters.map((chapter) => chapter.title)).toEqual([
      '楔子',
      '第一章 旧约',
      '第12章 归途',
      '卷一',
      '番外 雪后',
      '001',
    ]);
    expect(preview.chapters.map((chapter) => chapter.paragraphCount)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(preview.chapters.at(-1)?.suspiciousHeadingMarkers).toContain('numeric_heading');
  });

  test('normalizes whitespace and keeps author-facing paragraph preview snippets', () => {
    const preview = parseTxtManuscript('第一章　雨夜\r\n　第一段。  \r\n\r\n第二段。', {
      fileName: 'demo.txt',
      sourceFilePath: '/tmp/demo.txt',
      detectedEncoding: 'UTF-8',
    });

    expect(preview.chapters[0].title).toBe('第一章 雨夜');
    expect(preview.chapters[0].paragraphs).toEqual(['第一段。', '第二段。']);
    expect(preview.chapters[0].previewSnippets).toEqual(['第一段。', '第二段。']);
  });

  test('falls back to one chapter when no headings are found', () => {
    const preview = parseTxtManuscript('没有章名的第一段。\n没有章名的第二段。', {
      fileName: '散稿.txt',
      sourceFilePath: '/tmp/散稿.txt',
      detectedEncoding: 'UTF-8',
    });

    expect(preview.chapters).toHaveLength(1);
    expect(preview.chapters[0].title).toBe('散稿');
    expect(preview.chapters[0].suspiciousHeadingMarkers).toContain('no_chapter_heading');
    expect(preview.chapters[0].paragraphCount).toBe(2);
  });

  test('reads a UTF-8 file and derives the project name from the selected TXT file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-txt-'));
    const filePath = path.join(root, '窗下旧约.txt');
    await writeFile(filePath, '第一章 窗下\n门外传来叩响。', 'utf8');

    const preview = await previewTxtImport(filePath);

    expect(preview.sourceFilePath).toBe(filePath);
    expect(preview.fileName).toBe('窗下旧约.txt');
    expect(preview.suggestedProjectName).toBe('窗下旧约');
    expect(preview.detectedEncoding).toBeTruthy();
    expect(preview.chapters[0].title).toBe('第一章 窗下');
  });

  test('commits preview chapters, paragraphs, versions, original file copy, and index job', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-txt-commit-'));
    const sourcePath = path.join(root, '长夜.txt');
    await writeFile(sourcePath, '第一章 雨夜\n第一段。\n第二段。\n\n第二章 天明\n第三段。', 'utf8');
    const project = await createProject({ baseDirectory: root, projectName: '长夜' });
    const preview = await previewTxtImport(sourcePath);

    const db = new Database(project.dbPath);
    try {
      const result = await commitTxtImport({
        projectPath: project.projectPath,
        db,
        queue: createJobQueue(db),
        preview,
      });

      const chapters = db.prepare('SELECT title, chapter_index FROM chapters ORDER BY chapter_index').all() as Array<{
        title: string;
        chapter_index: number;
      }>;
      const paragraphs = db
        .prepare('SELECT id, text, paragraph_index FROM paragraphs ORDER BY chapter_id, paragraph_index')
        .all() as Array<{ id: string; text: string; paragraph_index: number }>;
      const versions = db.prepare('SELECT text, version FROM paragraph_versions ORDER BY created_at').all() as Array<{
        text: string;
        version: number;
      }>;
      const jobs = db.prepare('SELECT type, status FROM jobs ORDER BY created_at').all() as Array<{
        type: string;
        status: string;
      }>;
      const ftsRows = db.prepare('SELECT paragraph_id FROM paragraphs_fts').all() as Array<{
        paragraph_id: string;
      }>;

      expect(result.chapterCount).toBe(2);
      expect(result.paragraphCount).toBe(3);
      expect(result.originalCopyPath).toContain(path.join('originals', '长夜.txt'));
      expect(chapters.map((chapter) => chapter.title)).toEqual(['第一章 雨夜', '第二章 天明']);
      expect(paragraphs.map((paragraph) => paragraph.text)).toEqual(['第一段。', '第二段。', '第三段。']);
      expect(paragraphs[0].id).toMatch(/^para-0001-0001-/);
      expect(versions).toHaveLength(3);
      expect(versions.every((version) => version.version === 1)).toBe(true);
      expect(jobs).toEqual([{ type: 'index_fts', status: 'done' }]);
      expect(ftsRows).toHaveLength(3);
    } finally {
      db.close();
    }
  });
});
