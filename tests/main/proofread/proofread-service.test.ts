import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { createTxtImportService } from '../../../src/main/importers/txt/txt-import-service';
import { getChapterForEditing, listChaptersForProject, updateParagraphText } from '../../../src/main/manuscript/manuscript-service';
import {
  listIssues,
  proofreadParagraphText,
  runRuleBasedProofread,
  updateIssueStatus,
} from '../../../src/main/proofread/proofread-service';

async function importTestNovel() {
  const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-proofread-'));
  const service = createTxtImportService();
  const preview = await service.previewTxt(path.join(process.cwd(), 'test_novel', 'test.txt'));
  return service.commitTxt({
    previewId: preview.previewId,
    baseDirectory: root,
    projectName: preview.preview.suggestedProjectName,
  });
}

describe('proofread service', () => {
  test('detects local Chinese proofreading issues with evidence quotes', () => {
    const issues = proofreadParagraphText({
      paragraphId: 'para-1',
      friendlyLocation: '第一章 / 第 1 段',
      text: '他说：“钥匙还在门口。！！他他转身,离开。',
    });

    expect(issues.map((issue) => issue.type)).toEqual(
      expect.arrayContaining([
        'proofread_quote_mismatch',
        'proofread_repeated_punctuation',
        'proofread_repeated_word',
        'proofread_mixed_width_punctuation',
      ])
    );
    expect(issues.every((issue) => issue.evidence[0]?.paragraphId === 'para-1')).toBe(true);
    expect(issues.every((issue) => issue.evidence[0]?.quote.length > 0)).toBe(true);
  });

  test('stores issue cards, evidence, and deduplicates repeated runs', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const editable = getChapterForEditing(project.dbPath, chapter.id);
    const paragraph = editable.paragraphs[0];
    updateParagraphText(project.dbPath, {
      paragraphId: paragraph.id,
      text: '他说：“钥匙还在门口。！！他他转身,离开。',
      changeReason: 'proofread_fixture',
    });

    const first = runRuleBasedProofread(project.dbPath, {
      paragraphIds: [paragraph.id],
      sourceTaskId: 'task-proofread-1',
    });
    const second = runRuleBasedProofread(project.dbPath, {
      paragraphIds: [paragraph.id],
      sourceTaskId: 'task-proofread-2',
    });
    const listed = listIssues(project.dbPath, { currentParagraphId: paragraph.id, status: 'open' });

    expect(first.issues.length).toBeGreaterThanOrEqual(4);
    expect(second.issues.map((issue) => issue.id).sort()).toEqual(first.issues.map((issue) => issue.id).sort());
    expect(listed.map((issue) => issue.id).sort()).toEqual(first.issues.map((issue) => issue.id).sort());
    expect(listed[0]).toMatchObject({
      status: 'open',
      currentParagraphId: paragraph.id,
    });
    expect(listed[0].evidence[0]).toMatchObject({
      paragraphId: paragraph.id,
      role: 'current',
    });

    const db = new Database(project.dbPath);
    try {
      const evidenceCount = db.prepare('SELECT COUNT(*) AS count FROM issue_evidence').get() as Record<string, unknown>;
      expect(Number(evidenceCount.count)).toBe(first.issues.length);
    } finally {
      db.close();
    }
  });

  test('updates issue status without changing manuscript text', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const editable = getChapterForEditing(project.dbPath, chapter.id);
    const paragraph = editable.paragraphs[0];
    updateParagraphText(project.dbPath, {
      paragraphId: paragraph.id,
      text: '他说：“钥匙还在门口。！！',
      changeReason: 'proofread_fixture',
    });
    const result = runRuleBasedProofread(project.dbPath, {
      paragraphIds: [paragraph.id],
      sourceTaskId: 'task-proofread-3',
    });

    const updated = updateIssueStatus(project.dbPath, {
      issueId: result.issues[0].id,
      status: 'false_positive',
    });
    const reopened = getChapterForEditing(project.dbPath, chapter.id);

    expect(updated.status).toBe('false_positive');
    expect(reopened.paragraphs.find((item) => item.id === paragraph.id)?.text).toBe('他说：“钥匙还在门口。！！');
  });
});
