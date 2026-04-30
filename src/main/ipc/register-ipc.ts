import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { AiTaskService, type AiChatGenerator, type AiTaskGenerator } from "../ai/ai-task-service";
import { OpenRouterChatGenerator } from "../ai/openrouter-chat-generator";
import { DefaultOpenRouterConnectionTester } from "../ai/openrouter-connection-tester";
import { OpenRouterModelCatalogClient } from "../ai/openrouter-client";
import { OpenRouterTaskGenerator } from "../ai/openrouter-task-generator";
import { getTokenBudget } from "../ai/token-budget";
import { WritingOperationRunner } from "../ai/writing-operation-runner";
import { ChapterService } from "../chapter/chapter-service";
import { createDatabase, resolveDatabasePath, type SqliteDatabase } from "../db/database";
import { runMigrations } from "../db/migrations";
import { AiChatRepository } from "../db/repositories/ai-chat-repo";
import { AiTaskRepository } from "../db/repositories/ai-task-repo";
import { ChapterRepository } from "../db/repositories/chapter-repo";
import { ImportJobRepository } from "../db/repositories/import-job-repo";
import { ProjectRepository } from "../db/repositories/project-repo";
import { ScratchNoteRepository } from "../db/repositories/scratch-note-repo";
import { SettingsRepository } from "../db/repositories/settings-repo";
import { TxtExporter } from "../export/txt-exporter";
import { TxtImporter } from "../import/txt-importer";
import { ProjectService } from "../project/project-service";
import { createElectronSecretStore } from "../settings/electron-secret-store";
import { SettingsService } from "../settings/settings-service";
import { ipcChannels } from "../shared/types";
import type { TaskType } from "../shared/types";
import { IpcPayloadValidationError, parseIpcPayload } from "../shared/schemas";
import type { z } from "zod";
import { registerAiIpc } from "./ai-ipc";
import { registerChapterIpc } from "./chapter-ipc";
import { registerExportIpc } from "./export-ipc";
import { registerImportIpc } from "./import-ipc";
import { registerProjectIpc } from "./project-ipc";
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

let registered = false;

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
              type: "表达不顺",
              quote: task.inputText,
              suggestion: e2eGeneratedText.proofread,
              reason: "E2E 校对建议"
            }
          ]
        };
      }

      handlers.onChunk?.({ requestId: "e2e_task_stream", content: e2eGeneratedText[task.taskType] });
      return {
        generatedText: e2eGeneratedText[task.taskType],
        changeSummary: `E2E ${task.taskType} candidate`
      };
    },
    async generate(task) {
      if (task.taskType === "proofread") {
        return {
          generatedText: "",
          changeSummary: "发现 1 个问题",
          proofreadIssues: [
            {
              type: "表达不顺",
              quote: task.inputText,
              suggestion: e2eGeneratedText.proofread,
              reason: "E2E 校对建议"
            }
          ]
        };
      }

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
    },
    async sendMessage(input) {
      return {
        role: "assistant",
        content: `E2E AI 回复：${input.message}`,
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
    const writingOperationRunner = useE2eAiGenerators() ? undefined : WritingOperationRunner.fromSettings(settingsService, resolveChapterRepo);
    const chapterService = new ChapterService((projectId) => new ChapterRepository(resolveProjectDb(projectId)));
    const aiTaskService = new AiTaskService(
      (projectId) => new AiTaskRepository(resolveProjectDb(projectId)),
      useE2eAiGenerators()
        ? createE2eTaskGenerator()
        : new OpenRouterTaskGenerator(settingsService, resolveChapterRepo),
      useE2eAiGenerators() ? createE2eChatGenerator() : new OpenRouterChatGenerator(settingsService),
      (projectId) => new AiChatRepository(resolveProjectDb(projectId)),
      (projectId) => new ScratchNoteRepository(resolveProjectDb(projectId)),
      resolveChapterRepo,
      undefined,
      async () => getTokenBudget("chat", useE2eAiGenerators() ? null : (await settingsService.getOpenRouterConfigWithModelMetadata()).contextLength),
      writingOperationRunner
    );
    const txtImporter = new TxtImporter(importJobRepo, projectRepo, projectService);
    const txtExporter = new TxtExporter(resolveChapterRepo);

    ipcMain.handle(ipcChannels.system.getDatabaseStatus, () => ({
      ready: true
    }));
    registerProjectIpc(projectService);
    registerChapterIpc(chapterService);
    registerAiIpc(aiTaskService);
    registerScratchIpc((projectId) => new ScratchNoteRepository(resolveProjectDb(projectId)));
    registerImportIpc(txtImporter);
    registerExportIpc(txtExporter);
    registerSettingsIpc(settingsService);
    registered = true;
  }

  return db;
}
