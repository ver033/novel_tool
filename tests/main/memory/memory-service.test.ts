import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { listMemoryCards, updateMemoryCard } from '../../../src/main/memory/memory-service';
import { createTxtImportService } from '../../../src/main/importers/txt/txt-import-service';
import { getChapterForEditing, listChaptersForProject } from '../../../src/main/manuscript/manuscript-service';

async function importTestNovel() {
  const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-memory-'));
  const service = createTxtImportService();
  const preview = await service.previewTxt(path.join(process.cwd(), 'test_novel', 'test.txt'));
  return service.commitTxt({
    previewId: preview.previewId,
    baseDirectory: root,
    projectName: preview.preview.suggestedProjectName,
  });
}

describe('memory service', () => {
  test('lists source-backed fact cards and lets the author confirm one', async () => {
    const project = await importTestNovel();
    const firstChapter = getChapterForEditing(project.dbPath, listChaptersForProject(project.dbPath)[0].id);
    const paragraph = firstChapter.paragraphs[0];
    const db = new Database(project.dbPath);
    try {
      db.prepare(
        `INSERT INTO facts
         (id, predicate, object_text, fact_type, source_paragraph_id, quote, confidence, status, created_at, updated_at)
         VALUES ('fact-copper-key', '状态', '铜钥匙被丢入泥水', 'prop', ?, ?, 0.82, 'ai_extracted', ?, ?)`
      ).run(paragraph.id, paragraph.text.slice(0, 18), '2026-04-25T00:00:00.000Z', '2026-04-25T00:00:00.000Z');
    } finally {
      db.close();
    }

    const cards = listMemoryCards(project.dbPath);
    expect(cards.cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'fact:fact-copper-key',
          kind: 'fact',
          body: '铜钥匙被丢入泥水',
          sourceParagraphId: paragraph.id,
          sourceLocation: `${firstChapter.title} / ${paragraph.friendlyLabel}`,
          status: 'ai_extracted',
        }),
      ])
    );

    const updated = updateMemoryCard(project.dbPath, {
      cardId: 'fact:fact-copper-key',
      changes: {
        status: 'user_confirmed',
        objectText: '铜钥匙被丢入泥水，暂未解释如何取回',
      },
    });

    expect(updated).toMatchObject({
      id: 'fact:fact-copper-key',
      status: 'user_confirmed',
      body: '铜钥匙被丢入泥水，暂未解释如何取回',
    });
  });

  test('updates non-fact memory card status without guessing table names', async () => {
    const project = await importTestNovel();
    const db = new Database(project.dbPath);
    try {
      db.prepare(
        `INSERT INTO entities (id, type, canonical_name, description, status, confidence, created_at, updated_at)
         VALUES ('entity-linzhao', 'character', '林照', '遇事先试探，不先摊牌', 'ai_extracted', 0.76, ?, ?)`
      ).run('2026-04-25T00:00:00.000Z', '2026-04-25T00:00:00.000Z');
    } finally {
      db.close();
    }

    const updated = updateMemoryCard(project.dbPath, {
      cardId: 'entity:entity-linzhao',
      changes: { status: 'user_confirmed' },
    });

    expect(updated).toMatchObject({
      id: 'entity:entity-linzhao',
      title: '林照',
      status: 'user_confirmed',
    });
  });
});
