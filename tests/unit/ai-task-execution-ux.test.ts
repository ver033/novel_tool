import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTaskExecutionActivities } from "../../src/renderer/state/task-execution";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("AI task execution UX", () => {
  it("appends real execution events instead of exposing a fixed pending checklist", () => {
    expect(buildTaskExecutionActivities("ready", false)).toEqual([]);
    expect(buildTaskExecutionActivities("creating", false)).toEqual([
      { id: "context", status: "active" }
    ]);
    expect(buildTaskExecutionActivities("preparing", true)).toEqual([
      { id: "context", status: "active" }
    ]);
    expect(buildTaskExecutionActivities("requesting", true)).toEqual([
      { id: "context", status: "complete" },
      { id: "generation", status: "active" }
    ]);
    expect(buildTaskExecutionActivities("streaming", true)).toEqual([
      { id: "context", status: "complete" },
      { id: "generation", status: "active" }
    ]);
    expect(buildTaskExecutionActivities("finalizing", true)).toEqual([
      { id: "context", status: "complete" },
      { id: "generation", status: "complete" },
      { id: "result", status: "active" }
    ]);
    expect(buildTaskExecutionActivities("complete", true).every((activity) => activity.status === "complete")).toBe(true);
  });

  it("keeps stopped and failed runs visible instead of pretending they completed", () => {
    expect(buildTaskExecutionActivities("canceled", true)).toEqual([
      { id: "context", status: "complete" },
      { id: "generation", status: "stopped" }
    ]);
    expect(buildTaskExecutionActivities("error", true)).toEqual([
      { id: "context", status: "complete" },
      { id: "generation", status: "error" }
    ]);
    expect(buildTaskExecutionActivities("error", false)).toEqual([{ id: "context", status: "error" }]);
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
    expect(taskStore).not.toContain("autoStartId");
    expect(taskStore).toContain('setTaskExecutionPhase(projectId && selectionSnapshot ? "ready" : "idle")');
    expect(taskStore).toContain("activeTaskIdRef");
    expect(taskStore).toContain("const generatePreview = useCallback");
    expect(taskStore.indexOf("api.ai.createTask")).toBeGreaterThan(taskStore.indexOf("const generatePreview = useCallback"));
    const currentTask = readSource("src/renderer/sidebar/CurrentTaskTab.tsx");
    expect(currentTask).toContain("task-context-plan");
    expect(currentTask).toContain("TaskRequestEditor");
    expect(currentTask).toContain("task-activity-list");
    expect(currentTask).toContain("Ctrl / ⌘ + Enter");
    expect(currentTask).toContain('closest<HTMLElement>(".sidebar-content, .floating-panel-body")');
    expect(currentTask).toContain("scrollTo({ top: 0 })");
  });

  it("locks the task selection in the editor and suppresses the formatting bubble while the task panel owns it", () => {
    const editor = readSource("src/renderer/editor/NovelEditor.tsx");
    const writing = readSource("src/renderer/routes/WritingPage.tsx");
    const styles = readSource("src/renderer/styles/globals.css");

    expect(editor).toContain("AiTaskLockedSelectionExtension");
    expect(editor).toContain("ai-task-locked-selection");
    expect(editor).toContain("editor && !lockedSelectionSnapshot");
    expect(writing).toContain("lockedTaskSelection");
    expect(writing).toContain('sidebarTab === "task"');
    expect(styles).toContain(".tiptap-manuscript .ai-task-locked-selection");
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
