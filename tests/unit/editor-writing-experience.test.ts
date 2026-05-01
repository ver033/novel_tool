import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getHighlightedSearchParts } from "../../src/renderer/routes/WritingPage";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("editor writing experience optimizations", () => {
  it("wires the top search input to real local editor search state", () => {
    const topBar = readSource("src/renderer/layout/TopBar.tsx");
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");

    expect(topBar).toContain("searchValue");
    expect(topBar).toContain("onSearchChange");
    expect(topBar).not.toContain("readOnly");
    expect(writingPage).toContain("searchResults");
    expect(writingPage).toContain("search-result-list");
    expect(writingPage).toContain("search-result-highlight");
  });

  it("keeps top bar action buttons anchored while the window resizes", () => {
    const css = readSource("src/renderer/styles/globals.css");

    expect(css).toMatch(/\.topbar\s*{[\s\S]*grid-template-columns:\s*minmax\(0,\s*var\(--topbar-brand-width\)\)\s+minmax\(0,\s*1fr\)\s+max-content/);
    expect(css).toMatch(/\.search\s*{[\s\S]*justify-self:\s*center/);
    expect(css).toMatch(/\.search\s*{[\s\S]*width:\s*min\(100%,\s*460px\)/);
    expect(css).toMatch(/\.top-actions\s*{[\s\S]*min-width:\s*max-content/);
    expect(css).not.toContain("grid-template-columns: minmax(230px, 1fr) minmax(320px, 460px) minmax(260px, 1fr)");
  });

  it("splits search result text into highlighted matching parts", () => {
    expect(getHighlightedSearchParts("林远推门回家", "推门")).toEqual([
      { highlighted: false, text: "林远" },
      { highlighted: true, text: "推门" },
      { highlighted: false, text: "回家" }
    ]);
    expect(getHighlightedSearchParts("He Said ok", "said")).toEqual([
      { highlighted: false, text: "He " },
      { highlighted: true, text: "Said" },
      { highlighted: false, text: " ok" }
    ]);
  });

  it("allows direct chapter title editing from the editor heading", () => {
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");

    expect(writingPage).toContain("chapter-title-input");
    expect(writingPage).toContain("submitInlineChapterRename");
    expect(writingPage).toContain("startInlineChapterRename");
  });

  it("adds focus writing mode without modifying the selection bubble menu", () => {
    const topBar = readSource("src/renderer/layout/TopBar.tsx");
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");
    const bubbleMenu = readSource("src/renderer/editor/SelectionBubbleMenu.tsx");

    expect(topBar).toContain("onFocusModeToggle");
    expect(writingPage).toContain("focus-mode");
    expect(writingPage).toContain("focusMode");
    expect(bubbleMenu).toContain("Code");
    expect(bubbleMenu).toContain("TextUnderline");
  });

  it("shows lightweight target progress in bottom metrics", () => {
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");

    expect(writingPage).toContain("targetProgressLabel");
    expect(writingPage).toContain("还差");
    expect(writingPage).toContain("已超过");
  });

  it("only shows the manuscript placeholder at the start of an empty chapter", () => {
    const css = readSource("src/renderer/styles/globals.css");

    expect(css).toContain(".tiptap-manuscript p.is-editor-empty:first-child::before");
    expect(css).not.toContain(".tiptap-manuscript p.is-empty::before");
  });
});
