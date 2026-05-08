import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiTaskService, type AiChatGenerator, type AiChatMessageResult } from "../../src/main/ai/ai-task-service";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { AiChatRepository } from "../../src/main/db/repositories/ai-chat-repo";
import { AiTaskRepository } from "../../src/main/db/repositories/ai-task-repo";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import type { AiChatMessageRecord } from "../../src/main/shared/types";

const tempDirs: string[] = [];
const openDbs: SqliteDatabase[] = [];

type RegenerateChatService = AiTaskService & {
  readonly regenerateChatMessageStream: (
    input: {
      readonly requestId: string;
      readonly projectId: string;
      readonly sessionId: string;
      readonly assistantMessageId: string;
    },
    handlers?: Parameters<AiTaskService["sendChatMessageStream"]>[1]
  ) => ReturnType<AiTaskService["sendChatMessageStream"]>;
};

function createHarness(chatGenerator: AiChatGenerator) {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-ai-chat-regenerate-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "novel-tool.sqlite3"));
  openDbs.push(db);
  runMigrations(db);
  const now = "2026-05-08T00:00:00.000Z";
  const project = new ProjectRepository(db).create({
    id: "project_regenerate",
    name: "重试测试",
    rootPath: null,
    createdAt: now,
    updatedAt: now
  });
  const chatRepo = new AiChatRepository(db);
  const session = chatRepo.createSession({ projectId: project.id, title: "对话" });
  const service = new AiTaskService(
    new AiTaskRepository(db),
    undefined,
    chatGenerator,
    chatRepo,
    undefined,
    new ChapterRepository(db),
    undefined,
    () => ({ maxInputTokens: 12_000, maxOutputTokens: 12_000 })
  ) as RegenerateChatService;

  return { chatRepo, project, service, session };
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("AI chat answer regeneration", () => {
  it("replaces the latest assistant answer without creating a duplicate user message or replaying the old answer in history", async () => {
    const generatorInputs: { readonly message: string; readonly history: readonly AiChatMessageRecord[] }[] = [];
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(input): Promise<AiChatMessageResult> {
        generatorInputs.push(input);
        return {
          role: "assistant",
          content: "新的回答：节奏可以压缩成一段。",
          createdAt: "2026-05-08T00:10:00.000Z"
        };
      }
    };
    const { chatRepo, project, service, session } = createHarness(chatGenerator);
    chatRepo.createMessage({
      projectId: project.id,
      sessionId: session.id,
      role: "user",
      content: "更早的问题",
      action: null
    });
    chatRepo.createMessage({
      projectId: project.id,
      sessionId: session.id,
      role: "assistant",
      content: "更早的回答",
      action: { type: "none" }
    });
    chatRepo.createMessage({
      projectId: project.id,
      sessionId: session.id,
      role: "user",
      content: "上一条用户提问",
      action: null
    });
    const oldAssistant = chatRepo.createMessage({
      projectId: project.id,
      sessionId: session.id,
      role: "assistant",
      content: "旧回答：节奏不用改。",
      action: { type: "none" }
    });

    const result = await service.regenerateChatMessageStream({
      requestId: "chat_regenerate_1",
      projectId: project.id,
      sessionId: session.id,
      assistantMessageId: oldAssistant.id
    });

    const generatorInput = generatorInputs[0];
    if (!generatorInput) {
      throw new Error("generator input was not captured");
    }
    expect(generatorInput.message).toBe("上一条用户提问");
    expect(generatorInput.history.map((message) => message.content)).toEqual(["更早的问题", "更早的回答"]);
    expect(result.messages.map((message) => [message.role, message.content])).toEqual([["assistant", "新的回答：节奏可以压缩成一段。"]]);
    expect(chatRepo.listMessages({ projectId: project.id, sessionId: session.id }).map((message) => [message.role, message.content])).toEqual([
      ["user", "更早的问题"],
      ["assistant", "更早的回答"],
      ["user", "上一条用户提问"],
      ["assistant", "新的回答：节奏可以压缩成一段。"]
    ]);
  });

  it("keeps the old assistant answer when regeneration fails", async () => {
    const chatGenerator: AiChatGenerator = {
      async sendAgentMessageStream(): Promise<AiChatMessageResult> {
        throw new Error("模型暂时不可用");
      }
    };
    const { chatRepo, project, service, session } = createHarness(chatGenerator);
    chatRepo.createMessage({
      projectId: project.id,
      sessionId: session.id,
      role: "user",
      content: "请重写这段",
      action: null
    });
    const oldAssistant = chatRepo.createMessage({
      projectId: project.id,
      sessionId: session.id,
      role: "assistant",
      content: "旧回答仍然可见",
      action: { type: "none" }
    });
    const onError = vi.fn();

    await expect(
      service.regenerateChatMessageStream(
        {
          requestId: "chat_regenerate_fail",
          projectId: project.id,
          sessionId: session.id,
          assistantMessageId: oldAssistant.id
        },
        { onError }
      )
    ).rejects.toThrow("模型暂时不可用");

    expect(onError).toHaveBeenCalledWith({ requestId: "chat_regenerate_fail", error: "模型暂时不可用" });
    expect(chatRepo.listMessages({ projectId: project.id, sessionId: session.id }).map((message) => [message.role, message.content])).toEqual([
      ["user", "请重写这段"],
      ["assistant", "旧回答仍然可见"]
    ]);
  });

  it("rejects regenerating an assistant answer that has a following tool result", async () => {
    const chatGenerator: AiChatGenerator = {
      sendAgentMessageStream: vi.fn()
    };
    const { chatRepo, project, service, session } = createHarness(chatGenerator);
    chatRepo.createMessage({
      projectId: project.id,
      sessionId: session.id,
      role: "user",
      content: "把这段加入草稿纸",
      action: null
    });
    const assistant = chatRepo.createMessage({
      projectId: project.id,
      sessionId: session.id,
      role: "assistant",
      content: "已整理。",
      action: { type: "none" }
    });
    chatRepo.createMessage({
      projectId: project.id,
      sessionId: session.id,
      role: "tool",
      content: "已加入草稿纸。",
      action: {
        type: "add_to_scratchpad",
        content: "草稿内容",
        chapterId: null
      }
    });

    await expect(
      service.regenerateChatMessageStream({
        requestId: "chat_regenerate_tool",
        projectId: project.id,
        sessionId: session.id,
        assistantMessageId: assistant.id
      })
    ).rejects.toThrow("带有工具结果");

    expect(chatGenerator.sendAgentMessageStream).not.toHaveBeenCalled();
  });
});
