import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import {
  buildContextPackage,
  createAiTaskWithContext,
} from '../../../src/main/context/context-builder';
import { createTxtImportService } from '../../../src/main/importers/txt/txt-import-service';
import { getChapterForEditing, listChaptersForProject } from '../../../src/main/manuscript/manuscript-service';

async function importTestNovel() {
  const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-context-'));
  const service = createTxtImportService();
  const preview = await service.previewTxt(path.join(process.cwd(), 'test_novel', 'test.txt'));
  return service.commitTxt({
    previewId: preview.previewId,
    baseDirectory: root,
    projectName: preview.preview.suggestedProjectName,
  });
}

describe('context builder', () => {
  test('builds a source-backed package for a selected-text task without loading the full book', async () => {
    const project = await importTestNovel();
    const [firstChapter, secondChapter] = listChaptersForProject(project.dbPath);
    const editable = getChapterForEditing(project.dbPath, firstChapter.id);
    const paragraph = editable.paragraphs[3];
    const reference = editable.paragraphs[0];

    const context = buildContextPackage(project.dbPath, {
      actionKind: 'polish',
      scopeLabel: `${editable.title} / ${paragraph.friendlyLabel}`,
      selectedText: paragraph.text.slice(0, 32),
      anchorParagraphId: paragraph.id,
      currentChapterId: editable.id,
      referenceParagraphIds: [reference.id],
      userInstruction: '让这段更克制，保留事实。',
      maxCharacters: 2800,
    });

    expect(context.action).toMatchObject({
      kind: 'polish',
      scopeLabel: `${editable.title} / ${paragraph.friendlyLabel}`,
    });
    expect(context.selectedText).toBe(paragraph.text.slice(0, 32));
    expect(context.contextText).toContain('[selected_text]');
    expect(context.contextText).toContain('[current_paragraph]');
    expect(context.contextText).toContain('[reference]');
    expect(context.sourceList).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'current_paragraph',
          paragraphId: paragraph.id,
          friendlyLocation: `${editable.title} / ${paragraph.friendlyLabel}`,
        }),
        expect.objectContaining({
          kind: 'reference',
          paragraphId: reference.id,
        }),
      ])
    );
    expect(context.sourceList.some((source) => source.chapterId === secondChapter.id)).toBe(false);
    expect(context.contextText).not.toContain('月如银盘');
    expect(context.omittedContextReasons).toContainEqual(
      expect.objectContaining({
        code: 'full_book_not_loaded',
      })
    );
    expect(context.tokenEstimate).toBeGreaterThan(0);
    expect(context.preflightSummary).toContain('polish');
    expect(context.preflightSummary).toContain(String(context.sourceList.length));
  });

  test('resolves @search mentions and reports missing memory/style/issue context as omitted', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const editable = getChapterForEditing(project.dbPath, chapter.id);
    const paragraph = editable.paragraphs[0];

    const context = buildContextPackage(project.dbPath, {
      actionKind: 'continuity',
      scopeLabel: `${editable.title} / ${paragraph.friendlyLabel}`,
      anchorParagraphId: paragraph.id,
      currentChapterId: editable.id,
      searchMentions: ['@search:斗之力'],
      userInstruction: '检查这段和前文是否矛盾。',
      maxCharacters: 2400,
    });

    expect(context.sourceList).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'search_result',
          textPreview: expect.stringContaining('斗之力'),
        }),
      ])
    );
    expect(context.contextText).toContain('@search:斗之力');
    expect(context.omittedContextReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'facts_not_available' }),
        expect.objectContaining({ code: 'style_guide_not_available' }),
        expect.objectContaining({ code: 'issues_not_available' }),
      ])
    );
  });

  test('stores context metadata on ai_tasks without storing raw manuscript context', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const editable = getChapterForEditing(project.dbPath, chapter.id);
    const paragraph = editable.paragraphs[1];
    const context = buildContextPackage(project.dbPath, {
      actionKind: 'expand',
      scopeLabel: `${editable.title} / ${paragraph.friendlyLabel}`,
      anchorParagraphId: paragraph.id,
      currentChapterId: editable.id,
      selectedText: paragraph.text.slice(0, 20),
      userInstruction: '接下来写一个短场景。',
      maxCharacters: 1800,
    });

    const task = createAiTaskWithContext(project.dbPath, {
      taskType: 'expand',
      context,
      providerId: 'deepseek',
      modelName: 'deepseek-v4-pro',
      reasoningEffort: 'high',
      thinkingMode: 'enabled',
    });

    const db = new Database(project.dbPath);
    try {
      const row = db.prepare('SELECT type, status, input_json, model_provider, model_name FROM ai_tasks WHERE id = ?').get(
        task.taskId
      ) as Record<string, unknown> | undefined;
      expect(row).toBeDefined();
      expect(row).toMatchObject({
        type: 'expand',
        status: 'preflight_ready',
        model_provider: 'deepseek',
        model_name: 'deepseek-v4-pro',
      });
      const input = JSON.parse(String(row?.input_json));
      expect(input.contextMetadata.sourceList.length).toBe(context.sourceList.length);
      expect(input.contextMetadata.tokenEstimate).toBe(context.tokenEstimate);
      expect(input.reasoning).toEqual({ reasoningEffort: 'high', thinkingMode: 'enabled' });
      expect(JSON.stringify(input)).not.toContain(paragraph.text);
      expect(input.contextMetadata.omittedContextReasons).toEqual(context.omittedContextReasons);
    } finally {
      db.close();
    }
  });
});
