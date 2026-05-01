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

    expect(chapterTree).toContain("chapters.map");
    expect(chapterTree).toContain("onCreateChapter");
    expect(chapterTree).toContain("onSelectChapter");
    expect(chapterTree).toContain("onRenameChapter");
    expect(chapterTree).toContain("onDeleteChapter");
    expect(appStore).toContain("renameChapter");
    expect(appStore).toContain("deleteChapter");
    expect(chapterTree).not.toContain("const chapters =");
  });

  it("returns from settings to the page that opened settings", () => {
    const app = readSource("src/renderer/App.tsx");

    expect(app).toContain("settingsReturnPage");
    expect(app).toContain("returnFromSettings");
    expect(app).toContain("onClose={returnFromSettings}");
  });
});
