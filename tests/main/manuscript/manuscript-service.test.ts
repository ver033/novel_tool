import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import {
  getChapterForEditing,
  listChaptersForProject,
  listRevisions,
  restoreRevision,
  updateParagraphText,
} from '../../../src/main/manuscript/manuscript-service';
import { createProject } from '../../../src/main/projects/project-service';

function insertFixture(dbPath: string): void {
  const db = new Database(dbPath);
  try {
    const now = '2026-04-24T00:00:00.000Z';
    db.prepare(
      `INSERT INTO books (id, project_id, title, language, created_at, updated_at)
       VALUES ('book-1', 'default-project', '长夜', 'zh-CN', ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO chapters
       (id, book_id, title, chapter_index, source_type, source_href, word_count, created_at, updated_at)
       VALUES ('chap-1', 'book-1', '第一章 雨巷', 0, 'txt', '长夜.txt', 12, ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO chapters
       (id, book_id, title, chapter_index, source_type, source_href, word_count, created_at, updated_at)
       VALUES ('chap-2', 'book-1', '第二章 旧约', 1, 'txt', '长夜.txt', 6, ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO paragraphs
       (id, chapter_id, paragraph_index, text, text_hash, version, created_at, updated_at)
       VALUES ('para-1', 'chap-1', 0, '雨声贴着窗棂往下淌。', 'hash-1', 1, ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO paragraphs
       (id, chapter_id, paragraph_index, text, text_hash, version, created_at, updated_at)
       VALUES ('para-2', 'chap-1', 1, '沈照把灯芯拨低。', 'hash-2', 1, ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO paragraph_versions (id, paragraph_id, version, text, change_reason, created_by, created_at)
       VALUES ('pver-para-1-0001', 'para-1', 1, '雨声贴着窗棂往下淌。', 'initial_import', 'importer', ?)`
    ).run(now);
    db.prepare(
      `INSERT INTO paragraph_versions (id, paragraph_id, version, text, change_reason, created_by, created_at)
       VALUES ('pver-para-2-0001', 'para-2', 1, '沈照把灯芯拨低。', 'initial_import', 'importer', ?)`
    ).run(now);
  } finally {
    db.close();
  }
}

async function createFixtureProject() {
  const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-manuscript-'));
  const project = await createProject({ baseDirectory: root, projectName: '长夜' });
  insertFixture(project.dbPath);
  return project;
}

describe('manuscript service', () => {
  test('lists chapters and returns editor-friendly paragraph locations', async () => {
    const project = await createFixtureProject();

    const chapters = listChaptersForProject(project.dbPath);
    const chapter = getChapterForEditing(project.dbPath, 'chap-1');

    expect(chapters).toEqual([
      { id: 'chap-1', title: '第一章 雨巷', index: 0, wordCount: 12, paragraphCount: 2 },
      { id: 'chap-2', title: '第二章 旧约', index: 1, wordCount: 6, paragraphCount: 0 },
    ]);
    expect(chapter).toEqual({
      id: 'chap-1',
      title: '第一章 雨巷',
      index: 0,
      paragraphs: [
        {
          id: 'para-1',
          index: 0,
          friendlyLabel: '第 1 段',
          text: '雨声贴着窗棂往下淌。',
          version: 1,
        },
        {
          id: 'para-2',
          index: 1,
          friendlyLabel: '第 2 段',
          text: '沈照把灯芯拨低。',
          version: 1,
        },
      ],
    });
  });

  test('hides legacy empty EPUB spine placeholders while keeping real empty chapters', async () => {
    const project = await createFixtureProject();
    const db = new Database(project.dbPath);
    try {
      const now = '2026-04-24T00:00:00.000Z';
      db.prepare(
        `INSERT INTO chapters
         (id, book_id, title, chapter_index, source_type, source_href, word_count, created_at, updated_at)
         VALUES ('chap-legacy-empty', 'book-1', '第 1 章', -1, 'epub', 'nav.xhtml', 0, ?, ?)`
      ).run(now, now);
      db.prepare(
        `INSERT INTO chapters
         (id, book_id, title, chapter_index, source_type, source_href, word_count, created_at, updated_at)
         VALUES ('chap-epub-real', 'book-1', '序章', 2, 'epub', 'chapter.xhtml', 5, ?, ?)`
      ).run(now, now);
      db.prepare(
        `INSERT INTO paragraphs
         (id, chapter_id, paragraph_index, text, text_hash, version, created_at, updated_at)
         VALUES ('para-epub-real', 'chap-epub-real', 0, '真正的正文。', 'hash-epub-real', 1, ?, ?)`
      ).run(now, now);
    } finally {
      db.close();
    }

    const chapters = listChaptersForProject(project.dbPath);

    expect(chapters.map((chapter) => chapter.id)).toEqual(['chap-1', 'chap-2', 'chap-epub-real']);
  });

  test('updates a paragraph with version and revision records without duplicating unchanged text', async () => {
    const project = await createFixtureProject();

    const changed = updateParagraphText(project.dbPath, {
      paragraphId: 'para-1',
      text: '雨声贴着窗棂往下淌，像一层银箔。',
      changeReason: 'manual_edit',
    });
    const unchanged = updateParagraphText(project.dbPath, {
      paragraphId: 'para-1',
      text: '雨声贴着窗棂往下淌，像一层银箔。',
      changeReason: 'autosave',
    });
    const chapter = getChapterForEditing(project.dbPath, 'chap-1');
    const revisions = listRevisions(project.dbPath, { scopeType: 'paragraph', scopeId: 'para-1' });

    expect(changed).toMatchObject({ paragraphId: 'para-1', version: 2, changed: true });
    expect(unchanged).toMatchObject({ paragraphId: 'para-1', version: 2, changed: false });
    expect(chapter.paragraphs[0]).toMatchObject({
      text: '雨声贴着窗棂往下淌，像一层银箔。',
      version: 2,
    });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      scopeType: 'paragraph',
      scopeId: 'para-1',
      beforeText: '雨声贴着窗棂往下淌。',
      afterText: '雨声贴着窗棂往下淌，像一层银箔。',
      status: 'applied',
    });
  });

  test('restores a revision as a new paragraph version and keeps the restore reversible', async () => {
    const project = await createFixtureProject();

    updateParagraphText(project.dbPath, {
      paragraphId: 'para-1',
      text: '雨声贴着窗棂往下淌，像一层银箔。',
      changeReason: 'manual_edit',
    });
    const [revision] = listRevisions(project.dbPath, { scopeType: 'paragraph', scopeId: 'para-1' });

    const restored = restoreRevision(project.dbPath, { revisionId: revision.id });
    const chapter = getChapterForEditing(project.dbPath, 'chap-1');
    const revisions = listRevisions(project.dbPath, { scopeType: 'paragraph', scopeId: 'para-1' });

    expect(restored).toMatchObject({ paragraphId: 'para-1', version: 3, changed: true });
    expect(chapter.paragraphs[0]).toMatchObject({
      text: '雨声贴着窗棂往下淌。',
      version: 3,
    });
    expect(revisions).toHaveLength(2);
    expect(revisions[0]).toMatchObject({
      beforeText: '雨声贴着窗棂往下淌，像一层银箔。',
      afterText: '雨声贴着窗棂往下淌。',
      status: 'applied',
    });
  });
});
