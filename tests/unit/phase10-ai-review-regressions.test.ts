import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("phase 10 AI review regressions", () => {
  it("uses the latest custom instruction when generating a preview", () => {
    const taskStore = readSource("src/renderer/state/task-store.ts");

    expect(taskStore).toContain("api.ai.updateTask");
    expect(taskStore).toMatch(/taskId: task\.id,[\s\S]*patch: \{[\s\S]*instruction/);
    expect(taskStore.indexOf("api.ai.updateTask")).toBeGreaterThan(-1);
    expect(taskStore.indexOf("api.ai.updateTask")).toBeLessThan(taskStore.indexOf("api.ai.generatePreview"));
  });

  it("resets configured task identity when the active selection context changes", () => {
    const taskStore = readSource("src/renderer/state/task-store.ts");

    expect(taskStore).toMatch(
      /useEffect\(\(\) => \{[\s\S]*setTask\(null\);[\s\S]*setCandidate\(null\);[\s\S]*setError\(null\);[\s\S]*configuredKey\.current = null;[\s\S]*\}, \[[\s\S]*projectId[\s\S]*chapterId[\s\S]*taskType[\s\S]*presetId[\s\S]*selectionSnapshot\?\.selectionHash[\s\S]*\]\);/
    );
  });

  it("resets the default task instruction when task type or selection changes", () => {
    const currentTask = readSource("src/renderer/sidebar/CurrentTaskTab.tsx");

    expect(currentTask).toContain("useEffect");
    expect(currentTask).toContain("initialInstructionForTask(taskType, taskPromptPreset)");
    expect(currentTask).toMatch(/\[taskType, taskPromptPreset\?\.id, selectionSnapshot\?\.selectionHash\]/);
  });

  it("does not expose incomplete scratchpad task insertion affordances", () => {
    const scratchpad = readSource("src/renderer/sidebar/ScratchpadTab.tsx");
    const preload = readSource("src/preload/api.ts");
    const scratchIpc = readSource("src/main/ipc/scratch-ipc.ts");

    expect(scratchpad).not.toContain("插入任务");
    expect(scratchpad).not.toContain("insertIntoTask");
    expect(preload).not.toContain("insertIntoTask");
    expect(scratchIpc).not.toContain("insertIntoTask");
  });

  it("keeps the implementation plan aligned with OpenRouter-only runtime AI", () => {
    const taskGenerator = readSource("src/main/ai/openrouter-task-generator.ts");
    const aiTaskService = readSource("src/main/ai/ai-task-service.ts");

    expect(taskGenerator).not.toContain("mock-ai-client.ts");
    expect(taskGenerator).not.toContain("mock AI client");
    expect(aiTaskService).not.toContain("using mock AI");
    expect(aiTaskService).toContain("AiTaskGenerator");
  });
});
