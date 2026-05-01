import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("phase 5 selected-text toolbar wiring", () => {
  it("uses the required official Tiptap style extensions without duplicate underline registration", () => {
    const packageJson = readSource("package.json");
    const editor = readSource("src/renderer/editor/NovelEditor.tsx");

    expect(packageJson).toContain("@tiptap/extension-underline");
    expect(packageJson).toContain("@tiptap/extension-link");
    expect(packageJson).toContain("@tiptap/extension-text-style");
    expect(editor).toContain("StarterKit.configure");
    expect(editor).not.toContain("@tiptap/extension-underline");
    expect(editor).toContain("@tiptap/extension-link");
    expect(editor).toContain("@tiptap/extension-text-style");
    expect(editor).toContain("openOnClick: false");
  });

  it("routes selected AI tasks through SelectionSnapshot and keeps style commands local", () => {
    const bubblePath = "src/renderer/editor/SelectionBubbleMenu.tsx";
    const editor = readSource("src/renderer/editor/NovelEditor.tsx");
    const textAlign = readSource("src/renderer/editor/tiptap/text-align.ts");
    const css = readSource("src/renderer/styles/globals.css");

    expect(existsSync(join(rootDir, bubblePath))).toBe(true);
    const bubble = readSource(bubblePath);

    expect(editor).toContain("SelectionBubbleMenu");
    expect(editor).toContain("onTask(task, snapshot, taskPromptPreset)");
    expect(editor).toContain("taskPromptPresets");
    expect(bubble).toContain("Ask AI");
    expect(bubble).toContain("createSelectionSnapshotFromEditor");
    expect(bubble).toContain("runAiPreset");
    expect(bubble).toContain("taskPromptPresets");
    expect(bubble).toContain("showInSelectionMenu");
    expect(bubble).toContain("onTask(task, snapshot, null)");
    expect(bubble).toContain("onTask(taskPromptPreset.taskType, snapshot, taskPromptPreset)");
    expect(bubble).toContain("toggleUnderline");
    expect(bubble).toContain("setFontSize");
    expect(bubble).toContain("setLink");
    expect(bubble).toContain("setHeading");
    expect(bubble).toContain("setParagraph");
    expect(bubble).not.toContain("EditorStyleDropdown");
    expect(bubble).toContain("activeMenu");
    expect(bubble).toContain("bubble-dropdown");
    expect(bubble).toContain("icon-select");
    expect(bubble).toContain("Highlighter");
    expect(bubble).toContain("NotePencil");
    expect(bubble).toContain("DotsThreeVertical");
    expect(bubble).toContain("setTextAlign");
    expect(editor).toContain("TextAlignExtension");
    expect(textAlign).toContain(".some(Boolean)");
    expect(css).toContain(".bubble-dropdown");
    expect(css).toContain(".bubble-menu .icon-select");
  });

  it("opens and refreshes the scratchpad tab after saving selected text", () => {
    const app = readSource("src/renderer/App.tsx");
    const writing = readSource("src/renderer/routes/WritingPage.tsx");
    const sidebar = readSource("src/renderer/layout/RightUtilitySidebar.tsx");
    const scratchpad = readSource("src/renderer/sidebar/ScratchpadTab.tsx");

    expect(app).toContain("openScratchpad");
    expect(app).toContain("setSidebarOpen(true)");
    expect(app).toContain('setSidebarTab("scratch")');
    expect(app).toContain("setScratchpadRefreshToken");
    expect(writing).toContain("onOpenScratchpad");
    expect(writing).toContain("onOpenScratchpad();");
    expect(writing).toContain("scratchpadRefreshToken");
    expect(sidebar).toContain("scratchpadRefreshToken");
    expect(sidebar).toContain("refreshToken={scratchpadRefreshToken}");
    expect(scratchpad).toContain("refreshToken");
    expect(scratchpad).toContain("}, [loadNotes, refreshToken]);");
  });
});
