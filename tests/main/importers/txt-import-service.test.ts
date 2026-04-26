import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { createTxtImportService } from '../../../src/main/importers/txt/txt-import-service';

describe('TXT import service', () => {
  test('previews a selected TXT file and commits it into a new project', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-txt-service-'));
    const sourcePath = path.join(root, '雾巷.txt');
    await writeFile(sourcePath, '第一章 雾巷\n她在门前停住。\n\n第二章 回声\n灯火灭了。', 'utf8');
    const service = createTxtImportService();

    const previewResult = await service.previewTxt(sourcePath);
    const commitResult = await service.commitTxt({
      previewId: previewResult.previewId,
      baseDirectory: root,
      projectName: previewResult.preview.suggestedProjectName,
    });

    const db = new Database(commitResult.dbPath);
    try {
      const chapterCount = db.prepare('SELECT COUNT(*) AS count FROM chapters').get() as { count: number };
      const paragraphCount = db.prepare('SELECT COUNT(*) AS count FROM paragraphs').get() as { count: number };

      expect(previewResult.preview.suggestedProjectName).toBe('雾巷');
      expect(commitResult.projectPath).toBe(path.join(root, '雾巷.novelproj'));
      expect(commitResult.chapterCount).toBe(2);
      expect(chapterCount.count).toBe(2);
      expect(paragraphCount.count).toBe(2);
    } finally {
      db.close();
    }
  });

  test('fails clearly when committing an unknown preview', async () => {
    const service = createTxtImportService();

    await expect(
      service.commitTxt({
        previewId: 'missing-preview',
        baseDirectory: '/tmp',
        projectName: '不存在',
      })
    ).rejects.toThrow('TXT import preview is missing');
  });
});
