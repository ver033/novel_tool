import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { createTxtImportService } from '../../../src/main/importers/txt/txt-import-service';
import { updateParagraphText } from '../../../src/main/manuscript/manuscript-service';
import {
  getParagraphReferences,
  resolveSearchMentionReferences,
  searchParagraphs,
  updateReferenceBasketIds,
} from '../../../src/main/search/search-service';

async function importTestNovel() {
  const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-search-'));
  const service = createTxtImportService();
  const preview = await service.previewTxt(path.join(process.cwd(), 'test_novel', 'test.txt'));
  return service.commitTxt({
    previewId: preview.previewId,
    baseDirectory: root,
    projectName: preview.preview.suggestedProjectName,
  });
}

describe('search service', () => {
  test('searches imported Chinese paragraphs with friendly locations and original snippets', async () => {
    const project = await importTestNovel();

    const result = searchParagraphs(project.dbPath, { query: '斗之力', limit: 5 });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]).toMatchObject({
      chapterTitle: '第1章 陨落的天才',
      friendlyLocation: expect.stringContaining('第 1 段'),
    });
    expect(result.results[0].snippet).toContain('斗之力');
    expect(result.results[0].text).toContain('斗之力');
  });

  test('updates the index after a paragraph edit', async () => {
    const project = await importTestNovel();
    const first = searchParagraphs(project.dbPath, { query: '斗之力', limit: 1 }).results[0];

    updateParagraphText(project.dbPath, {
      paragraphId: first.paragraphId,
      text: '这是一次用于搜索索引的测试编辑。',
      changeReason: 'search_fixture',
    });
    const edited = searchParagraphs(project.dbPath, { query: '搜索索引', limit: 5 });

    expect(edited.results).toHaveLength(1);
    expect(edited.results[0]).toMatchObject({
      paragraphId: first.paragraphId,
      text: '这是一次用于搜索索引的测试编辑。',
    });
  });

  test('does not return unrelated paragraphs only because the chapter title matches a Chinese query', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-search-title-'));
    const manuscriptPath = path.join(root, 'title-match.txt');
    await writeFile(
      manuscriptPath,
      ['第1章 最后的愿望', '', '★ ★ ★', '', '这便是我最后的愿望了。', '', '第2章 普通章节', '', '愿望在这里再次出现。'].join('\n')
    );
    const service = createTxtImportService();
    const preview = await service.previewTxt(manuscriptPath);
    const project = await service.commitTxt({
      previewId: preview.previewId,
      baseDirectory: root,
      projectName: 'title-match-project',
    });

    const result = searchParagraphs(project.dbPath, { query: '愿望', limit: 10 });

    expect(result.results.map((item) => item.text)).toEqual(['这便是我最后的愿望了。', '愿望在这里再次出现。']);
  });

  test('returns selected paragraphs as context references in the requested order', async () => {
    const project = await importTestNovel();
    const results = searchParagraphs(project.dbPath, { query: '萧炎', limit: 2 }).results;

    const references = getParagraphReferences(project.dbPath, results.map((result) => result.paragraphId));

    expect(references.references.map((reference) => reference.paragraphId)).toEqual(
      results.map((result) => result.paragraphId)
    );
    expect(references.references[0]).toMatchObject({
      chapterTitle: expect.any(String),
      friendlyLocation: expect.stringContaining('第 '),
      text: expect.stringContaining('萧炎'),
    });
  });

  test('keeps a persistent reference basket with deduplicated order', () => {
    expect(updateReferenceBasketIds(['para-1'], ['para-2', 'para-1'], 'add')).toEqual(['para-1', 'para-2']);
    expect(updateReferenceBasketIds(['para-1', 'para-2'], ['para-2'], 'replace')).toEqual(['para-2']);
    expect(updateReferenceBasketIds(['para-1'], [], 'clear')).toEqual([]);
  });

  test('resolves @search mentions into context references', async () => {
    const project = await importTestNovel();

    const references = resolveSearchMentionReferences(project.dbPath, { mention: '@search:萧炎', limit: 2 });

    expect(references.references.length).toBeGreaterThan(0);
    expect(references.references[0]).toMatchObject({
      friendlyLocation: expect.stringContaining('第 '),
      text: expect.stringContaining('萧炎'),
    });
  });
});
