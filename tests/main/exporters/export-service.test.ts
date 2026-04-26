import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { previewExport, runExport } from '../../../src/main/exporters/export-service';
import { createTxtImportService } from '../../../src/main/importers/txt/txt-import-service';
import { createProject } from '../../../src/main/projects/project-service';

async function importTestNovel() {
  const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-export-'));
  const service = createTxtImportService();
  const preview = await service.previewTxt(path.join(process.cwd(), 'test_novel', 'test.txt'));
  return service.commitTxt({
    previewId: preview.previewId,
    baseDirectory: root,
    projectName: preview.preview.suggestedProjectName,
  });
}

describe('export service', () => {
  test('previews and writes a TXT export without mutating manuscript data', async () => {
    const project = await importTestNovel();
    const preview = previewExport(project.dbPath, project.projectPath, { format: 'txt' });
    const outputPath = path.join(project.projectPath, 'exports', 'fixture-export.txt');

    const result = await runExport(project.dbPath, project.projectPath, {
      format: 'txt',
      outputPath,
    });
    const exported = await readFile(outputPath, 'utf8');
    const afterPreview = previewExport(project.dbPath, project.projectPath, { format: 'txt' });

    expect(preview).toMatchObject({
      format: 'txt',
      chapterCount: 5,
      unresolvedHighRiskIssueCount: 0,
    });
    expect(preview.characterCount).toBeGreaterThan(1000);
    expect(result).toMatchObject({
      format: 'txt',
      outputPath,
      chapterCount: 5,
    });
    expect(result.bytesWritten).toBe(Buffer.byteLength(exported));
    expect(exported).toContain('第1章 陨落的天才');
    expect(exported).toContain('第5章 聚气散');
    expect(afterPreview.characterCount).toBe(preview.characterCount);
  });

  test('skips legacy empty EPUB spine placeholders in export output', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-export-legacy-'));
    const project = await createProject({ baseDirectory: root, projectName: '旧版 EPUB' });
    const db = new Database(project.dbPath);
    try {
      const now = '2026-04-24T00:00:00.000Z';
      db.prepare(
        `INSERT INTO books (id, project_id, title, language, created_at, updated_at)
         VALUES ('book-1', 'default-project', '旧版 EPUB', 'zh-CN', ?, ?)`
      ).run(now, now);
      db.prepare(
        `INSERT INTO chapters
         (id, book_id, title, chapter_index, source_type, source_href, word_count, created_at, updated_at)
         VALUES ('legacy-empty', 'book-1', '第 1 章', 0, 'epub', 'toc.xhtml', 0, ?, ?)`
      ).run(now, now);
      db.prepare(
        `INSERT INTO chapters
         (id, book_id, title, chapter_index, source_type, source_href, word_count, created_at, updated_at)
         VALUES ('real-chapter', 'book-1', '序章', 1, 'epub', 'chapter.xhtml', 6, ?, ?)`
      ).run(now, now);
      db.prepare(
        `INSERT INTO paragraphs
         (id, chapter_id, paragraph_index, text, text_hash, version, created_at, updated_at)
         VALUES ('real-para', 'real-chapter', 0, '真正的正文。', 'hash-real', 1, ?, ?)`
      ).run(now, now);
    } finally {
      db.close();
    }

    const preview = previewExport(project.dbPath, project.projectPath, { format: 'txt' });
    const outputPath = path.join(project.projectPath, 'exports', 'legacy-export.txt');
    const result = await runExport(project.dbPath, project.projectPath, { format: 'txt', outputPath });
    const exported = await readFile(outputPath, 'utf8');

    expect(preview.chapterCount).toBe(1);
    expect(result.chapterCount).toBe(1);
    expect(exported).toContain('序章');
    expect(exported).toContain('真正的正文。');
    expect(exported).not.toContain('第 1 章');
  });
});
