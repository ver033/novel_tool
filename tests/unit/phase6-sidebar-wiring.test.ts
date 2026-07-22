import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("phase 6 sidebar data wiring", () => {
  it("extracts sidebar tabs into data-capable components and stores", () => {
    for (const file of [
      "src/renderer/sidebar/AiChatTab.tsx",
      "src/renderer/sidebar/CurrentTaskTab.tsx",
      "src/renderer/sidebar/ScratchpadTab.tsx",
      "src/renderer/state/chat-store.ts",
      "src/renderer/state/sidebar-store.ts",
      "src/renderer/state/task-store.ts"
    ]) {
      expect(existsSync(join(rootDir, file)), `${file} should exist`).toBe(true);
    }

    const sidebar = readSource("src/renderer/layout/RightUtilitySidebar.tsx");
    const writing = readSource("src/renderer/routes/WritingPage.tsx");
    expect(sidebar).toContain("../sidebar/AiChatTab");
    expect(writing).toContain("../sidebar/CurrentTaskTab");
    expect(writing).toContain('className="inline-task-dock"');
    expect(sidebar).toContain("../sidebar/ScratchpadTab");
  });

  it("creates persisted AI tasks and scratch notes through the typed preload API", () => {
    const taskStore = readSource("src/renderer/state/task-store.ts");
    const aiApply = readSource("src/renderer/editor/ai-apply.ts");
    const currentTask = readSource("src/renderer/sidebar/CurrentTaskTab.tsx");
    const scratchpad = readSource("src/renderer/sidebar/ScratchpadTab.tsx");
    const chat = readSource("src/renderer/sidebar/AiChatTab.tsx");
    const chatStore = readSource("src/renderer/state/chat-store.ts");
    const writing = readSource("src/renderer/routes/WritingPage.tsx");

    expect(taskStore).toContain("api.ai");
    expect(taskStore).toContain(".createTask");
    expect(taskStore).toContain(".generatePreviewStream");
    expect(taskStore).toContain(".rejectCandidate");
    expect(taskStore).toContain("applyAiCandidateToEditor");
    expect(taskStore).toContain(".saveCandidateToScratchpad");
    expect(aiApply).toContain(".applyCandidate");
    expect(writing).toContain("useChatStore");
    expect(chat).toContain("chatStore");
    expect(chatStore).toContain(".sendChatMessageStream");
    expect(currentTask).toContain("useTaskStore");
    expect(currentTask).toContain("selectionSnapshot");
    expect(scratchpad).toContain("api.scratch.list");
    expect(scratchpad).toContain("api.scratch.create");
    expect(scratchpad).toContain("api.scratch.update");
    expect(scratchpad).toContain("api.scratch.delete");
  });

  it("wires chapter titles into the scratchpad summary list", () => {
    const sidebar = readSource("src/renderer/layout/RightUtilitySidebar.tsx");
    const scratchpad = readSource("src/renderer/sidebar/ScratchpadTab.tsx");
    const utils = readSource("src/renderer/sidebar/scratchpad-utils.ts");

    expect(sidebar).toContain("chapters={chapters}");
    expect(scratchpad).toContain("readonly chapters");
    expect(scratchpad).toContain("getLocalizedScratchNoteChapterLabel(note, chapters, locale)");
    expect(scratchpad).toContain("note-chapter-tag");
    expect(utils).toContain("getScratchNoteChapterLabel");
  });
});
