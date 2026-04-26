import { ipcMain, safeStorage, app, dialog } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';

import { validateIpcRequest, validateIpcResponse, type IpcChannel } from '../../shared/ipc-contracts';
import { applyAgentArtifact, rejectAgentArtifact } from '../agent/agent-artifact-service';
import { listAgentRunSteps, runAgent } from '../agent/agent-runner';
import { buildAiTaskPreflight } from '../ai/ai-task-preflight';
import {
  acceptExpansionRevisionCandidate,
  buildExpansionPromptMessages,
  createExpansionRevisionCandidate,
  parseExpansionStructuredOutput,
  rejectExpansionRevisionCandidate,
} from '../ai/expansion-service';
import {
  acceptPolishRevisionCandidate,
  buildPolishPromptMessages,
  createPolishRevisionCandidate,
  parsePolishStructuredOutput,
  rejectPolishRevisionCandidate,
} from '../ai/polish-service';
import { analyzeProjectCanon, importMarkdownCanon, listMarkdownCanon } from '../canon/canon-service';
import { runFactContinuityCheck } from '../continuity/continuity-service';
import { previewExport, runExport } from '../exporters/export-service';
import { createEpubImportService } from '../importers/epub/epub-import-service';
import { createTxtImportService } from '../importers/txt/txt-import-service';
import { createJobQueue } from '../jobs/job-queue';
import { defaultModelForProvider, sendProviderChatCompletion } from '../llm/provider-adapters';
import { listMemoryCards, updateMemoryCard } from '../memory/memory-service';
import {
  getChapterForEditing,
  listChaptersForProject,
  listRevisions,
  restoreRevision,
  updateParagraphText,
} from '../manuscript/manuscript-service';
import { readProjectConfig, writeProjectConfig } from '../projects/project-config';
import {
  createAndSetCurrentProject,
  getCurrentProject,
  openAndSetCurrentProject,
  requireCurrentProject,
} from '../projects/project-runtime';
import { listIssues, runRuleBasedProofread, updateIssueStatus } from '../proofread/proofread-service';
import { getParagraphReferences, searchParagraphs, updateReferenceBasketIds } from '../search/search-service';
import {
  buildLlmProofreadPromptMessages,
  parseLlmProofreadStructuredOutput,
  persistLlmProofreadIssues,
} from '../proofread/llm-proofread-service';
import { buildProviderStatus, type ProviderConnectionState } from '../llm/provider-status';
import { analyzeTimeline, queryTimeline } from '../timeline/timeline-service';

type ProviderId = 'deepseek' | 'openrouter';

interface ProviderSettingsFile {
  activeProvider: ProviderId | null;
  encryptedKeys: Partial<Record<ProviderId, string>>;
  connections: Partial<Record<ProviderId, ProviderConnectionState>>;
}

const providerSettingsFileName = 'provider-settings.json';
const providerSettingsSchema = z.object({
  activeProvider: z.enum(['deepseek', 'openrouter']).nullable().default(null),
  encryptedKeys: z
    .object({
      deepseek: z.string().optional(),
      openrouter: z.string().optional(),
    })
    .default({}),
  connections: z
    .object({
      deepseek: z
        .object({
          status: z.enum(['not_configured', 'configured_untested', 'connected', 'failed']),
          model: z.string().min(1).nullable(),
          testedAt: z.string().min(1).nullable(),
          error: z.string().nullable(),
        })
        .optional(),
      openrouter: z
        .object({
          status: z.enum(['not_configured', 'configured_untested', 'connected', 'failed']),
          model: z.string().min(1).nullable(),
          testedAt: z.string().min(1).nullable(),
          error: z.string().nullable(),
        })
        .optional(),
    })
    .default({}),
});

function recordParagraphIndexJob(dbPath: string, inputSummary: Record<string, unknown>): void {
  const db = new Database(dbPath);
  try {
    const queue = createJobQueue(db);
    const job = queue.enqueue({
      type: 'index_fts',
      inputSummary,
      cancellable: true,
    });
    queue.complete(job.id, inputSummary);
  } finally {
    db.close();
  }
}

function updateAiTaskStatus(
  dbPath: string,
  taskId: string,
  input: { status: string; output?: unknown; error?: string | null; startedAt?: string | null; finishedAt?: string | null }
): void {
  const db = new Database(dbPath);
  try {
    db.prepare(
      `UPDATE ai_tasks
       SET status = ?,
           output_json = COALESCE(?, output_json),
           error = ?,
           started_at = COALESCE(?, started_at),
           finished_at = COALESCE(?, finished_at)
       WHERE id = ?`
    ).run(
      input.status,
      input.output === undefined ? null : JSON.stringify(input.output),
      input.error ?? null,
      input.startedAt ?? null,
      input.finishedAt ?? null,
      taskId
    );
  } finally {
    db.close();
  }
}

function inputString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function inputStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
}

function parseAiTaskStructuredOutput(task: string, content: string):
  | { kind: 'polish'; output: ReturnType<typeof parsePolishStructuredOutput> }
  | { kind: 'expand'; output: ReturnType<typeof parseExpansionStructuredOutput> } {
  if (task === 'polish') {
    return { kind: 'polish', output: parsePolishStructuredOutput(content) };
  }
  if (task === 'expand') {
    return { kind: 'expand', output: parseExpansionStructuredOutput(content) };
  }
  throw new Error(`${task} 暂不支持生成候选`);
}

function readCandidateScopeType(dbPath: string, revisionId: string): string {
  const db = new Database(dbPath);
  try {
    const row = db.prepare('SELECT scope_type FROM revisions WHERE id = ? AND status = ?').get(revisionId, 'candidate') as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      throw new Error('待确认候选不存在');
    }
    return String(row.scope_type);
  } finally {
    db.close();
  }
}

function providerSettingsPath(): string {
  return path.join(app.getPath('userData'), providerSettingsFileName);
}

async function readProviderSettings(): Promise<ProviderSettingsFile> {
  try {
    const raw = await readFile(providerSettingsPath(), 'utf8');
    return providerSettingsSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { activeProvider: null, encryptedKeys: {}, connections: {} };
    }
    throw error;
  }
}

async function writeProviderSettings(settings: ProviderSettingsFile): Promise<void> {
  await mkdir(path.dirname(providerSettingsPath()), { recursive: true });
  await writeFile(providerSettingsPath(), `${JSON.stringify(providerSettingsSchema.parse(settings), null, 2)}\n`, 'utf8');
}

function isBasicTextStorageBackend(): boolean {
  return (
    process.platform === 'linux' &&
    typeof safeStorage.getSelectedStorageBackend === 'function' &&
    safeStorage.getSelectedStorageBackend() === 'basic_text'
  );
}

function assertSafeStorageAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全存储不可用，API Key 未保存');
  }
  if (isBasicTextStorageBackend()) {
    throw new Error('当前 Linux 安全存储后端是 basic_text，拒绝以明文方式保存 API Key');
  }
}

function decryptProviderKey(settings: ProviderSettingsFile, providerId: ProviderId): string {
  const encrypted = settings.encryptedKeys[providerId];
  if (!encrypted) {
    throw new Error(`请先保存 ${providerId === 'deepseek' ? 'DeepSeek' : 'OpenRouter'} API Key`);
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全存储不可用，无法读取 API Key');
  }
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
}

async function buildConnectedModelRequest(
  projectPath: string,
  task: 'memory' | 'continuity',
  actionLabel: string
) {
  const settings = await readProviderSettings();
  const providerId = settings.activeProvider;
  const status = buildProviderStatus(settings);
  const activeConnection = status.activeConnection;
  if (!providerId || !activeConnection || activeConnection.status !== 'connected') {
    throw new Error(`请先在模型设置中连接当前供应商，再运行${actionLabel}`);
  }
  const config = await readProjectConfig(projectPath);
  const taskModel = config.taskModelProfile[task];
  const modelName = taskModel.modelNameOverride?.trim() || defaultModelForProvider(providerId, taskModel.modelRole);
  const apiKey = decryptProviderKey(settings, providerId);
  return {
    model: modelName,
    reasoningEffort: taskModel.reasoningEffort,
    thinkingMode: taskModel.thinkingMode,
    sendModelRequest: (request: Parameters<typeof sendProviderChatCompletion>[1]) =>
      sendProviderChatCompletion(providerId, request, apiKey, 240_000),
  };
}

function handle<C extends IpcChannel>(
  channel: C,
  handler: (payload: ReturnType<typeof validateIpcRequest<C>>) => Promise<unknown> | unknown
): void {
  ipcMain.handle(channel, async (_event, rawPayload) => {
    const payload = validateIpcRequest(channel, rawPayload);
    const result = await handler(payload);
    return validateIpcResponse(channel, result);
  });
}

export function registerIpcHandlers(): void {
  const txtImportService = createTxtImportService();
  const epubImportService = createEpubImportService();

  handle('project.create', (payload) => createAndSetCurrentProject(payload));
  handle('project.open', (payload) => openAndSetCurrentProject(payload.projectPath));
  handle('project.pickExisting', async () => {
    const result = await dialog.showOpenDialog({
      title: '打开已有小说项目',
      properties: ['openDirectory', 'treatPackageAsDirectory'],
      filters: [{ name: 'Novel Tool 项目', extensions: ['novelproj'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    const projectPath = result.filePaths[0];
    if (path.extname(projectPath) !== '.novelproj') {
      throw new Error('请选择 .novelproj 项目文件夹');
    }
    return {
      canceled: false,
      ...(await openAndSetCurrentProject(projectPath)),
    };
  });
  handle('project.getCurrent', () => getCurrentProject());

  handle('config.get', () => {
    const project = requireCurrentProject();
    return readProjectConfig(project.projectPath);
  });

  handle('config.updateProjectInstructions', async (payload) => {
    const project = requireCurrentProject();
    const config = await readProjectConfig(project.projectPath);
    const next = { ...config, customInstructions: payload.customInstructions };
    await writeProjectConfig(project.projectPath, next);
    return next;
  });

  handle('config.updateTaskModelProfile', async (payload) => {
    const project = requireCurrentProject();
    const config = await readProjectConfig(project.projectPath);
    const next = {
      ...config,
      taskModelProfile: {
        ...config.taskModelProfile,
        [payload.task]: payload.setting,
      },
    };
    await writeProjectConfig(project.projectPath, next);
    return next.taskModelProfile;
  });

  handle('providers.status', async () => {
    const settings = await readProviderSettings();
    return buildProviderStatus(settings);
  });

  handle('providers.setActive', async (payload) => {
    const settings = await readProviderSettings();
    const next = { ...settings, activeProvider: payload.providerId };
    await writeProviderSettings(next);
    return { activeProvider: next.activeProvider };
  });

  handle('providers.deleteKey', async (payload) => {
    const settings = await readProviderSettings();
    const { [payload.providerId]: _deletedKey, ...encryptedKeys } = settings.encryptedKeys;
    const { [payload.providerId]: _deletedConnection, ...connections } = settings.connections;
    const activeProvider = settings.activeProvider === payload.providerId ? null : settings.activeProvider;
    await writeProviderSettings({
      activeProvider,
      encryptedKeys,
      connections,
    });
    return {
      providerId: payload.providerId,
      deleted: true,
      activeProvider,
    };
  });

  handle('providers.saveKey', async (payload) => {
    assertSafeStorageAvailable();

    const settings = await readProviderSettings();
    const encrypted = safeStorage.encryptString(payload.apiKey).toString('base64');
    const next = {
      activeProvider: settings.activeProvider ?? payload.providerId,
      encryptedKeys: {
        ...settings.encryptedKeys,
        [payload.providerId]: encrypted,
      },
      connections: {
        ...settings.connections,
        [payload.providerId]: {
          status: 'configured_untested' as const,
          model: null,
          testedAt: null,
          error: null,
        },
      },
    };
    await writeProviderSettings(next);
    return { providerId: payload.providerId, configured: true, activeProvider: next.activeProvider };
  });

  handle('chapters.list', () => {
    const project = requireCurrentProject();
    return listChaptersForProject(project.dbPath);
  });
  handle('chapters.get', (payload) => {
    const project = requireCurrentProject();
    return getChapterForEditing(project.dbPath, payload.chapterId);
  });
  handle('paragraphs.update', (payload) => {
    const project = requireCurrentProject();
    const result = updateParagraphText(project.dbPath, payload);
    if (result.changed) {
      recordParagraphIndexJob(project.dbPath, {
        reason: 'paragraph_update',
        paragraphId: result.paragraphId,
        version: result.version,
      });
    }
    return result;
  });
  handle('revisions.list', (payload) => {
    const project = requireCurrentProject();
    return listRevisions(project.dbPath, payload);
  });
  handle('revisions.restore', (payload) => {
    const project = requireCurrentProject();
    const result = restoreRevision(project.dbPath, payload);
    if (result.changed) {
      recordParagraphIndexJob(project.dbPath, {
        reason: 'revision_restore',
        paragraphId: result.paragraphId,
        version: result.version,
      });
    }
    return result;
  });
  handle('revisions.acceptCandidate', (payload) => {
    const project = requireCurrentProject();
    const scopeType = readCandidateScopeType(project.dbPath, payload.revisionId);
    if (scopeType === 'insertion_after_paragraph') {
      const result = acceptExpansionRevisionCandidate(project.dbPath, payload);
      recordParagraphIndexJob(project.dbPath, {
        reason: 'ai_expand_accept',
        anchorParagraphId: result.anchorParagraphId,
        insertedParagraphIds: result.insertedParagraphIds,
      });
      return result;
    }
    const result = acceptPolishRevisionCandidate(project.dbPath, payload);
    if (result.changed) {
      recordParagraphIndexJob(project.dbPath, {
        reason: 'ai_polish_accept',
        paragraphId: result.paragraphId,
        version: result.version,
      });
    }
    return result;
  });
  handle('revisions.rejectCandidate', (payload) => {
    const project = requireCurrentProject();
    const scopeType = readCandidateScopeType(project.dbPath, payload.revisionId);
    if (scopeType === 'insertion_after_paragraph') {
      return rejectExpansionRevisionCandidate(project.dbPath, payload);
    }
    return rejectPolishRevisionCandidate(project.dbPath, payload);
  });
  handle('imports.previewTxt', (payload) => txtImportService.previewTxt(payload.filePath));
  handle('imports.commitTxt', async (payload) => {
    const result = await txtImportService.commitTxt(payload);
    await openAndSetCurrentProject(result.projectPath);
    return result;
  });
  handle('imports.pickManuscript', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 TXT 或 EPUB 小说文件',
      properties: ['openFile'],
      filters: [
        { name: '小说文件', extensions: ['txt', 'epub'] },
        { name: 'TXT', extensions: ['txt'] },
        { name: 'EPUB', extensions: ['epub'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    const filePath = result.filePaths[0];
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.txt') {
      return { canceled: false, filePath, fileType: 'txt' };
    }
    if (extension === '.epub') {
      return { canceled: false, filePath, fileType: 'epub' };
    }
    throw new Error('只支持 TXT 和 EPUB 文件');
  });
  handle('imports.previewEpub', (payload) => epubImportService.previewEpub(payload.filePath));
  handle('imports.commitEpub', async (payload) => {
    const result = await epubImportService.commitEpub(payload);
    await openAndSetCurrentProject(result.projectPath);
    return result;
  });
  handle('search.query', (payload) => {
    const project = requireCurrentProject();
    return searchParagraphs(project.dbPath, payload);
  });
  handle('search.addToContext', async (payload) => {
    const project = requireCurrentProject();
    if (payload.mode === 'add' && payload.paragraphIds.length === 0) {
      throw new Error('请先选择要加入引用的段落');
    }
    const config = await readProjectConfig(project.projectPath);
    const paragraphIds = updateReferenceBasketIds(
      config.contextReferences.paragraphIds,
      payload.paragraphIds,
      payload.mode
    );
    await writeProjectConfig(project.projectPath, {
      ...config,
      contextReferences: { paragraphIds },
    });
    return getParagraphReferences(project.dbPath, paragraphIds);
  });
  handle('providers.testConnection', async (payload) => {
    const settings = await readProviderSettings();
    const apiKey = decryptProviderKey(settings, payload.providerId);
    const model = payload.model ?? defaultModelForProvider(payload.providerId, 'flash');
    try {
      const result = await sendProviderChatCompletion(
        payload.providerId,
        {
          model,
          messages: [{ role: 'user', content: '请只回复 OK，用于连接测试。' }],
          reasoningEffort: 'high',
          thinkingMode: 'disabled',
          stream: false,
        },
        apiKey,
        30_000
      );
      await writeProviderSettings({
        ...settings,
        connections: {
          ...settings.connections,
          [payload.providerId]: {
            status: 'connected',
            model,
            testedAt: new Date().toISOString(),
            error: null,
          },
        },
      });
      return {
        providerId: payload.providerId,
        model,
        ok: true,
        contentPreview: result.content.slice(0, 120),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '模型连接测试失败';
      await writeProviderSettings({
        ...settings,
        connections: {
          ...settings.connections,
          [payload.providerId]: {
            status: 'failed',
            model,
            testedAt: new Date().toISOString(),
            error: message,
          },
        },
      });
      throw error;
    }
  });
	  handle('ai.runTask', async (payload) => {
    const project = requireCurrentProject();
    const settings = await readProviderSettings();
    const config = await readProjectConfig(project.projectPath);
    const preflight = buildAiTaskPreflight(project.dbPath, {
      task: payload.task,
      activeProvider: settings.activeProvider,
      taskSetting: config.taskModelProfile[payload.task],
      contextReferenceParagraphIds: config.contextReferences.paragraphIds,
      scope: payload.scope,
      input: payload.input,
    });
    if (payload.input.execute !== true) {
      return preflight;
    }
	    if (payload.task !== 'polish' && payload.task !== 'expand' && payload.task !== 'proofread' && payload.task !== 'continuity') {
	      throw new Error(`${payload.task} 的模型执行会在后续阶段接入；当前阶段不会伪装成功。`);
	    }

    const startedAt = new Date().toISOString();
    updateAiTaskStatus(project.dbPath, preflight.taskId, {
      status: 'running',
      startedAt,
	    });
	    try {
	      const anchorParagraphId = inputString(payload.scope.anchorParagraphId);
      const paragraphIds = [
        ...(anchorParagraphId ? [anchorParagraphId] : []),
        ...inputStringArray(payload.scope.referenceParagraphIds),
        ...config.contextReferences.paragraphIds,
      ];
      const uniqueParagraphIds = [...new Set(paragraphIds)];
      if (payload.task === 'continuity') {
        const continuityResult = runFactContinuityCheck(project.dbPath, {
          paragraphIds: uniqueParagraphIds,
          sourceTaskId: preflight.taskId,
        });
        const finishedAt = new Date().toISOString();
        updateAiTaskStatus(project.dbPath, preflight.taskId, {
          status: 'issues_ready',
          output: {
            checkedFactCount: continuityResult.checkedFactCount,
            issueCount: continuityResult.issues.length,
            issueIds: continuityResult.issues.map((issue) => issue.id),
            mode: 'structured_fact_rules',
          },
          error: null,
          finishedAt,
        });
        return {
          ...preflight,
          status: 'issues_ready' as const,
          issues: continuityResult.issues,
          checkedParagraphCount: continuityResult.checkedFactCount,
        };
      }
      if (payload.task === 'proofread') {
        const connection = buildProviderStatus(settings).providers[preflight.providerId].connection;
        if (connection.status !== 'connected') {
          throw new Error('请先在模型设置里测试并连接当前供应商，再运行完整校对');
        }
        if (uniqueParagraphIds.length === 0) {
          throw new Error('完整校对需要先选择正文段落、选区或引用范围');
        }
        const apiKey = decryptProviderKey(settings, preflight.providerId);
        const providerResponse = await sendProviderChatCompletion(
          preflight.providerId,
          {
            model: preflight.modelName,
            messages: buildLlmProofreadPromptMessages(preflight.context),
            reasoningEffort: preflight.reasoning.reasoningEffort,
            thinkingMode: preflight.reasoning.thinkingMode,
            stream: false,
            responseFormat: 'json_object',
          },
          apiKey
        );
        const llmOutput = parseLlmProofreadStructuredOutput(providerResponse.content);
        const llmResult = persistLlmProofreadIssues(project.dbPath, {
          sourceTaskId: preflight.taskId,
          structuredOutput: llmOutput,
        });
        const localResult = runRuleBasedProofread(project.dbPath, {
          paragraphIds: uniqueParagraphIds,
          sourceTaskId: preflight.taskId,
        });
        const issues = [...localResult.issues, ...llmResult.issues];
	        const finishedAt = new Date().toISOString();
	        updateAiTaskStatus(project.dbPath, preflight.taskId, {
	          status: 'issues_ready',
	          output: {
	            checkedParagraphCount: localResult.checkedParagraphCount,
	            issueCount: issues.length,
	            issueIds: issues.map((issue) => issue.id),
	            mode: 'llm_with_local_rules',
            providerResponse: {
              id: providerResponse.id,
              finishReason: providerResponse.finishReason,
              usage: providerResponse.usage,
              hasReasoningContent: Boolean(providerResponse.reasoningContent),
              toolCallCount: providerResponse.toolCalls.length,
            },
	          },
	          error: null,
	          finishedAt,
	        });
	        return {
	          ...preflight,
	          status: 'issues_ready' as const,
	          issues,
	          checkedParagraphCount: localResult.checkedParagraphCount,
	        };
	      }
	      if (!anchorParagraphId) {
	        throw new Error(`${payload.task === 'polish' ? '润色' : '扩写'}任务需要先选择正文段落或选区`);
	      }
      const apiKey = decryptProviderKey(settings, preflight.providerId);
      const providerResponse = await sendProviderChatCompletion(
        preflight.providerId,
        {
          model: preflight.modelName,
          messages:
            payload.task === 'polish'
              ? buildPolishPromptMessages(preflight.context, {
                  strength:
                    payload.input.strength === 'medium' || payload.input.strength === 'heavy'
                      ? payload.input.strength
                      : 'light',
                  focus: inputString(payload.input.focus),
                  forbiddenChanges: inputString(payload.input.forbiddenChanges),
                })
              : buildExpansionPromptMessages(preflight.context, {
                  previousContext: inputString(payload.input.previousContext),
                  nextBeats: inputString(payload.input.nextBeats),
                  focusDetails: inputString(payload.input.focusDetails),
                  forbiddenChanges: inputString(payload.input.forbiddenChanges),
                  pov: inputString(payload.input.pov),
                  targetLength: inputString(payload.input.targetLength),
                  styleStrength: inputString(payload.input.styleStrength),
                }),
          reasoningEffort: preflight.reasoning.reasoningEffort,
          thinkingMode: preflight.reasoning.thinkingMode,
          stream: false,
          responseFormat: 'json_object',
        },
        apiKey
      );
      const structuredOutput = parseAiTaskStructuredOutput(payload.task, providerResponse.content);
      const candidate =
        structuredOutput.kind === 'polish'
          ? createPolishRevisionCandidate(project.dbPath, {
              paragraphId: anchorParagraphId,
              sourceTaskId: preflight.taskId,
              structuredOutput: structuredOutput.output,
            })
          : createExpansionRevisionCandidate(project.dbPath, {
              anchorParagraphId,
              sourceTaskId: preflight.taskId,
              structuredOutput: structuredOutput.output,
            });
      const finishedAt = new Date().toISOString();
      updateAiTaskStatus(project.dbPath, preflight.taskId, {
        status: 'candidate_ready',
        output: {
          providerResponse: {
            id: providerResponse.id,
            finishReason: providerResponse.finishReason,
            usage: providerResponse.usage,
            hasReasoningContent: Boolean(providerResponse.reasoningContent),
            toolCallCount: providerResponse.toolCalls.length,
          },
          structuredOutput: structuredOutput.output,
          candidate:
            candidate.kind === 'polish'
              ? {
                  revisionId: candidate.revisionId,
                  paragraphId: candidate.paragraphId,
                }
              : {
                  revisionId: candidate.revisionId,
                  anchorParagraphId: candidate.anchorParagraphId,
                  paragraphCount: candidate.paragraphs.length,
                },
        },
        error: null,
        finishedAt,
      });
      return {
        ...preflight,
        status: 'candidate_ready' as const,
        candidate,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : `${payload.task} 任务失败`;
      updateAiTaskStatus(project.dbPath, preflight.taskId, {
        status: 'error',
        error: message,
        finishedAt: new Date().toISOString(),
      });
      throw error;
    }
  });
	  handle('chat.send', async (payload) => {
	    const project = requireCurrentProject();
	    const settings = await readProviderSettings();
	    const providerId = settings.activeProvider;
	    const status = buildProviderStatus(settings);
	    const activeConnection = status.activeConnection;
	    if (!providerId || !activeConnection || activeConnection.status !== 'connected') {
	      throw new Error('请先在模型设置中连接当前供应商，再运行 Agent 对话');
	    }
	    const config = await readProjectConfig(project.projectPath);
	    const chatModel = config.taskModelProfile.chat;
	    const modelName = chatModel.modelNameOverride ?? defaultModelForProvider(providerId, chatModel.modelRole);
	    const apiKey = decryptProviderKey(settings, providerId);
	    const result = await runAgent({
	      dbPath: project.dbPath,
	      sessionId: payload.sessionId,
	      message: payload.message,
	      mode: payload.mode,
	      providerId,
	      modelName,
	      reasoningEffort: chatModel.reasoningEffort,
	      thinkingMode: chatModel.thinkingMode,
	      currentParagraphId: payload.currentParagraphId,
	      selectedParagraphIds: payload.selectedParagraphIds,
	      selectedText: payload.selectedText,
	      references: payload.references,
	      sendModelRequest: (request) => sendProviderChatCompletion(providerId, request, apiKey),
	    });
	    return {
	      ...result,
	      error: result.error ?? null,
	      steps: listAgentRunSteps(project.dbPath, result.runId),
	    };
	  });
  handle('agent.applyArtifact', (payload) => {
    const project = requireCurrentProject();
    const result = applyAgentArtifact(project.dbPath, payload);
    if (result.appliedType === 'polish_revision' && result.appliedResult && typeof result.appliedResult === 'object') {
      const applied = result.appliedResult as Record<string, unknown>;
      recordParagraphIndexJob(project.dbPath, {
        reason: 'agent_polish_artifact_accept',
        paragraphId: applied.paragraphId,
        version: applied.version,
      });
    }
    if (result.appliedType === 'expansion_draft' && result.appliedResult && typeof result.appliedResult === 'object') {
      const applied = result.appliedResult as Record<string, unknown>;
      recordParagraphIndexJob(project.dbPath, {
        reason: 'agent_expand_artifact_accept',
        anchorParagraphId: applied.anchorParagraphId,
        insertedParagraphIds: applied.insertedParagraphIds,
      });
    }
    return result;
  });
  handle('agent.rejectArtifact', (payload) => {
    const project = requireCurrentProject();
    return rejectAgentArtifact(project.dbPath, payload);
  });
	  handle('proofread.runRules', (payload) => {
	    const project = requireCurrentProject();
	    return runRuleBasedProofread(project.dbPath, {
	      paragraphIds: payload.paragraphIds,
	      sourceTaskId: undefined,
	    });
	  });
	  handle('issues.list', (payload) => {
	    const project = requireCurrentProject();
	    return { issues: listIssues(project.dbPath, payload) };
	  });
	  handle('issues.updateStatus', (payload) => {
	    const project = requireCurrentProject();
	    return updateIssueStatus(project.dbPath, payload);
	  });
  handle('memory.list', () => {
    const project = requireCurrentProject();
    return listMemoryCards(project.dbPath);
  });
  handle('memory.updateCard', (payload) => {
    const project = requireCurrentProject();
    return updateMemoryCard(project.dbPath, payload);
  });
  handle('canon.list', () => {
    const project = requireCurrentProject();
    return listMarkdownCanon(project.dbPath);
  });
  handle('canon.importMarkdown', (payload) => {
    const project = requireCurrentProject();
    return importMarkdownCanon({
      projectPath: project.projectPath,
      dbPath: project.dbPath,
      filePath: payload.filePath,
    });
  });
  handle('canon.analyzeProject', async () => {
    const project = requireCurrentProject();
    return analyzeProjectCanon({
      projectPath: project.projectPath,
      dbPath: project.dbPath,
      modelRequest: await buildConnectedModelRequest(project.projectPath, 'memory', '项目分析'),
    });
  });
  handle('timeline.query', (payload) => {
    const project = requireCurrentProject();
    return queryTimeline(project.dbPath, payload);
  });
  handle('timeline.analyze', async () => {
    const project = requireCurrentProject();
    return analyzeTimeline(project.dbPath, {
      modelRequest: await buildConnectedModelRequest(project.projectPath, 'memory', '时间线分析'),
    });
  });
  handle('exports.preview', (payload) => {
    const project = requireCurrentProject();
    return previewExport(project.dbPath, project.projectPath, payload);
  });
  handle('exports.run', (payload) => {
    const project = requireCurrentProject();
    return runExport(project.dbPath, project.projectPath, payload);
  });
  handle('jobs.subscribe', () => {
    const project = getCurrentProject();
    if (!project) {
      return { jobs: [] };
    }
    const db = new Database(project.dbPath);
    try {
      return { jobs: createJobQueue(db).listRecent(20) };
    } finally {
      db.close();
    }
  });
}
