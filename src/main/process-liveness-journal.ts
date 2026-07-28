import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type ProcessLivenessRecord = {
  readonly sessionId: string;
  readonly pid: number;
  readonly state: "running" | "orderly_exit";
  readonly startedAt: string;
  readonly lastSeenAt: string;
  readonly exitReason?: string;
  readonly exitedAt?: string;
};

export type ProcessLivenessStartResult = {
  readonly previousUncleanSession: ProcessLivenessRecord | null;
  readonly currentSession: ProcessLivenessRecord;
};

type ProcessLivenessJournalOptions = {
  readonly now?: () => Date;
  readonly sessionId?: () => string;
  readonly pid?: number;
};

function isProcessLivenessRecord(value: unknown): value is ProcessLivenessRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ProcessLivenessRecord>;
  return (
    typeof candidate.sessionId === "string" &&
    typeof candidate.pid === "number" &&
    (candidate.state === "running" || candidate.state === "orderly_exit") &&
    typeof candidate.startedAt === "string" &&
    typeof candidate.lastSeenAt === "string"
  );
}

export class ProcessLivenessJournal {
  readonly filePath: string;
  private readonly now: () => Date;
  private readonly sessionId: () => string;
  private readonly pid: number;
  private currentSession: ProcessLivenessRecord | null = null;

  constructor(filePath: string, options: ProcessLivenessJournalOptions = {}) {
    this.filePath = filePath;
    this.now = options.now ?? (() => new Date());
    this.sessionId = options.sessionId ?? randomUUID;
    this.pid = options.pid ?? process.pid;
  }

  start(): ProcessLivenessStartResult {
    const previousSession = this.read();
    const now = this.now().toISOString();
    const currentSession: ProcessLivenessRecord = {
      sessionId: this.sessionId(),
      pid: this.pid,
      state: "running",
      startedAt: now,
      lastSeenAt: now
    };
    this.currentSession = currentSession;
    this.write(currentSession);
    return {
      previousUncleanSession: previousSession?.state === "running" ? previousSession : null,
      currentSession
    };
  }

  heartbeat(): void {
    if (!this.currentSession || this.currentSession.state !== "running") {
      return;
    }
    const nextSession: ProcessLivenessRecord = {
      ...this.currentSession,
      lastSeenAt: this.now().toISOString()
    };
    this.currentSession = nextSession;
    this.write(nextSession);
  }

  markOrderlyExit(reason: string): void {
    if (!this.currentSession) {
      return;
    }
    const exitedAt = this.now().toISOString();
    const nextSession: ProcessLivenessRecord = {
      ...this.currentSession,
      state: "orderly_exit",
      lastSeenAt: exitedAt,
      exitedAt,
      exitReason: reason
    };
    this.currentSession = nextSession;
    this.write(nextSession);
  }

  private read(): ProcessLivenessRecord | null {
    try {
      const value = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
      return isProcessLivenessRecord(value) ? value : null;
    } catch {
      return null;
    }
  }

  private write(record: ProcessLivenessRecord): void {
    const directory = path.dirname(this.filePath);
    mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${this.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(record)}\n`, "utf8");
    try {
      renameSync(temporaryPath, this.filePath);
    } catch {
      writeFileSync(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
      try {
        unlinkSync(temporaryPath);
      } catch {
        // A failed temporary-file cleanup must not stop the application.
      }
    }
  }
}
