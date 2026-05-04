import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AiTaskService, type AiChatGenerator, type AiChatMessageResult } from "../../src/main/ai/ai-task-service";
import type { ChatPlanner } from "../../src/main/ai/chat-agent-planner";
import type { ChatAgentPlan } from "../../src/main/ai/chat-agent-types";
import type { OpenRouterChatCompletionInput, OpenRouterStreamHandlers } from "../../src/main/ai/openrouter-client";
import { emptyChapterContent } from "../../src/main/chapter/default-content";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { AiChatRepository } from "../../src/main/db/repositories/ai-chat-repo";
import { AiTaskRepository } from "../../src/main/db/repositories/ai-task-repo";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { ScratchNoteRepository } from "../../src/main/db/repositories/scratch-note-repo";
import { SummaryRepository } from "../../src/main/db/repositories/summary-repo";
import { ProjectService } from "../../src/main/project/project-service";
import { createId } from "../../src/main/shared/ids";
import { computeChapterContentHash, computeSourceHash, type ChapterAiSummaryPayload } from "../../src/main/shared/summary-index";
import type { AiChatMessageRecord, AiStreamContextEvent, ChapterSummary } from "../../src/main/shared/types";
import { estimateTextTokens } from "../../src/main/ai/token-estimator";
import { getTokenBudget } from "../../src/main/ai/token-budget";
import { WritingOperationRunner } from "../../src/main/ai/writing-operation-runner";
import { arcIndexPayloadV2, bookIndexPayloadV2, chapterIndexPayloadV2 } from "../helpers/summary-index-fixtures";

const tempDirs: string[] = [];
const projectServices: ProjectService[] = [];

function trackProjectService(projectService: ProjectService): ProjectService {
  projectServices.push(projectService);
  return projectService;
}

function createServices() {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-ai-chat-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "novel-tool.sqlite3"));
  runMigrations(db);

  const projectService = trackProjectService(
    new ProjectService(new ProjectRepository(db), {
      projectFileDirectory: join(dir, "projects")
    })
  );
  const projectDb = (projectId: string) => projectService.getProjectDatabaseForProject(projectId);

  return {
    aiTaskRepo: (projectId?: string) => new AiTaskRepository(projectId ? projectDb(projectId) : projectService.getActiveProjectDatabase()),
    chatRepo: (projectId: string) => new AiChatRepository(projectDb(projectId)),
    chapterRepo: (projectId: string) => new ChapterRepository(projectDb(projectId)),
    db,
    projectService,
    scratchRepo: (projectId: string) => new ScratchNoteRepository(projectDb(projectId)),
    summaryRepo: (projectId: string) => new SummaryRepository(projectDb(projectId))
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

function createChapter(
  repo: ChapterRepository,
  input: {
    readonly projectId: string;
    readonly title: string;
    readonly sortOrder: number;
    readonly plainText: string;
  }
): ChapterSummary {
  const createdAt = new Date().toISOString();
  return repo.create({
    id: createId("chapter"),
    projectId: input.projectId,
    title: input.title,
    volumeTitle: "第一卷",
    sortOrder: input.sortOrder,
    contentJson: emptyChapterContent,
    plainText: input.plainText,
    wordCount: input.plainText.length,
    dailyWordCount: 0,
    dailyWordCountDate: null,
    targetWordCount: null,
    status: "draft",
    createdAt,
    updatedAt: createdAt
  });
}

function createChapterSummaryPayload(input: { readonly oneLine: string; readonly synopsis: string }): ChapterAiSummaryPayload {
  return chapterIndexPayloadV2({
    oneLine: input.oneLine,
    synopsis: input.synopsis,
    detail: `${input.synopsis} 这个章节缓存用于集成测试，保留关键事件、人物状态、可核对事实和不可丢失信息，确保对话上下文可以读取章节索引而不回退旧摘要结构。`
  });
}

function createPlanner(plan: ChatAgentPlan, onPlan?: (input: Parameters<ChatPlanner["plan"]>[0]) => void): ChatPlanner {
  return {
    async plan(input) {
      onPlan?.(input);
      return plan;
    }
  };
}

function requireAbortSignal(signal: AbortSignal | null): AbortSignal {
  if (!signal) {
    throw new Error("stream signal was not captured");
  }
  return signal;
}

describe("AI chat flow", () => {
  it("persists default chat sessions and clears messages only when requested", () => {
    const { chatRepo, db, projectService } = createServices();
    const { project } = projectService.createProject({ name: "雨夜" });
    const repo = chatRepo(project.id);
    const session = repo.getOrCreateDefaultSession(project.id);

    repo.createMessage({
      projectId: project.id,
      sessionId: session.id,
      role: "user",
      content: "总结本章",
      action: null
    });
    repo.createMessage({
      projectId: project.id,
      sessionId: session.id,
      role: "assistant",
      content: "可以总结。",
      action: {
        type: "none"
      }
    });

    expect(repo.getOrCreateDefaultSession(project.id).id).toBe(session.id);
    expect(repo.listMessages({ projectId: project.id, sessionId: session.id }).map((message) => message.content)).toEqual([
      "总结本章",
      "可以总结。"
    ]);

    repo.clearSession({ projectId: project.id, sessionId: session.id });
    expect(repo.listMessages({ projectId: project.id, sessionId: session.id })).toEqual([]);

    db.close();
  });

  it("creates multiple chat sessions and keeps each session history isolated", () => {
    const { chatRepo, db, projectService } = createServices();
    const { project } = projectService.createProject({ name: "雨夜" });
    const repo = chatRepo(project.id);
    const firstSession = repo.getOrCreateDefaultSession(project.id);
    const secondSession = repo.createSession({ projectId: project.id, title: "人物动机讨论" });

    repo.createMessage({
      projectId: project.id,
      sessionId: firstSession.id,
      role: "user",
      content: "总结第一章",
      action: null
    });
    repo.createMessage({
      projectId: project.id,
      sessionId: secondSession.id,
      role: "user",
      content: "讨论林远为什么离开",
      action: null
    });

    const sessionIds = repo.listSessions(project.id).map((session) => session.id);
    expect(sessionIds).toContain(firstSession.id);
    expect(sessionIds).toContain(secondSession.id);
    expect(repo.listMessages({ projectId: project.id, sessionId: firstSession.id }).map((message) => message.content)).toEqual(["总结第一章"]);
    expect(repo.listMessages({ projectId: project.id, sessionId: secondSession.id }).map((message) => message.content)).toEqual([
      "讨论林远为什么离开"
    ]);

    repo.deleteSession({ projectId: project.id, sessionId: secondSession.id });
    expect(repo.listSessions(project.id).map((session) => session.id)).not.toContain(secondSession.id);
    expect(repo.listMessages({ projectId: project.id, sessionId: secondSession.id })).toEqual([]);
    expect(repo.getOrCreateDefaultSession(project.id).id).toBe(firstSession.id);

    db.close();
  });

  it("exposes multi-session chat operations through the AI service", () => {
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project } = projectService.createProject({ name: "雨夜" });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, undefined, chatRepo, scratchRepo);
    const firstSession = aiTaskService.getChatSession({ projectId: project.id });
    const secondSession = aiTaskService.createChatSession({ projectId: project.id });

    expect(secondSession.id).not.toBe(firstSession.id);
    expect(secondSession.title).toBe("新对话");
    expect(aiTaskService.listChatSessions({ projectId: project.id }).map((session) => session.id)).toEqual([secondSession.id, firstSession.id]);

    const renamed = aiTaskService.renameChatSession({
      projectId: project.id,
      sessionId: secondSession.id,
      title: "第 2 章讨论"
    });
    expect(renamed.title).toBe("第 2 章讨论");

    aiTaskService.deleteChatSession({ projectId: project.id, sessionId: secondSession.id });
    expect(aiTaskService.listChatSessions({ projectId: project.id }).map((session) => session.id)).toEqual([firstSession.id]);

    db.close();
  });

  it("streams and persists AI chat messages through the service", async () => {
    const chunks: string[] = [];
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(input, handlers) {
        expect(input.history).toEqual([]);
        handlers.onChunk?.({ requestId: "chat_stream_1", content: "可以" });
        handlers.onChunk?.({ requestId: "chat_stream_1", content: "这样处理。" });
        return {
          role: "assistant",
          content: `回复：${input.message}`,
          createdAt: "2026-04-28T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project } = projectService.createProject({ name: "雨夜" });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    const result = await aiTaskService.sendChatMessageStream(
      {
        requestId: "chat_stream_1",
        projectId: project.id,
        sessionId: session.id,
        message: "这一章节奏如何？",
        chapterExcerpt: "雨一直下。"
      },
      {
        onChunk(event) {
          chunks.push(event.content);
        }
      }
    );

    expect(chunks).toEqual(["可以", "这样处理。"]);
    expect(result.messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "这一章节奏如何？"],
      ["assistant", "回复：这一章节奏如何？"]
    ]);
    expect(aiTaskService.listChatMessages({ projectId: project.id, sessionId: session.id }).map((message) => message.content)).toEqual([
      "这一章节奏如何？",
      "回复：这一章节奏如何？"
    ]);

    db.close();
  });

  it("does not fall back to legacy direct chat generation when the tool-call agent is unavailable", async () => {
    const chatGenerator: AiChatGenerator = {
      async sendMessageStream() {
        return {
          role: "assistant",
          content: "旧 direct chat 不应该被调用。",
          createdAt: "2026-05-01T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project } = projectService.createProject({ name: "雨夜" });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await expect(
      aiTaskService.sendChatMessageStream({
        requestId: "chat_stream_no_agent",
        projectId: project.id,
        sessionId: session.id,
        message: "总结全部章节"
      })
    ).rejects.toThrow("OpenRouter 对话工具调用服务未初始化");

    db.close();
  });

  it("resolves explicit chapter references before sending chat context to OpenRouter", async () => {
    const capturedInputs: unknown[] = [];
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(input) {
        capturedInputs.push(input);
        return {
          role: "assistant",
          content: "第四章总结",
          createdAt: "2026-04-28T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const repo = chapterRepo(project.id);
    repo.rename(initialChapter.id, "第1章 陨落的天才1", new Date().toISOString());
    createChapter(repo, {
      projectId: project.id,
      title: "第2章 山门旧雨",
      sortOrder: 1,
      plainText: "第二章正文"
    });
    createChapter(repo, {
      projectId: project.id,
      title: "第3章 暗潮",
      sortOrder: 2,
      plainText: "第三章正文"
    });
    const fourthChapter = createChapter(repo, {
      projectId: project.id,
      title: "第4章 真正的风暴",
      sortOrder: 3,
      plainText: "第四章真正正文：林远在风暴中发现旧敌。"
    });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_chapter_ref",
      projectId: project.id,
      sessionId: session.id,
      message: "总结一下第4章的内容",
      chapterId: initialChapter.id,
      currentChapterTitle: "第1章 陨落的天才1",
      chapterExcerpt: "第一章正文不应该被发送给模型"
    });

    expect(capturedInputs[0]).toMatchObject({
      chapterId: fourthChapter.id,
      currentChapterTitle: "第4章 真正的风暴",
      chapterExcerpt: "第四章真正正文：林远在风暴中发现旧敌。"
    });
    expect(JSON.stringify(capturedInputs[0])).not.toContain("第一章正文不应该被发送给模型");

    db.close();
  });

  it("rebuilds current chapter chat context in Main instead of trusting renderer excerpts", async () => {
    const capturedInputs: unknown[] = [];
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(input) {
        capturedInputs.push(input);
        return {
          role: "assistant",
          content: "本章总结",
          createdAt: "2026-04-28T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const repo = chapterRepo(project.id);
    repo.saveContent(
      initialChapter.id,
      emptyChapterContent,
      "第一章数据库里的真实正文。",
      12,
      0,
      "2026-04-29",
      new Date().toISOString()
    );
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_current_chapter_context",
      projectId: project.id,
      sessionId: session.id,
      message: "总结本章",
      chapterId: initialChapter.id,
      currentChapterTitle: "错误标题",
      chapterExcerpt: "renderer 里过期的正文"
    });

    expect(capturedInputs[0]).toMatchObject({
      chapterId: initialChapter.id,
      currentChapterTitle: initialChapter.title,
      chapterExcerpt: "第一章数据库里的真实正文。"
    });
    expect(JSON.stringify(capturedInputs[0])).not.toContain("renderer 里过期的正文");

    db.close();
  });

  it("trims long chat chapter context to the chat input budget", async () => {
    const capturedInputs: unknown[] = [];
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(input) {
        capturedInputs.push(input);
        return {
          role: "assistant",
          content: "长章总结",
          createdAt: "2026-04-28T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const longText = "第四章正文。".repeat(20000);
    const repo = chapterRepo(project.id);
    const fourthChapter = createChapter(repo, {
      projectId: project.id,
      title: "第四章 长夜",
      sortOrder: 3,
      plainText: longText
    });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_budgeted_chapter_context",
      projectId: project.id,
      sessionId: session.id,
      message: "总结第四章",
      chapterId: initialChapter.id,
      selectionText: "这段选中文字必须保留",
      chapterExcerpt: "renderer 片段"
    });

    const sent = capturedInputs[0] as { chapterId: string; chapterExcerpt: string; selectionText: string };
    expect(sent.chapterId).toBe(fourthChapter.id);
    expect(sent.selectionText).toBe("这段选中文字必须保留");
    expect(sent.chapterExcerpt.length).toBeLessThan(longText.length);
    expect(estimateTextTokens(sent.chapterExcerpt)).toBeLessThanOrEqual(getTokenBudget("chat").maxInputTokens);

    db.close();
  });

  it("uses explicitly referenced chapter for chat scratchpad actions", async () => {
    let scratchChapterId = "";
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(input) {
        expect(input.currentChapterTitle).toBe("第四章 真相");
        expect(input.chapterExcerpt).toContain("第四章正文");
        const scratchResult = await input.executeTool({
          id: "call_save_fourth_summary",
          name: "add_to_scratchpad",
          argumentsJson: JSON.stringify({
            content: "第四章总结：旧案浮出水面。",
            chapterId: scratchChapterId
          })
        });
        return {
          role: "assistant",
          content: "第四章总结：旧案浮出水面。",
          actions: scratchResult.action ? [scratchResult.action] : [],
          createdAt: "2026-04-28T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const repo = chapterRepo(project.id);
    createChapter(repo, {
      projectId: project.id,
      title: "第二章",
      sortOrder: 1,
      plainText: "第二章正文"
    });
    createChapter(repo, {
      projectId: project.id,
      title: "第三章",
      sortOrder: 2,
      plainText: "第三章正文"
    });
    const fourthChapter = createChapter(repo, {
      projectId: project.id,
      title: "第四章 真相",
      sortOrder: 3,
      plainText: "第四章正文：旧案浮出水面。"
    });
    scratchChapterId = fourthChapter.id;
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    const result = await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_chapter_ref_scratch",
      projectId: project.id,
      sessionId: session.id,
      message: "把第四章总结后加入草稿纸",
      chapterId: initialChapter.id,
      currentChapterTitle: initialChapter.title,
      chapterExcerpt: "第一章正文"
    });

    expect(result.action).toMatchObject({
      type: "add_to_scratchpad",
      chapterId: fourthChapter.id,
      content: "第四章总结：旧案浮出水面。"
    });
    expect(scratchRepo(project.id).list({ projectId: project.id, chapterId: fourthChapter.id })).toMatchObject([
      {
        content: "第四章总结：旧案浮出水面。"
      }
    ]);

    db.close();
  });

  it("lets the tool-call agent report a missing chapter without legacy-context abort", async () => {
    let wasGeneratorCalled = false;
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream() {
        wasGeneratorCalled = true;
        return {
          role: "assistant",
          content: "找不到第9章，当前项目没有这个章节。",
          createdAt: "2026-04-28T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    const result = await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_missing_chapter",
      projectId: project.id,
      sessionId: session.id,
      message: "总结第9章",
      chapterId: initialChapter.id,
      currentChapterTitle: initialChapter.title,
      chapterExcerpt: "当前章内容"
    });

    expect(wasGeneratorCalled).toBe(true);
    expect(result.messages.at(-1)?.content).toContain("找不到第9章");
    expect(aiTaskService.listChatMessages({ projectId: project.id, sessionId: session.id }).map((message) => message.role)).toEqual([
      "user",
      "assistant"
    ]);

    db.close();
  });

  it("can add a streamed chapter summary to scratchpad from chat", async () => {
    let scratchChapterId = "";
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(input, handlers) {
        handlers.onChunk?.({ requestId: "chat_stream_2", content: "本章总结" });
        const scratchResult = await input.executeTool({
          id: "call_save_current_summary",
          name: "add_to_scratchpad",
          argumentsJson: JSON.stringify({
            content: "本章总结：林远在雨夜抵达山门。",
            chapterId: scratchChapterId
          })
        });
        return {
          role: "assistant",
          content: "本章总结：林远在雨夜抵达山门。",
          actions: scratchResult.action ? [scratchResult.action] : [],
          createdAt: "2026-04-28T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    scratchChapterId = initialChapter.id;
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    const result = await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_2",
      projectId: project.id,
      sessionId: session.id,
      message: "把这章总结了加入到草稿纸中",
      chapterId: initialChapter.id,
      currentChapterTitle: initialChapter.title,
      chapterExcerpt: "林远在雨夜抵达山门。"
    });

    expect(result.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
    expect(result.action).toMatchObject({
      type: "add_to_scratchpad",
      chapterId: initialChapter.id,
      content: "本章总结：林远在雨夜抵达山门。"
    });
    expect(scratchRepo(project.id).list({ projectId: project.id, chapterId: initialChapter.id })).toMatchObject([
      {
        content: "本章总结：林远在雨夜抵达山门。",
        sourceTaskId: null
      }
    ]);

    db.close();
  });

  it("does not write chat rewrite requests directly back to chapter content", async () => {
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream() {
        return {
          role: "assistant",
          content: "建议改写为：林远在雨声中停步。",
          createdAt: "2026-04-28T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const repo = chapterRepo(project.id);
    const before = repo.getContent(initialChapter.id)?.plainText ?? "";
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    const result = await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_3",
      projectId: project.id,
      sessionId: session.id,
      message: "把这段改写后直接写回正文",
      chapterId: initialChapter.id,
      selectionText: "林远停步。"
    });

    expect(result.action).toBeNull();
    expect(repo.getContent(initialChapter.id)?.plainText).toBe(before);
    expect(scratchRepo(project.id).list({ projectId: project.id })).toEqual([]);

    db.close();
  });

  it("resolves obvious natural all-chapter summary requests without depending on planner JSON", async () => {
    const capturedInputs: unknown[] = [];
    let plannerCalled = false;
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(input) {
        capturedInputs.push(input);
        return {
          role: "assistant",
          content: "全书总结",
          createdAt: "2026-04-29T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const repo = chapterRepo(project.id);
    repo.rename(initialChapter.id, "第1章 起点", new Date().toISOString());
    repo.saveContent(initialChapter.id, emptyChapterContent, "第一章数据库真实正文。", 10, 0, "2026-04-29", new Date().toISOString());
    createChapter(repo, {
      projectId: project.id,
      title: "第2章 暗潮",
      sortOrder: 1,
      plainText: "第二章数据库真实正文。"
    });
    createChapter(repo, {
      projectId: project.id,
      title: "第3章 转折",
      sortOrder: 2,
      plainText: "第三章数据库真实正文。"
    });
    const planner: ChatPlanner = {
      async plan() {
        plannerCalled = true;
        throw new Error("obvious all-chapter request should bypass planner");
      }
    };
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo, planner);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_natural_all",
      projectId: project.id,
      sessionId: session.id,
      message: "总结现有的全部章节的内容",
      chapterId: initialChapter.id,
      currentChapterTitle: "错误标题",
      chapterExcerpt: "renderer 旧正文"
    });

    const sent = capturedInputs[0] as { agentContext?: { scopeLabel: string; contextText: string; sourceChapterIds: readonly string[] } };
    expect(plannerCalled).toBe(false);
    expect(sent.agentContext?.scopeLabel).toBe("全部章节");
    expect(sent.agentContext?.contextText).toContain("第一章数据库真实正文。");
    expect(sent.agentContext?.contextText).toContain("第二章数据库真实正文。");
    expect(sent.agentContext?.contextText).toContain("第三章数据库真实正文。");
    expect(JSON.stringify(sent)).not.toContain("renderer 旧正文");

    db.close();
  });

  it("resolves @all-chapters without calling the planner", async () => {
    const capturedInputs: unknown[] = [];
    let plannerCalled = false;
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(input) {
        capturedInputs.push(input);
        return {
          role: "assistant",
          content: "全部章节总结",
          createdAt: "2026-04-29T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const repo = chapterRepo(project.id);
    repo.saveContent(initialChapter.id, emptyChapterContent, "第一章真实正文。", 10, 0, "2026-04-29", new Date().toISOString());
    createChapter(repo, {
      projectId: project.id,
      title: "第2章",
      sortOrder: 1,
      plainText: "第二章真实正文。"
    });
    const planner: ChatPlanner = {
      async plan() {
        plannerCalled = true;
        throw new Error("explicit @ reference should bypass planner");
      }
    };
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo, planner);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_at_all",
      projectId: project.id,
      sessionId: session.id,
      message: "@全部章节 总结",
      chapterId: initialChapter.id,
      chapterExcerpt: "renderer 旧正文"
    });

    const sent = capturedInputs[0] as { agentContext?: { scopeLabel: string; contextText: string } };
    expect(plannerCalled).toBe(false);
    expect(sent.agentContext?.scopeLabel).toBe("全部章节");
    expect(sent.agentContext?.contextText).toContain("第一章真实正文。");
    expect(sent.agentContext?.contextText).toContain("第二章真实正文。");

    db.close();
  });

  it("resolves @chapter ranges to the requested chapters only", async () => {
    const capturedInputs: unknown[] = [];
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(input) {
        capturedInputs.push(input);
        return {
          role: "assistant",
          content: "第二到三章梳理",
          createdAt: "2026-04-29T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const repo = chapterRepo(project.id);
    repo.saveContent(initialChapter.id, emptyChapterContent, "第一章不应进入范围。", 10, 0, "2026-04-29", new Date().toISOString());
    const second = createChapter(repo, {
      projectId: project.id,
      title: "第2章 暗潮",
      sortOrder: 1,
      plainText: "第二章真实正文。"
    });
    const third = createChapter(repo, {
      projectId: project.id,
      title: "第3章 转折",
      sortOrder: 2,
      plainText: "第三章真实正文。"
    });
    createChapter(repo, {
      projectId: project.id,
      title: "第4章 不应出现",
      sortOrder: 3,
      plainText: "第四章不应进入范围。"
    });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_at_range",
      projectId: project.id,
      sessionId: session.id,
      message: "@第2-3章 梳理主线",
      chapterId: initialChapter.id
    });

    const sent = capturedInputs[0] as { agentContext?: { scopeLabel: string; contextText: string; sourceChapterIds: readonly string[] } };
    expect(sent.agentContext?.scopeLabel).toBe("第2-3章");
    expect(sent.agentContext?.sourceChapterIds).toEqual([second.id, third.id]);
    expect(sent.agentContext?.contextText).toContain("第二章真实正文。");
    expect(sent.agentContext?.contextText).toContain("第三章真实正文。");
    expect(sent.agentContext?.contextText).not.toContain("第一章不应进入范围。");
    expect(sent.agentContext?.contextText).not.toContain("第四章不应进入范围。");

    db.close();
  });

  it("uses direct all-chapter context when the current prompt fits the chat input budget", async () => {
    const capturedInputs: unknown[] = [];
    const moderatelyLongText = "测试正文。".repeat(600);
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(input) {
        capturedInputs.push(input);
        return {
          role: "assistant",
          content: "四章总结",
          createdAt: "2026-04-29T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const repo = chapterRepo(project.id);
    repo.rename(initialChapter.id, "第1章 起点", new Date().toISOString());
    repo.saveContent(initialChapter.id, emptyChapterContent, moderatelyLongText, moderatelyLongText.length, 0, "2026-04-29", new Date().toISOString());
    createChapter(repo, {
      projectId: project.id,
      title: "第2章 暗潮",
      sortOrder: 1,
      plainText: moderatelyLongText
    });
    createChapter(repo, {
      projectId: project.id,
      title: "第3章 转折",
      sortOrder: 2,
      plainText: moderatelyLongText
    });
    createChapter(repo, {
      projectId: project.id,
      title: "第4章 风暴",
      sortOrder: 3,
      plainText: moderatelyLongText
    });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_direct_four_chapters",
      projectId: project.id,
      sessionId: session.id,
      message: "总结现有的全部章节的内容",
      chapterId: initialChapter.id
    });

    const sent = capturedInputs[0] as { agentContext?: { mode: string; contextText: string } };
    expect(sent.agentContext?.mode).toBe("direct");
    expect(sent.agentContext?.contextText).toContain("第4章 风暴");
    expect(sent.agentContext?.contextText).toContain(moderatelyLongText);

    db.close();
  });

  it("executes add-to-scratchpad only from the validated agent tool call", async () => {
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(input) {
        const scratchResult = await input.executeTool({
          id: "call_add_summary_to_scratchpad",
          name: "add_to_scratchpad",
          argumentsJson: JSON.stringify({
            content: "全书总结：主角发现旧案。",
            chapterId: null
          })
        });
        return {
          role: "assistant",
          content: "全书总结：主角发现旧案。",
          actions: scratchResult.action ? [scratchResult.action] : [],
          createdAt: "2026-04-29T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const repo = chapterRepo(project.id);
    repo.saveContent(initialChapter.id, emptyChapterContent, "第一章正文。", 10, 0, "2026-04-29", new Date().toISOString());
    const planner = createPlanner({
      intent: "summarize",
      scope: { type: "all_chapters" },
      actions: [{ type: "add_to_scratchpad" }],
      reason: "用户要求总结并保存"
    });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo, planner);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    const result = await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_plan_scratch",
      projectId: project.id,
      sessionId: session.id,
      message: "总结现有内容，放到草稿纸",
      chapterId: initialChapter.id
    });

    expect(result.action).toMatchObject({
      type: "add_to_scratchpad",
      chapterId: null,
      content: "全书总结：主角发现旧案。"
    });
    expect(scratchRepo(project.id).list({ projectId: project.id })).toMatchObject([
      {
        chapterId: null,
        content: "全书总结：主角发现旧案。"
      }
    ]);

    db.close();
  });

  it("summarizes oversized all-chapter contexts in budgeted batches instead of per chapter", async () => {
    type BatchSummaryInput = {
      readonly chapters: readonly { readonly title: string; readonly ordinal: number; readonly plainText: string }[];
    };
    const batchSizes: number[] = [];
    const capturedInputs: unknown[] = [];
    const longText = "长章节正文。".repeat(300);
    const chatGenerator = {
      async summarizeContextBatchForContext(input: BatchSummaryInput) {
        batchSizes.push(input.chapters.length);
        return input.chapters.map((chapter) => `第${chapter.ordinal}章批量摘要`).join("\n");
      },
      async sendAgentMessageStream(input: unknown) {
        capturedInputs.push(input);
        return {
          role: "assistant",
          content: "批量压缩后的全书总结",
          createdAt: "2026-04-29T00:00:00.000Z"
        };
      }
    } as AiChatGenerator & {
      summarizeContextBatchForContext: (input: BatchSummaryInput) => Promise<string>;
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const repo = chapterRepo(project.id);
    repo.rename(initialChapter.id, "第1章 长夜", new Date().toISOString());
    repo.saveContent(initialChapter.id, emptyChapterContent, longText, longText.length, 0, "2026-04-29", new Date().toISOString());
    for (let index = 2; index <= 12; index += 1) {
      createChapter(repo, {
        projectId: project.id,
        title: `第${index}章`,
        sortOrder: index - 1,
        plainText: longText
      });
    }
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_batch_summaries",
      projectId: project.id,
      sessionId: session.id,
      message: "@全部章节 总结现有剧情",
      chapterId: initialChapter.id
    });

    const sent = capturedInputs[0] as { agentContext?: { mode: string; contextText: string } };
    expect(batchSizes.length).toBeGreaterThan(0);
    expect(batchSizes.length).toBeLessThan(12);
    expect(batchSizes.reduce((total, size) => total + size, 0)).toBe(12);
    expect(sent.agentContext?.mode).toBe("summarized");
    expect(sent.agentContext?.contextText).toContain("第12章批量摘要");
    expect(sent.agentContext?.contextText).not.toContain(longText);

    db.close();
  });

  it("uses the selected model context length before deciding to compress all chapters", async () => {
    let summarized = false;
    const capturedInputs: unknown[] = [];
    const textThatExceedsDefaultBudget = "大上下文正文。".repeat(3000);
    const chatGenerator = {
      async summarizeContextBatchForContext() {
        summarized = true;
        return "不应该压缩";
      },
      async sendAgentMessageStream(input: unknown) {
        capturedInputs.push(input);
        return {
          role: "assistant",
          content: "大上下文总结",
          createdAt: "2026-04-29T00:00:00.000Z"
        };
      }
    } as AiChatGenerator;
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const repo = chapterRepo(project.id);
    repo.rename(initialChapter.id, "第1章 起点", new Date().toISOString());
    repo.saveContent(
      initialChapter.id,
      emptyChapterContent,
      textThatExceedsDefaultBudget,
      textThatExceedsDefaultBudget.length,
      0,
      "2026-04-29",
      new Date().toISOString()
    );
    for (let index = 2; index <= 4; index += 1) {
      createChapter(repo, {
        projectId: project.id,
        title: `第${index}章`,
        sortOrder: index - 1,
        plainText: textThatExceedsDefaultBudget
      });
    }
    const aiTaskService = new AiTaskService(
      aiTaskRepo,
      undefined,
      chatGenerator,
      chatRepo,
      scratchRepo,
      chapterRepo,
      undefined,
      () => getTokenBudget("chat", 1_048_576)
    );
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_large_model_direct",
      projectId: project.id,
      sessionId: session.id,
      message: "@全部章节 总结现有剧情",
      chapterId: initialChapter.id
    });

    const sent = capturedInputs[0] as { agentContext?: { mode: string; contextText: string } };
    expect(summarized).toBe(false);
    expect(sent.agentContext?.mode).toBe("direct");
    expect(sent.agentContext?.contextText).toContain(textThatExceedsDefaultBudget);

    db.close();
  });

  it("forwards streamed reasoning chunks from chat generation handlers", async () => {
    const reasoningChunks: string[] = [];
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(_input, handlers) {
        (handlers as unknown as { onReasoning?: (event: { readonly requestId: string; readonly content: string }) => void }).onReasoning?.({
          requestId: "chat_stream_reasoning",
          content: "先判断章节范围。"
        });
        return {
          role: "assistant",
          content: "总结结果",
          createdAt: "2026-04-29T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project } = projectService.createProject({ name: "雨夜" });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });
    const handlers = {
      onReasoning(event: { readonly content: string }) {
        reasoningChunks.push(event.content);
      }
    };

    await aiTaskService.sendChatMessageStream(
      {
        requestId: "chat_stream_reasoning",
        projectId: project.id,
        sessionId: session.id,
        message: "总结本章"
      },
      handlers as never
    );

    expect(reasoningChunks).toEqual(["先判断章节范围。"]);

    db.close();
  });

  it("forwards reasoning chunks from inline chat writing operations", async () => {
    const streamEvents: string[] = [];
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo, summaryRepo } = createServices();
    const { project } = projectService.createProject({ name: "雨夜" });
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream() {
        throw new Error("inline writing operation should not fall through to the agent generator");
      }
    };
    const runner = new WritingOperationRunner({
      resolveChapterRepo: (projectId) => chapterRepo(projectId),
      resolveSummaryRepo: (projectId) => summaryRepo(projectId),
      resolveTaskPreset: () => null,
      resolveModelConfig: async () => ({
        apiKey: "sk-or-v1-test",
        modelName: "test/model",
        contextLength: null
      }),
      createClient: () => ({
        async createChatCompletion() {
          throw new Error("inline chat writing operation should use streamChatCompletion");
        },
        async streamChatCompletion(input: OpenRouterChatCompletionInput, handlers?: OpenRouterStreamHandlers) {
          expect(input.reasoning).not.toMatchObject({ exclude: true });
          handlers?.onReasoning?.("先判断润色目标和边界。");
          handlers?.onToken?.("萧炎缓缓垂下眼，紧攥的指节在袖中一点点泛白。");
          return {
            content: "萧炎缓缓垂下眼，紧攥的指节在袖中一点点泛白。",
            truncated: false
          };
        }
      })
    });
    const aiTaskService = new AiTaskService(
      aiTaskRepo,
      undefined,
      chatGenerator,
      chatRepo,
      scratchRepo,
      chapterRepo,
      undefined,
      () => getTokenBudget("chat"),
      runner,
      summaryRepo
    );
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream(
      {
        requestId: "chat_inline_reasoning",
        projectId: project.id,
        sessionId: session.id,
        message: "萧炎垂下眼，指节慢慢攥紧。\n帮我润色一下"
      },
      {
        onChunk(event) {
          streamEvents.push(`chunk:${event.content}`);
        },
        onReasoning(event) {
          streamEvents.push(`reasoning:${event.content}`);
        }
      }
    );

    expect(streamEvents).toEqual([
      "reasoning:先判断润色目标和边界。",
      "chunk:【润色稿】\n",
      "chunk:萧炎缓缓垂下眼，紧攥的指节在袖中一点点泛白。"
    ]);

    db.close();
  });

  it("forwards estimated context usage from chat generation handlers", async () => {
    const contextEvents: AiStreamContextEvent[] = [];
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(_input, handlers) {
        handlers.onContext?.({
          requestId: "chat_stream_context",
          estimatedInputTokens: 4800,
          maxInputTokens: 12_000,
          maxOutputTokens: 4096,
          modelContextTokens: 16_384,
          modelName: "google/gemini-2.5-pro",
          contextMode: "direct",
          scopeLabel: "本章"
        });
        return {
          role: "assistant",
          content: "总结结果",
          createdAt: "2026-04-29T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project } = projectService.createProject({ name: "雨夜" });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream(
      {
        requestId: "chat_stream_context",
        projectId: project.id,
        sessionId: session.id,
        message: "总结本章"
      },
      {
        onContext(event) {
          contextEvents.push(event);
        }
      }
    );

    expect(contextEvents[0]).toEqual(
      {
        requestId: "chat_stream_context",
        estimatedInputTokens: 4800,
        maxInputTokens: 12_000,
        maxOutputTokens: 4096,
        modelContextTokens: 16_384,
        modelName: "google/gemini-2.5-pro",
        contextMode: "direct",
        scopeLabel: "本章",
        memoryCompacted: false,
        memoryCompactedThisRun: false
      }
    );
    expect(contextEvents.at(-1)).toMatchObject({
      requestId: "chat_stream_context",
      scopeLabel: "会话背景窗口"
    });
    expect(contextEvents.at(-1)?.estimatedInputTokens).toBeGreaterThan(4800);

    db.close();
  });

  it("persists the latest chat context usage on the active session", async () => {
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(_input, handlers) {
        handlers.onContext?.({
          requestId: "chat_stream_persist_context",
          estimatedInputTokens: 7200,
          maxInputTokens: 12_000,
          maxOutputTokens: 4096,
          modelContextTokens: 32_768,
          modelName: "google/gemini-2.5-pro",
          contextMode: "summarized",
          scopeLabel: "全部章节"
        });
        return {
          role: "assistant",
          content: "总结结果",
          createdAt: "2026-04-29T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project } = projectService.createProject({ name: "雨夜" });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_persist_context",
      projectId: project.id,
      sessionId: session.id,
      message: "总结全部章节"
    });

    expect(aiTaskService.listChatSessions({ projectId: project.id })[0]).toMatchObject({
      id: session.id,
      lastContextUsage: {
        requestId: "chat_stream_persist_context",
        maxInputTokens: 12_000,
        maxOutputTokens: 4096,
        modelContextTokens: 32_768,
        modelName: "google/gemini-2.5-pro",
        contextMode: "summarized",
        scopeLabel: "会话背景窗口"
      }
    });
    expect(aiTaskService.listChatSessions({ projectId: project.id })[0].lastContextUsage?.estimatedInputTokens).toBeGreaterThan(7200);

    db.close();
  });

  it("keeps the session context meter from dropping on a smaller follow-up request", async () => {
    const emittedUsages = [
      {
        requestId: "chat_stream_context_large",
        estimatedInputTokens: 7200,
        maxInputTokens: 12_000,
        maxOutputTokens: 4096,
        modelContextTokens: 80_000,
        modelName: "google/gemini-2.5-pro",
        contextMode: "direct",
        scopeLabel: "全部章节"
      },
      {
        requestId: "chat_stream_context_small",
        estimatedInputTokens: 2400,
        maxInputTokens: 12_000,
        maxOutputTokens: 4096,
        modelContextTokens: 80_000,
        modelName: "google/gemini-2.5-pro",
        contextMode: "direct",
        scopeLabel: "当前章节"
      }
    ] satisfies AiStreamContextEvent[];
    let generationIndex = 0;
    const observedContextEvents: AiStreamContextEvent[] = [];
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(_input, handlers) {
        handlers.onContext?.(emittedUsages[generationIndex]);
        generationIndex += 1;
        return {
          role: "assistant",
          content: generationIndex === 2 ? "第二轮回答继续占用会话上下文。".repeat(120) : `回复 ${generationIndex}`,
          createdAt: "2026-04-29T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project } = projectService.createProject({ name: "雨夜" });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream(
      {
        requestId: "chat_stream_context_large",
        projectId: project.id,
        sessionId: session.id,
        message: "总结全部章节"
      },
      {
        onContext(event) {
          observedContextEvents.push(event);
        }
      }
    );
    await aiTaskService.sendChatMessageStream(
      {
        requestId: "chat_stream_context_small",
        projectId: project.id,
        sessionId: session.id,
        message: "润色当前章节"
      },
      {
        onContext(event) {
          observedContextEvents.push(event);
        }
      }
    );

    expect(observedContextEvents.at(-1)).toMatchObject({
      requestId: "chat_stream_context_small",
      scopeLabel: "会话背景窗口"
    });
    expect(observedContextEvents.at(-1)?.estimatedInputTokens).toBeGreaterThan(7200);
    expect(aiTaskService.listChatSessions({ projectId: project.id })[0].lastContextUsage).toMatchObject({
      requestId: "chat_stream_context_small",
      scopeLabel: "会话背景窗口"
    });
    expect(aiTaskService.listChatSessions({ projectId: project.id })[0].lastContextUsage?.estimatedInputTokens).toBeGreaterThan(7200);

    db.close();
  });

  it("uses the tool-call agent chat path when the generator supports it", async () => {
    const capturedToolNames: string[] = [];
    let plannerCalled = false;
    let toolResultText = "";
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(input) {
        capturedToolNames.push(...input.tools.map((tool) => tool.function.name));
        const toolResult = await input.executeTool({
          id: "call_read_all",
          name: "read_chapters",
          argumentsJson: JSON.stringify({
            scope: {
              type: "all_chapters"
            }
          })
        });
        toolResultText = toolResult.content;
        return {
          role: "assistant",
          content: "基于工具读取的全部章节总结。",
          createdAt: "2026-04-30T00:00:00.000Z"
        };
      }
    };
    const planner: ChatPlanner = {
      async plan() {
        plannerCalled = true;
        throw new Error("tool-call agent path should bypass planner");
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const repo = chapterRepo(project.id);
    repo.rename(initialChapter.id, "第1章 起点", new Date().toISOString());
    repo.saveContent(initialChapter.id, emptyChapterContent, "第一章数据库真实正文。", 10, 0, "2026-04-30", new Date().toISOString());
    createChapter(repo, {
      projectId: project.id,
      title: "第2章 暗潮",
      sortOrder: 1,
      plainText: "第二章数据库真实正文。"
    });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo, planner);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_agent_path",
      projectId: project.id,
      sessionId: session.id,
      message: "总结现有的全部章节的内容",
      chapterId: initialChapter.id,
      currentChapterTitle: "renderer 旧标题",
      chapterExcerpt: "renderer 旧正文"
    });

    expect(plannerCalled).toBe(false);
    expect(capturedToolNames).toContain("read_chapters");
    expect(toolResultText).toContain("第一章数据库真实正文。");
    expect(toolResultText).toContain("第二章数据库真实正文。");
    expect(toolResultText).not.toContain("renderer 旧正文");

    db.close();
  });

  it("does not run the legacy planner before the tool-call agent for natural short-range requests", async () => {
    const capturedInputs: unknown[] = [];
    let plannerCalled = false;
    let toolResultText = "";
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(input) {
        capturedInputs.push(input);
        const toolResult = await input.executeTool({
          id: "call_read_first_two",
          name: "read_chapters",
          argumentsJson: JSON.stringify({
            scope: "chapter_range",
            from: 1,
            to: 2
          })
        });
        toolResultText = toolResult.content;
        return {
          role: "assistant",
          content: "前两章总结。",
          createdAt: "2026-05-01T00:00:00.000Z"
        };
      }
    };
    const planner: ChatPlanner = {
      async plan() {
        plannerCalled = true;
        throw new Error("tool-call agent path must not pre-run the legacy planner");
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo, summaryRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const repo = chapterRepo(project.id);
    repo.rename(initialChapter.id, "第1章 雨夜", new Date().toISOString());
    repo.saveContent(
      initialChapter.id,
      emptyChapterContent,
      "第一章不应被旧链路读取的原始正文。".repeat(1200),
      1000,
      0,
      "2026-05-01",
      new Date().toISOString()
    );
    const second = createChapter(repo, {
      projectId: project.id,
      title: "第2章 旧信",
      sortOrder: 1,
      plainText: "第二章不应被旧链路读取的原始正文。".repeat(1200)
    });
    const summaries = summaryRepo(project.id);
    [
      { chapter: initialChapter, title: "第1章 雨夜", ordinal: 1, short: "林远雨夜回城。", long: "林远在雨夜回到旧城，发现异常。" },
      { chapter: second, title: "第2章 旧信", ordinal: 2, short: "旧信提供新线索。", long: "旧信让林远确认失踪故人仍有线索可追。" }
    ].forEach((item) => {
      summaries.upsertChapterSummary({
        id: `summary_short_range_agent_${item.ordinal}`,
        projectId: project.id,
        chapterId: item.chapter.id,
        chapterTitle: item.title,
        chapterOrder: item.ordinal,
        contentHash: computeChapterContentHash(`chapter-${item.ordinal}`),
        summaryShort: item.short,
        summaryLong: item.long,
        structured: createChapterSummaryPayload({ oneLine: item.short, synopsis: item.long }),
        tokenCount: 30,
        status: "ready",
        error: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z"
      });
    });
    const aiTaskService = new AiTaskService(
      aiTaskRepo,
      undefined,
      chatGenerator,
      chatRepo,
      scratchRepo,
      chapterRepo,
      planner,
      () => getTokenBudget("chat"),
      undefined,
      summaryRepo
    );
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_short_range_agent_no_legacy",
      projectId: project.id,
      sessionId: session.id,
      message: "帮我总结前两章的内容",
      chapterId: initialChapter.id
    });

    expect(plannerCalled).toBe(false);
    expect((capturedInputs[0] as { agentContext?: { readonly scopeLabel?: string; readonly indexMode?: string; readonly contextText?: string } }).agentContext).toMatchObject({
      scopeLabel: "第1-2章摘要索引",
      indexMode: "summary_cache"
    });
    expect(JSON.stringify(capturedInputs[0])).not.toContain("不应被旧链路读取的原始正文");
    expect(toolResultText).toContain("章节范围摘要索引");
    expect(toolResultText).toContain('"indexMode":"summary_cache"');
    expect(toolResultText).toContain("林远雨夜回城。");
    expect(toolResultText).toContain("旧信让林远确认失踪故人仍有线索可追。");
    expect(toolResultText).not.toContain("不应被旧链路读取的原始正文");

    db.close();
  });

  it("does not pre-run the legacy planner for open-ended natural chat before the tool-call agent", async () => {
    const capturedInputs: unknown[] = [];
    let plannerCalled = false;
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(input) {
        capturedInputs.push(input);
        return {
          role: "assistant",
          content: "可以，我会先判断需要读取哪些上下文。",
          createdAt: "2026-05-01T00:00:00.000Z"
        };
      }
    };
    const planner: ChatPlanner = {
      async plan() {
        plannerCalled = true;
        throw new Error("tool-call agent should decide context without a legacy planner preflight");
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo, planner);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_open_ended_no_legacy_planner",
      projectId: project.id,
      sessionId: session.id,
      message: "这个人物的动机合理吗？",
      chapterId: initialChapter.id
    });

    expect(plannerCalled).toBe(false);
    expect(capturedInputs).toHaveLength(1);
    expect((capturedInputs[0] as { readonly agentContext?: unknown }).agentContext).toBeUndefined();

    db.close();
  });

  it("uses the persisted summary index for all-chapter read_chapters tools when the service has a summary repository", async () => {
    let toolResultText = "";
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(input) {
        const toolResult = await input.executeTool({
          id: "call_read_all_summary_index",
          name: "read_chapters",
          argumentsJson: JSON.stringify({
            scope: "all_chapters"
          })
        });
        toolResultText = toolResult.content;
        return {
          role: "assistant",
          content: "基于全书摘要索引回答。",
          createdAt: "2026-05-01T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo, summaryRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const repo = chapterRepo(project.id);
    repo.rename(initialChapter.id, "第1章 雨夜", new Date().toISOString());
    repo.saveContent(
      initialChapter.id,
      emptyChapterContent,
      "第一章不应出现在对话上下文里的原始正文。".repeat(1200),
      1000,
      0,
      "2026-05-01",
      new Date().toISOString()
    );
    const second = createChapter(repo, {
      projectId: project.id,
      title: "第2章 旧信",
      sortOrder: 1,
      plainText: "第二章不应出现在对话上下文里的原始正文。".repeat(1200)
    });
    const summaries = summaryRepo(project.id);
    summaries.upsertChapterSummary({
      id: "summary_1",
      projectId: project.id,
      chapterId: initialChapter.id,
      chapterTitle: "第1章 雨夜",
      chapterOrder: 1,
      contentHash: computeChapterContentHash("chapter-1"),
      summaryShort: "林远雨夜回城。",
      summaryLong: "林远在雨夜回到旧城，发现异常。",
      structured: createChapterSummaryPayload({ oneLine: "林远雨夜回城。", synopsis: "林远在雨夜回到旧城，发现异常。" }),
      tokenCount: 30,
      status: "ready",
      error: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    summaries.upsertChapterSummary({
      id: "summary_2",
      projectId: project.id,
      chapterId: second.id,
      chapterTitle: "第2章 旧信",
      chapterOrder: 2,
      contentHash: computeChapterContentHash("chapter-2"),
      summaryShort: "旧信提供新线索。",
      summaryLong: "旧信让林远确认失踪故人仍有线索可追。",
      structured: createChapterSummaryPayload({ oneLine: "旧信提供新线索。", synopsis: "旧信让林远确认失踪故人仍有线索可追。" }),
      tokenCount: 30,
      status: "ready",
      error: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    summaries.upsertArcSummary({
      id: "arc_summary_1",
      projectId: project.id,
      arcKey: "auto:001-002",
      chapterFrom: 1,
      chapterTo: 2,
      sourceHash: computeSourceHash(["chapter-1", "chapter-2"]),
      summary: "第1-2章中，林远回城并获得旧信线索。",
      structured: arcIndexPayloadV2(),
      status: "ready",
      error: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    summaries.upsertBookSummary({
      id: "book_summary_1",
      projectId: project.id,
      sourceHash: "book-source",
      summaryShort: "林远回城追查旧信。",
      summaryLong: "林远回到旧城，凭旧信开始追查失踪故人的真相。",
      structured: bookIndexPayloadV2(),
      status: "ready",
      error: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    const aiTaskService = new AiTaskService(
      aiTaskRepo,
      undefined,
      chatGenerator,
      chatRepo,
      scratchRepo,
      chapterRepo,
      undefined,
      () => getTokenBudget("chat"),
      undefined,
      summaryRepo
    );
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_agent_summary_index",
      projectId: project.id,
      sessionId: session.id,
      message: "总结现有的全部章节",
      chapterId: initialChapter.id
    });

    expect(toolResultText).toContain("全书摘要索引");
    expect(toolResultText).toContain('"indexMode":"summary_cache"');
    expect(toolResultText).toContain('"indexedChapterCount":2');
    expect(toolResultText).toContain("林远回到旧城，凭旧信开始追查失踪故人的真相。");
    expect(toolResultText).toContain("第1-2章中，林远回城并获得旧信线索。");
    expect(toolResultText).not.toContain("不应出现在对话上下文里的原始正文");

    db.close();
  });

  it("uses character-focused summary indexes for scoped follow-up questions", async () => {
    let toolResultText = "";
    let plannerCalled = false;
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(input) {
        const agentInput = input as typeof input & { readonly agentContext?: { readonly scopeLabel?: string } };
        expect(agentInput.agentContext?.scopeLabel).toBe("第1-2章摘要索引");
        const toolResult = await input.executeTool({
          id: "call_read_character_focus",
          name: "read_chapters",
          argumentsJson: JSON.stringify({
            scope: "chapter_range",
            from: 1,
            to: 2,
            focus: "characters"
          })
        });
        toolResultText = toolResult.content;
        return {
          role: "assistant",
          content: "前两章角色特征如下。",
          createdAt: "2026-05-01T00:00:00.000Z"
        };
      }
    };
    const planner: ChatPlanner = {
      async plan() {
        plannerCalled = true;
        throw new Error("follow-up scope should be resolved before asking planner");
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo, summaryRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const repo = chapterRepo(project.id);
    repo.rename(initialChapter.id, "第1章 雨夜", new Date().toISOString());
    repo.saveContent(initialChapter.id, emptyChapterContent, "第一章角色原文不应进入工具结果。", 20, 0, "2026-05-01", new Date().toISOString());
    const second = createChapter(repo, {
      projectId: project.id,
      title: "第2章 旧信",
      sortOrder: 1,
      plainText: "第二章角色原文不应进入工具结果。"
    });
    const summaries = summaryRepo(project.id);
    [
      { chapter: initialChapter, title: "第1章 雨夜", ordinal: 1, character: "林远", state: "谨慎回城" },
      { chapter: second, title: "第2章 旧信", ordinal: 2, character: "沈青", state: "因旧信线索开始动摇" }
    ].forEach((item) => {
      const structured = createChapterSummaryPayload({
        oneLine: `${item.character}人物线推进。`,
        synopsis: `${item.character}在本章出现关键状态变化。`
      });
      structured.人物状态[0] = {
        ...structured.人物状态[0],
        人物: item.character,
        本章结束状态: item.state,
        情绪状态: item.state,
        新获得信息: [`${item.character}获得旧信相关信息`]
      };
      structured.人物认知边界[0] = {
        ...structured.人物认知边界[0],
        人物: item.character,
        已经知道: [`${item.character}知道旧信存在`],
        尚不知道: [`${item.character}尚不知道旧信全部来源`]
      };
      summaries.upsertChapterSummary({
        id: `summary_character_followup_${item.ordinal}`,
        projectId: project.id,
        chapterId: item.chapter.id,
        chapterTitle: item.title,
        chapterOrder: item.ordinal,
        contentHash: computeChapterContentHash(`character-followup-${item.ordinal}`),
        summaryShort: `${item.character}人物线推进。`,
        summaryLong: `${item.character}在本章出现关键状态变化。`,
        structured,
        tokenCount: 50,
        status: "ready",
        error: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z"
      });
    });
    const session = chatRepo(project.id).getOrCreateDefaultSession(project.id);
    chatRepo(project.id).createMessage({
      projectId: project.id,
      sessionId: session.id,
      role: "user",
      content: "帮我总结前两章的内容",
      action: null
    });
    chatRepo(project.id).createMessage({
      projectId: project.id,
      sessionId: session.id,
      role: "assistant",
      content: "前两章总结如下。",
      action: { type: "none" }
    });
    const aiTaskService = new AiTaskService(
      aiTaskRepo,
      undefined,
      chatGenerator,
      chatRepo,
      scratchRepo,
      chapterRepo,
      planner,
      () => getTokenBudget("chat"),
      undefined,
      summaryRepo
    );

    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_character_focus_followup",
      projectId: project.id,
      sessionId: session.id,
      message: "同时告诉我出现了哪些角色，有什么特征",
      chapterId: initialChapter.id
    });

    expect(plannerCalled).toBe(false);
    expect(toolResultText).toContain('"scopeLabel":"第1-2章人物索引"');
    expect(toolResultText).toContain("人物状态");
    expect(toolResultText).toContain("人物认知边界");
    expect(toolResultText).toContain("林远");
    expect(toolResultText).toContain("沈青");
    expect(toolResultText).not.toContain("角色原文不应进入工具结果");

    db.close();
  });

  it("exposes writing operation tools to the agent even without an explicit slash skill", async () => {
    const toolNamesByRequest: string[][] = [];
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(input) {
        toolNamesByRequest.push(input.tools.map((tool) => tool.function.name));
        return {
          role: "assistant",
          content: "收到。",
          createdAt: "2026-05-01T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_without_skill",
      projectId: project.id,
      sessionId: session.id,
      message: "这段文字润色一下",
      chapterId: initialChapter.id,
      currentChapterTitle: "第1章"
    });
    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_with_skill",
      projectId: project.id,
      sessionId: session.id,
      message: "@当前章节 /润色 这段文字润色一下",
      chapterId: initialChapter.id,
      currentChapterTitle: "第1章"
    });

    expect(toolNamesByRequest[0]).toContain("run_writing_operation");
    expect(toolNamesByRequest[1]).toContain("run_writing_operation");

    db.close();
  });

  it("compacts long chat history before the tool-call agent prompt", async () => {
    const capturedInputs: unknown[] = [];
    const compactedMessages: string[] = [];
    const observedContextEvents: AiStreamContextEvent[] = [];
    const chatGenerator: AiChatGenerator = {
      async summarizeChatHistoryForMemory(input) {
        compactedMessages.push(...input.messages.map((message) => message.content));
        return {
          summary: "压缩记忆：作者正在围绕全部章节总结与角色特征连续追问。"
        };
      },
      async sendAgentMessageStream(input, handlers) {
        capturedInputs.push(input);
        handlers.onContext?.({
          requestId: "generator_context_after_compaction",
          estimatedInputTokens: 600,
          maxInputTokens: 2200,
          maxOutputTokens: 512,
          modelContextTokens: null,
          modelName: "test/model",
          contextMode: "summarized",
          scopeLabel: "压缩记忆"
        });
        return {
          role: "assistant",
          content: "已基于压缩记忆继续回答。",
          createdAt: "2026-04-30T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "长对话" });
    const repo = chatRepo(project.id);
    const session = repo.getOrCreateDefaultSession(project.id);
    for (let index = 0; index < 18; index += 1) {
      repo.createMessage({
        projectId: project.id,
        sessionId: session.id,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `第${index}轮长对话内容。`.repeat(260),
      action: index % 2 === 0 ? null : { type: "none" }
      });
    }
    repo.updateSessionContextUsage({
      projectId: project.id,
      sessionId: session.id,
      contextUsage: {
        requestId: "previous_large_context",
        estimatedInputTokens: 1600,
        maxInputTokens: 2200,
        maxOutputTokens: 512,
        modelContextTokens: null,
        modelName: "test/model",
        contextMode: "direct",
        scopeLabel: "全部章节"
      }
    });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo, undefined, () => ({
      maxInputTokens: 2200,
      maxOutputTokens: 512
    }));

    await aiTaskService.sendChatMessageStream(
      {
        requestId: "chat_stream_compact_memory",
        projectId: project.id,
        sessionId: session.id,
        message: "继续分析这些角色的变化",
        chapterId: initialChapter.id
      },
      {
        onContext(event) {
          observedContextEvents.push(event);
        }
      }
    );

    const sent = capturedInputs[0] as {
      readonly compactedMemorySummary?: string | null;
      readonly compactedMemoryThroughMessageId?: string | null;
      readonly history: readonly AiChatMessageRecord[];
    };
    const refreshedSession = repo.getOrCreateDefaultSession(project.id);
    expect(compactedMessages.length).toBeGreaterThan(0);
    expect(sent.history).toHaveLength(18);
    expect(sent.compactedMemorySummary).toContain("压缩记忆");
    expect(sent.compactedMemoryThroughMessageId).toBeTruthy();
    expect(refreshedSession.compactedMemorySummary).toContain("压缩记忆");
    expect(refreshedSession.compactedMemoryThroughMessageId).toBe(sent.compactedMemoryThroughMessageId);
    expect(observedContextEvents.at(-1)).toMatchObject({
      requestId: "chat_stream_compact_memory",
      contextMode: "summarized",
      scopeLabel: "会话背景窗口"
    });
    expect(observedContextEvents.at(-1)?.estimatedInputTokens).toBeGreaterThan(1600);
    expect(refreshedSession.lastContextUsage).toMatchObject({
      requestId: "chat_stream_compact_memory",
      contextMode: "summarized",
      scopeLabel: "会话背景窗口"
    });
    expect(refreshedSession.lastContextUsage?.estimatedInputTokens).toBeGreaterThan(1600);

    db.close();
  });

  it("does not persist cancellation as an AI error message", async () => {
    let capturedSignal: AbortSignal | null = null;
    let signalCaptured!: () => void;
    const signalReady = new Promise<void>((resolve) => {
      signalCaptured = resolve;
    });
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(_input, _handlers, options): Promise<AiChatMessageResult> {
        capturedSignal = options?.signal ?? null;
        signalCaptured();
        return new Promise<AiChatMessageResult>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("canceled")), { once: true });
        });
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project } = projectService.createProject({ name: "雨夜" });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });
    const errorEvents: string[] = [];
    const pending = aiTaskService.sendChatMessageStream(
      {
        requestId: "chat_stream_cancel",
        projectId: project.id,
        sessionId: session.id,
        message: "总结本章"
      },
      {
        onError(event) {
          errorEvents.push(event.error);
        }
      }
    );

    await signalReady;
    const signal = requireAbortSignal(capturedSignal);
    expect(signal.aborted).toBe(false);
    aiTaskService.cancelStream({ requestId: "chat_stream_cancel" });

    await expect(pending).resolves.toMatchObject({
      action: null,
      messages: [
        {
          role: "user",
          content: "总结本章"
        }
      ]
    });
    expect(errorEvents).toEqual([]);
    expect(chatRepo(project.id).listMessages({ projectId: project.id, sessionId: session.id }).map((message) => message.role)).toEqual(["user"]);

    db.close();
  });

  it("inherits the previous all-chapters scope for follow-up chat questions", async () => {
    const capturedInputs: unknown[] = [];
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(input) {
        capturedInputs.push(input);
        return {
          role: "assistant",
          content: "角色分析结果",
          createdAt: "2026-04-30T00:00:00.000Z"
        };
      }
    };
    const planner: ChatPlanner = {
      async plan() {
        return {
          intent: "answer",
          scope: {
            type: "selection"
          },
          needsClarification: true,
          clarificationQuestion: "不应该询问范围",
          actions: []
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "斗气大陆" });
    const repo = chapterRepo(project.id);
    repo.rename(initialChapter.id, "第1章 陨落的天才", new Date().toISOString());
    repo.saveContent(initialChapter.id, emptyChapterContent, "萧炎在测验中受挫，萧薰儿关心他的处境。", 22, 0, "2026-04-30", new Date().toISOString());
    createChapter(repo, {
      projectId: project.id,
      title: "第2章 斗气大陆",
      sortOrder: 1,
      plainText: "药老留下伏笔，斗气大陆的修炼规则被介绍。"
    });
    createChapter(repo, {
      projectId: project.id,
      title: "第3章 客人",
      sortOrder: 2,
      plainText: "纳兰嫣然和云岚宗来客进入萧家。"
    });
    const session = chatRepo(project.id).getOrCreateDefaultSession(project.id);
    chatRepo(project.id).createMessage({
      projectId: project.id,
      sessionId: session.id,
      role: "user",
      content: "帮我总结现有所有章节的内容",
      action: null
    });
    chatRepo(project.id).createMessage({
      projectId: project.id,
      sessionId: session.id,
      role: "assistant",
      content: "目前全部章节总结如下。",
      action: {
        type: "none"
      }
    });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo, planner);

    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_followup_scope",
      projectId: project.id,
      sessionId: session.id,
      message: "同时告诉我出现了哪些角色，有什么特征",
      chapterId: initialChapter.id
    });

    const sent = capturedInputs[0] as { readonly agentContext?: { readonly scopeLabel: string; readonly contextText: string } };
    expect(sent.agentContext?.scopeLabel).toBe("全部章节");
    expect(sent.agentContext?.contextText).toContain("萧炎");
    expect(sent.agentContext?.contextText).toContain("药老");
    expect(sent.agentContext?.contextText).toContain("纳兰嫣然");

    db.close();
  });

  it("summarizes oversized chapter ranges before final chat generation", async () => {
    const summarizedChapters: string[] = [];
    const capturedInputs: unknown[] = [];
    const longText = "长章节正文。".repeat(20000);
    const chatGenerator: AiChatGenerator & {
      summarizeChapterForContext: NonNullable<AiChatGenerator["summarizeChapterForContext"]>;
    } = {
      async summarizeChapterForContext(input) {
        summarizedChapters.push(input.title);
        return `${input.title} 摘要`;
      },
      async sendAgentMessageStream(input) {
        capturedInputs.push(input);
        return {
          role: "assistant",
          content: "汇总后的全书总结",
          createdAt: "2026-04-29T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const repo = chapterRepo(project.id);
    repo.rename(initialChapter.id, "第1章 长夜", new Date().toISOString());
    repo.saveContent(initialChapter.id, emptyChapterContent, longText, longText.length, 0, "2026-04-29", new Date().toISOString());
    createChapter(repo, {
      projectId: project.id,
      title: "第2章 暗潮",
      sortOrder: 1,
      plainText: longText
    });
    createChapter(repo, {
      projectId: project.id,
      title: "第3章 转折",
      sortOrder: 2,
      plainText: longText
    });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_map_reduce",
      projectId: project.id,
      sessionId: session.id,
      message: "@全部章节 总结现有剧情",
      chapterId: initialChapter.id
    });

    const sent = capturedInputs[0] as { agentContext?: { mode: string; contextText: string } };
    expect(summarizedChapters).toEqual(["第1章 长夜", "第2章 暗潮", "第3章 转折"]);
    expect(sent.agentContext?.mode).toBe("summarized");
    expect(sent.agentContext?.contextText).toContain("第1章 长夜 摘要");
    expect(sent.agentContext?.contextText).toContain("第2章 暗潮 摘要");
    expect(sent.agentContext?.contextText).not.toContain(longText);

    db.close();
  });

  it("merges oversized chapter summaries before final chat generation", async () => {
    let mergeCallCount = 0;
    const capturedInputs: unknown[] = [];
    const longText = "长章节正文。".repeat(20000);
    const chatGenerator: AiChatGenerator & {
      summarizeChapterForContext: NonNullable<AiChatGenerator["summarizeChapterForContext"]>;
      mergeContextSummaries: NonNullable<AiChatGenerator["mergeContextSummaries"]>;
    } = {
      async summarizeChapterForContext(input) {
        return `${input.title} ${"摘要".repeat(10000)}`;
      },
      async mergeContextSummaries(input) {
        mergeCallCount += 1;
        expect(input.summaries.map((summary) => summary.title)).toEqual(["第1章 长夜", "第2章 暗潮", "第3章 转折"]);
        return "聚合后的全书摘要";
      },
      async sendAgentMessageStream(input) {
        capturedInputs.push(input);
        return {
          role: "assistant",
          content: "基于聚合摘要的总结",
          createdAt: "2026-04-29T00:00:00.000Z"
        };
      }
    };
    const { aiTaskRepo, chapterRepo, chatRepo, db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "雨夜" });
    const repo = chapterRepo(project.id);
    repo.rename(initialChapter.id, "第1章 长夜", new Date().toISOString());
    repo.saveContent(initialChapter.id, emptyChapterContent, longText, longText.length, 0, "2026-04-29", new Date().toISOString());
    createChapter(repo, {
      projectId: project.id,
      title: "第2章 暗潮",
      sortOrder: 1,
      plainText: longText
    });
    createChapter(repo, {
      projectId: project.id,
      title: "第3章 转折",
      sortOrder: 2,
      plainText: longText
    });
    const aiTaskService = new AiTaskService(aiTaskRepo, undefined, chatGenerator, chatRepo, scratchRepo, chapterRepo);
    const session = aiTaskService.getChatSession({ projectId: project.id });

    await aiTaskService.sendChatMessageStream({
      requestId: "chat_stream_summary_merge",
      projectId: project.id,
      sessionId: session.id,
      message: "@全部章节 总结现有剧情",
      chapterId: initialChapter.id
    });

    const sent = capturedInputs[0] as { agentContext?: { mode: string; contextText: string } };
    expect(mergeCallCount).toBe(1);
    expect(sent.agentContext?.mode).toBe("summarized");
    expect(sent.agentContext?.contextText).toContain("聚合后的全书摘要");
    expect(sent.agentContext?.contextText).not.toContain("摘要".repeat(10000));

    db.close();
  });
});
