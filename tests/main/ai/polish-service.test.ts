import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import {
  acceptPolishRevisionCandidate,
  buildPolishPromptMessages,
  createPolishRevisionCandidate,
  parsePolishStructuredOutput,
  rejectPolishRevisionCandidate,
} from '../../../src/main/ai/polish-service';
import { buildContextPackage } from '../../../src/main/context/context-builder';
import { createTxtImportService } from '../../../src/main/importers/txt/txt-import-service';
import { getChapterForEditing, listChaptersForProject, listRevisions } from '../../../src/main/manuscript/manuscript-service';
import { searchParagraphs } from '../../../src/main/search/search-service';

async function importTestNovel() {
  const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-polish-'));
  const service = createTxtImportService();
  const preview = await service.previewTxt(path.join(process.cwd(), 'test_novel', 'test.txt'));
  return service.commitTxt({
    previewId: preview.previewId,
    baseDirectory: root,
    projectName: preview.preview.suggestedProjectName,
  });
}

describe('polish service', () => {
  test('validates structured polish output and rejects malformed responses', () => {
    const parsed = parsePolishStructuredOutput(
      JSON.stringify({
        revised_text: '雨声贴着窗棂往下淌。',
        edit_summary: '压低了语气。',
        changed_facts: [],
        risk_flags: [{ type: 'style', description: '语气更冷' }],
      })
    );

    expect(parsed.revisedText).toBe('雨声贴着窗棂往下淌。');
    expect(parsed.riskFlags[0]).toEqual({ type: 'style', description: '语气更冷' });
    expect(() => parsePolishStructuredOutput('{"revised_text":""}')).toThrow('润色输出结构无效');
  });

  test('builds a bounded polish prompt with context and JSON contract', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const editable = getChapterForEditing(project.dbPath, chapter.id);
    const paragraph = editable.paragraphs[0];
    const context = buildContextPackage(project.dbPath, {
      actionKind: 'polish',
      scopeLabel: `${editable.title} / ${paragraph.friendlyLabel}`,
      anchorParagraphId: paragraph.id,
      currentChapterId: editable.id,
      selectedText: paragraph.text,
      userInstruction: '更克制，不改事实。',
    });

    const messages = buildPolishPromptMessages(context, {
      strength: 'light',
      focus: '减少夸张修饰',
      forbiddenChanges: '不能新增人物和设定',
    });

    expect(messages[0]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('只返回 JSON'),
    });
    expect(messages[1].content).toContain(context.contextText);
    expect(messages[1].content).toContain('"revised_text"');
    expect(messages[1].content).toContain('不能新增人物和设定');
  });

  test('creates a candidate revision without changing manuscript text', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const editable = getChapterForEditing(project.dbPath, chapter.id);
    const paragraph = editable.paragraphs[0];
    const revisedText = `${paragraph.text} 她把这句话又看了一遍。`;

    const candidate = createPolishRevisionCandidate(project.dbPath, {
      paragraphId: paragraph.id,
      sourceTaskId: 'task-polish-1',
      structuredOutput: {
        revisedText,
        editSummary: '补了一句克制动作。',
        changedFacts: [],
        riskFlags: [],
      },
    });
    const reopened = getChapterForEditing(project.dbPath, chapter.id).paragraphs[0];

    expect(candidate).toMatchObject({
      status: 'candidate',
      paragraphId: paragraph.id,
      beforeText: paragraph.text,
      afterText: revisedText,
    });
    expect(candidate.diffJson.length).toBeGreaterThan(0);
    expect(reopened.text).toBe(paragraph.text);
    expect(reopened.version).toBe(paragraph.version);
    expect(listRevisions(project.dbPath, { scopeType: 'paragraph', scopeId: paragraph.id })).toEqual([]);
  });

  test('accepts a candidate as a new paragraph version and updates search index', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const editable = getChapterForEditing(project.dbPath, chapter.id);
    const paragraph = editable.paragraphs[1];
    const revisedText = '这是一次用于润色接受的唯一短句。';
    const candidate = createPolishRevisionCandidate(project.dbPath, {
      paragraphId: paragraph.id,
      sourceTaskId: 'task-polish-2',
      structuredOutput: {
        revisedText,
        editSummary: '测试接受候选。',
        changedFacts: [],
        riskFlags: [],
      },
    });

    const result = acceptPolishRevisionCandidate(project.dbPath, { revisionId: candidate.revisionId });
    const reopened = getChapterForEditing(project.dbPath, chapter.id).paragraphs.find((item) => item.id === paragraph.id);
    const search = searchParagraphs(project.dbPath, { query: '润色接受', limit: 5 });

    expect(result).toMatchObject({
      paragraphId: paragraph.id,
      version: paragraph.version + 1,
      changed: true,
    });
    expect(reopened).toMatchObject({ text: revisedText, version: paragraph.version + 1 });
    expect(search.results.map((item) => item.paragraphId)).toContain(paragraph.id);

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

  test('rejects a candidate without changing manuscript text', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const editable = getChapterForEditing(project.dbPath, chapter.id);
    const paragraph = editable.paragraphs[2];
    const candidate = createPolishRevisionCandidate(project.dbPath, {
      paragraphId: paragraph.id,
      sourceTaskId: 'task-polish-3',
      structuredOutput: {
        revisedText: `${paragraph.text} 测试拒绝。`,
        editSummary: '测试拒绝候选。',
        changedFacts: [],
        riskFlags: [],
      },
    });

    const result = rejectPolishRevisionCandidate(project.dbPath, { revisionId: candidate.revisionId });
    const reopened = getChapterForEditing(project.dbPath, chapter.id).paragraphs.find((item) => item.id === paragraph.id);

    expect(result).toEqual({ revisionId: candidate.revisionId, status: 'rejected' });
    expect(reopened).toMatchObject({ text: paragraph.text, version: paragraph.version });
  });
});
