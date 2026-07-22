import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("phase 3 renderer project and chapter wiring", () => {
  it("uses an app-store bridge instead of hard-coded welcome projects", () => {
    const app = readSource("src/renderer/App.tsx");
    const welcome = readSource("src/renderer/routes/WelcomePage.tsx");

    expect(app).toContain("useAppStore");
    expect(welcome).toContain("recentProjects");
    expect(welcome).not.toContain("const recentProjects =");
  });

  it("renders the chapter tree from props with create and select callbacks", () => {
    const chapterTree = readSource("src/renderer/layout/LeftChapterTree.tsx");
    const appStore = readSource("src/renderer/state/app-store.ts");
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");
    const styles = readSource("src/renderer/styles/globals.css");

    expect(chapterTree).toContain("chapters.map");
    expect(chapterTree).toContain("onCreateChapter");
    expect(chapterTree).toContain("onCreateChapterAfter");
    expect(chapterTree).toContain('t("addAfterLastChapter")');
    expect(chapterTree).toContain("onSelectChapter");
    expect(chapterTree).toContain("onRenameChapter");
    expect(chapterTree).toContain("onDeleteChapter");
    expect(writingPage).toContain("onCreateChapter({ afterChapterId: chapterId })");
    expect(appStore).toContain("suggestNewChapterTitle");
    expect(appStore).toContain("renameChapter");
    expect(appStore).toContain("deleteChapter");
    expect(styles).toContain("position: sticky");
    expect(chapterTree).not.toContain("const chapters =");
  });

  it("only exposes after-chapter creation on the last chapter", () => {
    const chapterTree = readSource("src/renderer/layout/LeftChapterTree.tsx");
    const appStore = readSource("src/renderer/state/app-store.ts");

    expect(chapterTree).toContain("lastChapterId");
    expect(chapterTree).toContain("chapter.id === lastChapterId");
    expect(chapterTree).toContain('t("addAfterLastChapter")');
    expect(appStore).toContain("requestedAfterChapter");
    expect(appStore).toContain("requestedAfterChapter?.id === lastChapter?.id");
  });

  it("returns from settings to the page that opened settings", () => {
    const app = readSource("src/renderer/App.tsx");

    expect(app).toContain("settingsReturnPage");
    expect(app).toContain("returnFromSettings");
    expect(app).toContain("onClose={returnFromSettings}");
  });

  it("uses persisted resizable panels for the editor and right utility sidebar", () => {
    const packageJson = JSON.parse(readSource("package.json")) as { dependencies?: Record<string, string> };
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");
    const styles = readSource("src/renderer/styles/globals.css");

    expect(packageJson.dependencies?.["react-resizable-panels"]).toBe("4.9.0");
    expect(writingPage).toContain("PanelGroup");
    expect(writingPage).toContain("PanelResizeHandle");
    expect(writingPage).toContain('id="moshu-writing-sidebar-v3"');
    expect(writingPage).toContain("useDefaultLayout");
    expect(writingPage).toContain('defaultSize="400px"');
    expect(writingPage).toContain('minSize="360px"');
    expect(writingPage).toContain('maxSize="520px"');
    expect(writingPage).not.toContain("defaultSize={34}");
    expect(writingPage).not.toContain("maxSize={48}");
    expect(writingPage).toContain('className="sidebar-resize-handle"');
    expect(styles).toContain(".workspace-main-panels");
    expect(styles).toContain(".sidebar-resize-handle");
    expect(styles).toContain("cursor: col-resize");
  });
});
