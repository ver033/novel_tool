import { mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test, vi } from "vitest";
import { AiTaskService, type AiChatGenerator } from "../src/main/ai/ai-task-service";
import { createDatabase } from "../src/main/db/database";
import { runMigrations } from "../src/main/db/migrations";
import { AiChatRepository } from "../src/main/db/repositories/ai-chat-repo";
import { ChapterRepository } from "../src/main/db/repositories/chapter-repo";
import { ProjectRepository } from "../src/main/db/repositories/project-repo";
import { ProjectService } from "../src/main/project/project-service";
import { resolveSaveCompletionStatus } from "../src/renderer/state/editor-store";

function createTempDatabase() {
  const dir = mkdtempSync(path.join(tmpdir(), "moshu-phase1-"));
  const db = createDatabase(path.join(dir, "test.sqlite3"));
  runMigrations(db);
  return db;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

describe("phase 1 regressions", () => {
  test("listRecentProjects preserves temporarily unavailable project entries with availability state", () => {
    const db = createTempDatabase();
    const repo = new ProjectRepository(db);
    const missingProject = repo.create({
      id: "project_missing",
      name: "Temporarily missing",
      rootPath: path.join(tmpdir(), "missing-project-file.noveltool"),
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    repo.setCurrentProject(missingProject.id, missingProject.updatedAt);

    const service = new ProjectService(repo);

    const recent = service.listRecentProjects();
    expect(recent[0]).toMatchObject({
      availability: "missing",
      project: expect.objectContaining({
        id: missingProject.id,
        name: "Temporarily missing"
      })
    });
    expect(repo.findById(missingProject.id)).not.toBeNull();
    expect(repo.getCurrentProjectId()).toBe(missingProject.id);
  });

  test("finishing an older stream does not remove a newer stream registered with the same request id", async () => {
    const db = createTempDatabase();
    const projectRepo = new ProjectRepository(db);
    projectRepo.create({
      id: "project_stream",
      name: "Stream Project",
      rootPath: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    const chatRepo = new AiChatRepository(db);
    const session = chatRepo.createSession({ projectId: "project_stream" });
    const first = createDeferred<Awaited<ReturnType<NonNullable<AiChatGenerator["sendAgentMessageStream"]>>>>();
    const second = createDeferred<Awaited<ReturnType<NonNullable<AiChatGenerator["sendAgentMessageStream"]>>>>();
    const calls: AbortSignal[] = [];
    const generator: AiChatGenerator = {
      sendAgentMessageStream(_input, _handlers, options) {
        if (!options?.signal) {
          throw new Error("missing signal");
        }
        calls.push(options.signal);
        return calls.length === 1 ? first.promise : second.promise;
      }
    };
    const service = new AiTaskService(
      (() => {
        throw new Error("task repo not used");
      }) as never,
      undefined,
      generator,
      () => chatRepo,
      undefined,
      () => new ChapterRepository(db),
      undefined,
      () => ({ maxInputTokens: 12_000, maxOutputTokens: 12_000 })
    );

    const requestId = "chat_stream_same";
    const firstRun = service.sendChatMessageStream({ requestId, projectId: "project_stream", sessionId: session.id, message: "first" });
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    const secondRun = service.sendChatMessageStream({ requestId, projectId: "project_stream", sessionId: session.id, message: "second" });
    await vi.waitFor(() => expect(calls).toHaveLength(2));

    first.reject(Object.assign(new Error("canceled"), { code: "ERR_CANCELED" }));
    await firstRun;

    try {
      service.cancelStream({ requestId });
      expect(calls[1].aborted).toBe(true);
    } finally {
      second.resolve({
        role: "assistant",
        content: "second response",
        createdAt: "2026-05-01T00:00:00.000Z"
      });
      await secondRun;
    }
  });

  test("save completion keeps the editor dirty when content changed while save was in flight", () => {
    expect(resolveSaveCompletionStatus({ saveStartedAtRevision: 2, currentRevision: 2 })).toBe("saved");
    expect(resolveSaveCompletionStatus({ saveStartedAtRevision: 2, currentRevision: 3 })).toBe("dirty");
  });
});
