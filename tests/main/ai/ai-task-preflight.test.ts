import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { buildAiTaskPreflight } from '../../../src/main/ai/ai-task-preflight';
import { createTxtImportService } from '../../../src/main/importers/txt/txt-import-service';
import { getChapterForEditing, listChaptersForProject } from '../../../src/main/manuscript/manuscript-service';

async function importTestNovel() {
  const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-ai-preflight-'));
  const service = createTxtImportService();
  const preview = await service.previewTxt(path.join(process.cwd(), 'test_novel', 'test.txt'));
  return service.commitTxt({
    previewId: preview.previewId,
    baseDirectory: root,
    projectName: preview.preview.suggestedProjectName,
  });
}

describe('AI task preflight', () => {
  test('uses the single active provider even if task input tries to name another provider', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const editable = getChapterForEditing(project.dbPath, chapter.id);
    const paragraph = editable.paragraphs[0];

    const preflight = buildAiTaskPreflight(project.dbPath, {
      task: 'polish',
      activeProvider: 'deepseek',
      taskSetting: {
        modelRole: 'pro',
        reasoningEffort: 'max',
        thinkingMode: 'enabled',
      },
      contextReferenceParagraphIds: [],
      scope: {
        scopeLabel: `${editable.title} / ${paragraph.friendlyLabel}`,
        anchorParagraphId: paragraph.id,
        currentChapterId: editable.id,
        selectedText: paragraph.text,
        providerId: 'openrouter',
      },
      input: {
        userInstruction: '保留事实，语言更紧。',
        providerId: 'openrouter',
      },
    });

    expect(preflight).toMatchObject({
      providerId: 'deepseek',
      modelName: 'deepseek-v4-pro',
      reasoning: {
        reasoningEffort: 'max',
        thinkingMode: 'enabled',
      },
      status: 'preflight_ready',
    });
    expect(preflight.context.action.kind).toBe('polish');

    const db = new Database(project.dbPath);
    try {
      const row = db.prepare('SELECT model_provider, model_name, input_json FROM ai_tasks WHERE id = ?').get(
        preflight.taskId
      ) as Record<string, unknown> | undefined;
      expect(row).toMatchObject({
        model_provider: 'deepseek',
        model_name: 'deepseek-v4-pro',
      });
      expect(String(row?.input_json)).not.toContain('openrouter');
    } finally {
      db.close();
    }
  });

  test('fails explicitly when no provider is active', async () => {
    const project = await importTestNovel();

    expect(() =>
      buildAiTaskPreflight(project.dbPath, {
        task: 'chat',
        activeProvider: null,
        taskSetting: {
          modelRole: 'flash',
          reasoningEffort: 'high',
          thinkingMode: 'disabled',
        },
        contextReferenceParagraphIds: [],
        scope: {},
        input: { userInstruction: '解释当前人物关系。' },
      })
    ).toThrow('请先在模型设置里选择一个激活供应商');
  });

  test('uses an OpenRouter task model override without changing the active provider', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const editable = getChapterForEditing(project.dbPath, chapter.id);
    const paragraph = editable.paragraphs[0];

    const preflight = buildAiTaskPreflight(project.dbPath, {
      task: 'chat',
      activeProvider: 'openrouter',
      taskSetting: {
        modelRole: 'pro',
        modelNameOverride: 'anthropic/claude-sonnet-4.5',
        reasoningEffort: 'high',
        thinkingMode: 'enabled',
      },
      contextReferenceParagraphIds: [],
      scope: {
        scopeLabel: `${editable.title} / ${paragraph.friendlyLabel}`,
        anchorParagraphId: paragraph.id,
        currentChapterId: editable.id,
      },
      input: { userInstruction: '解释当前冲突。' },
    });

    expect(preflight.providerId).toBe('openrouter');
    expect(preflight.modelName).toBe('anthropic/claude-sonnet-4.5');

    const db = new Database(project.dbPath);
    try {
      const row = db.prepare('SELECT model_provider, model_name FROM ai_tasks WHERE id = ?').get(preflight.taskId) as
        | Record<string, unknown>
        | undefined;
      expect(row).toMatchObject({
        model_provider: 'openrouter',
        model_name: 'anthropic/claude-sonnet-4.5',
      });
    } finally {
      db.close();
    }
  });
});
