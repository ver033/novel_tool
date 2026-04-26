import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { runFactContinuityCheck } from '../../../src/main/continuity/continuity-service';
import { createTxtImportService } from '../../../src/main/importers/txt/txt-import-service';
import { getChapterForEditing, listChaptersForProject } from '../../../src/main/manuscript/manuscript-service';
import { listIssues } from '../../../src/main/proofread/proofread-service';

async function importTestNovel() {
  const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-continuity-'));
  const service = createTxtImportService();
  const preview = await service.previewTxt(path.join(process.cwd(), 'test_novel', 'test.txt'));
  return service.commitTxt({
    previewId: preview.previewId,
    baseDirectory: root,
    projectName: preview.preview.suggestedProjectName,
  });
}

describe('continuity service', () => {
  test('creates evidence-backed issue cards for conflicting facts about the same object state', async () => {
    const project = await importTestNovel();
    const chapter = getChapterForEditing(project.dbPath, listChaptersForProject(project.dbPath)[0].id);
    const [firstParagraph, secondParagraph] = chapter.paragraphs;
    const db = new Database(project.dbPath);
    try {
      db.prepare(
        `INSERT INTO entities (id, type, canonical_name, description, status, confidence, created_at, updated_at)
         VALUES ('entity-copper-key', 'prop', '铜钥匙', '旧港线索道具', 'user_confirmed', 1, ?, ?)`
      ).run('2026-04-25T00:00:00.000Z', '2026-04-25T00:00:00.000Z');
      db.prepare(
        `INSERT INTO facts
         (id, subject_entity_id, predicate, object_text, fact_type, source_paragraph_id, quote, confidence, status, created_at, updated_at)
         VALUES (?, 'entity-copper-key', '状态', ?, 'prop', ?, ?, 0.91, ?, ?, ?)`
      ).run(
        'fact-key-lost',
        '被陈砚丢入泥水',
        firstParagraph.id,
        firstParagraph.text.slice(0, 24),
        'user_confirmed',
        '2026-04-25T00:00:00.000Z',
        '2026-04-25T00:00:00.000Z'
      );
      db.prepare(
        `INSERT INTO facts
         (id, subject_entity_id, predicate, object_text, fact_type, source_paragraph_id, quote, confidence, status, created_at, updated_at)
         VALUES (?, 'entity-copper-key', '状态', ?, 'prop', ?, ?, 0.72, ?, ?, ?)`
      ).run(
        'fact-key-held',
        '回到林照掌心',
        secondParagraph.id,
        secondParagraph.text.slice(0, 24),
        'ai_extracted',
        '2026-04-25T00:01:00.000Z',
        '2026-04-25T00:01:00.000Z'
      );
    } finally {
      db.close();
    }

    const result = runFactContinuityCheck(project.dbPath, { sourceTaskId: 'task-continuity-1' });
    const listed = listIssues(project.dbPath, { status: 'open' });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      type: 'prop_state_conflict',
      severity: 'high',
      title: expect.stringContaining('铜钥匙'),
      currentParagraphId: secondParagraph.id,
      sourceTaskId: 'task-continuity-1',
    });
    expect(result.issues[0].evidence).toHaveLength(2);
    expect(result.issues[0].evidence.map((item) => item.paragraphId)).toEqual([firstParagraph.id, secondParagraph.id]);
    expect(listed[0].id).toBe(result.issues[0].id);
  });

  test('uses scoped paragraph IDs as the current check target while retrieving prior project facts', async () => {
    const project = await importTestNovel();
    const chapter = getChapterForEditing(project.dbPath, listChaptersForProject(project.dbPath)[0].id);
    const [firstParagraph, secondParagraph] = chapter.paragraphs;
    const db = new Database(project.dbPath);
    try {
      db.prepare(
        `INSERT INTO entities (id, type, canonical_name, description, status, confidence, created_at, updated_at)
         VALUES ('entity-copper-key', 'prop', '铜钥匙', '旧港线索道具', 'user_confirmed', 1, ?, ?)`
      ).run('2026-04-25T00:00:00.000Z', '2026-04-25T00:00:00.000Z');
      db.prepare(
        `INSERT INTO facts
         (id, subject_entity_id, predicate, object_text, fact_type, source_paragraph_id, quote, confidence, status, created_at, updated_at)
         VALUES (?, 'entity-copper-key', '状态', ?, 'prop', ?, ?, 0.91, ?, ?, ?)`
      ).run(
        'fact-key-lost',
        '被陈砚丢入泥水',
        firstParagraph.id,
        firstParagraph.text.slice(0, 24),
        'user_confirmed',
        '2026-04-25T00:00:00.000Z',
        '2026-04-25T00:00:00.000Z'
      );
      db.prepare(
        `INSERT INTO facts
         (id, subject_entity_id, predicate, object_text, fact_type, source_paragraph_id, quote, confidence, status, created_at, updated_at)
         VALUES (?, 'entity-copper-key', '状态', ?, 'prop', ?, ?, 0.72, ?, ?, ?)`
      ).run(
        'fact-key-held',
        '回到林照掌心',
        secondParagraph.id,
        secondParagraph.text.slice(0, 24),
        'ai_extracted',
        '2026-04-25T00:01:00.000Z',
        '2026-04-25T00:01:00.000Z'
      );
    } finally {
      db.close();
    }

    const result = runFactContinuityCheck(project.dbPath, {
      paragraphIds: [secondParagraph.id],
      sourceTaskId: 'task-continuity-scoped',
    });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      currentParagraphId: secondParagraph.id,
      sourceTaskId: 'task-continuity-scoped',
    });
    expect(result.issues[0].evidence.map((item) => item.paragraphId)).toEqual([firstParagraph.id, secondParagraph.id]);
  });
});
