import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { applyAgentArtifact, rejectAgentArtifact } from '../../../src/main/agent/agent-artifact-service';
import { createAgentToolRegistry } from '../../../src/main/agent/agent-tool-registry';
import { createTxtImportService } from '../../../src/main/importers/txt/txt-import-service';
import { getChapterForEditing, listChaptersForProject, updateParagraphText } from '../../../src/main/manuscript/manuscript-service';
import { listMemoryCards } from '../../../src/main/memory/memory-service';

async function importTestNovel() {
  const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-agent-artifacts-'));
  const service = createTxtImportService();
  const preview = await service.previewTxt(path.join(process.cwd(), 'test_novel', 'test.txt'));
  return service.commitTxt({
    previewId: preview.previewId,
    baseDirectory: root,
    projectName: preview.preview.suggestedProjectName,
  });
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

function artifactRows(dbPath: string): Array<Record<string, unknown>> {
  const db = new Database(dbPath);
  try {
    return db.prepare('SELECT id, status FROM agent_artifacts ORDER BY id').all() as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function approvalRows(dbPath: string): Array<Record<string, unknown>> {
  const db = new Database(dbPath);
  try {
    return db.prepare('SELECT artifact_id, decision FROM agent_approvals ORDER BY created_at').all() as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function createIssue(dbPath: string): string {
  const db = new Database(dbPath);
  try {
    const issueId = 'issue-agent-artifact-1';
    db.prepare(
      `INSERT INTO issues
       (id, type, severity, title, explanation, suggestion, status, current_paragraph_id, source_task_id, created_at, updated_at)
       VALUES (?, 'continuity_test', 'medium', '道具状态冲突', '前后道具状态不一致。', '确认是否为伏笔。', 'open', NULL, NULL, ?, ?)`
    ).run(issueId, '2026-04-25T00:00:00.000Z', '2026-04-25T00:00:00.000Z');
    return issueId;
  } finally {
    db.close();
  }
}

describe('agent artifact service', () => {
  test('applies a polish artifact only after explicit approval', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const paragraph = getChapterForEditing(project.dbPath, chapter.id).paragraphs[0];
    const runId = 'agent-run-artifact-polish';
    createAgentRun(project.dbPath, runId);
    const registry = createAgentToolRegistry(project.dbPath, { runId });
    const proposal = await registry.execute('propose_polish', {
      paragraphId: paragraph.id,
      revisedText: `${paragraph.text}他把灯又拨暗了一分。`,
      editSummary: '补一处动作细节。',
      riskFlags: [],
    });

    const result = applyAgentArtifact(project.dbPath, { artifactId: proposal.artifact!.id });

    expect(result).toMatchObject({
      artifactId: proposal.artifact!.id,
      status: 'approved',
      appliedType: 'polish_revision',
    });
    expect(getChapterForEditing(project.dbPath, chapter.id).paragraphs[0].text).toContain('他把灯又拨暗了一分。');
    expect(artifactRows(project.dbPath)).toEqual([expect.objectContaining({ status: 'approved' })]);
    expect(approvalRows(project.dbPath)).toEqual([
      expect.objectContaining({
        artifact_id: proposal.artifact!.id,
        decision: 'approved',
      }),
    ]);
  });

  test('refuses to apply a stale polish artifact after the paragraph changes', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const paragraph = getChapterForEditing(project.dbPath, chapter.id).paragraphs[0];
    const runId = 'agent-run-artifact-stale-polish';
    createAgentRun(project.dbPath, runId);
    const registry = createAgentToolRegistry(project.dbPath, { runId });
    const proposal = await registry.execute('propose_polish', {
      paragraphId: paragraph.id,
      revisedText: `${paragraph.text}他把灯又拨暗了一分。`,
      editSummary: '补一处动作细节。',
      riskFlags: [],
    });

    updateParagraphText(project.dbPath, {
      paragraphId: paragraph.id,
      text: `${paragraph.text}作者先手动补了一句。`,
      changeReason: 'manual_test_change',
    });

    expect(() => applyAgentArtifact(project.dbPath, { artifactId: proposal.artifact!.id })).toThrow('正文已变化');
    expect(artifactRows(project.dbPath)).toEqual([expect.objectContaining({ status: 'pending_approval' })]);
    expect(approvalRows(project.dbPath)).toEqual([]);
  });

  test('applies an issue-action artifact through the existing issue status service', async () => {
    const project = await importTestNovel();
    const issueId = createIssue(project.dbPath);
    const runId = 'agent-run-artifact-issue';
    createAgentRun(project.dbPath, runId);
    const registry = createAgentToolRegistry(project.dbPath, { runId });
    const proposal = await registry.execute('propose_issue_action', {
      issueId,
      action: 'mark_foreshadowing',
      note: '作者确认这是伏笔。',
    });

    const result = applyAgentArtifact(project.dbPath, { artifactId: proposal.artifact!.id });

    expect(result).toMatchObject({
      artifactId: proposal.artifact!.id,
      status: 'approved',
      appliedType: 'issue_action',
    });
    const db = new Database(project.dbPath);
    try {
      const row = db.prepare('SELECT status FROM issues WHERE id = ?').get(issueId) as Record<string, unknown>;
      expect(row.status).toBe('marked_as_foreshadowing');
    } finally {
      db.close();
    }
  });

  test('applies a memory-update artifact into project memory after approval', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const paragraph = getChapterForEditing(project.dbPath, chapter.id).paragraphs[0];
    const runId = 'agent-run-artifact-memory';
    createAgentRun(project.dbPath, runId);
    const registry = createAgentToolRegistry(project.dbPath, { runId });
    const proposal = await registry.execute('propose_memory_update', {
      cardType: 'world_rule',
      title: '旧港钥匙规则',
      content: '铜钥匙只有接触旧港黑泥后才会显出齿痕。',
      sourceParagraphIds: [paragraph.id],
    });

    const result = applyAgentArtifact(project.dbPath, { artifactId: proposal.artifact!.id });
    const cards = listMemoryCards(project.dbPath).cards;

    expect(result).toMatchObject({
      artifactId: proposal.artifact!.id,
      status: 'approved',
      appliedType: 'memory_update',
    });
    expect(cards).toEqual([
      expect.objectContaining({
        kind: 'world_rule',
        body: '铜钥匙只有接触旧港黑泥后才会显出齿痕。',
        sourceParagraphId: paragraph.id,
        status: 'user_confirmed',
      }),
    ]);
  });

  test('rejects an artifact without changing manuscript text', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const paragraph = getChapterForEditing(project.dbPath, chapter.id).paragraphs[0];
    const runId = 'agent-run-artifact-reject';
    createAgentRun(project.dbPath, runId);
    const registry = createAgentToolRegistry(project.dbPath, { runId });
    const proposal = await registry.execute('propose_polish', {
      paragraphId: paragraph.id,
      revisedText: `${paragraph.text}他把灯又拨暗了一分。`,
      editSummary: '补一处动作细节。',
      riskFlags: [],
    });

    const result = rejectAgentArtifact(project.dbPath, { artifactId: proposal.artifact!.id });

    expect(result).toEqual({
      artifactId: proposal.artifact!.id,
      status: 'rejected',
      decision: 'rejected',
      appliedType: null,
      appliedResult: null,
    });
    expect(getChapterForEditing(project.dbPath, chapter.id).paragraphs[0].text).toBe(paragraph.text);
    expect(artifactRows(project.dbPath)).toEqual([expect.objectContaining({ status: 'rejected' })]);
  });
});
