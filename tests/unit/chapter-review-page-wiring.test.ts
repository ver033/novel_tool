import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("AI chapter review page wiring", () => {
  it("adds AI审稿 as an implemented project module and route", () => {
    const app = readSource("src/renderer/App.tsx");
    const moduleRail = readSource("src/renderer/layout/ProjectModuleRail.tsx");

    expect(existsSync(join(rootDir, "src/renderer/routes/ChapterReviewPage.tsx"))).toBe(true);
    expect(moduleRail).toContain('"chapterReview"');
    expect(moduleRail).toContain("AI审稿");
    expect(moduleRail).toContain("MagnifyingGlass");
    expect(app).toContain('type Page = "welcome" | "writing" | "relationshipGraph" | "outline" | "chapterReview"');
    expect(app).toContain("<ChapterReviewPage");
    expect(app).toContain('chapterReview: "chapterReview"');
  });

  it("exposes a dedicated chapter review IPC surface without reusing selection task channels", () => {
    const types = readSource("src/main/shared/types.ts");
    const preload = readSource("src/preload/api.ts");
    const registerIpc = readSource("src/main/ipc/register-ipc.ts");
    const chapterReviewIpc = readSource("src/main/ipc/chapter-review-ipc.ts");

    expect(types).toContain("chapterReview:");
    expect(types).toContain("novelTool:chapterReview:startReview");
    expect(types).toContain("novelTool:chapterReview:cancelReview");
    expect(types).toContain("novelTool:chapterReview:listRuns");
    expect(types).toContain("novelTool:chapterReview:getRun");
    expect(types).toContain("novelTool:chapterReview:deleteRun");
    expect(types).toContain("novelTool:chapterReview:progress");
    expect(preload).toContain("chapterReview: Object.freeze");
    expect(preload).toContain("ipcChannels.chapterReview.startReview");
    expect(preload).toContain("ipcChannels.chapterReview.cancelReview");
    expect(preload).toContain("subscribeProgress");
    expect(registerIpc).toContain("registerChapterReviewIpc");
    expect(registerIpc).toContain("ChapterReviewService");
    expect(chapterReviewIpc).toContain("chapterReviewCancelInputSchema");
    expect(chapterReviewIpc).toContain("service.cancelReview");
  });

  it("shows review progress and groups issues by category", () => {
    const page = readSource("src/renderer/routes/ChapterReviewPage.tsx");

    expect(page).toContain("ChapterReviewProgressEvent");
    expect(page).toContain("issueCategoryOptions");
    expect(page).toContain("chapter-review-progress");
    expect(page).toContain("chapter-review-category-tabs");
    expect(page).toContain("groupIssuesForDisplay");
  });

  it("keeps the chapter picker scrollable and presents review status as a focused workspace", () => {
    const page = readSource("src/renderer/routes/ChapterReviewPage.tsx");
    const css = readSource("src/renderer/styles/globals.css");

    expect(page).toContain("chapter-review-focus-panel");
    expect(page).toContain("chapter-review-selection-meta");
    expect(page).toContain("chapter-review-progress-stats");
    expect(page).toContain("停止审稿");
    expect(page).toContain("cancelActiveReview");
    expect(css).toContain(".chapter-review-chapter-list");
    expect(css).toContain("overflow-y: auto");
    expect(css).toContain("scrollbar-width: thin");
    expect(css).toContain(".chapter-review-focus-panel");
  });
});
