import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { createTxtImportService } from '../../../src/main/importers/txt/txt-import-service';
import {
  getChapterForEditing,
  listChaptersForProject,
  listRevisions,
  updateParagraphText,
} from '../../../src/main/manuscript/manuscript-service';

describe('test_novel fixture import', () => {
  test('imports the sample Chinese TXT and supports first edit persistence', async () => {
    const sourcePath = path.join(process.cwd(), 'test_novel', 'test.txt');
    const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-test-novel-'));
    const service = createTxtImportService();

    const preview = await service.previewTxt(sourcePath);
    const commit = await service.commitTxt({
      previewId: preview.previewId,
      baseDirectory: root,
      projectName: preview.preview.suggestedProjectName,
    });
    const chapters = listChaptersForProject(commit.dbPath);
    const firstChapter = getChapterForEditing(commit.dbPath, chapters[0].id);
    const firstParagraph = firstChapter.paragraphs[0];
    const editedText = `${firstParagraph.text}【测试编辑】`;
    const saveResult = updateParagraphText(commit.dbPath, {
      paragraphId: firstParagraph.id,
      text: editedText,
      changeReason: 'fixture_smoke',
    });
    const reopenedChapter = getChapterForEditing(commit.dbPath, chapters[0].id);
    const revisions = listRevisions(commit.dbPath, {
      scopeType: 'paragraph',
      scopeId: firstParagraph.id,
    });

    expect(preview.preview.chapters).toHaveLength(5);
    expect(preview.preview.chapters[0]).toMatchObject({
      title: '第1章 陨落的天才',
      paragraphCount: expect.any(Number),
    });
    expect(commit.chapterCount).toBe(5);
    expect(commit.paragraphCount).toBeGreaterThan(80);
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      '第1章 陨落的天才',
      '第2章 斗气大陆',
      '第3章 客人',
      '第4章 云岚宗',
      '第5章 聚气散',
    ]);
    expect(firstParagraph.friendlyLabel).toBe('第 1 段');
    expect(saveResult).toMatchObject({ changed: true, version: 2 });
    expect(reopenedChapter.paragraphs[0]).toMatchObject({
      id: firstParagraph.id,
      text: editedText,
      version: 2,
    });
    expect(revisions).toHaveLength(1);
  });
});
