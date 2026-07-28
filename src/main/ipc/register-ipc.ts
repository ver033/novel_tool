import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import {
  AiTaskService,
  type AiChatAgentGenerationInput,
  type AiChatGenerator,
  type AiChatMessageResult,
  type AiTaskGenerator
} from "../ai/ai-task-service";
import { OpenRouterChatGenerator } from "../ai/openrouter-chat-generator";
import { LegacyNovelAgentRuntime } from "../ai/agent-runtime/legacy-novel-agent-runtime";
import { PiNovelAgentRuntime } from "../ai/agent-runtime/pi-novel-agent-runtime";
import type { NovelAgentRuntimeHandlers } from "../ai/agent-runtime/novel-agent-runtime";
import { DefaultOpenRouterConnectionTester } from "../ai/openrouter-connection-tester";
import { OpenRouterModelCatalogClient } from "../ai/openrouter-client";
import { OpenRouterTaskGenerator } from "../ai/openrouter-task-generator";
import { SummaryService } from "../ai/summary-service";
import { SummaryWorker } from "../ai/summary-worker";
import { getTokenBudget } from "../ai/token-budget";
import { WritingOperationRunner } from "../ai/writing-operation-runner";
import {
  ChapterReviewService,
  createOpenRouterChapterReviewClient,
  type ChapterReviewClient
} from "../chapter-review/chapter-review-service";
import { createChapterContentInvalidator } from "../chapter/chapter-content-invalidator";
import { ChapterService } from "../chapter/chapter-service";
import { createDatabase, resolveDatabasePath, type SqliteDatabase } from "../db/database";
import { runMigrations } from "../db/migrations";
import { AiChatRepository } from "../db/repositories/ai-chat-repo";
import { AiTaskRepository } from "../db/repositories/ai-task-repo";
import { AuthorRelationshipRepository } from "../db/repositories/author-relationship-repo";
import { ChapterRepository } from "../db/repositories/chapter-repo";
import { ChapterReviewRepository } from "../db/repositories/chapter-review-repo";
import { ImportJobRepository } from "../db/repositories/import-job-repo";
import { OutlineRepository } from "../db/repositories/outline-repo";
import { ProjectRepository } from "../db/repositories/project-repo";
import { ScratchNoteRepository } from "../db/repositories/scratch-note-repo";
import { SettingsRepository } from "../db/repositories/settings-repo";
import { SummaryRepository } from "../db/repositories/summary-repo";
import { UsageAnalyticsRepository } from "../db/repositories/usage-analytics-repo";
import { WritingGoalRepository } from "../db/repositories/writing-goal-repo";
import { ShareableProjectExporter } from "../export/shareable-project-exporter";
import { ExternalBookSyncAutomationStore } from "../external-book-sync/book-automation-store";
import { ExternalBookSentChapterStore } from "../external-book-sync/book-send-history-store";
import { ExternalBookSourceStore } from "../external-book-sync/book-source-store";
import { EXTERNAL_BOOK_SYNC_CHECK_INTERVAL_MS } from "../external-book-sync/external-book-sync-config";
import { ExternalBookSyncService } from "../external-book-sync/external-book-sync-service";
import { TxtExporter } from "../export/txt-exporter";
import { TxtImporter } from "../import/txt-importer";
import { OutlineService } from "../outline/outline-service";
import { ProjectService } from "../project/project-service";
import { AuthorRelationshipGraphService } from "../relationships/author-relationship-graph";
import { SummaryRelationshipGraphAggregator } from "../relationships/relationship-graph-aggregator";
import { logMainError } from "../logger";
import { createElectronSecretStore } from "../settings/electron-secret-store";
import { SettingsService } from "../settings/settings-service";
import { ipcChannels } from "../shared/types";
import type { TaskType } from "../shared/types";
import { SettingsStartupLaunchPreferenceStore, StartupLaunchService } from "../startup/startup-launch-service";
import type { ProcessWatchdogRuntimeStatus } from "../startup/process-watchdog";
import { OpenRouterUsageAnalyticsReporter, UsageAnalyticsService, type UsageAnalyticsProjectContext } from "../usage/usage-analytics-service";
import { WritingGoalService } from "../writing-goals/writing-goal-service";
import {
  IpcPayloadValidationError,
  parseIpcPayload,
  summaryCancelCurrentJobInputSchema,
  summaryClearAndRetryArcCacheInputSchema,
  summaryClearAndRetryBookCacheInputSchema,
  summaryClearAndRetryChapterCacheInputSchema,
  summaryGetArcCacheInputSchema,
  summaryGetBookCacheInputSchema,
  summaryGetChapterCacheInputSchema,
  summaryIndexStatusInputSchema,
  summaryListCacheEntriesInputSchema,
  summaryRebuildProjectIndexInputSchema
} from "../shared/schemas";
import type { z } from "zod";
import { registerAiIpc } from "./ai-ipc";
import { registerAuthorRelationshipIpc } from "./author-relationship-ipc";
import { registerChapterIpc } from "./chapter-ipc";
import { registerChapterReviewIpc } from "./chapter-review-ipc";
import { registerExternalBookSyncIpc } from "./external-book-sync-ipc";
import { registerExportIpc } from "./export-ipc";
import { registerImportIpc } from "./import-ipc";
import { registerOutlineIpc } from "./outline-ipc";
import { registerProjectIpc } from "./project-ipc";
import { registerRelationshipGraphIpc } from "./relationship-graph-ipc";
import { registerScratchIpc } from "./scratch-ipc";
import { registerSettingsIpc } from "./settings-ipc";
import { registerUsageAnalyticsIpc } from "./usage-analytics-ipc";
import { registerWritingGoalIpc } from "./writing-goal-ipc";

type RegisterIpcOptions = {
  readonly database?: SqliteDatabase;
  readonly userDataPath?: string;
  readonly getProcessWatchdogStatus?: () => ProcessWatchdogRuntimeStatus;
};

const e2eGeneratedText: Record<TaskType, string> = {
  polish: "他缓缓勒住马缰，望向暮色中的山道。",
  expand: "他勒住马缰，马蹄在碎石上轻轻一顿，暮色从山口压下来。",
  proofread: "他勒住马缰。",
  continue: "远处的钟声忽然响起，他意识到追兵已经逼近。"
};

const e2eGeneratedTextJa: Record<TaskType, string> = {
  polish: "彼は静かに手を止め、雨の向こうに沈む港を見つめた。",
  expand: "彼は静かに手を止めた。軒を打つ雨音の向こうで、港の灯がひとつずつ滲んでいく。",
  proofread: "彼は静かに手を止めた。",
  continue: "遠くで汽笛が鳴り、彼は約束の時刻が近いことを悟った。"
};

function e2eTextFor(taskType: TaskType, sourceText: string): string {
  return /[\u3040-\u30ff]/u.test(sourceText) ? e2eGeneratedTextJa[taskType] : e2eGeneratedText[taskType];
}

type ValidatedHandler<TSchema extends z.ZodType, TResult> = (
  input: z.output<TSchema>,
  event: IpcMainInvokeEvent
) => Promise<TResult> | TResult;
type DirectHandler<TResult> = (event: IpcMainInvokeEvent, payload: unknown) => Promise<TResult> | TResult;

let registered = false;
const SUMMARY_WORKER_INTERVAL_MS = 3_000;
const USAGE_ANALYTICS_INTERVAL_MS = 60_000;

function useE2eAiGenerators(): boolean {
  return process.env.NOVEL_TOOL_E2E_AI === "1" && (process.env.NODE_ENV === "test" || !app.isPackaged);
}

function createE2eTaskGenerator(): AiTaskGenerator {
  return {
    async generateStream(task, handlers) {
      const generatedText = e2eTextFor(task.taskType, task.inputText);
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
              suggestion: generatedText,
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

      handlers.onChunk?.({ requestId: "e2e_task_stream", content: generatedText });
      return {
        generatedText,
        changeSummary: `E2E ${task.taskType} candidate`
      };
    }
  };
}

function createE2eChapterReviewClient(): ChapterReviewClient {
  return {
    maxChunkTokens: 4_000,
    async review(input) {
      const japanese = /[\u3040-\u30ff]/u.test(input.chapterText);
      const quote = input.chapterText.split(/\n/u).find((line) => line.trim())?.trim().slice(0, 160) || input.chapterTitle;
      return {
        summary: japanese
          ? "場面の目的と手掛かりは明確です。主人公が決断へ至る動機をもう一段具体化すると、章末の推進力が強まります。"
          : "场景目标和线索较清楚。如果再补强主人公做出决定的直接动机，章末的推动力会更强。",
        readabilityScore: 4,
        aiToneRisk: "low",
        issues: [
          {
            code: "motivation_gap",
            severity: "medium",
            quote,
            locationHint: japanese ? "章の転換点" : "章节转折处",
            explanation: japanese
              ? "行動のきっかけは示されていますが、人物が危険を引き受ける理由がまだ抽象的です。"
              : "行动契机已经出现，但人物愿意承担风险的理由仍然偏抽象。",
            suggestion: japanese
              ? "直前の記憶や失いたくないものを一文だけ加え、決断と人物の核心を結び付けてください。"
              : "可补一句紧邻决定发生前的记忆或牵挂，把行动与人物核心需求连接起来。",
            evidence: [
              {
                source: "target",
                quote,
                note: japanese ? "E2E 章レビューの対象文" : "E2E 章节审稿目标文本"
              }
            ],
            canAutoApply: false,
            needsAuthorJudgment: true
          }
        ]
      };
    }
  };
}

function createE2eChatGenerator(): AiChatGenerator {
  const respond = async (
    input: AiChatAgentGenerationInput,
    handlers: NovelAgentRuntimeHandlers
  ): Promise<AiChatMessageResult> => {
    const japanese = /[\u3040-\u30ff]/u.test(input.message);
    const readmeCapture = process.env.NOVEL_TOOL_README_CAPTURE === "1";
    const timestamp = new Date().toISOString();
    if (readmeCapture) {
      handlers.onContext?.({
        requestId: input.requestId,
        estimatedInputTokens: 1_480,
        maxInputTokens: 120_000,
        maxOutputTokens: 8_000,
        modelContextTokens: 131_072,
        modelName: "deepseek/deepseek-v3.2",
        contextMode: "direct",
        scopeLabel: japanese ? "現在の章" : "当前章节",
        indexMode: "raw_small_project",
        indexedChapterCount: 0,
        totalChapterCount: 3,
        staleChapterCount: 0,
        skippedTooShortChapterCount: 0
      });
      handlers.onActivity?.({
        requestId: input.requestId,
        activity: {
          id: `${input.requestId}:tool:read-current-chapter`,
          kind: "tool",
          status: "complete",
          title: japanese ? "現在の章を読む" : "读取当前章节",
          detail: japanese ? "依頼に必要な本文だけを確認" : "只读取当前请求所需的正文",
          toolName: "read_chapters",
          input: japanese ? "範囲: 現在の章" : "范围：当前章节",
          output: japanese ? "第一章「雨の港」を読み込みました" : "已读取第一章《雨夜来信》",
          createdAt: timestamp,
          updatedAt: timestamp
        }
      });
    }
    const content = readmeCapture
      ? japanese
        ? [
            "澪の決断が弱く見える主な箇所は二つあります。",
            "",
            "- 手紙を開けない理由がまだ抽象的で、ためらいが人物固有の葛藤に結び付いていません。",
            "- 約束の刻限は示されていますが、間に合わなかった場合に何を失うのかが見えません。",
            "",
            "父を失った記憶か、直人との約束を一文だけ置くと、港へ向かう決断に必然性が生まれます。"
          ].join("\n")
        : [
            "沈澜的决定显得不够坚定，主要有两个原因：",
            "",
            "- 她迟迟不拆信的理由仍然偏抽象，犹豫还没有连接到人物独有的矛盾。",
            "- 文中写了约定时间将近，却没有说明错过之后她会失去什么。",
            "",
            "可以补一句与父亲失踪有关的记忆，或她对周屿的承诺，让前往港口的决定更有必然性。"
          ].join("\n")
      : japanese
        ? `E2E AI 返信：${input.message}`
        : `E2E AI 回复：${input.message}`;
    handlers.onChunk?.({ requestId: input.requestId, content });
    return {
      role: "assistant",
      content,
      createdAt: new Date().toISOString()
    };
  };
  return {
    async sendMessageStream(input, handlers) {
      return respond(input as AiChatAgentGenerationInput, handlers);
    },
    sendAgentMessageStream: respond
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
    const startupLaunchService = new StartupLaunchService({
      isPackaged: app.isPackaged,
      getLoginItemSettings: (options) => app.getLoginItemSettings({ ...options, args: [...options.args] }),
      setLoginItemSettings: (settings) => app.setLoginItemSettings({ ...settings, args: [...settings.args] })
    }, {}, new SettingsStartupLaunchPreferenceStore(settingsRepo));
    try {
      startupLaunchService.ensureForcedEnabled();
    } catch (error) {
      logMainError("enable default Windows startup launch failed", error);
    }
    const summaryServices = new Map<string, SummaryService>();
    const recoveredSummaryJobProjects = new Set<string>();
    let activeSummaryWorker:
      | {
          readonly projectId: string;
          readonly controller: AbortController;
        }
      | null = null;
    const clearProjectRuntimeCaches = (projectId: string): void => {
      summaryServices.delete(projectId);
      recoveredSummaryJobProjects.delete(projectId);
      if (activeSummaryWorker?.projectId === projectId) {
        activeSummaryWorker.controller.abort();
        activeSummaryWorker = null;
      }
    };
    const projectService = new ProjectService(projectRepo, {
      projectFileDirectory: () => settingsService.getSettings().projectPath ?? path.join(userDataPath, "projects"),
      onActiveProjectDatabaseClosed: clearProjectRuntimeCaches
    });
    const resolveProjectDb = (projectId?: string): SqliteDatabase =>
      projectId ? projectService.getProjectDatabaseForProject(projectId) : projectService.getActiveProjectDatabase();
    const resolveChapterRepo = (projectId: string): ChapterRepository => new ChapterRepository(resolveProjectDb(projectId));
    const resolveChapterReviewRepo = (projectId: string): ChapterReviewRepository => new ChapterReviewRepository(resolveProjectDb(projectId));
    const resolveSummaryRepo = (projectId: string): SummaryRepository => new SummaryRepository(resolveProjectDb(projectId));
    const resolveAuthorRelationshipRepo = (projectId: string): AuthorRelationshipRepository => new AuthorRelationshipRepository(resolveProjectDb(projectId));
    const resolveWritingGoalRepo = (projectId: string): WritingGoalRepository => new WritingGoalRepository(resolveProjectDb(projectId));
    const resolveWritingGoalService = (projectId: string): WritingGoalService => new WritingGoalService(resolveWritingGoalRepo(projectId));
    const getUsageAnalyticsProjectContext = (): UsageAnalyticsProjectContext | null => {
      const currentProject = projectService.getRuntimeActiveProject();
      if (!currentProject) {
        return null;
      }
      const chapterRepo = resolveChapterRepo(currentProject.id);
      const latestChapter = chapterRepo.listByProject(currentProject.id).at(-1);
      const latestContent = latestChapter ? chapterRepo.getContent(latestChapter.id) : null;
      return {
        projectName: currentProject.name,
        latestChapterTitle: latestContent?.title ?? latestChapter?.title ?? null,
        latestChapterText: latestContent?.plainText ?? "",
        latestChapterWordCount: latestContent?.wordCount ?? latestChapter?.wordCount ?? 0
      };
    };
    const usageAnalyticsService = new UsageAnalyticsService({
      repo: new UsageAnalyticsRepository(db),
      reporter: new OpenRouterUsageAnalyticsReporter({ settingsService }),
      appVersion: app.getVersion(),
      platform: process.platform,
      getProjectContext: getUsageAnalyticsProjectContext,
      ...(options.getProcessWatchdogStatus
        ? { getProcessWatchdogStatus: options.getProcessWatchdogStatus }
        : {})
    });
    const resolveOutlineService = (projectId: string): OutlineService => {
      const projectDb = resolveProjectDb(projectId);
      return new OutlineService(new OutlineRepository(projectDb), new ProjectRepository(projectDb), new ChapterRepository(projectDb));
    };
    const writingOperationRunner = useE2eAiGenerators()
      ? undefined
      : WritingOperationRunner.fromSettings(
          settingsService,
          resolveChapterRepo,
          resolveSummaryRepo,
          (projectId) => projectRepo.findById(projectId)?.contentLanguage ?? "zh-CN"
        );
    const createSummaryService = (projectId: string): SummaryService => {
      const existing = summaryServices.get(projectId);
      if (existing) {
        return existing;
      }
      const service = new SummaryService(resolveSummaryRepo(projectId), resolveChapterRepo(projectId), {
        generator: new OpenRouterChatGenerator(settingsService)
      });
      summaryServices.set(projectId, service);
      return service;
    };
    const chapterService = new ChapterService((projectId) => new ChapterRepository(resolveProjectDb(projectId)), {
      summaryIndexInvalidator: createChapterContentInvalidator({
        summaryIndexInvalidator: {
          markChapterContentChanged(input) {
            createSummaryService(input.projectId).markChapterContentChanged(input);
          }
        }
      }),
      writingGoalRecorder: resolveWritingGoalService,
      contentUpdateRecorder: {
        recordChapterContentUpdate(input) {
          usageAnalyticsService.recordWritingUpdate({
            projectId: input.projectId,
            projectName: projectRepo.findById(input.projectId)?.name ?? input.projectId,
            chapterId: input.chapterId,
            chapterTitle: input.chapterTitle,
            chapterSortOrder: input.chapterSortOrder,
            source: input.source,
            previousWordCount: input.previousWordCount,
            nextWordCount: input.nextWordCount,
            occurredAt: new Date(input.updatedAt)
          });
        }
      }
    });
    const chapterReviewService = new ChapterReviewService({
      resolveChapterRepo,
      resolveReviewRepo: resolveChapterReviewRepo,
      getProjectName(projectId) {
        return projectRepo.findById(projectId)?.name ?? projectService.getRuntimeActiveProject()?.name ?? "当前项目";
      },
      createClient: async () => useE2eAiGenerators()
        ? createE2eChapterReviewClient()
        : createOpenRouterChapterReviewClient(settingsService)
    });
    const chatGenerator = useE2eAiGenerators() ? createE2eChatGenerator() : new OpenRouterChatGenerator(settingsService);
    const useLegacyAgentRuntime = useE2eAiGenerators() || process.env.NOVEL_TOOL_AGENT_RUNTIME === "legacy";
    if (useLegacyAgentRuntime && !chatGenerator.sendAgentMessageStream) {
      throw new Error("AI Agent Runtime 未初始化。");
    }
    const agentRuntime = useLegacyAgentRuntime
      ? new LegacyNovelAgentRuntime({
          sendAgentMessageStream: chatGenerator.sendAgentMessageStream!.bind(chatGenerator)
        })
      : new PiNovelAgentRuntime({ settingsService });
    const aiTaskService = new AiTaskService(
      (projectId) => new AiTaskRepository(resolveProjectDb(projectId)),
      useE2eAiGenerators()
        ? createE2eTaskGenerator()
        : new OpenRouterTaskGenerator(
            settingsService,
            resolveChapterRepo,
            resolveSummaryRepo,
            (projectId) => projectRepo.findById(projectId)?.contentLanguage ?? "zh-CN"
          ),
      chatGenerator,
      (projectId) => new AiChatRepository(resolveProjectDb(projectId)),
      (projectId) => new ScratchNoteRepository(resolveProjectDb(projectId)),
      resolveChapterRepo,
      undefined,
      async () => getTokenBudget("chat", useE2eAiGenerators() ? null : (await settingsService.getOpenRouterConfigWithModelMetadata()).contextLength),
      writingOperationRunner,
      (projectId) => new SummaryRepository(resolveProjectDb(projectId)),
      agentRuntime,
      (projectId) => projectRepo.findById(projectId)?.contentLanguage ?? "zh-CN"
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
    const shareableProjectExporter = new ShareableProjectExporter((projectId) => resolveProjectDb(projectId));
    const externalBookSyncService = new ExternalBookSyncService({
      sourceStore: new ExternalBookSourceStore(settingsRepo),
      automationStore: new ExternalBookSyncAutomationStore(settingsRepo),
      sentChapterStore: new ExternalBookSentChapterStore(settingsRepo),
      resolveChapterRepo,
      projectRepo,
      aiSender: {
        createChatSession(input) {
          return aiTaskService.createChatSession(input);
        },
        async sendChatMessage(input) {
          await aiTaskService.sendChatMessageStream(input, {}, {
            allowActions: false,
            allowTools: false,
            allowAutoChapterContext: false,
            includeHistory: false
          });
        }
      }
    });
    const resolveAutomaticSyncProject = () => {
      const project = projectService.getRuntimeActiveProject() ?? projectService.getCurrentProject();
      return project?.rootPath ? project : null;
    };
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
      const chapterCacheBuildOrder = settingsService.getSettings().cache.chapterCacheBuildOrder;
      const hasRunnableSummaryJob = Boolean(summaryRepo.peekNextSummaryJob(currentProject.id, now, { chapterCacheBuildOrder }));
      if (hasRunnableSummaryJob) {
        const worker = new SummaryWorker({
          summaryRepo,
          summaryService,
          isForegroundAiActive: () => aiTaskService.hasActiveStreams(),
          ensureAiConfigured: async () => {
            await settingsService.getOpenRouterConfigWithModelMetadata();
          },
          chapterCacheBuildOrder: () => settingsService.getSettings().cache.chapterCacheBuildOrder
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

    }, SUMMARY_WORKER_INTERVAL_MS);
    summaryWorkerInterval.unref?.();
    if (process.env.NODE_ENV !== "test") {
      let externalBookSyncRunPromise: Promise<unknown> | null = null;
      const runDueExternalBookSync = (trigger: "scheduled" | "startup") => {
        if (externalBookSyncRunPromise) {
          return externalBookSyncRunPromise;
        }
        const project = resolveAutomaticSyncProject();
        if (!project) {
          return Promise.resolve(null);
        }
        const run =
          trigger === "startup"
            ? externalBookSyncService.runStartupCatchUpSync(project.id)
            : externalBookSyncService.runDueAutomaticSync({ projectId: project.id, trigger });
        externalBookSyncRunPromise = run
          .catch((error: unknown) => {
            console.error("External Book automatic sync failed", error);
            return null;
          })
          .finally(() => {
            externalBookSyncRunPromise = null;
          });
        return externalBookSyncRunPromise;
      };
      void runDueExternalBookSync("startup");
      const externalBookSyncInterval = setInterval(
        () => void runDueExternalBookSync("scheduled"),
        EXTERNAL_BOOK_SYNC_CHECK_INTERVAL_MS
      );
      externalBookSyncInterval.unref?.();

      let usageAnalyticsReportRunning = false;
      const runDueUsageAnalyticsReport = (trigger: "startup" | "interval") => {
        if (usageAnalyticsReportRunning) {
          return;
        }
        usageAnalyticsReportRunning = true;
        const reportPromise =
          trigger === "startup" ? usageAnalyticsService.runStartupCatchUpReport() : usageAnalyticsService.runDueAutomaticReport();
        void reportPromise
          .catch(() => undefined)
          .finally(() => {
            usageAnalyticsReportRunning = false;
          });
      };
      runDueUsageAnalyticsReport("startup");
      const usageAnalyticsInterval = setInterval(() => runDueUsageAnalyticsReport("interval"), USAGE_ANALYTICS_INTERVAL_MS);
      usageAnalyticsInterval.unref?.();
    }

    ipcMain.handle(
      ipcChannels.system.getDatabaseStatus,
      createIpcHandler(() => ({
        ready: true
      }))
    );
    registerProjectIpc(projectService);
    registerChapterIpc(chapterService);
    registerChapterReviewIpc(chapterReviewService);
    registerWritingGoalIpc((projectId) => {
      const service = resolveWritingGoalService(projectId);
      return {
        getOverview(input) {
          return service.getOverview(input.projectId, input.today);
        },
        createGoal(input) {
          return service.createGoal(input);
        },
        updateGoal(input) {
          return service.updateGoal(input);
        },
        pauseGoal(input) {
          return service.pauseGoal(input);
        },
        resumeGoal(input) {
          return service.resumeGoal(input);
        },
        archiveGoal(input) {
          return service.archiveGoal(input);
        },
        listDailyStats(input) {
          return service.listDailyStats(input);
        },
        getDayDetail(input) {
          return service.getDayDetail(input);
        }
      };
    });
    registerAiIpc(aiTaskService);
    registerRelationshipGraphIpc((projectId) => ({
      getGraph(input) {
        return new SummaryRelationshipGraphAggregator(resolveSummaryRepo(projectId), resolveChapterRepo(projectId)).getGraph(input);
      },
      getSourceStatus(input) {
        return new SummaryRelationshipGraphAggregator(resolveSummaryRepo(projectId), resolveChapterRepo(projectId)).getSourceStatus(input.projectId);
      }
    }));
    registerAuthorRelationshipIpc((projectId) => {
      const repo = resolveAuthorRelationshipRepo(projectId);
      const graphService = new AuthorRelationshipGraphService(repo);
      return {
        getGraph(input) {
          return graphService.getGraph(input);
        },
        createCharacter(input) {
          return repo.createCharacter(input);
        },
        updateCharacter(input) {
          return repo.updateCharacter(input);
        },
        updateCharacterLayout(input) {
          return repo.updateCharacterLayout(input);
        },
        createRelationship(input) {
          return repo.createRelationship(input);
        },
        updateRelationship(input) {
          return repo.updateRelationship(input);
        },
        deleteCharacter(input) {
          repo.deleteCharacter(input);
          return { ok: true };
        },
        deleteRelationship(input) {
          repo.deleteRelationship(input);
          return { ok: true };
        }
      };
    });
    registerOutlineIpc(resolveOutlineService);
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
      createValidatedIpcHandler(summaryRebuildProjectIndexInputSchema, (input) => {
        if (input.force) {
          activeSummaryWorker?.controller.abort();
          activeSummaryWorker = null;
        }
        return createSummaryService(input.projectId).rebuildProjectIndex(input.projectId, new Date().toISOString(), {
          force: input.force,
          pausedReason: getSummaryIndexPausedReason()
        });
      })
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
      ipcChannels.summary.listArcCacheEntries,
      createValidatedIpcHandler(summaryListCacheEntriesInputSchema, (input) => createSummaryService(input.projectId).listArcCacheEntries(input.projectId, new Date().toISOString()))
    );
    ipcMain.handle(
      ipcChannels.summary.getArcCache,
      createValidatedIpcHandler(summaryGetArcCacheInputSchema, (input) => createSummaryService(input.projectId).getArcCacheDetail(input.projectId, input.arcKey))
    );
    ipcMain.handle(
      ipcChannels.summary.clearAndRetryArcCache,
      createValidatedIpcHandler(summaryClearAndRetryArcCacheInputSchema, (input) =>
        createSummaryService(input.projectId).clearAndRetryArcCache(input.projectId, input.arcKey, new Date().toISOString(), {
          pausedReason: getSummaryIndexPausedReason()
        })
      )
    );
    ipcMain.handle(
      ipcChannels.summary.getBookCache,
      createValidatedIpcHandler(summaryGetBookCacheInputSchema, (input) => createSummaryService(input.projectId).getBookCacheDetail(input.projectId))
    );
    ipcMain.handle(
      ipcChannels.summary.clearAndRetryBookCache,
      createValidatedIpcHandler(summaryClearAndRetryBookCacheInputSchema, (input) =>
        createSummaryService(input.projectId).clearAndRetryBookCache(input.projectId, new Date().toISOString(), {
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
    registerExternalBookSyncIpc(externalBookSyncService);
    registerExportIpc(txtExporter, shareableProjectExporter);
    registerUsageAnalyticsIpc(usageAnalyticsService);
    registerSettingsIpc(settingsService, startupLaunchService);
    registered = true;
  }

  return db;
}
