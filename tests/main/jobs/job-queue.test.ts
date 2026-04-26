import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { initializeDatabase } from "../../../src/main/db/migrations";
import { createJobQueue } from "../../../src/main/jobs/job-queue";

function createQueue() {
  const rootPromise = mkdtemp(path.join(tmpdir(), "novel-tool-jobs-"));
  return rootPromise.then((root) => {
    const dbPath = path.join(root, "book.db");
    initializeDatabase(dbPath);
    const db = new Database(dbPath);
    return { db, queue: createJobQueue(db) };
  });
}

describe("job queue", () => {
  test("records progress, completion, and events", async () => {
    const { db, queue } = await createQueue();
    const job = queue.enqueue({
      type: "index_fts",
      inputSummary: { chapterId: "chapter-1" },
      cancellable: true
    });

    queue.start(job.id);
    queue.updateProgress(job.id, 55, { indexed: 10 });
    queue.complete(job.id, { indexed: 18 });

    const saved = queue.get(job.id);
    const events = queue.events(job.id);
    db.close();

    expect(saved?.status).toBe("done");
    expect(saved?.progress).toBe(100);
    expect(events.map((event) => event.type)).toEqual(["created", "started", "progress", "done"]);
  });

  test("redacts secrets from input summaries and errors", async () => {
    const { db, queue } = await createQueue();
    const job = queue.enqueue({
      type: "provider_call",
      inputSummary: {
        provider: "deepseek",
        apiKey: "sk-secret",
        nested: { authorization: "Bearer hidden" }
      },
      cancellable: true
    });

    queue.fail(job.id, new Error("request failed with sk-secret and Bearer hidden"));
    const saved = queue.get(job.id);
    db.close();

    expect(JSON.stringify(saved?.inputSummary)).not.toContain("sk-secret");
    expect(JSON.stringify(saved?.inputSummary)).not.toContain("Bearer hidden");
    expect(saved?.error).not.toContain("sk-secret");
    expect(saved?.error).not.toContain("Bearer hidden");
    expect(saved?.error).toContain("[redacted]");
  });

  test("cancels a queued cancellable job", async () => {
    const { db, queue } = await createQueue();
    const job = queue.enqueue({
      type: "export_txt",
      inputSummary: { format: "txt" },
      cancellable: true
    });

    queue.cancel(job.id);

    const saved = queue.get(job.id);
    const events = queue.events(job.id);
    db.close();

    expect(saved?.status).toBe("cancelled");
    expect(events.map((event) => event.type)).toContain("cancelled");
  });

  test("recovers interrupted running jobs without rerunning provider calls", async () => {
    const { db, queue } = await createQueue();
    const providerJob = queue.enqueue({
      type: "provider_call",
      inputSummary: { provider: "deepseek" },
      cancellable: true
    });
    const importJob = queue.enqueue({
      type: "import_txt",
      inputSummary: { file: "demo.txt" },
      cancellable: true
    });

    queue.start(providerJob.id);
    queue.start(importJob.id);
    const recovered = queue.recoverInterrupted();

    const provider = queue.get(providerJob.id);
    const imported = queue.get(importJob.id);
    db.close();

    expect(recovered).toBe(2);
    expect(provider?.status).toBe("error");
    expect(provider?.error).toContain("interrupted");
    expect(imported?.status).toBe("cancelled");
  });

  test("lists recent jobs for the bottom job strip", async () => {
    const { db, queue } = await createQueue();
    const first = queue.enqueue({
      type: "import_txt",
      inputSummary: { file: "first.txt" },
      cancellable: true
    });
    const second = queue.enqueue({
      type: "index_fts",
      inputSummary: { file: "second.txt" },
      cancellable: true
    });
    queue.complete(second.id, { indexed: 3 });

    const jobs = queue.listRecent(5);
    db.close();

    expect(jobs.map((job) => job.id)).toEqual([second.id, first.id]);
    expect(jobs[0]).toMatchObject({ type: "index_fts", status: "done", progress: 100 });
  });
});
