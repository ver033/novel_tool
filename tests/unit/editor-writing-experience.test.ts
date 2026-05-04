import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findChapterSearchMatch, findChapterSearchMatches, getHighlightedSearchParts } from "../../src/renderer/routes/WritingPage";
import { createTiptapDocumentFromPlainText } from "../../src/renderer/editor/tiptap/converters";

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

  it("finds the paragraph that contains a search result keyword", () => {
    const contentJson = createTiptapDocumentFromPlainText("第一段没有。\n\n第二段出现星火。\n\n第三段。");

    expect(findChapterSearchMatch("第1章", contentJson, "第一段没有。\n\n第二段出现星火。\n\n第三段。", "星火")).toMatchObject({
      paragraphIndex: 1,
      snippet: "第二段出现星火。"
    });
  });

  it("returns every matching paragraph inside the same chapter", () => {
    const contentJson = createTiptapDocumentFromPlainText("星火在第一段。\n\n第二段没有。\n\n第三段再次出现星火。");

    expect(findChapterSearchMatches("第1章", contentJson, "星火在第一段。\n\n第二段没有。\n\n第三段再次出现星火。", "星火")).toMatchObject([
      {
        paragraphIndex: 0,
        snippet: "星火在第一段。"
      },
      {
        paragraphIndex: 2,
        snippet: "第三段再次出现星火。"
      }
    ]);
  });

  it("keeps title-only search results as chapter-level targets", () => {
    const contentJson = createTiptapDocumentFromPlainText("正文没有关键词。");

    expect(findChapterSearchMatch("星火之章", contentJson, "正文没有关键词。", "星火")).toMatchObject({
      paragraphId: null,
      snippet: "匹配章节标题"
    });
  });

  it("keeps a pending search jump until the editor can resolve the target paragraph", () => {
    const novelEditor = readSource("src/renderer/editor/NovelEditor.tsx");

    expect(novelEditor).toMatch(/const range = resolveSearchTargetRange\(editor, searchTarget\);[\s\S]*if \(!range\) \{\s*return;\s*\}/);
    expect(novelEditor).toMatch(/if \(!range\) \{\s*return;\s*\}[\s\S]*onSearchTargetResolved\?\.\(searchTarget\.id\);/);
  });

  it("does not pass a search jump to stale editor content while a new chapter is still loading", () => {
    const editorStore = readSource("src/renderer/state/editor-store.ts");
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");

    expect(editorStore).toContain("loadedChapterId");
    expect(writingPage).toContain("editorStore.loadedChapterId === activeChapter.id ? searchJumpTarget : null");
  });

  it("highlights the jumped keyword inside the editor manuscript", () => {
    const novelEditor = readSource("src/renderer/editor/NovelEditor.tsx");
    const css = readSource("src/renderer/styles/globals.css");

    expect(novelEditor).toContain("searchJumpHighlightPluginKey");
    expect(novelEditor).toContain("Decoration.inline");
    expect(novelEditor).toContain("scrollSearchRangeIntoEditorView");
    expect(css).toContain(".search-jump-highlight");
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
