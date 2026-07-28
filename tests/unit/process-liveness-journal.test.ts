import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessLivenessJournal } from "../../src/main/process-liveness-journal";

const createdDirectories: string[] = [];

function createJournal(now: string, sessionId: string, pid: number): ProcessLivenessJournal {
  const directory = mkdtempSync(path.join(tmpdir(), "moshu-process-liveness-"));
  createdDirectories.push(directory);
  return new ProcessLivenessJournal(path.join(directory, "logs", "process-liveness.json"), {
    now: () => new Date(now),
    sessionId: () => sessionId,
    pid
  });
}

afterEach(() => {
  while (createdDirectories.length > 0) {
    rmSync(createdDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("ProcessLivenessJournal", () => {
  it("identifies a prior process session that disappeared without an orderly exit", () => {
    const first = createJournal("2026-07-28T01:00:00.000Z", "session-one", 101);
    const filePath = first.filePath;
    first.start();
    first.heartbeat();

    const second = new ProcessLivenessJournal(filePath, {
      now: () => new Date("2026-07-28T09:00:00.000Z"),
      sessionId: () => "session-two",
      pid: 202
    });
    const result = second.start();

    expect(result.previousUncleanSession).toMatchObject({
      sessionId: "session-one",
      pid: 101,
      state: "running",
      lastSeenAt: "2026-07-28T01:00:00.000Z"
    });
    expect(result.currentSession).toMatchObject({
      sessionId: "session-two",
      pid: 202,
      state: "running"
    });
  });

  it("does not report an orderly app quit as an unexplained disappearance", () => {
    const first = createJournal("2026-07-28T01:00:00.000Z", "session-one", 101);
    const filePath = first.filePath;
    first.start();
    first.markOrderlyExit("will-quit");

    const second = new ProcessLivenessJournal(filePath, {
      now: () => new Date("2026-07-28T09:00:00.000Z"),
      sessionId: () => "session-two",
      pid: 202
    });

    expect(second.start().previousUncleanSession).toBeNull();
  });
});
