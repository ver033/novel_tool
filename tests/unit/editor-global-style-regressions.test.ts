import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { editorSettingsSchema } from "../../src/main/shared/schemas";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("editor global style controls", () => {
  it("keeps page layout controls in the top bar and out of the selected-text editor surface", () => {
    const novelEditor = readSource("src/renderer/editor/NovelEditor.tsx");
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");
    const topBar = readSource("src/renderer/layout/TopBar.tsx");
    const editorStore = readSource("src/renderer/state/editor-store.ts");

    expect(topBar).toContain("页面与排版");
    expect(topBar).toContain("global-style-panel");
    expect(topBar).toContain("data-editor-preset");
    expect(writingPage).toContain("editorSettings={editorStore.editorSettings}");
    expect(writingPage).toContain("onEditorSettingsChange={editorStore.updateEditorSettings}");
    expect(novelEditor).not.toContain("showGlobalToolbar");
    expect(novelEditor).not.toContain("editor-global-style-toggle");
    expect(novelEditor).not.toContain("EditorToolbar");
    expect(editorStore).toContain("updateEditorSettings");
    expect(editorStore).toContain("api.settings.save");
  });

  it("allows editor settings to persist author-facing page and paragraph preferences", () => {
    const result = editorSettingsSchema.parse({
      fontSize: 22,
      lineHeight: 2.32,
      autosaveMs: 1000,
      layoutPreset: "reading",
      pageWidth: "narrow",
      fontFamily: "song",
      paragraphSpacing: "loose",
      firstLineIndent: "two",
      theme: "eye"
    });

    expect(result).toMatchObject({
      layoutPreset: "reading",
      pageWidth: "narrow",
      fontFamily: "song",
      paragraphSpacing: "loose",
      firstLineIndent: "two",
      theme: "eye"
    });
  });
});
