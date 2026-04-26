import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { applyAgentArtifact } from '../../src/main/agent/agent-artifact-service';
import { runAgent } from '../../src/main/agent/agent-runner';
import { createAgentToolRegistry } from '../../src/main/agent/agent-tool-registry';
import { buildAiTaskPreflight, type TaskModelSetting } from '../../src/main/ai/ai-task-preflight';
import {
  acceptExpansionRevisionCandidate,
  buildExpansionPromptMessages,
  createExpansionRevisionCandidate,
  parseExpansionStructuredOutput,
} from '../../src/main/ai/expansion-service';
import {
  acceptPolishRevisionCandidate,
  buildPolishPromptMessages,
  createPolishRevisionCandidate,
  parsePolishStructuredOutput,
} from '../../src/main/ai/polish-service';
import { importMarkdownCanon } from '../../src/main/canon/canon-service';
import { runFactContinuityCheck } from '../../src/main/continuity/continuity-service';
import { previewExport, runExport } from '../../src/main/exporters/export-service';
import { createTxtImportService, type CommitTxtPreviewResult } from '../../src/main/importers/txt/txt-import-service';
import { createJobQueue } from '../../src/main/jobs/job-queue';
import { defaultModelForProvider, sendProviderChatCompletion, type LlmTaskRequest } from '../../src/main/llm/provider-adapters';
import {
  getChapterForEditing,
  listChaptersForProject,
  listRevisions,
  restoreRevision,
  updateParagraphText,
} from '../../src/main/manuscript/manuscript-service';
import { listMemoryCards, updateMemoryCard } from '../../src/main/memory/memory-service';
import {
  buildLlmProofreadPromptMessages,
  parseLlmProofreadStructuredOutput,
  persistLlmProofreadIssues,
} from '../../src/main/proofread/llm-proofread-service';
import { listIssues, runRuleBasedProofread } from '../../src/main/proofread/proofread-service';
import { searchParagraphs } from '../../src/main/search/search-service';
import { queryTimeline } from '../../src/main/timeline/timeline-service';

const liveDescribe = process.env.RUN_LIVE_DEEPSEEK === '1' ? describe : describe.skip;
const deepSeekModel = defaultModelForProvider('deepseek', 'flash');
const taskSetting = {
  modelRole: 'flash',
  reasoningEffort: 'high',
  thinkingMode: 'disabled',
} satisfies TaskModelSetting;
const thinkingTaskSetting = {
  ...taskSetting,
  thinkingMode: 'enabled',
} satisfies TaskModelSetting;

interface LiveStep {
  name: string;
  status: 'passed' | 'failed';
  durationMs: number;
  details?: string;
}

function redact(value: unknown): string {
  const raw = value instanceof Error ? value.message : typeof value === 'string' ? value : JSON.stringify(value);
  return (raw || 'unknown error')
    .replace(/sk-[A-Za-z0-9._-]+/g, '[REDACTED_API_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED_API_KEY]');
}

function parseDeepSeekKey(raw: string): string {
  const lines = raw
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  for (const line of lines) {
    const explicit = /^DEEPSEEK_API_KEY\s*=\s*(.+)$/i.exec(line);
    if (explicit) {
      return explicit[1].replace(/^["']|["']$/g, '').trim();
    }
  }
  const rawKey = lines.find((line) => line.startsWith('sk-'));
  return rawKey?.replace(/^["']|["']$/g, '').trim() ?? '';
}

async function readDeepSeekApiKey(): Promise<string> {
  const raw = await readFile(path.join(process.cwd(), '.env'), 'utf8');
  const apiKey = parseDeepSeekKey(raw);
  if (!apiKey) {
    throw new Error('.env 中没有可用的 DeepSeek API Key');
  }
  return apiKey;
}

async function importSampleTxt(): Promise<CommitTxtPreviewResult & { tempRoot: string }> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'novel-tool-deepseek-live-'));
  const service = createTxtImportService();
  const preview = await service.previewTxt(path.join(process.cwd(), 'test_novel', 'test.txt'));
  expect(preview.preview.fileName).toBe('test.txt');
  expect(preview.preview.chapters.length).toBeGreaterThan(0);
  const project = await service.commitTxt({
    previewId: preview.previewId,
    baseDirectory: tempRoot,
    projectName: `live-${Date.now()}`,
  });
  return { ...project, tempRoot };
}

async function callDeepSeek(apiKey: string, request: Partial<LlmTaskRequest> & Pick<LlmTaskRequest, 'messages'>) {
  return sendProviderChatCompletion(
    'deepseek',
    {
      model: request.model ?? deepSeekModel,
      messages: request.messages,
      reasoningEffort: request.reasoningEffort ?? 'high',
      thinkingMode: request.thinkingMode ?? 'disabled',
      stream: request.stream ?? false,
      responseFormat: request.responseFormat,
      tools: request.tools,
    },
    apiKey,
    120_000
  );
}

function insertAgentRun(dbPath: string): string {
  const db = new Database(dbPath);
  try {
    const runId = `live-agent-run-${Date.now()}`;
    const timestamp = new Date().toISOString();
    db.prepare(
      `INSERT INTO agent_runs (id, chat_session_id, mode, status, created_at, updated_at)
       VALUES (?, NULL, 'organize', 'created', ?, ?)`
    ).run(runId, timestamp, timestamp);
    return runId;
  } finally {
    db.close();
  }
}

function seedContradictingFacts(dbPath: string, firstParagraphId: string, secondParagraphId: string, firstQuote: string, secondQuote: string): void {
  const db = new Database(dbPath);
  try {
    const timestamp = new Date().toISOString();
    db.prepare(
      `INSERT INTO entities (id, type, canonical_name, description, status, confidence, created_at, updated_at)
       VALUES ('entity-live-ring', 'prop', '黑铁戒指', '真实测试道具', 'user_confirmed', 1, ?, ?)`
    ).run(timestamp, timestamp);
    db.prepare(
      `INSERT INTO facts
       (id, subject_entity_id, predicate, object_text, fact_type, source_paragraph_id, quote, confidence, status, created_at, updated_at)
       VALUES ('fact-live-ring-lost', 'entity-live-ring', '状态', '已经遗失', 'prop', ?, ?, 0.95, 'user_confirmed', ?, ?)`
    ).run(firstParagraphId, firstQuote, timestamp, timestamp);
    db.prepare(
      `INSERT INTO facts
       (id, subject_entity_id, predicate, object_text, fact_type, source_paragraph_id, quote, confidence, status, created_at, updated_at)
       VALUES ('fact-live-ring-held', 'entity-live-ring', '状态', '仍在萧炎手中', 'prop', ?, ?, 0.76, 'ai_extracted', ?, ?)`
    ).run(secondParagraphId, secondQuote, timestamp, timestamp);
  } finally {
    db.close();
  }
}

liveDescribe('DeepSeek live smoke with test_novel/test.txt', () => {
  test(
    'runs implemented TXT, editor, AI, proofreading, continuity, agent, memory, timeline, and TXT export flows against real DeepSeek',
    async () => {
      const steps: LiveStep[] = [];
      const failures: string[] = [];
      let apiKey = '';
      let project: (CommitTxtPreviewResult & { tempRoot: string }) | undefined;
      let chapterId = '';
      let firstParagraphId = '';
      let secondParagraphId = '';
      let proofreadParagraphId = '';
      let continuityIssueId = '';

      async function step<T>(name: string, body: () => Promise<T> | T): Promise<T | undefined> {
        const started = Date.now();
        try {
          const value = await body();
          steps.push({ name, status: 'passed', durationMs: Date.now() - started });
          console.info(`[live-smoke] PASS ${name}`);
          return value;
        } catch (error) {
          const message = redact(error);
          failures.push(`${name}: ${message}`);
          steps.push({ name, status: 'failed', durationMs: Date.now() - started, details: message });
          console.error(`[live-smoke] FAIL ${name}: ${message}`);
          return undefined;
        }
      }

      await step('read .env DeepSeek key without logging it', async () => {
        apiKey = await readDeepSeekApiKey();
        expect(apiKey.startsWith('sk-')).toBe(true);
      });

      await step('TXT import creates local project, chapters, paragraphs, FTS job', async () => {
        project = await importSampleTxt();
        const chapters = listChaptersForProject(project.dbPath);
        expect(chapters.length).toBeGreaterThanOrEqual(5);
        expect(chapters[0].title).toContain('第1章');
        const chapter = getChapterForEditing(project.dbPath, chapters[0].id);
        expect(chapter.paragraphs.length).toBeGreaterThan(20);
        chapterId = chapter.id;
        firstParagraphId = chapter.paragraphs[1].id;
        secondParagraphId = chapter.paragraphs[2].id;
        proofreadParagraphId = chapter.paragraphs[3].id;
        const db = new Database(project.dbPath);
        try {
          const jobs = createJobQueue(db).listRecent(10);
          expect(jobs.some((job) => job.type === 'index_fts' && job.status === 'done')).toBe(true);
        } finally {
          db.close();
        }
      });

      await step('editor autosave service writes version history and restore keeps paragraph IDs stable', () => {
        if (!project) throw new Error('project not ready');
        const paragraph = getChapterForEditing(project.dbPath, chapterId).paragraphs.find((item) => item.id === firstParagraphId);
        if (!paragraph) throw new Error('paragraph not ready');
        const changedText = `${paragraph.text} 真实测试标记。`;
        const update = updateParagraphText(project.dbPath, {
          paragraphId: paragraph.id,
          text: changedText,
          changeReason: 'live_deepseek_smoke_edit',
        });
        expect(update.changed).toBe(true);
        const revisions = listRevisions(project.dbPath, { scopeType: 'paragraph', scopeId: paragraph.id });
        expect(revisions.length).toBeGreaterThan(0);
        const restored = restoreRevision(project.dbPath, { revisionId: revisions[0].id });
        expect(restored.changed).toBe(true);
        const reopened = getChapterForEditing(project.dbPath, chapterId).paragraphs.find((item) => item.id === paragraph.id);
        expect(reopened?.id).toBe(paragraph.id);
        expect(reopened?.text).toBe(paragraph.text);
      });

      await step('search finds Chinese manuscript terms and returns source locations', () => {
        if (!project) throw new Error('project not ready');
        const result = searchParagraphs(project.dbPath, { query: '萧炎', limit: 5 });
        expect(result.results.length).toBeGreaterThan(0);
        expect(result.results[0].paragraphId).toBeTruthy();
        expect(result.results[0].friendlyLocation).toContain('第');
      });

      await step('Markdown outline/canon import feeds global planning context', async () => {
        if (!project) throw new Error('project not ready');
        const outlinePath = path.join(project.tempRoot, 'live-outline.md');
        await writeFile(
          outlinePath,
          [
            '# 全局设定',
            '## 角色：萧炎',
            '曾经是萧家天才，当前承受测试失利带来的压力。',
            '## 世界观',
            '斗之气分段，十段后可以凝聚斗之气旋。',
            '## 第三章大纲',
            '测试结束后，主角需要面对来自族人的议论。',
          ].join('\n'),
          'utf8'
        );
        const result = await importMarkdownCanon({
          projectPath: project.projectPath,
          dbPath: project.dbPath,
          filePath: outlinePath,
        });
        expect(result.recordCount).toBeGreaterThanOrEqual(3);
        expect(result.records.some((record) => record.recordType === 'character')).toBe(true);
      });

      await step('ContextBuilder preflight records bounded sources for model tasks', () => {
        if (!project) throw new Error('project not ready');
        const paragraph = getChapterForEditing(project.dbPath, chapterId).paragraphs.find((item) => item.id === firstParagraphId);
        if (!paragraph) throw new Error('paragraph not ready');
        const preflight = buildAiTaskPreflight(project.dbPath, {
          task: 'polish',
          activeProvider: 'deepseek',
          taskSetting,
          contextReferenceParagraphIds: [secondParagraphId],
          scope: {
            scopeLabel: '真实测试选区',
            anchorParagraphId: paragraph.id,
            currentChapterId: chapterId,
            selectedText: paragraph.text,
          },
          input: {
            userInstruction: '轻微润色，不改事实。',
            maxCharacters: 4_000,
          },
        });
        expect(preflight.providerId).toBe('deepseek');
        expect(preflight.modelName).toBe(deepSeekModel);
        expect(preflight.context.sourceList.length).toBeGreaterThan(0);
        expect(preflight.context.contextText).toContain('[current_paragraph]');
      });

      await step('DeepSeek official V4 request works with reasoning_effort=high and thinking enabled', async () => {
        if (!apiKey) throw new Error('api key not ready');
        const response = await callDeepSeek(apiKey, {
          messages: [{ role: 'user', content: '请只回复 OK，用于真实连接测试。' }],
          thinkingMode: 'enabled',
          reasoningEffort: 'high',
        });
        expect(response.content.toUpperCase()).toContain('OK');
      });

      await step('real DeepSeek polish returns JSON, creates diff candidate, accepts revision', async () => {
        if (!project || !apiKey) throw new Error('project or api key not ready');
        const paragraph = getChapterForEditing(project.dbPath, chapterId).paragraphs.find((item) => item.id === firstParagraphId);
        if (!paragraph) throw new Error('paragraph not ready');
        const preflight = buildAiTaskPreflight(project.dbPath, {
          task: 'polish',
          activeProvider: 'deepseek',
          taskSetting,
          contextReferenceParagraphIds: [],
          scope: {
            scopeLabel: '真实测试润色',
            anchorParagraphId: paragraph.id,
            currentChapterId: chapterId,
            selectedText: paragraph.text,
          },
          input: {
            userInstruction: '只做轻微润色，补一点感官细节，不改变事实。',
            maxCharacters: 4_000,
          },
        });
        const response = await callDeepSeek(apiKey, {
          messages: buildPolishPromptMessages(preflight.context, {
            strength: 'light',
            focus: '语言更顺一点，克制补充动作或感官细节',
            forbiddenChanges: '不得改变人物、等级、地点、时间和世界规则',
          }),
          responseFormat: 'json_object',
        });
        const output = parsePolishStructuredOutput(response.content);
        expect(output.revisedText).not.toBe(paragraph.text);
        const candidate = createPolishRevisionCandidate(project.dbPath, {
          paragraphId: paragraph.id,
          sourceTaskId: preflight.taskId,
          structuredOutput: output,
        });
        expect(candidate.diffJson.length).toBeGreaterThan(0);
        const accepted = acceptPolishRevisionCandidate(project.dbPath, { revisionId: candidate.revisionId });
        expect(accepted.changed).toBe(true);
      });

      await step('real DeepSeek expansion returns draft candidate and inserts accepted paragraphs', async () => {
        if (!project || !apiKey) throw new Error('project or api key not ready');
        const chapter = getChapterForEditing(project.dbPath, chapterId);
        const anchor = chapter.paragraphs.find((item) => item.id === secondParagraphId);
        if (!anchor) throw new Error('anchor not ready');
        const preflight = buildAiTaskPreflight(project.dbPath, {
          task: 'expand',
          activeProvider: 'deepseek',
          taskSetting: thinkingTaskSetting,
          contextReferenceParagraphIds: [],
          scope: {
            scopeLabel: '真实测试扩写',
            anchorParagraphId: anchor.id,
            currentChapterId: chapterId,
            selectedText: anchor.text,
          },
          input: {
            userInstruction: '在不改变结果的前提下，补一小段萧炎握拳忍耐的细节。',
            maxCharacters: 4_000,
          },
        });
        const response = await callDeepSeek(apiKey, {
          messages: buildExpansionPromptMessages(preflight.context, {
            nextBeats: '萧炎听到公布结果后压下情绪，没有反驳。',
            focusDetails: '手掌、呼吸、广场声音',
            forbiddenChanges: '不得改变萧炎斗之力三段的事实，不新增人物。',
            targetLength: '80-140字',
          }),
          thinkingMode: 'enabled',
          responseFormat: 'json_object',
        });
        const output = parseExpansionStructuredOutput(response.content);
        expect(output.paragraphs.length).toBeGreaterThan(0);
        const candidate = createExpansionRevisionCandidate(project.dbPath, {
          anchorParagraphId: anchor.id,
          sourceTaskId: preflight.taskId,
          structuredOutput: output,
        });
        const accepted = acceptExpansionRevisionCandidate(project.dbPath, { revisionId: candidate.revisionId });
        expect(accepted.insertedCount).toBe(output.paragraphs.length);
      });

      await step('real DeepSeek proofreading plus local rules produces storable evidence cards', async () => {
        if (!project || !apiKey) throw new Error('project or api key not ready');
        const typoText = '萧炎炎看着魔石碑，，心里觉得不不甘。';
        updateParagraphText(project.dbPath, {
          paragraphId: proofreadParagraphId,
          text: typoText,
          changeReason: 'live_proofread_fixture',
        });
        const preflight = buildAiTaskPreflight(project.dbPath, {
          task: 'proofread',
          activeProvider: 'deepseek',
          taskSetting,
          contextReferenceParagraphIds: [],
          scope: {
            scopeLabel: '真实测试校对',
            anchorParagraphId: proofreadParagraphId,
            currentChapterId: chapterId,
            selectedText: typoText,
          },
          input: {
            userInstruction: '找出重复字、重复标点和表达问题。',
            maxCharacters: 4_000,
          },
        });
        expect(preflight.context.sourceList.some((source) => source.paragraphId === proofreadParagraphId)).toBe(true);
        const response = await callDeepSeek(apiKey, {
          messages: buildLlmProofreadPromptMessages(preflight.context),
          responseFormat: 'json_object',
        });
        const llmOutput = parseLlmProofreadStructuredOutput(response.content);
        expect(llmOutput.issues.length).toBeGreaterThan(0);
        const llmResult = persistLlmProofreadIssues(project.dbPath, {
          sourceTaskId: preflight.taskId,
          structuredOutput: llmOutput,
        });
        const localResult = runRuleBasedProofread(project.dbPath, {
          paragraphIds: [proofreadParagraphId],
          sourceTaskId: preflight.taskId,
        });
        expect(llmResult.issues.length + localResult.issues.length).toBeGreaterThan(0);
        const listed = listIssues(project.dbPath, { currentParagraphId: proofreadParagraphId, status: 'open' });
        expect(listed.some((issue) => issue.evidence.length > 0)).toBe(true);
      });

      await step('memory cards, timeline nodes, and issue-action artifacts persist local project state', async () => {
        if (!project) throw new Error('project not ready');
        const dbPath = project.dbPath;
        const chapter = getChapterForEditing(project.dbPath, chapterId);
        const first = chapter.paragraphs.find((item) => item.id === firstParagraphId);
        const second = chapter.paragraphs.find((item) => item.id === secondParagraphId);
        if (!first || !second) throw new Error('paragraphs not ready');
        seedContradictingFacts(dbPath, first.id, second.id, first.text.slice(0, 24), second.text.slice(0, 24));
        const memoryBefore = listMemoryCards(dbPath);
        expect(memoryBefore.cards.some((card) => card.id === 'fact:fact-live-ring-held')).toBe(true);
        const updated = updateMemoryCard(dbPath, {
          cardId: 'fact:fact-live-ring-held',
          changes: { status: 'user_confirmed' },
        });
        expect(updated.status).toBe('user_confirmed');

        const runId = insertAgentRun(dbPath);
        const registry = createAgentToolRegistry(dbPath, { runId });
        const artifactResult = await registry.execute('propose_memory_update', {
          cardType: 'timeline',
          title: '测试结束后',
          content: '萧炎在测试结果公布后压住情绪离场。',
          sourceParagraphIds: [first.id],
        });
        if (!artifactResult.artifact) throw new Error('memory artifact missing');
        const applied = applyAgentArtifact(dbPath, { artifactId: artifactResult.artifact.id });
        expect(applied.status).toBe('approved');
        const timeline = queryTimeline(dbPath);
        expect(timeline.nodes.some((node) => node.summary.includes('压住情绪'))).toBe(true);
      });

      await step('continuity check creates evidence-backed contradiction cards', () => {
        if (!project) throw new Error('project not ready');
        const result = runFactContinuityCheck(project.dbPath, {
          paragraphIds: [secondParagraphId],
          sourceTaskId: 'live-continuity-task',
        });
        expect(result.issues.length).toBeGreaterThan(0);
        expect(result.issues[0].evidence.length).toBe(2);
        continuityIssueId = result.issues[0].id;
      });

      await step('issue-action artifact approval updates an issue without direct model writes', async () => {
        if (!project) throw new Error('project not ready');
        const dbPath = project.dbPath;
        const runId = insertAgentRun(dbPath);
        const registry = createAgentToolRegistry(dbPath, { runId });
        const artifactResult = await registry.execute('propose_issue_action', {
          issueId: continuityIssueId,
          action: 'mark_foreshadowing',
          note: '真实测试：作为伏笔保留。',
        });
        if (!artifactResult.artifact) throw new Error('issue action artifact missing');
        const applied = applyAgentArtifact(dbPath, { artifactId: artifactResult.artifact.id });
        expect(applied.status).toBe('approved');
        const issue = listIssues(dbPath, { limit: 20 }).find((item) => item.id === continuityIssueId);
        expect(issue?.status).toBe('marked_as_foreshadowing');
      });

      await step('real DeepSeek Agent loop can call project tools and return sourced answer', async () => {
        if (!project || !apiKey) throw new Error('project or api key not ready');
        const result = await runAgent({
          dbPath: project.dbPath,
          message: '请先调用 search_manuscript 工具搜索“萧炎”，再用工具结果用一句话回答：萧炎在当前片段里的处境如何。',
          mode: 'investigate',
          providerId: 'deepseek',
          modelName: deepSeekModel,
          reasoningEffort: 'high',
          thinkingMode: 'enabled',
          currentParagraphId: firstParagraphId,
          sendModelRequest: (request) => sendProviderChatCompletion('deepseek', request, apiKey, 120_000),
        });
        expect(result.status).toBe('completed');
        expect(result.finalAnswer.length).toBeGreaterThan(0);
        expect(result.toolResults.some((tool) => tool.toolName === 'search_manuscript')).toBe(true);
      });

      await step('TXT export writes artifact and records export job; EPUB intentionally skipped', async () => {
        if (!project) throw new Error('project not ready');
        const preview = previewExport(project.dbPath, project.projectPath, { format: 'txt' });
        expect(preview.chapterCount).toBeGreaterThan(0);
        const outputPath = path.join(project.projectPath, 'exports', 'live-smoke-export.txt');
        const exported = await runExport(project.dbPath, project.projectPath, { format: 'txt', outputPath });
        expect(exported.bytesWritten).toBeGreaterThan(0);
        const file = await stat(outputPath);
        expect(file.size).toBe(exported.bytesWritten);
        const db = new Database(project.dbPath);
        try {
          const jobs = createJobQueue(db).listRecent(20);
          expect(jobs.some((job) => job.type === 'export_txt' && job.status === 'done')).toBe(true);
        } finally {
          db.close();
        }
      });

      console.info(`[live-smoke] completed ${steps.length} steps, failures=${failures.length}`);
      if (failures.length > 0) {
        throw new Error(`DeepSeek live smoke failed:\n${failures.join('\n')}`);
      }
      expect(failures).toEqual([]);
    },
    480_000
  );
});
