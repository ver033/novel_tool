import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { runAgent } from '../../../src/main/agent/agent-runner';
import { createTxtImportService } from '../../../src/main/importers/txt/txt-import-service';
import { getChapterForEditing, listChaptersForProject } from '../../../src/main/manuscript/manuscript-service';
import type { LlmTaskRequest, ParsedProviderResponse } from '../../../src/main/llm/provider-adapters';

async function importTestNovel() {
  const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-agent-runner-'));
  const service = createTxtImportService();
  const preview = await service.previewTxt(path.join(process.cwd(), 'test_novel', 'test.txt'));
  return service.commitTxt({
    previewId: preview.previewId,
    baseDirectory: root,
    projectName: preview.preview.suggestedProjectName,
  });
}

function listAgentSteps(dbPath: string, runId: string): Array<Record<string, unknown>> {
  const db = new Database(dbPath);
  try {
    return db.prepare('SELECT label, status, details_json FROM agent_steps WHERE run_id = ? ORDER BY step_index').all(runId) as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function listArtifacts(dbPath: string, runId: string): Array<Record<string, unknown>> {
  const db = new Database(dbPath);
  try {
    return db.prepare('SELECT artifact_type, status, payload_json FROM agent_artifacts WHERE run_id = ?').all(runId) as Array<
      Record<string, unknown>
    >;
  } finally {
    db.close();
  }
}

describe('agent runner', () => {
  test('executes read tool calls, preserves DeepSeek reasoning content, and persists trace', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const paragraph = getChapterForEditing(project.dbPath, chapter.id).paragraphs[0];
    const requests: LlmTaskRequest[] = [];
    const responses: ParsedProviderResponse[] = [
      {
        content: '',
        reasoningContent: '需要读取当前段落作为证据。',
        toolCalls: [
          {
            id: 'call-read-1',
            type: 'function',
            function: {
              name: 'read_paragraphs',
              arguments: JSON.stringify({ paragraphIds: [paragraph.id] }),
            },
          },
        ],
        finishReason: 'tool_calls',
      },
      {
        content: '这段没有明显矛盾。来源：第 1 段。',
        reasoningContent: null,
        toolCalls: [],
        finishReason: 'stop',
      },
    ];

    const result = await runAgent({
      dbPath: project.dbPath,
      message: '@当前段落 看看有没有明显问题',
      mode: 'investigate',
      providerId: 'deepseek',
      modelName: 'deepseek-v4-pro',
      reasoningEffort: 'high',
      thinkingMode: 'enabled',
      currentParagraphId: paragraph.id,
      sendModelRequest: async (request) => {
        requests.push(request);
        const response = responses.shift();
        if (!response) {
          throw new Error('unexpected model call');
        }
        return response;
      },
    });

    expect(result.status).toBe('completed');
    expect(result.finalAnswer).toContain('没有明显矛盾');
    expect(requests).toHaveLength(2);
    expect(requests[1].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          reasoningContent: '需要读取当前段落作为证据。',
          toolCalls: expect.any(Array),
        }),
        expect.objectContaining({
          role: 'tool',
          toolCallId: 'call-read-1',
          content: expect.stringContaining(paragraph.text),
        }),
      ])
    );

    const steps = listAgentSteps(project.dbPath, result.runId);
    expect(steps.map((step) => step.label)).toEqual(
      expect.arrayContaining(['resolve context', 'model turn 1', 'tool read_paragraphs', 'model turn 2'])
    );
    expect(JSON.stringify(steps)).not.toContain('sk-');
  });

  test('builds bounded context before the first model turn', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const paragraph = getChapterForEditing(project.dbPath, chapter.id).paragraphs[0];
    const requests: LlmTaskRequest[] = [];

    const result = await runAgent({
      dbPath: project.dbPath,
      message: '@当前段落 说明这段在写什么',
      mode: 'ask',
      providerId: 'deepseek',
      modelName: 'deepseek-v4-pro',
      reasoningEffort: 'high',
      thinkingMode: 'enabled',
      currentParagraphId: paragraph.id,
      selectedText: paragraph.text,
      sendModelRequest: async (request) => {
        requests.push(request);
        return {
          content: '这段在写雨夜中的等待。',
          reasoningContent: null,
          toolCalls: [],
          finishReason: 'stop',
        };
      },
    });

    expect(result.status).toBe('completed');
    expect(requests[0].messages.map((message) => message.content).join('\n')).toContain('[current_paragraph]');
    const steps = listAgentSteps(project.dbPath, result.runId);
    expect(steps.map((step) => step.label)).toContain('context builder');
    expect(JSON.stringify(steps)).not.toContain(paragraph.text);
  });

  test('exposes only read tools in investigate mode', async () => {
    const project = await importTestNovel();
    const requests: LlmTaskRequest[] = [];

    const result = await runAgent({
      dbPath: project.dbPath,
      message: '只分析，不要生成正文候选',
      mode: 'investigate',
      providerId: 'deepseek',
      modelName: 'deepseek-v4-pro',
      reasoningEffort: 'high',
      thinkingMode: 'enabled',
      sendModelRequest: async (request) => {
        requests.push(request);
        return {
          content: '可以直接基于已有上下文回答。',
          reasoningContent: null,
          toolCalls: [],
          finishReason: 'stop',
        };
      },
    });

    expect(result.status).toBe('completed');
    const toolNames = (requests[0].tools ?? []).map((tool) => {
      const root = tool as { function?: { name?: string } };
      return root.function?.name;
    });
    expect(toolNames).toEqual(expect.arrayContaining(['read_paragraphs', 'search_manuscript', 'list_issues', 'build_context_package']));
    expect(toolNames).not.toEqual(expect.arrayContaining(['propose_polish', 'propose_expansion', 'propose_memory_update']));
  });

  test('forces a final synthesis without tools when the read loop reaches the model turn budget', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const paragraph = getChapterForEditing(project.dbPath, chapter.id).paragraphs[0];
    const requests: LlmTaskRequest[] = [];

    const result = await runAgent({
      dbPath: project.dbPath,
      message: '@引用 这句愿望在开头有什么作用？只给写作建议，不要改正文。',
      mode: 'investigate',
      providerId: 'deepseek',
      modelName: 'deepseek-v4-pro',
      reasoningEffort: 'high',
      thinkingMode: 'enabled',
      references: [paragraph.id],
      sendModelRequest: async (request) => {
        requests.push(request);
        if (requests.length <= 6) {
          return {
            content: '',
            reasoningContent: '继续读取上下文。',
            toolCalls: [
              {
                id: `call-read-${requests.length}`,
                type: 'function',
                function: {
                  name: 'read_paragraphs',
                  arguments: JSON.stringify({ paragraphIds: [paragraph.id] }),
                },
              },
            ],
            finishReason: 'tool_calls',
          };
        }
        return {
          content: '这句开头把世界危机和个人愿望绑定在一起，可以作为整本书的承诺。',
          reasoningContent: null,
          toolCalls: [],
          finishReason: 'stop',
        };
      },
    });

    expect(result.status).toBe('completed');
    expect(result.finalAnswer).toContain('世界危机和个人愿望');
    expect(requests).toHaveLength(7);
    expect(requests[6].tools).toBeUndefined();
    expect(requests[6].messages.at(-1)?.content).toContain('不要再调用工具');
    expect(listAgentSteps(project.dbPath, result.runId).map((step) => step.label)).toContain('final synthesis');
  });

  test('blocks proposal tools in investigate mode even if the model asks for one', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const paragraph = getChapterForEditing(project.dbPath, chapter.id).paragraphs[0];

    const result = await runAgent({
      dbPath: project.dbPath,
      message: '只分析，不要生成候选',
      mode: 'investigate',
      providerId: 'deepseek',
      modelName: 'deepseek-v4-pro',
      reasoningEffort: 'high',
      thinkingMode: 'enabled',
      currentParagraphId: paragraph.id,
      sendModelRequest: async () => ({
        content: '',
        reasoningContent: '模型错误地尝试生成候选。',
        toolCalls: [
          {
            id: 'call-polish-disallowed',
            type: 'function',
            function: {
              name: 'propose_polish',
              arguments: JSON.stringify({
                paragraphId: paragraph.id,
                revisedText: `${paragraph.text}。`,
                editSummary: '不应在分析模式生成候选。',
                riskFlags: [],
              }),
            },
          },
        ],
        finishReason: 'tool_calls',
      }),
    });

    expect(result.status).toBe('failed_tool_validation');
    expect(result.error).toContain('not allowed in investigate mode');
    expect(result.artifacts).toHaveLength(0);
    expect(listArtifacts(project.dbPath, result.runId)).toHaveLength(0);
  });

  test('fails visibly when the model requests an unregistered write tool', async () => {
    const project = await importTestNovel();

    const result = await runAgent({
      dbPath: project.dbPath,
      message: '直接把这一段改掉',
      mode: 'draft',
      providerId: 'deepseek',
      modelName: 'deepseek-v4-pro',
      reasoningEffort: 'high',
      thinkingMode: 'enabled',
      sendModelRequest: async () => ({
        content: '',
        reasoningContent: '用户想写入正文。',
        toolCalls: [
          {
            id: 'call-write-1',
            type: 'function',
            function: {
              name: 'write_manuscript_directly',
              arguments: JSON.stringify({ text: '新正文' }),
            },
          },
        ],
        finishReason: 'tool_calls',
      }),
    });

    expect(result.status).toBe('failed_tool_validation');
    expect(result.error).toContain('Agent tool is not registered');
    expect(listAgentSteps(project.dbPath, result.runId).at(-1)).toMatchObject({
      label: 'tool write_manuscript_directly',
      status: 'failed',
    });
  });

  test('lets the model recover when a read-only tool asks for a missing paragraph ID', async () => {
    const project = await importTestNovel();
    const requests: LlmTaskRequest[] = [];
    const responses: ParsedProviderResponse[] = [
      {
        content: '',
        reasoningContent: '先验证模型给出的段落 ID。',
        toolCalls: [
          {
            id: 'call-read-missing',
            type: 'function',
            function: {
              name: 'read_paragraphs',
              arguments: JSON.stringify({ paragraphIds: ['missing-paragraph'] }),
            },
          },
        ],
        finishReason: 'tool_calls',
      },
      {
        content: '没有读到该段落，需要用户重新添加引用。',
        reasoningContent: null,
        toolCalls: [],
        finishReason: 'stop',
      },
    ];

    const result = await runAgent({
      dbPath: project.dbPath,
      message: '检查这个引用',
      mode: 'investigate',
      providerId: 'deepseek',
      modelName: 'deepseek-v4-pro',
      reasoningEffort: 'high',
      thinkingMode: 'enabled',
      sendModelRequest: async (request) => {
        requests.push(request);
        const response = responses.shift();
        if (!response) {
          throw new Error('unexpected model call');
        }
        return response;
      },
    });

    expect(result.status).toBe('completed');
    expect(result.finalAnswer).toContain('重新添加引用');
    expect(requests).toHaveLength(2);
    expect(requests[1].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          toolCallId: 'call-read-missing',
          content: expect.stringContaining('missingParagraphIds'),
        }),
      ])
    );
  });

  test('stops for user approval after creating a proposal artifact', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const paragraph = getChapterForEditing(project.dbPath, chapter.id).paragraphs[0];

    const result = await runAgent({
      dbPath: project.dbPath,
      message: '给这一段做一个可确认的润色候选',
      mode: 'draft',
      providerId: 'deepseek',
      modelName: 'deepseek-v4-pro',
      reasoningEffort: 'high',
      thinkingMode: 'enabled',
      currentParagraphId: paragraph.id,
      sendModelRequest: async () => ({
        content: '',
        reasoningContent: '需要生成一个候选而不是直接写入。',
        toolCalls: [
          {
            id: 'call-polish-1',
            type: 'function',
            function: {
              name: 'propose_polish',
              arguments: JSON.stringify({
                paragraphId: paragraph.id,
                revisedText: `${paragraph.text}他把灯又拨暗了一分。`,
                editSummary: '补一处动作细节。',
                riskFlags: [],
              }),
            },
          },
        ],
        finishReason: 'tool_calls',
      }),
    });

    expect(result.status).toBe('blocked_needs_approval');
    expect(result.artifacts).toEqual([
      expect.objectContaining({
        artifactType: 'polish_revision',
        status: 'pending_approval',
      }),
    ]);
    expect(getChapterForEditing(project.dbPath, chapter.id).paragraphs[0].text).toBe(paragraph.text);
    expect(listArtifacts(project.dbPath, result.runId)).toEqual([
      expect.objectContaining({
        artifact_type: 'polish_revision',
        status: 'pending_approval',
      }),
    ]);
  });

  test('stops before creating more than three proposal artifacts', async () => {
    const project = await importTestNovel();

    const result = await runAgent({
      dbPath: project.dbPath,
      message: '批量生成很多记忆候选',
      mode: 'organize',
      providerId: 'deepseek',
      modelName: 'deepseek-v4-pro',
      reasoningEffort: 'high',
      thinkingMode: 'enabled',
      sendModelRequest: async () => ({
        content: '',
        reasoningContent: '需要限制候选数量。',
        toolCalls: Array.from({ length: 4 }, (_, index) => ({
          id: `call-memory-${index}`,
          type: 'function',
          function: {
            name: 'propose_memory_update',
            arguments: JSON.stringify({
              cardType: 'world_rule',
              title: `规则 ${index}`,
              content: `规则内容 ${index}`,
              sourceParagraphIds: [],
            }),
          },
        })),
        finishReason: 'tool_calls',
      }),
    });

    expect(result.status).toBe('failed_tool_validation');
    expect(result.error).toContain('proposal artifact limit');
    expect(listArtifacts(project.dbPath, result.runId)).toHaveLength(3);
  });
});
