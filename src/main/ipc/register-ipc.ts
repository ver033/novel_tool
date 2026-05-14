import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { AiTaskService, type AiChatGenerator, type AiTaskGenerator } from "../ai/ai-task-service";
import { OpenRouterChatGenerator } from "../ai/openrouter-chat-generator";
import { DefaultOpenRouterConnectionTester } from "../ai/openrouter-connection-tester";
import { OpenRouterModelCatalogClient } from "../ai/openrouter-client";
import { OpenRouterTaskGenerator } from "../ai/openrouter-task-generator";
import { SummaryService } from "../ai/summary-service";
import { SummaryWorker } from "../ai/summary-worker";
import { getTokenBudget } from "../ai/token-budget";
import { WritingOperationRunner } from "../ai/writing-operation-runner";
import { createChapterContentInvalidator } from "../chapter/chapter-content-invalidator";
import { ChapterService } from "../chapter/chapter-service";
import { createDatabase, resolveDatabasePath, type SqliteDatabase } from "../db/database";
import { runMigrations } from "../db/migrations";
import { AiChatRepository } from "../db/repositories/ai-chat-repo";
import { AiTaskRepository } from "../db/repositories/ai-task-repo";
import { ChapterRepository } from "../db/repositories/chapter-repo";
import { ImportJobRepository } from "../db/repositories/import-job-repo";
import { ProjectRepository } from "../db/repositories/project-repo";
import { RelationshipIndexRepository } from "../db/repositories/relationship-index-repo";
import { ScratchNoteRepository } from "../db/repositories/scratch-note-repo";
import { SettingsRepository } from "../db/repositories/settings-repo";
import { SummaryRepository } from "../db/repositories/summary-repo";
import { TxtExporter } from "../export/txt-exporter";
import { TxtImporter } from "../import/txt-importer";
import { ProjectService } from "../project/project-service";
import { RelationshipGraphAggregator } from "../relationships/relationship-graph-aggregator";
import { RelationshipIndexService } from "../relationships/relationship-index-service";
import { createElectronSecretStore } from "../settings/electron-secret-store";
import { SettingsService } from "../settings/settings-service";
import { ipcChannels } from "../shared/types";
import type { TaskType } from "../shared/types";
import {
  IpcPayloadValidationError,
  parseIpcPayload,
  summaryCancelCurrentJobInputSchema,
  summaryClearAndRetryChapterCacheInputSchema,
  summaryGetChapterCacheInputSchema,
  summaryIndexStatusInputSchema,
  summaryListCacheEntriesInputSchema,
  summaryRebuildProjectIndexInputSchema
} from "../shared/schemas";
import type { z } from "zod";
import { registerAiIpc } from "./ai-ipc";
import { registerChapterIpc } from "./chapter-ipc";
import { registerExportIpc } from "./export-ipc";
import { registerImportIpc } from "./import-ipc";
import { registerProjectIpc } from "./project-ipc";
import { registerRelationshipGraphIpc } from "./relationship-graph-ipc";
import { registerScratchIpc } from "./scratch-ipc";
import { registerSettingsIpc } from "./settings-ipc";

type RegisterIpcOptions = {
  readonly database?: SqliteDatabase;
  readonly userDataPath?: string;
};

const e2eGeneratedText: Record<TaskType, string> = {
  polish: "他缓缓勒住马缰，望向暮色中的山道。",
  expand: "他勒住马缰，马蹄在碎石上轻轻一顿，暮色从山口压下来。",
  proofread: "他勒住马缰。",
  continue: "远处的钟声忽然响起，他意识到追兵已经逼近。"
};

type ValidatedHandler<TSchema extends z.ZodType, TResult> = (
  input: z.output<TSchema>,
  event: IpcMainInvokeEvent
) => Promise<TResult> | TResult;
type DirectHandler<TResult> = (event: IpcMainInvokeEvent, payload: unknown) => Promise<TResult> | TResult;

let registered = false;
const SUMMARY_WORKER_INTERVAL_MS = 3_000;

function useE2eAiGenerators(): boolean {
  return process.env.NODE_ENV === "test" && process.env.NOVEL_TOOL_E2E_AI === "1";
}

function createE2eTaskGenerator(): AiTaskGenerator {
  return {
    async generateStream(task, handlers) {
      if (task.taskType === "proofread") {
        return {
          generatedText: "",
          changeSummary: "发现 1 个问题",
          proofreadIssues: [
            {
              code: "awkward_expression",
              severity: "medium",
              quote: task.inputText,
              locationHint: "E2E 选区",
              explanation: "E2E 校对建议",
              suggestion: e2eGeneratedText.proofread,
              evidence: [
                {
                  source: "target",
                  quote: task.inputText,
                  note: "E2E 目标文本"
                }
              ],
              canAutoApply: true,
              needsAuthorJudgment: false
            }
          ]
        };
      }

      handlers.onChunk?.({ requestId: "e2e_task_stream", content: e2eGeneratedText[task.taskType] });
      return {
        generatedText: e2eGeneratedText[task.taskType],
        changeSummary: `E2E ${task.taskType} candidate`
      };
    }
  };
}

function createE2eChatGenerator(): AiChatGenerator {
  return {
    async sendMessageStream(input, handlers) {
      const content = `E2E AI 回复：${input.message}`;
      handlers.onChunk?.({ requestId: input.requestId, content });
      return {
        role: "assistant",
        content,
        createdAt: new Date().toISOString()
      };
    }
  };
}

export function createValidatedIpcHandler<TSchema extends z.ZodType, TResult>(
  schema: TSchema,
  handler: ValidatedHandler<TSchema, TResult>
) {
  return async (event: IpcMainInvokeEvent, payload: unknown): Promise<TResult> => {
    try {
      return await handler(parseIpcPayload(schema, payload), event);
    } catch (error) {
      throw sanitizeIpcError(error);
    }
  };
}

export function createIpcHandler<TResult>(handler: DirectHandler<TResult>) {
  return async (event: IpcMainInvokeEvent, payload: unknown): Promise<TResult> => {
    try {
      return await handler(event, payload);
    } catch (error) {
      throw sanitizeIpcError(error);
    }
  };
}

export function sanitizeIpcError(error: unknown): Error {
  if (error instanceof IpcPayloadValidationError) {
    return new Error("IPC 请求参数无效。");
  }

  if (error instanceof Error) {
    return new Error(error.message);
  }

  return new Error(String(error));
}

export function registerIpcHandlers(options: RegisterIpcOptions = {}): SqliteDatabase {
  if (registered && !options.database) {
    throw new Error("IPC handlers are already registered");
  }

  const userDataPath = options.userDataPath ?? app.getPath("userData");
  const db = options.database ?? createDatabase(resolveDatabasePath(userDataPath));

  runMigrations(db);

  if (!registered) {
    const importJobRepo = new ImportJobRepository(db);
    const projectRepo = new ProjectRepository(db);
    const settingsRepo = new SettingsRepository(db);
    const settingsService = new SettingsService(settingsRepo, {
      secretStore: createElectronSecretStore(),
      connectionTester: new DefaultOpenRouterConnectionTester(),
      modelCatalog: new OpenRouterModelCatalogClient()
    });
    const projectService = new ProjectService(projectRepo, {
      projectFileDirectory: () => settingsService.getSettings().projectPath ?? path.join(userDataPath, "projects")
    });
    const resolveProjectDb = (projectId?: string): SqliteDatabase =>
      projectId ? projectService.getProjectDatabaseForProject(projectId) : projectService.getActiveProjectDatabase();
    const resolveChapterRepo = (projectId: string): ChapterRepository => new ChapterRepository(resolveProjectDb(projectId));
    const resolveSummaryRepo = (projectId: string): SummaryRepository => new SummaryRepository(resolveProjectDb(projectId));
    const resolveRelationshipIndexRepo = (projectId: string): RelationshipIndexRepository =>
      new RelationshipIndexRepository(resolveProjectDb(projectId));
    const writingOperationRunner = useE2eAiGenerators()
      ? undefined
      : WritingOperationRunner.fromSettings(settingsService, resolveChapterRepo, resolveSummaryRepo);
    const summaryServices = new Map<string, SummaryService>();
    const relationshipIndexServices = new Map<string, RelationshipIndexService>();
    const createSummaryService = (projectId: string): SummaryService => {
      const existing = summaryServices.get(projectId);
      if (existing) {
        return existing;
      }
      const service = new SummaryService(resolveSummaryRepo(projectId), resolveChapterRepo(projectId), {
        generator: new OpenRouterChatGenerator(settingsService),
        relationshipIndexRepo: resolveRelationshipIndexRepo(projectId)
      });
      summaryServices.set(projectId, service);
      return service;
    };
    const createRelationshipIndexService = (projectId: string): RelationshipIndexService => {
      const existing = relationshipIndexServices.get(projectId);
      if (existing) {
        return existing;
      }
      const service = new RelationshipIndexService(resolveRelationshipIndexRepo(projectId), resolveChapterRepo(projectId));
      relationshipIndexServices.set(projectId, service);
      return service;
    };
    const chapterService = new ChapterService((projectId) => new ChapterRepository(resolveProjectDb(projectId)), {
      summaryIndexInvalidator: createChapterContentInvalidator({
        summaryIndexInvalidator: {
          markChapterContentChanged(input) {
            createSummaryService(input.projectId).markChapterContentChanged(input);
          }
        },
        relationshipIndexInvalidator: {
          markChapterContentChanged(input) {
            createRelationshipIndexService(input.projectId).markChapterContentChanged(input);
          }
        }
      })
    });
    const aiTaskService = new AiTaskService(
      (projectId) => new AiTaskRepository(resolveProjectDb(projectId)),
      useE2eAiGenerators()
        ? createE2eTaskGenerator()
        : new OpenRouterTaskGenerator(settingsService, resolveChapterRepo, resolveSummaryRepo),
      useE2eAiGenerators() ? createE2eChatGenerator() : new OpenRouterChatGenerator(settingsService),
      (projectId) => new AiChatRepository(resolveProjectDb(projectId)),
      (projectId) => new ScratchNoteRepository(resolveProjectDb(projectId)),
      resolveChapterRepo,
      undefined,
      async () => getTokenBudget("chat", useE2eAiGenerators() ? null : (await settingsService.getOpenRouterConfigWithModelMetadata()).contextLength),
      writingOperationRunner,
      (projectId) => new SummaryRepository(resolveProjectDb(projectId))
    );
    const getSummaryIndexPausedReason = () => {
      if (aiTaskService.hasActiveStreams()) {
        return "foreground_ai_active" as const;
      }
      try {
        const aiProvider = settingsService.getSettings().aiProvider;
        if (!aiProvider?.apiKeyConfigured || !aiProvider.modelName) {
          return "ai_not_configured" as const;
        }
      } catch {
        return "ai_not_configured" as const;
      }
      return null;
    };
    const txtImporter = new TxtImporter(importJobRepo, projectRepo, projectService);
    const txtExporter = new TxtExporter(resolveChapterRepo);
    const recoveredSummaryJobProjects = new Set<string>();
    let activeSummaryWorker:
      | {
          readonly projectId: string;
          readonly controller: AbortController;
        }
      | null = null;
    const summaryWorkerInterval = setInterval(() => {
      const currentProject = projectService.getRuntimeActiveProject();
      if (!currentProject?.rootPath) {
        return;
      }
      if (activeSummaryWorker) {
        return;
      }
      const now = new Date().toISOString();
      const projectDb = resolveProjectDb(currentProject.id);
      const summaryRepo = new SummaryRepository(projectDb);
      if (!summaryRepo.getBackgroundIndexEnabled(currentProject.id)) {
        return;
      }
      if (!recoveredSummaryJobProjects.has(currentProject.id)) {
        summaryRepo.resetRunningJobs(currentProject.id, now);
        recoveredSummaryJobProjects.add(currentProject.id);
      }
      const summaryService = createSummaryService(currentProject.id);
      summaryService.enqueueEligibleStaleChapterSummaries(currentProject.id, now);
      const hasRunnableSummaryJob = Boolean(summaryRepo.peekNextSummaryJob(currentProject.id, now));
      if (hasRunnableSummaryJob) {
        const worker = new SummaryWorker({
          summaryRepo,
          summaryService,
          isForegroundAiActive: () => aiTaskService.hasActiveStreams(),
          ensureAiConfigured: async () => {
            await settingsService.getOpenRouterConfigWithModelMetadata();
          }
        });
        const controller = new AbortController();
        activeSummaryWorker = {
          projectId: currentProject.id,
          controller
        };
        worker
          .runOnce(currentProject.id, now, { signal: controller.signal })
          .catch((error: unknown) => {
            console.error("Summary worker failed", error);
          })
          .finally(() => {
            if (activeSummaryWorker?.controller === controller) {
              activeSummaryWorker = null;
            }
        });
        return;
      }
      summaryService.materializeEligibleRelationshipIndexes(currentProject.id, now);

    }, SUMMARY_WORKER_INTERVAL_MS);
    summaryWorkerInterval.unref?.();

    ipcMain.handle(
      ipcChannels.system.getDatabaseStatus,
      createIpcHandler(() => ({
        ready: true
      }))
    );
    registerProjectIpc(projectService);
    registerChapterIpc(chapterService);
    registerAiIpc(aiTaskService);
    registerRelationshipGraphIpc((projectId) => ({
      getGraph(input) {
        return new RelationshipGraphAggregator(resolveRelationshipIndexRepo(projectId)).getGraph(input);
      },
      getStatus(input) {
        return createRelationshipIndexService(projectId).getRelationshipIndexStatus(input.projectId, new Date().toISOString());
      },
      rebuild(input) {
        const now = new Date().toISOString();
        createSummaryService(projectId).rebuildProjectIndex(input.projectId, now, {
          force: input.force,
          pausedReason: getSummaryIndexPausedReason()
        });
        createSummaryService(projectId).materializeEligibleRelationshipIndexes(input.projectId, now);
        return createRelationshipIndexService(projectId).getRelationshipIndexStatus(input.projectId, now);
      }
    }));
    ipcMain.handle(
      ipcChannels.summary.getIndexStatus,
      createValidatedIpcHandler(summaryIndexStatusInputSchema, (input) =>
        createSummaryService(input.projectId).getIndexStatus(input.projectId, new Date().toISOString(), {
          pausedReason: getSummaryIndexPausedReason()
        })
      )
    );
    ipcMain.handle(
      ipcChannels.summary.rebuildProjectIndex,
      createValidatedIpcHandler(summaryRebuildProjectIndexInputSchema, (input) =>
        createSummaryService(input.projectId).rebuildProjectIndex(input.projectId, new Date().toISOString(), {
          force: input.force,
          pausedReason: getSummaryIndexPausedReason()
        })
      )
    );
    ipcMain.handle(
      ipcChannels.summary.listCacheEntries,
      createValidatedIpcHandler(summaryListCacheEntriesInputSchema, (input) =>
        createSummaryService(input.projectId).listChapterCacheEntries(input.projectId, new Date().toISOString())
      )
    );
    ipcMain.handle(
      ipcChannels.summary.getChapterCache,
      createValidatedIpcHandler(summaryGetChapterCacheInputSchema, (input) =>
        createSummaryService(input.projectId).getChapterCacheDetail(input.projectId, input.chapterId)
      )
    );
    ipcMain.handle(
      ipcChannels.summary.clearAndRetryChapterCache,
      createValidatedIpcHandler(summaryClearAndRetryChapterCacheInputSchema, (input) =>
        createSummaryService(input.projectId).clearAndRetryChapterCache(input.projectId, input.chapterId, new Date().toISOString(), {
          pausedReason: getSummaryIndexPausedReason()
        })
      )
    );
    ipcMain.handle(
      ipcChannels.summary.cancelCurrentJob,
      createValidatedIpcHandler(summaryCancelCurrentJobInputSchema, (input) => {
        const now = new Date().toISOString();
        if (activeSummaryWorker?.projectId === input.projectId) {
          activeSummaryWorker.controller.abort();
        }
        return createSummaryService(input.projectId).setBackgroundIndexEnabled(input.projectId, false, now, {
          cancelQueuedAndRunning: true,
          pausedReason: getSummaryIndexPausedReason()
        });
      })
    );
    registerScratchIpc((projectId) => new ScratchNoteRepository(resolveProjectDb(projectId)));
    registerImportIpc(txtImporter);
    registerExportIpc(txtExporter);
    registerSettingsIpc(settingsService);
    registered = true;
  }

  return db;
}
