import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import {
  acceptExpansionRevisionCandidate,
  buildExpansionPromptMessages,
  createExpansionRevisionCandidate,
  parseExpansionStructuredOutput,
  rejectExpansionRevisionCandidate,
} from '../../../src/main/ai/expansion-service';
import { buildContextPackage } from '../../../src/main/context/context-builder';
import { createTxtImportService } from '../../../src/main/importers/txt/txt-import-service';
import { getChapterForEditing, listChaptersForProject, listRevisions } from '../../../src/main/manuscript/manuscript-service';
import { searchParagraphs } from '../../../src/main/search/search-service';

async function importTestNovel() {
  const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-expand-'));
  const service = createTxtImportService();
  const preview = await service.previewTxt(path.join(process.cwd(), 'test_novel', 'test.txt'));
  return service.commitTxt({
    previewId: preview.previewId,
    baseDirectory: root,
    projectName: preview.preview.suggestedProjectName,
  });
}

describe('expansion service', () => {
  test('validates structured expansion output and rejects malformed responses', () => {
    const parsed = parseExpansionStructuredOutput(
      JSON.stringify({
        draft_text: '他在众人的低语声里抬起眼。\n那块魔石碑仍然冷得像铁。',
        covered_beats: [{ beat: '抬头面对嘲笑', covered: true, note: '已描写' }],
        new_facts: [{ fact: '魔石碑触感冰冷', importance: 'low' }],
        risk_flags: [{ type: 'style', description: '语气偏冷' }],
        revision_notes: '插入为两段。',
      })
    );

    expect(parsed.paragraphs).toEqual(['他在众人的低语声里抬起眼。', '那块魔石碑仍然冷得像铁。']);
    expect(parsed.coveredBeats[0]).toEqual({ beat: '抬头面对嘲笑', covered: true, note: '已描写' });
    expect(() => parseExpansionStructuredOutput('{"draft_text":""}')).toThrow('扩写输出结构无效');
  });

  test('builds an expansion prompt with beats, POV, target length, and JSON contract', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const editable = getChapterForEditing(project.dbPath, chapter.id);
    const paragraph = editable.paragraphs[0];
    const context = buildContextPackage(project.dbPath, {
      actionKind: 'expand',
      scopeLabel: `${editable.title} / ${paragraph.friendlyLabel}`,
      anchorParagraphId: paragraph.id,
      currentChapterId: editable.id,
      selectedText: paragraph.text,
      userInstruction: '扩写测试。',
    });

    const messages = buildExpansionPromptMessages(context, {
      previousContext: '广场上正在测试斗之力。',
      nextBeats: '萧炎听见嘲笑，但没有回头。',
      focusDetails: '手掌、石碑、旁人的声音',
      forbiddenChanges: '不能改变测验结果',
      pov: '第三人称贴近萧炎',
      targetLength: '300 字',
      styleStrength: '贴近原文',
    });

    expect(messages[0]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('只返回 JSON'),
    });
    expect(messages[1].content).toContain(context.contextText);
    expect(messages[1].content).toContain('萧炎听见嘲笑');
    expect(messages[1].content).toContain('"draft_text"');
    expect(messages[1].content).toContain('不能改变测验结果');
  });

  test('creates an insertion candidate without changing manuscript text', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const editable = getChapterForEditing(project.dbPath, chapter.id);
    const anchor = editable.paragraphs[0];
    const next = editable.paragraphs[1];

    const candidate = createExpansionRevisionCandidate(project.dbPath, {
      anchorParagraphId: anchor.id,
      sourceTaskId: 'task-expand-1',
      structuredOutput: {
        draftText: '他慢慢松开了手。\n广场上的笑声像潮水一样退开。',
        paragraphs: ['他慢慢松开了手。', '广场上的笑声像潮水一样退开。'],
        coveredBeats: [{ beat: '松开手', covered: true, note: '已写' }],
        newFacts: [],
        riskFlags: [],
        revisionNotes: '两段插入。',
      },
    });
    const reopened = getChapterForEditing(project.dbPath, chapter.id);

    expect(candidate).toMatchObject({
      status: 'candidate',
      anchorParagraphId: anchor.id,
      chapterId: editable.id,
      paragraphs: ['他慢慢松开了手。', '广场上的笑声像潮水一样退开。'],
    });
    expect(reopened.paragraphs[0]).toMatchObject({ id: anchor.id, text: anchor.text });
    expect(reopened.paragraphs[1]).toMatchObject({ id: next.id, text: next.text });
    expect(listRevisions(project.dbPath, { scopeType: 'insertion_after_paragraph', scopeId: anchor.id })).toEqual([]);
  });

  test('accepts an expansion candidate by inserting stable paragraphs after the anchor and updating FTS', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const editable = getChapterForEditing(project.dbPath, chapter.id);
    const anchor = editable.paragraphs[0];
    const oldNext = editable.paragraphs[1];
    const candidate = createExpansionRevisionCandidate(project.dbPath, {
      anchorParagraphId: anchor.id,
      sourceTaskId: 'task-expand-2',
      structuredOutput: {
        draftText: '这是用于扩写接受的唯一插入段。',
        paragraphs: ['这是用于扩写接受的唯一插入段。'],
        coveredBeats: [],
        newFacts: [],
        riskFlags: [],
        revisionNotes: '单段插入。',
      },
    });

    const result = acceptExpansionRevisionCandidate(project.dbPath, { revisionId: candidate.revisionId });
    const reopened = getChapterForEditing(project.dbPath, chapter.id);
    const search = searchParagraphs(project.dbPath, { query: '扩写接受', limit: 5 });
    const inserted = reopened.paragraphs.find((paragraph) => paragraph.id === result.insertedParagraphIds[0]);

    expect(result).toMatchObject({
      revisionId: candidate.revisionId,
      status: 'applied',
      anchorParagraphId: anchor.id,
      chapterId: editable.id,
      insertedCount: 1,
    });
    expect(result.insertedParagraphIds[0]).toMatch(/^para-ins-/);
    expect(reopened.paragraphs[0].id).toBe(anchor.id);
    expect(reopened.paragraphs[1]).toMatchObject({
      id: result.insertedParagraphIds[0],
      friendlyLabel: '第 2 段',
      text: '这是用于扩写接受的唯一插入段。',
      version: 1,
    });
    expect(reopened.paragraphs[2].id).toBe(oldNext.id);
    expect(inserted?.version).toBe(1);
    expect(search.results.map((item) => item.paragraphId)).toContain(result.insertedParagraphIds[0]);

    const db = new Database(project.dbPath);
    try {
      const row = db.prepare('SELECT status FROM revisions WHERE id = ?').get(candidate.revisionId) as
        | Record<string, unknown>
        | undefined;
      expect(row?.status).toBe('applied');
    } finally {
      db.close();
    }
  });

  test('rejects an expansion candidate without inserting paragraphs', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const editable = getChapterForEditing(project.dbPath, chapter.id);
    const anchor = editable.paragraphs[0];
    const candidate = createExpansionRevisionCandidate(project.dbPath, {
      anchorParagraphId: anchor.id,
      sourceTaskId: 'task-expand-3',
      structuredOutput: {
        draftText: '测试拒绝扩写。',
        paragraphs: ['测试拒绝扩写。'],
        coveredBeats: [],
        newFacts: [],
        riskFlags: [],
        revisionNotes: '拒绝测试。',
      },
    });

    const result = rejectExpansionRevisionCandidate(project.dbPath, { revisionId: candidate.revisionId });
    const reopened = getChapterForEditing(project.dbPath, chapter.id);

    expect(result).toEqual({ revisionId: candidate.revisionId, status: 'rejected' });
    expect(reopened.paragraphs).toHaveLength(editable.paragraphs.length);
    expect(reopened.paragraphs[0]).toMatchObject({ id: anchor.id, text: anchor.text });
  });
});
