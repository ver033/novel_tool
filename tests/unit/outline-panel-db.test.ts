import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("editor outline panel persistence", () => {
  it("uses the outline IPC API for chapter notes and keeps localStorage as explicit legacy import only", () => {
    const panel = readSource("src/renderer/sidebar/OutlinePanel.tsx");
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");

    expect(panel).toContain("api.outline.getChapterNote");
    expect(panel).toContain("api.outline.saveChapterNote");
    expect(panel).toContain("api.outline.importLegacyChapterNote");
    expect(panel).toContain("api.outline.getOverview");
    expect(panel).toContain("发现旧细纲");
    expect(panel).not.toContain("window.localStorage.setItem");
    expect(writingPage).toContain("api.outline.getOverview");
    expect(writingPage).not.toContain("outlineStorageKey(currentProject.id, chapter.id)");
  });

  it("separates chapter notes from full-book outline preview in the editor panel", () => {
    const panel = readSource("src/renderer/sidebar/OutlinePanel.tsx");
    const utilityPanel = readSource("src/renderer/layout/UtilityPanelContent.tsx");
    const floatingState = readSource("src/renderer/layout/floating-panel-state.ts");
    const floatingLayer = readSource("src/renderer/layout/FloatingWorkspaceLayer.tsx");

    expect(panel).toContain('type OutlinePanelTab = "chapter" | "book"');
    expect(panel).toContain("initialTab");
    expect(panel).toContain("本章细纲");
    expect(panel).toContain("全书大纲");
    expect(panel).toContain("未安排章节");
    expect(panel).toContain("event.chapterId === null");
    expect(utilityPanel).toContain("outlineTab");
    expect(utilityPanel).toContain("initialTab={outlineTab}");
    expect(floatingState).toContain("OutlineFloatingTab");
    expect(floatingState).toContain("outlineTab");
    expect(floatingLayer).toContain("全书大纲速览");
  });
});
