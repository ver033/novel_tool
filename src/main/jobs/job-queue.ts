import crypto from "node:crypto";
import Database from "better-sqlite3";

type SqliteDb = InstanceType<typeof Database>;

export type JobType =
  | "import_txt"
  | "index_fts"
  | "autosave"
  | "provider_call"
  | "export_txt"
  | "import_epub"
  | "export_epub";

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface JobRecord {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  cancellable: boolean;
  inputSummary: unknown;
  result: unknown;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobEventRecord {
  id: string;
  jobId: string;
  type: string;
  message: string | null;
  data: unknown;
  createdAt: string;
}

const secretKeyPattern = /(api[_-]?key|authorization|secret|token|password)/i;
const secretValuePattern = /(sk-[A-Za-z0-9._-]+|Bearer\s+[A-Za-z0-9._-]+)/g;

function now(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(secretValuePattern, "[redacted]");
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        secretKeyPattern.test(key) ? "[redacted]" : redact(child)
      ])
    );
  }
  return value;
}

function stringify(value: unknown): string {
  return JSON.stringify(redact(value));
}

function parseJson(value: string | null): unknown {
  if (!value) {
    return null;
  }
  return JSON.parse(value);
}

function toJobRecord(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row.id),
    type: row.type as JobType,
    status: row.status as JobStatus,
    progress: Number(row.progress),
    cancellable: Boolean(row.cancellable),
    inputSummary: parseJson(String(row.input_summary_json)),
    result: parseJson(row.result_json ? String(row.result_json) : null),
    startedAt: row.started_at ? String(row.started_at) : null,
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    error: row.error ? String(row.error) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function toEventRecord(row: Record<string, unknown>): JobEventRecord {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    type: String(row.type),
    message: row.message ? String(row.message) : null,
    data: parseJson(row.data_json ? String(row.data_json) : null),
    createdAt: String(row.created_at)
  };
}

export function createJobQueue(db: SqliteDb) {
  function addEvent(jobId: string, type: string, data?: unknown, message?: string): void {
    db.prepare(
      `INSERT INTO job_events (id, job_id, type, message, data_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id("job-event"), jobId, type, message ?? null, data === undefined ? null : stringify(data), now());
  }

  return {
    enqueue(input: { type: JobType; inputSummary: unknown; cancellable: boolean }): JobRecord {
      const jobId = id("job");
      const timestamp = now();
      db.prepare(
        `INSERT INTO jobs
         (id, type, status, progress, cancellable, input_summary_json, created_at, updated_at)
         VALUES (?, ?, 'queued', 0, ?, ?, ?, ?)`
      ).run(jobId, input.type, input.cancellable ? 1 : 0, stringify(input.inputSummary), timestamp, timestamp);
      addEvent(jobId, "created", { type: input.type });
      const saved = this.get(jobId);
      if (!saved) {
        throw new Error("Failed to create job");
      }
      return saved;
    },

    start(jobId: string): void {
      const timestamp = now();
      db.prepare(
        `UPDATE jobs SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?`
      ).run(timestamp, timestamp, jobId);
      addEvent(jobId, "started");
    },

    updateProgress(jobId: string, progress: number, data?: unknown): void {
      const boundedProgress = Math.max(0, Math.min(99, Math.trunc(progress)));
      db.prepare("UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?").run(boundedProgress, now(), jobId);
      addEvent(jobId, "progress", data);
    },

    complete(jobId: string, result?: unknown): void {
      const timestamp = now();
      db.prepare(
        `UPDATE jobs
         SET status = 'done', progress = 100, result_json = ?, finished_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(result === undefined ? null : stringify(result), timestamp, timestamp, jobId);
      addEvent(jobId, "done", result);
    },

    fail(jobId: string, error: Error): void {
      const timestamp = now();
      db.prepare(
        `UPDATE jobs
         SET status = 'error', error = ?, finished_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(String(redact(error.message)), timestamp, timestamp, jobId);
      addEvent(jobId, "error", { error: error.message });
    },

    cancel(jobId: string, reason = "cancelled"): void {
      const timestamp = now();
      db.prepare(
        `UPDATE jobs
         SET status = 'cancelled', error = ?, finished_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(reason, timestamp, timestamp, jobId);
      addEvent(jobId, "cancelled", { reason });
    },

    recoverInterrupted(): number {
      const running = db.prepare("SELECT id, type FROM jobs WHERE status = 'running'").all() as Array<{
        id: string;
        type: JobType;
      }>;
      for (const job of running) {
        if (job.type === "provider_call") {
          this.fail(job.id, new Error("provider_call interrupted during app shutdown; retry requires user action"));
        } else {
          this.cancel(job.id, "interrupted during app shutdown; retry available");
        }
      }
      return running.length;
    },

    get(jobId: string): JobRecord | null {
      const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Record<string, unknown> | undefined;
      return row ? toJobRecord(row) : null;
    },

    listRecent(limit = 20): JobRecord[] {
      const rows = db
        .prepare("SELECT * FROM jobs ORDER BY created_at DESC, id DESC LIMIT ?")
        .all(Math.max(1, Math.min(100, Math.trunc(limit)))) as Array<Record<string, unknown>>;
      return rows.map(toJobRecord);
    },

    events(jobId: string): JobEventRecord[] {
      const rows = db.prepare("SELECT * FROM job_events WHERE job_id = ? ORDER BY created_at ASC").all(jobId) as Array<
        Record<string, unknown>
      >;
      return rows.map(toEventRecord);
    }
  };
}
