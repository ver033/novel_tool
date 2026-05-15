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

  it("cancels the running job when the worker abort signal fires", async () => {
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
    const controller = new AbortController();
    let resolveSignalReady: (signal: AbortSignal) => void = () => undefined;
    const signalReady = new Promise<AbortSignal>((resolve) => {
      resolveSignalReady = resolve;
    });
    const worker = new SummaryWorker({
      summaryRepo: repo,
      summaryService: {
        summarizeChapter: async (_projectId, _chapterId, _sourceHash, _now, options) => {
          const signal = options?.signal;
          if (!signal) {
            throw new Error("expected abort signal");
          }
          resolveSignalReady(signal);
          await new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("canceled")), { once: true });
          });
        }
      },
      isForegroundAiActive: () => false,
      ensureAiConfigured: async () => undefined
    });

    const pending = worker.runOnce("project_1", runAt, { signal: controller.signal });
    const signal = await signalReady;
    expect(signal.aborted).toBe(false);
    controller.abort();

    await expect(pending).resolves.toMatchObject({ status: "cancelled", jobId: job.id });
    expect(db.prepare("SELECT status, error FROM summary_jobs WHERE id = ?").get(job.id)).toEqual({
      status: "cancelled",
      error: "摘要索引任务已取消。"
    });
    db.close();
  });

  it("can mark running jobs cancelled from repository controls", () => {
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
    expect(repo.claimNextSummaryJob("project_1", runAt)?.id).toBe(job.id);

    const changes = repo.cancelRunningJobs("project_1", "用户停止当前索引任务。", "2026-05-01T00:02:00.000Z");

    expect(changes).toBe(1);
    expect(db.prepare("SELECT status, error FROM summary_jobs WHERE id = ?").get(job.id)).toEqual({
      status: "cancelled",
      error: "用户停止当前索引任务。"
    });
    db.close();
  });

  it("can stop queued and running background jobs from repository controls", () => {
    const db = createDb();
    const repo = new SummaryRepository(db);
    const runningJob = repo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: "hash_1",
      priority: 10,
      now: createdAt
    });
    const queuedJob = repo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_2",
      sourceHash: "hash_2",
      priority: 5,
      now: createdAt
    });
    expect(repo.claimNextSummaryJob("project_1", runAt)?.id).toBe(runningJob.id);

    const changes = repo.cancelQueuedAndRunningJobs("project_1", "用户停止后台索引任务。", "2026-05-01T00:02:00.000Z");

    expect(changes).toBe(2);
    expect(db.prepare("SELECT status, error FROM summary_jobs WHERE id = ?").get(runningJob.id)).toEqual({
      status: "cancelled",
      error: "用户停止后台索引任务。"
    });
    expect(db.prepare("SELECT status, error FROM summary_jobs WHERE id = ?").get(queuedJob.id)).toEqual({
      status: "cancelled",
      error: "用户停止后台索引任务。"
    });
    db.close();
  });

  it("backs off once after OpenRouter 429 while keeping the failed attempt visible", async () => {
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
    expect(db.prepare("SELECT status, attempt_count, next_run_at, error FROM summary_jobs WHERE id = ?").get(job.id)).toEqual({
      status: "failed",
      attempt_count: 1,
      next_run_at: "2026-05-01T00:16:00.000Z",
      error: "OpenRouter 请求失败 (429)"
    });
    expect(db.prepare("SELECT status, attempt_count, next_run_at FROM summary_jobs WHERE id != ?").get(job.id)).toEqual({
      status: "queued",
      attempt_count: 1,
      next_run_at: "2026-05-01T00:16:00.000Z"
    });
    db.close();
  });

  it("does not automatically retry invalid summary index model output", async () => {
    const db = createDb();
    const repo = new SummaryRepository(db);
    repo.enqueueSummaryJob({
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
          throw new Error("章节索引摘要无效：Expected array, received string");
        }
      },
      isForegroundAiActive: () => false,
      ensureAiConfigured: async () => undefined
    });

    const result = await worker.runOnce("project_1", runAt);
    expect(result).toMatchObject({
      status: "failed",
      error: "章节索引摘要无效：Expected array, received string"
    });
    expect(db.prepare("SELECT status, attempt_count, next_run_at, error FROM summary_jobs").get()).toEqual({
      status: "failed",
      attempt_count: 1,
      next_run_at: null,
      error: "章节索引摘要无效：Expected array, received string"
    });
    db.close();
  });
});
