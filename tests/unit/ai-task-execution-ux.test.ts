import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTaskExecutionSteps } from "../../src/renderer/state/task-execution";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("AI task execution UX", () => {
  it("derives honest progress from the real task execution phase", () => {
    expect(buildTaskExecutionSteps("creating", true).map((step) => step.status)).toEqual([
      "complete",
      "active",
      "pending",
      "pending"
    ]);
    expect(buildTaskExecutionSteps("preparing", true).map((step) => step.status)).toEqual([
      "complete",
      "active",
      "pending",
      "pending"
    ]);
    expect(buildTaskExecutionSteps("requesting", true).map((step) => step.status)).toEqual([
      "complete",
      "complete",
      "active",
      "pending"
    ]);
    expect(buildTaskExecutionSteps("streaming", true).map((step) => step.status)).toEqual([
      "complete",
      "complete",
      "active",
      "pending"
    ]);
    expect(buildTaskExecutionSteps("finalizing", true).map((step) => step.status)).toEqual([
      "complete",
      "complete",
      "complete",
      "active"
    ]);
    expect(buildTaskExecutionSteps("complete", true).every((step) => step.status === "complete")).toBe(true);
  });

  it("keeps stopped and failed runs visible instead of pretending they completed", () => {
    expect(buildTaskExecutionSteps("canceled", true).map((step) => step.status)).toEqual([
      "complete",
      "complete",
      "stopped",
      "pending"
    ]);
    expect(buildTaskExecutionSteps("error", true).map((step) => step.status)).toEqual([
      "complete",
      "complete",
      "error",
      "pending"
    ]);
  });

  it("mounts one shared task controller and renders the real task UI in the assistant sidebar", () => {
    const writing = readSource("src/renderer/routes/WritingPage.tsx");
    const sidebar = readSource("src/renderer/layout/RightUtilitySidebar.tsx");
    const taskStore = readSource("src/renderer/state/task-store.ts");

    expect(writing.match(/useTaskStore\(/g)).toHaveLength(1);
    expect(writing).not.toContain("inline-task-dock");
    expect(sidebar).toContain("<CurrentTaskTab");
    expect(sidebar).toContain("taskStore={taskStore}");
    expect(taskStore).toContain("taskExecutionPhase");
    expect(taskStore).toContain("await flushPendingSave()");
    expect(taskStore).toContain("autoStartId === taskRunId");
    expect(taskStore).toContain("activeTaskIdRef");
    expect(taskStore).toContain("configuredKey.current !== nextKey");
    const currentTask = readSource("src/renderer/sidebar/CurrentTaskTab.tsx");
    expect(currentTask).toContain("task-context-plan");
    expect(currentTask).toContain('closest<HTMLElement>(".sidebar-content, .floating-panel-body")');
    expect(currentTask).toContain("scrollTo({ top: 0 })");
  });

  it("keeps a live Agent execution trail stable for the whole turn", () => {
    const trail = readSource("src/renderer/sidebar/AgentActivityTrail.tsx");
    const chat = readSource("src/renderer/sidebar/AiChatTab.tsx");

    expect(trail).toContain("readonly live?: boolean");
    expect(trail).not.toContain("setTimeout(() => setExpanded(false)");
    expect(trail).not.toContain("wasRunning");
    expect(chat).toContain("<AgentActivityTrail activities={chatStore.agentActivities} live");
    expect(chat).toContain("isNewestCompletingAssistant");
  });
});
