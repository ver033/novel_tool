import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SummaryWorker } from "../../src/main/ai/summary-worker";
import { OpenRouterError } from "../../src/main/ai/openrouter-error";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { SummaryRepository } from "../../src/main/db/repositories/summary-repo";

const tempDirs: string[] = [];
const createdAt = "2026-05-01T00:00:00.000Z";
const runAt = "2026-05-01T00:01:00.000Z";

function createDb(): SqliteDatabase {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-summary-worker-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "novel-tool.sqlite3"));
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run("project_1", "归途", createdAt, createdAt);
  return db;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("summary worker", () => {
  it("does not claim jobs while foreground AI is active", async () => {
    const db = createDb();
    const repo = new SummaryRepository(db);
    repo.enqueueSummaryJob({ projectId: "project_1", jobType: "chapter_summary", targetId: "chapter_1", sourceHash: "hash", priority: 1, now: createdAt });
    let calls = 0;
    const worker = new SummaryWorker({
      summaryRepo: repo,
      summaryService: {
        summarizeChapter: async () => {
          calls += 1;
        }
      },
      isForegroundAiActive: () => true,
      ensureAiConfigured: async () => undefined
    });

    const result = await worker.runOnce("project_1", runAt);

    expect(result.status).toBe("paused_foreground_ai");
    expect(calls).toBe(0);
    expect(db.prepare("SELECT status FROM summary_jobs").get()).toEqual({ status: "queued" });
    db.close();
  });

  it("does not claim jobs when AI settings are missing", async () => {
    const db = createDb();
    const repo = new SummaryRepository(db);
    repo.enqueueSummaryJob({ projectId: "project_1", jobType: "chapter_summary", targetId: "chapter_1", sourceHash: "hash", priority: 1, now: createdAt });
    const worker = new SummaryWorker({
      summaryRepo: repo,
      summaryService: {
        summarizeChapter: async () => undefined
      },
      isForegroundAiActive: () => false,
      ensureAiConfigured: async () => {
        throw new Error("OpenRouter API Key 未配置。");
      }
    });

    const result = await worker.runOnce("project_1", runAt);

    expect(result.status).toBe("paused_ai_unconfigured");
    expect(db.prepare("SELECT status FROM summary_jobs").get()).toEqual({ status: "queued" });
    db.close();
  });

  it("does not check AI settings when there is no runnable job", async () => {
    const db = createDb();
    const repo = new SummaryRepository(db);
    let configChecks = 0;
    const worker = new SummaryWorker({
      summaryRepo: repo,
      summaryService: {
        summarizeChapter: async () => undefined
      },
      isForegroundAiActive: () => false,
      ensureAiConfigured: async () => {
        configChecks += 1;
      }
    });

    const result = await worker.runOnce("project_1", runAt);

    expect(result.status).toBe("idle");
    expect(configChecks).toBe(0);
    db.close();
  });

  it("claims one queued chapter job and completes it after generation", async () => {
    const db = createDb();
    const repo = new SummaryRepository(db);
    const job = repo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: "hash",
      priority: 10,
      now: createdAt
    });
    const calls: string[] = [];
    const worker = new SummaryWorker({
      summaryRepo: repo,
      summaryService: {
        summarizeChapter: async (_projectId, chapterId) => {
          calls.push(chapterId);
        }
      },
      isForegroundAiActive: () => false,
      ensureAiConfigured: async () => undefined
    });

    const result = await worker.runOnce("project_1", runAt);

    expect(result).toMatchObject({ status: "completed", jobId: job.id });
    expect(calls).toEqual(["chapter_1"]);
    expect(db.prepare("SELECT status FROM summary_jobs WHERE id = ?").get(job.id)).toEqual({ status: "completed" });
    db.close();
  });

  it("backs off and requeues a new job after OpenRouter 429", async () => {
    const db = createDb();
    const repo = new SummaryRepository(db);
    const job = repo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: "hash",
      priority: 10,
      now: createdAt
    });
    const worker = new SummaryWorker({
      summaryRepo: repo,
      summaryService: {
        summarizeChapter: async () => {
          throw new OpenRouterError({ code: "rate_limited", status: 429, message: "OpenRouter 请求失败 (429)" });
        }
      },
      isForegroundAiActive: () => false,
      ensureAiConfigured: async () => undefined
    });

    const result = await worker.runOnce("project_1", runAt);

    expect(result.status).toBe("retry_scheduled");
    expect(db.prepare("SELECT status FROM summary_jobs WHERE id = ?").get(job.id)).toEqual({ status: "failed" });
    expect(db.prepare("SELECT status, next_run_at FROM summary_jobs WHERE id != ?").get(job.id)).toEqual({
      status: "queued",
      next_run_at: "2026-05-01T00:06:00.000Z"
    });
    db.close();
  });
});
