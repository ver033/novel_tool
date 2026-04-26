import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { createAgentToolRegistry } from '../../../src/main/agent/agent-tool-registry';
import { createTxtImportService } from '../../../src/main/importers/txt/txt-import-service';
import { getChapterForEditing, listChaptersForProject } from '../../../src/main/manuscript/manuscript-service';

async function importTestNovel() {
  const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-agent-tools-'));
  const service = createTxtImportService();
  const preview = await service.previewTxt(path.join(process.cwd(), 'test_novel', 'test.txt'));
  return service.commitTxt({
    previewId: preview.previewId,
    baseDirectory: root,
    projectName: preview.preview.suggestedProjectName,
  });
}

function countParagraphs(dbPath: string): number {
  const db = new Database(dbPath);
  try {
    const row = db.prepare('SELECT COUNT(*) AS count FROM paragraphs').get() as { count: number } | undefined;
    return Number(row?.count ?? 0);
  } finally {
    db.close();
  }
}

function readArtifacts(dbPath: string): Array<Record<string, unknown>> {
  const db = new Database(dbPath);
  try {
    return db.prepare('SELECT artifact_type, title, payload_json, status FROM agent_artifacts ORDER BY title').all() as Array<
      Record<string, unknown>
    >;
  } finally {
    db.close();
  }
}

function createAgentRun(dbPath: string, runId: string): void {
  const db = new Database(dbPath);
  try {
    db.prepare(
      `INSERT INTO agent_runs (id, chat_session_id, mode, status, created_at, updated_at)
       VALUES (?, NULL, 'draft', 'created', ?, ?)`
    ).run(runId, '2026-04-25T00:00:00.000Z', '2026-04-25T00:00:00.000Z');
  } finally {
    db.close();
  }
}

describe('agent tool registry', () => {
  test('rejects unknown tools before execution', async () => {
    const project = await importTestNovel();
    const registry = createAgentToolRegistry(project.dbPath);

    await expect(registry.execute('write_manuscript_directly', {})).rejects.toThrow('Agent tool is not registered');
  });

  test('read_paragraphs returns friendly evidence without mutating manuscript rows', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const paragraph = getChapterForEditing(project.dbPath, chapter.id).paragraphs[0];
    const beforeCount = countParagraphs(project.dbPath);
    const registry = createAgentToolRegistry(project.dbPath);

    const result = await registry.execute('read_paragraphs', {
      paragraphIds: [paragraph.id],
    });

    expect(result.permission).toBe('read');
    expect(result.sources).toEqual([
      expect.objectContaining({
        paragraphId: paragraph.id,
        friendlyLocation: expect.stringContaining('第 1 段'),
      }),
    ]);
    expect(JSON.stringify(result.output)).toContain(paragraph.text);
    expect(countParagraphs(project.dbPath)).toBe(beforeCount);
  });

  test('read_paragraphs reports missing model-requested IDs as tool output instead of aborting the agent run', async () => {
    const project = await importTestNovel();
    const registry = createAgentToolRegistry(project.dbPath);

    const result = await registry.execute('read_paragraphs', {
      paragraphIds: ['missing-paragraph'],
    });

    expect(result.permission).toBe('read');
    expect(result.sources).toEqual([]);
    expect(result.output).toMatchObject({
      references: [],
      missingParagraphIds: ['missing-paragraph'],
    });
  });

  test('search_manuscript enforces its result limit', async () => {
    const project = await importTestNovel();
    const registry = createAgentToolRegistry(project.dbPath);

    const result = await registry.execute('search_manuscript', {
      query: '斗之力',
      limit: 2,
    });

    expect(result.permission).toBe('read');
    expect(result.sources.length).toBeLessThanOrEqual(2);
    expect(result.output).toMatchObject({
      query: '斗之力',
    });
  });

  test('propose_polish creates an approval artifact without changing manuscript text', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const paragraph = getChapterForEditing(project.dbPath, chapter.id).paragraphs[0];
    const runId = 'agent-run-test-1';
    createAgentRun(project.dbPath, runId);
    const registry = createAgentToolRegistry(project.dbPath, { runId });

    const result = await registry.execute('propose_polish', {
      paragraphId: paragraph.id,
      revisedText: `${paragraph.text}他把灯又拨暗了一分。`,
      editSummary: '补一处动作细节。',
      riskFlags: [],
    });

    expect(result.permission).toBe('proposal');
    expect(result.artifact).toEqual(
      expect.objectContaining({
        artifactType: 'polish_revision',
        status: 'pending_approval',
      })
    );
    expect(getChapterForEditing(project.dbPath, chapter.id).paragraphs[0].text).toBe(paragraph.text);
    const artifacts = readArtifacts(project.dbPath);
    expect(artifacts).toEqual([
      expect.objectContaining({
        artifact_type: 'polish_revision',
        status: 'pending_approval',
      }),
    ]);
  });

  test('propose_memory_update rejects missing evidence paragraph IDs', async () => {
    const project = await importTestNovel();
    const runId = 'agent-run-test-2';
    createAgentRun(project.dbPath, runId);
    const registry = createAgentToolRegistry(project.dbPath, { runId });

    await expect(
      registry.execute('propose_memory_update', {
        cardType: 'world_rule',
        title: '雨夜规则',
        content: '雨夜时所有人都无法使用传讯符。',
        sourceParagraphIds: ['missing-paragraph'],
      })
    ).rejects.toThrow('段落不存在');
    expect(readArtifacts(project.dbPath)).toEqual([]);
  });

  test('propose_issue_action rejects missing issue IDs', async () => {
    const project = await importTestNovel();
    const runId = 'agent-run-test-3';
    createAgentRun(project.dbPath, runId);
    const registry = createAgentToolRegistry(project.dbPath, { runId });

    await expect(
      registry.execute('propose_issue_action', {
        issueId: 'missing-issue',
        action: 'ignore',
        note: '不是矛盾。',
      })
    ).rejects.toThrow('问题卡不存在');
    expect(readArtifacts(project.dbPath)).toEqual([]);
  });
});
