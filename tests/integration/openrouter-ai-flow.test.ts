import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AiTaskService, type AiChatGenerator, type AiTaskGenerator } from "../../src/main/ai/ai-task-service";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { AiTaskRepository } from "../../src/main/db/repositories/ai-task-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { SettingsRepository } from "../../src/main/db/repositories/settings-repo";
import { ProjectService } from "../../src/main/project/project-service";
import { SettingsService, type SecretStore, type OpenRouterConnectionTester, type OpenRouterModelCatalog } from "../../src/main/settings/settings-service";

const tempDirs: string[] = [];
const projectServices: ProjectService[] = [];

const memorySecretStore: SecretStore = {
  encrypt(value) {
    return `encrypted:${Buffer.from(value, "utf8").toString("base64")}`;
  },
  decrypt(value) {
    return Buffer.from(value.replace(/^encrypted:/, ""), "base64").toString("utf8");
  }
};

function trackProjectService(projectService: ProjectService): ProjectService {
  projectServices.push(projectService);
  return projectService;
}

function createServices(generator?: AiTaskGenerator, tester?: OpenRouterConnectionTester, chatGenerator?: AiChatGenerator, modelCatalog?: OpenRouterModelCatalog) {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-openrouter-flow-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "novel-tool.sqlite3"));
  runMigrations(db);

  const projectService = trackProjectService(
    new ProjectService(new ProjectRepository(db), {
      projectFileDirectory: join(dir, "projects")
    })
  );
  const resolveProjectDb = (projectId?: string) =>
    projectId ? projectService.getProjectDatabaseForProject(projectId) : projectService.getActiveProjectDatabase();
  const settingsRepo = new SettingsRepository(db);

  return {
    aiTaskRepo: (projectId?: string) => new AiTaskRepository(resolveProjectDb(projectId)),
    aiTaskService: new AiTaskService((projectId) => new AiTaskRepository(resolveProjectDb(projectId)), generator, chatGenerator),
    db,
    projectService,
    settingsRepo,
    settingsService: new SettingsService(settingsRepo, {
      secretStore: memorySecretStore,
      connectionTester: tester,
      modelCatalog
    })
  };
}

afterEach(() => {
  for (const projectService of projectServices.splice(0)) {
    projectService.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("OpenRouter AI flow", () => {
  it("stores OpenRouter API keys encrypted and tests the saved connection without exposing the key", async () => {
    const testedKeys: string[] = [];
    const { db, settingsRepo, settingsService } = createServices(
      undefined,
      {
        async testConnection(config) {
          testedKeys.push(config.apiKey);
          return { ok: true, modelName: config.modelName };
        }
      },
      undefined,
      {
        async listModels() {
          return [{ id: "openai/gpt-5.2", name: "GPT-5.2", contextLength: 400_000, supportsTools: true }];
        }
      }
    );

    const saved = settingsService.saveSettings({
      aiProvider: {
        providerType: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        modelName: "openai/gpt-5.2",
        apiKey: "sk-or-v1-secret-key"
      }
    });

    expect(saved.aiProvider).toMatchObject({
      providerType: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      modelName: "openai/gpt-5.2",
      apiKeyConfigured: true
    });
    expect(JSON.stringify(saved)).not.toContain("sk-or-v1-secret-key");
    expect(JSON.stringify(settingsRepo.getJson("aiProvider"))).not.toContain("sk-or-v1-secret-key");

    await expect(settingsService.testConnection()).resolves.toMatchObject({
      ok: true,
      modelName: "openai/gpt-5.2"
    });
    expect(testedKeys).toEqual(["sk-or-v1-secret-key"]);

    db.close();
  });

  it("generates and persists candidates for every AI task type through the injected OpenRouter generator", async () => {
    const generatedTaskTypes: string[] = [];
    const generator: AiTaskGenerator = {
      async generateStream(task) {
        generatedTaskTypes.push(task.taskType);
        return {
          generatedText: `${task.taskType}: ${task.inputText}`,
          changeSummary: "OpenRouter generated candidate"
        };
      }
    };
    const { aiTaskRepo, aiTaskService, db, projectService } = createServices(generator);
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const projectAiTaskRepo = aiTaskRepo(project.id);

    for (const taskType of ["polish", "expand", "proofread", "continue"] as const) {
      const task = aiTaskService.createTask({
        projectId: project.id,
        chapterId: initialChapter.id,
        taskType,
        inputText: "林远在雨声里停下脚步。",
        instruction: "保持克制。"
      });
      const result = await aiTaskService.generatePreviewStream({ requestId: `stream_${taskType}`, taskId: task.id });

      expect(result.task.status).toBe("preview_ready");
      expect(result.candidate).toMatchObject({
        kind: taskType,
        originalText: "林远在雨声里停下脚步。",
        generatedText: `${taskType}: 林远在雨声里停下脚步。`,
        status: "preview"
      });
      expect(projectAiTaskRepo.findTaskById(task.id).outputText).toBe(`${taskType}: 林远在雨声里停下脚步。`);
    }

    expect(generatedTaskTypes).toEqual(["polish", "expand", "proofread", "continue"]);

    db.close();
  });

  it("rolls back a generated candidate if marking the task preview-ready fails", async () => {
    const generator: AiTaskGenerator = {
      async generateStream(task) {
        return {
          generatedText: `润色稿：${task.inputText}`,
          changeSummary: "OpenRouter generated candidate"
        };
      }
    };
    const { db, projectService } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const projectDb = projectService.getProjectDatabaseForProject(project.id);
    const projectAiTaskRepo = new AiTaskRepository(projectDb);
    const aiTaskService = new AiTaskService(projectAiTaskRepo, generator);
    const originalUpdateTask = projectAiTaskRepo.updateTask.bind(projectAiTaskRepo);
    projectAiTaskRepo.updateTask = ((taskId, patch) => {
      if (patch.status === "preview_ready") {
        return originalUpdateTask(taskId, {
          ...patch,
          status: "not_a_real_status" as never
        });
      }
      return originalUpdateTask(taskId, patch);
    }) as typeof projectAiTaskRepo.updateTask;
    const task = aiTaskService.createTask({
      projectId: project.id,
      chapterId: initialChapter.id,
      taskType: "polish",
      inputText: "林远在雨声里停下脚步。",
      instruction: "保持克制。"
    });

    await expect(aiTaskService.generatePreviewStream({ requestId: "stream_rollback", taskId: task.id })).rejects.toThrow("CHECK constraint failed");

    expect(projectDb.prepare("SELECT COUNT(*) AS count FROM ai_task_candidates WHERE task_id = ?").get(task.id)).toEqual({ count: 0 });
    expect(projectAiTaskRepo.findTaskById(task.id).status).toBe("failed");

    db.close();
  });

  it("persists proofread candidates as structured issue lists without replacement text", async () => {
    const generator: AiTaskGenerator = {
      async generateStream() {
        return {
          generatedText: "",
          changeSummary: "发现 2 个问题",
          contextPlan: {
            targetText: "他说：我回来了。",
            supportingContext: [],
            mode: "direct",
            estimatedInputTokens: 128,
            maxInputTokens: 8000,
            reason: "校对默认只检查目标文本"
          },
          proofreadIssues: [
            {
              type: "错别字",
              quote: "的地得",
              suggestion: "按语义修正的、地、得。",
              reason: "助词误用"
            },
            {
              type: "标点",
              quote: "他说：我回来了",
              suggestion: "他说：“我回来了。”",
              reason: "对白标点不完整"
            }
          ]
        };
      }
    };
    const { aiTaskRepo, aiTaskService, db, projectService } = createServices(generator);
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const projectAiTaskRepo = aiTaskRepo(project.id);
    const task = aiTaskService.createTask({
      projectId: project.id,
      chapterId: initialChapter.id,
      taskType: "proofread",
      inputText: "他说：我回来了。",
      instruction: "只列问题。"
    });

    const result = await aiTaskService.generatePreviewStream({ requestId: "stream_proofread_structured", taskId: task.id });

    expect(result.task).toMatchObject({
      status: "preview_ready",
      outputText: "发现 2 个问题"
    });
    expect(result.candidate).toMatchObject({
      kind: "proofread",
      generatedText: "",
      changeSummary: "发现 2 个问题",
      proofreadIssues: [
        {
          type: "错别字",
          quote: "的地得",
          suggestion: "按语义修正的、地、得。",
          reason: "助词误用"
        },
        {
          type: "标点",
          quote: "他说：我回来了",
          suggestion: "他说：“我回来了。”",
          reason: "对白标点不完整"
        }
      ],
      writingContextPlan: {
        targetText: "他说：我回来了。",
        supportingContext: [],
        mode: "direct",
        estimatedInputTokens: 128,
        maxInputTokens: 8000,
        reason: "校对默认只检查目标文本"
      }
    });
    expect(projectAiTaskRepo.findCandidateById(result.candidate.id).proofreadIssues).toEqual(result.candidate.proofreadIssues);
    expect(projectAiTaskRepo.findCandidateById(result.candidate.id).writingContextPlan).toEqual(result.candidate.writingContextPlan);

    db.close();
  });

  it("streams AI task tokens and persists the candidate only after completion", async () => {
    const streamedTokens: string[] = [];
    const generator: AiTaskGenerator = {
      async generateStream(task, handlers) {
        handlers.onChunk?.({ requestId: "stream_1", content: "雨声" });
        handlers.onChunk?.({ requestId: "stream_1", content: "渐近。" });
        return {
          generatedText: `流式：${task.inputText}`,
          changeSummary: "streamed candidate"
        };
      }
    };
    const { aiTaskRepo, aiTaskService, db, projectService } = createServices(generator);
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const task = aiTaskService.createTask({
      projectId: project.id,
      chapterId: initialChapter.id,
      taskType: "polish",
      inputText: "林远在雨声里停下脚步。"
    });

    const result = await aiTaskService.generatePreviewStream(
      { requestId: "stream_1", taskId: task.id },
      {
        onChunk(event) {
          streamedTokens.push(event.content);
          expect(() => aiTaskRepo(project.id).findCandidateById("candidate_missing")).toThrow("AI task candidate not found");
        }
      }
    );

    expect(streamedTokens).toEqual(["雨声", "渐近。"]);
    expect(result.candidate).toMatchObject({
      kind: "polish",
      generatedText: "流式：林远在雨声里停下脚步。",
      status: "preview"
    });
    expect(aiTaskRepo(project.id).findTaskById(task.id).status).toBe("preview_ready");

    db.close();
  });

  it("marks streamed AI tasks failed without creating a candidate when the stream errors", async () => {
    const generator: AiTaskGenerator = {
      async generateStream(_task, handlers) {
        handlers.onChunk?.({ requestId: "stream_2", content: "半段" });
        throw new Error("Provider disconnected");
      }
    };
    const { aiTaskRepo, aiTaskService, db, projectService } = createServices(generator);
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const task = aiTaskService.createTask({
      projectId: project.id,
      chapterId: initialChapter.id,
      taskType: "expand",
      inputText: "林远停下脚步。"
    });

    await expect(
      aiTaskService.generatePreviewStream(
        { requestId: "stream_2", taskId: task.id },
        {
          onChunk() {}
        }
      )
    ).rejects.toThrow("Provider disconnected");
    expect(aiTaskRepo(project.id).findTaskById(task.id)).toMatchObject({
      status: "failed",
      error: "Provider disconnected"
    });

    db.close();
  });

  it("cancels streamed AI task generation without turning the task into a failed result", async () => {
    const errorEvents: string[] = [];
    let resolveSignal: (signal: AbortSignal) => void = () => {};
    const signalReady = new Promise<AbortSignal>((resolve) => {
      resolveSignal = resolve;
    });
    const generator: AiTaskGenerator = {
      async generateStream(_task, _handlers, options) {
        if (!options?.signal) {
          throw new Error("missing abort signal");
        }
        resolveSignal(options.signal);
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(new Error("canceled")), { once: true });
        });
      }
    };
    const { aiTaskRepo, aiTaskService, db, projectService } = createServices(generator);
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const task = aiTaskService.createTask({
      projectId: project.id,
      chapterId: initialChapter.id,
      taskType: "expand",
      inputText: "林远停下脚步。"
    });

    const pending = aiTaskService.generatePreviewStream(
      { requestId: "stream_cancel_task", taskId: task.id },
      {
        onError(event) {
          errorEvents.push(event.error);
        }
      }
    );
    await signalReady;
    aiTaskService.cancelStream({ requestId: "stream_cancel_task" });

    await expect(pending).rejects.toThrow("AI 任务已取消");
    expect(errorEvents).toEqual([]);
    expect(aiTaskRepo(project.id).findTaskById(task.id)).toMatchObject({
      status: "configured",
      error: null
    });

    db.close();
  });

  it("keeps partial streamed text but does not create an applicable candidate when output is truncated", async () => {
    const streamedTokens: string[] = [];
    const generator: AiTaskGenerator = {
      async generateStream(_task, handlers) {
        handlers.onChunk?.({ requestId: "stream_truncated", content: "半段结果" });
        return {
          generatedText: "半段结果",
          changeSummary: "结果已截断",
          truncated: true
        } as Awaited<ReturnType<NonNullable<AiTaskGenerator["generateStream"]>>>;
      }
    };
    const { aiTaskRepo, aiTaskService, db, projectService } = createServices(generator);
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const task = aiTaskService.createTask({
      projectId: project.id,
      chapterId: initialChapter.id,
      taskType: "expand",
      inputText: "林远停下脚步。"
    });

    await expect(
      aiTaskService.generatePreviewStream(
        { requestId: "stream_truncated", taskId: task.id },
        {
          onChunk(event) {
            streamedTokens.push(event.content);
          }
        }
      )
    ).rejects.toThrow("AI 输出被截断");

    expect(streamedTokens).toEqual(["半段结果"]);
    expect(aiTaskRepo(project.id).findTaskById(task.id)).toMatchObject({
      status: "failed",
      outputText: "半段结果"
    });
    expect(() => aiTaskRepo(project.id).findCandidateById("candidate_missing")).toThrow("AI task candidate not found");

    db.close();
  });

  it("keeps partial proofread stream output and reports truncation instead of parsing partial JSON", async () => {
    const generator: AiTaskGenerator = {
      async generateStream() {
        return {
          generatedText: "{\"issues\":[",
          changeSummary: "结果已截断",
          truncated: true
        } as Awaited<ReturnType<NonNullable<AiTaskGenerator["generateStream"]>>>;
      }
    };
    const { aiTaskRepo, aiTaskService, db, projectService } = createServices(generator);
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const task = aiTaskService.createTask({
      projectId: project.id,
      chapterId: initialChapter.id,
      taskType: "proofread",
      inputText: "他说：我回来了。"
    });

    await expect(aiTaskService.generatePreviewStream({ requestId: "proofread_truncated", taskId: task.id })).rejects.toThrow("校对结果被截断");

    expect(aiTaskRepo(project.id).findTaskById(task.id)).toMatchObject({
      status: "failed",
      outputText: "{\"issues\":["
    });

    db.close();
  });

  it("continues from a truncated partial task output and creates one final candidate", async () => {
    const generator: AiTaskGenerator = {
      async generateStream(_task, handlers) {
        handlers.onChunk?.({ requestId: "stream_truncated_continue", content: "半段结果" });
        return {
          generatedText: "半段结果",
          changeSummary: "结果已截断",
          truncated: true
        } as Awaited<ReturnType<NonNullable<AiTaskGenerator["generateStream"]>>>;
      },
      async continueStream(_task, partialText, handlers) {
        expect(partialText).toBe("半段结果");
        handlers.onChunk?.({ requestId: "stream_continue", content: "完整结果" });
        return {
          generatedText: "半段结果完整结果",
          changeSummary: "continued candidate",
          truncated: false
        };
      }
    };
    const { aiTaskRepo, aiTaskService, db, projectService } = createServices(generator);
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const task = aiTaskService.createTask({
      projectId: project.id,
      chapterId: initialChapter.id,
      taskType: "expand",
      inputText: "林远停下脚步。"
    });

    await expect(aiTaskService.generatePreviewStream({ requestId: "stream_truncated_continue", taskId: task.id })).rejects.toThrow("AI 输出被截断");

    const continuedChunks: string[] = [];
    const result = await aiTaskService.continuePreviewStream(
      { requestId: "stream_continue", taskId: task.id },
      {
        onChunk(event) {
          continuedChunks.push(event.content);
        }
      }
    );

    expect(continuedChunks).toEqual(["完整结果"]);
    expect(result.candidate).toMatchObject({
      generatedText: "半段结果完整结果",
      status: "preview"
    });
    expect(aiTaskRepo(project.id).findTaskById(task.id).status).toBe("preview_ready");

    db.close();
  });
});
