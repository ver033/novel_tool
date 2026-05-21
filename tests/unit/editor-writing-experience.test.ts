import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findChapterSearchMatch, findChapterSearchMatches, getHighlightedSearchParts } from "../../src/renderer/routes/WritingPage";
import { createTiptapDocumentFromPlainText } from "../../src/renderer/editor/tiptap/converters";
import { clampFloatingPanelGeometry, openOrRaiseFloatingPanel } from "../../src/renderer/layout/floating-panel-state";

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

  it("lets authors hide the chapter list without entering focus mode", () => {
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");
    const leftChapterTree = readSource("src/renderer/layout/LeftChapterTree.tsx");
    const css = readSource("src/renderer/styles/globals.css");

    expect(leftChapterTree).toContain("onHideChapters");
    expect(leftChapterTree).toContain("IconButton");
    expect(leftChapterTree).toContain("SidebarSimple");
    expect(leftChapterTree).toContain("CaretLeft");
    expect(leftChapterTree).toContain("折叠章节列表");
    expect(leftChapterTree).not.toContain(">隐藏章节<");
    expect(writingPage).toContain("chapterListHidden");
    expect(writingPage).toContain("chapterLayoutPanelIds");
    expect(writingPage).toContain("workspace-shell-panels");
    expect(writingPage).toContain('className="chapter-resize-handle"');
    expect(writingPage).toContain('className="chapter-tree-panel"');
    expect(writingPage).toContain('className="chapter-workspace-panel"');
    expect(writingPage).toContain("chapter-rail");
    expect(writingPage).toContain("chapter-rail-button");
    expect(writingPage).toContain("CaretRight");
    expect(writingPage).toContain("setChapterListHidden(false)");
    expect(css).toContain(".workspace.chapter-hidden");
    expect(css).toContain(".workspace-shell-panels");
    expect(css).toContain(".chapter-resize-handle");
    expect(css).toContain(".chapter-rail");
  });

  it("shows chapter-bound auxiliary material status in the chapter list", () => {
    const app = readSource("src/renderer/App.tsx");
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");
    const leftChapterTree = readSource("src/renderer/layout/LeftChapterTree.tsx");
    const utilityPanel = readSource("src/renderer/layout/UtilityPanelContent.tsx");
    const outlinePanel = readSource("src/renderer/sidebar/OutlinePanel.tsx");
    const scratchpad = readSource("src/renderer/sidebar/ScratchpadTab.tsx");
    const css = readSource("src/renderer/styles/globals.css");

    expect(app).toContain("auxiliaryRefreshToken");
    expect(app).toContain("handleAuxiliaryChanged");
    expect(writingPage).toContain("chapterAuxiliaryInfoById");
    expect(writingPage).toContain("api.outline.getOverview");
    expect(writingPage).toContain("scratchCountByChapterId");
    expect(writingPage).toContain("scratchNoteIdsByChapterId");
    expect(writingPage).toContain("scratchNoteIds");
    expect(writingPage).toContain("auxiliaryInfoByChapterId={chapterAuxiliaryInfoById}");
    expect(leftChapterTree).toContain("auxiliaryInfoByChapterId");
    expect(leftChapterTree).toContain("chapter-aux-meta");
    expect(leftChapterTree).toContain("细纲");
    expect(leftChapterTree).toContain("草稿");
    expect(utilityPanel).toContain("onAuxiliaryChanged");
    expect(outlinePanel).toContain("onAuxiliaryChanged?.()");
    expect(scratchpad).toContain("onNotesChanged?.()");
    expect(css).toContain(".chapter-aux-meta");
    expect(css).toContain(".chapter-aux-chip");
  });

  it("lets the editor canvas expand when either side panel is hidden", () => {
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");
    const css = readSource("src/renderer/styles/globals.css");

    expect(writingPage).toContain("editorUsesFullWidth");
    expect(writingPage).toContain("chapterListHidden || !sidebarOpen");
    expect(writingPage).toContain('maxWidth: editorUsesFullWidth ? "none"');
    expect(writingPage).toContain("full-width-editor");
    expect(css).toContain(".workspace.full-width-editor .editor-scroll");
    expect(css).toContain(".workspace.full-width-editor .editor-inner");
  });

  it("adds all-mode editor right click floating windows without replacing the sidebar workflow", () => {
    const app = readSource("src/renderer/App.tsx");
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");
    const utilityPanel = readSource("src/renderer/layout/UtilityPanelContent.tsx");
    const floatingLayer = readSource("src/renderer/layout/FloatingWorkspaceLayer.tsx");
    const floatingFrame = readSource("src/renderer/layout/FloatingPanelFrame.tsx");
    const editorContextMenu = readSource("src/renderer/layout/EditorContextMenu.tsx");
    const css = readSource("src/renderer/styles/globals.css");

    expect(app).toContain('setSidebarTab("chat")');
    expect(app).toContain('setSidebarTab("scratch")');
    expect(app).toContain('setSidebarTab("task")');
    expect(app).toContain("openFloatingAiChat");
    expect(app).toContain("openFloatingScratchpad");
    expect(app).not.toContain("openFloatingTask");
    expect(writingPage).not.toContain("onOpenFloatingTask(activeChapterId);");
    expect(writingPage).toContain("activeChapterAuxiliaryInfo");
    expect(writingPage).toContain("canOpenAllAssist");
    expect(writingPage).toContain("activeChapterAuxiliaryInfo?.hasOutline");
    expect(writingPage).toContain("(activeChapterAuxiliaryInfo?.scratchCount ?? 0) > 0");
    expect(writingPage).toContain("activeChapterAuxiliaryInfo?.scratchNoteIds ?? []");
    expect(writingPage).toContain("onOpenFloatingScratchpad(activeChapterId, scratchNoteId)");
    expect(writingPage).toContain("onContextMenu={handleEditorContextMenu}");
    expect(writingPage).not.toContain("if (!focusMode) {\n      return;");
    expect(writingPage).toContain("FloatingWorkspaceLayer");
    expect(writingPage).toContain("EditorContextMenu");
    expect(floatingLayer).toContain("activeEditorChapterId={activeChapterId}");
    expect(utilityPanel).toContain("readonly activeEditorChapterId");
    expect(utilityPanel).toContain("activeEditorChapterId={activeEditorChapterId}");
    expect(utilityPanel).toContain("AiChatTab");
    expect(utilityPanel).toContain("CurrentTaskTab");
    expect(utilityPanel).toContain("ScratchpadEditorPanel");
    expect(floatingLayer).toContain("UtilityPanelContent");
    expect(floatingFrame).toContain("floating-panel-resize-handle");
    expect(floatingFrame).toContain("setPointerCapture");
    expect(editorContextMenu).toContain("查看全书大纲");
    expect(editorContextMenu).toContain("打开当前章节细纲");
    expect(editorContextMenu).toContain("onOpenBookOutline");
    expect(writingPage).toContain('onOpenFloatingPanel("outline", null, null, "book")');
    expect(writingPage).toContain('onOpenFloatingPanel("outline", activeChapterId, null, "chapter")');
    expect(editorContextMenu).toContain("创建当前章节草稿纸");
    expect(editorContextMenu).not.toContain("打开当前章节草稿纸");
    expect(editorContextMenu).toContain("打开 AI 对话");
    expect(editorContextMenu).toContain("canOpenAllAssist");
    expect(editorContextMenu).toContain("canOpenAllAssist ?");
    expect(editorContextMenu).not.toContain("打开当前章节任务");
    expect(editorContextMenu).not.toContain("onOpenTask");
    expect(editorContextMenu).toContain("复制");
    expect(css).toContain(".floating-workspace-layer");
    expect(css).toContain(".editor-context-menu");
  });

  it("keeps selection and context menus visible at full-document and bottom-edge selections", () => {
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");
    const bubbleMenu = readSource("src/renderer/editor/SelectionBubbleMenu.tsx");
    const contextMenu = readSource("src/renderer/layout/EditorContextMenu.tsx");
    const css = readSource("src/renderer/styles/globals.css");

    expect(bubbleMenu).toContain("createSelectionFloatingAnchor");
    expect(bubbleMenu).toContain("appendTo={() => document.body}");
    expect(bubbleMenu).toContain('strategy: "fixed"');
    expect(bubbleMenu).toContain("scrollTarget:");
    expect(bubbleMenu).toContain('editor.view.dom.closest(".editor-scroll")');
    expect(bubbleMenu).toContain('data-dropdown-side={dropdownSide}');
    expect(writingPage).toContain("editor?.state.selection");
    expect(writingPage).toContain("editor?.state.doc.textBetween");
    expect(writingPage).not.toContain("window.getSelection()?.toString().trim()");
    expect(contextMenu).toContain("clampEditorContextMenuPosition");
    expect(contextMenu).toContain("useLayoutEffect");
    expect(css).toContain('.bubble-menu[data-dropdown-side="top"] .bubble-dropdown');
    expect(css).toContain('.bubble-menu[data-dropdown-side="top"] .link-editor-popover');
  });

  it("keeps floating panels in viewport coordinates and below the top bar when side panels are present or resized", () => {
    const app = readSource("src/renderer/App.tsx");
    const css = readSource("src/renderer/styles/globals.css");
    const floatingLayerRule = css.match(/\.floating-workspace-layer\s*{[^}]*}/)?.[0] ?? "";
    const clamped = clampFloatingPanelGeometry(
      { height: 900, width: 900, x: -40, y: -40 },
      { height: 600, width: 800 }
    );

    expect(floatingLayerRule).toContain("position: fixed");
    expect(floatingLayerRule).toContain("inset: 0");
    expect(clamped).toEqual({
      height: 500,
      width: 776,
      x: 12,
      y: 88
    });
    expect(app).toContain('window.addEventListener("resize", handleFloatingViewportResize)');
    expect(app).toContain("clampFloatingPanelGeometry(panel, floatingViewport())");
  });

  it("uses editor-like ruled pages for floating scratchpad and chapter outline", () => {
    const utilityPanel = readSource("src/renderer/layout/UtilityPanelContent.tsx");
    const rightSidebar = readSource("src/renderer/layout/RightUtilitySidebar.tsx");
    const scratchpadEditor = readSource("src/renderer/sidebar/ScratchpadEditorPanel.tsx");
    const scratchpadSummary = readSource("src/renderer/sidebar/ScratchpadTab.tsx");
    const outlinePanel = readSource("src/renderer/sidebar/OutlinePanel.tsx");
    const floatingState = readSource("src/renderer/layout/floating-panel-state.ts");
    const css = readSource("src/renderer/styles/globals.css");

    expect(utilityPanel).toContain("ScratchpadEditorPanel");
    expect(utilityPanel).toContain("<ScratchpadEditorPanel");
    expect(rightSidebar).toContain("ScratchpadTab");
    expect(scratchpadSummary).toContain("草稿纸汇总");
    expect(scratchpadEditor).toContain("scratchpad-editor-page");
    expect(scratchpadEditor).toContain("scratchNoteId");
    expect(scratchpadEditor).toContain("api.scratch.list");
    expect(scratchpadEditor).toContain("ruled-aux-editor");
    expect(scratchpadEditor).toContain("api.scratch.create");
    expect(scratchpadEditor).toContain("api.scratch.update");
    expect(outlinePanel).toContain("outline-editor-page");
    expect(outlinePanel).toContain("ruled-aux-editor");
    expect(floatingState).toContain("scratchNoteId");
    expect(floatingState).toContain("scratchNoteId ??");
    expect(css).toContain(".aux-editor-page");
    expect(css).toContain(".ruled-aux-editor");
    expect(css).toContain("background-size: 100% var(--aux-line-step");
  });

  it("creates a fresh floating scratchpad draft each time until a note exists", () => {
    const viewport = { height: 720, width: 1180 };
    const firstOpen = openOrRaiseFloatingPanel([], "scratch", "chapter_1", viewport, null);
    const secondOpen = openOrRaiseFloatingPanel(firstOpen, "scratch", "chapter_1", viewport, null);
    const savedOpen = openOrRaiseFloatingPanel(secondOpen, "scratch", "chapter_1", viewport, "scratch_saved_1");
    const savedRaised = openOrRaiseFloatingPanel(savedOpen, "scratch", "chapter_1", viewport, "scratch_saved_1");

    expect(secondOpen).toHaveLength(2);
    expect(new Set(secondOpen.map((panel) => panel.id)).size).toBe(2);
    expect(secondOpen.every((panel) => panel.kind === "scratch" && panel.scratchNoteId === null)).toBe(true);
    expect(savedOpen).toHaveLength(3);
    expect(savedRaised).toHaveLength(3);
    expect(savedRaised.filter((panel) => panel.scratchNoteId === "scratch_saved_1")).toHaveLength(1);
  });

  it("keeps auxiliary editor actions outside ruled text areas when floating panels are resized", () => {
    const css = readSource("src/renderer/styles/globals.css");

    expect(css).toMatch(/\.aux-editor-page,\s*\.outline-panel\s*{[\s\S]*overflow:\s*hidden/);
    expect(css).toMatch(
      /\.aux-editor-page \.outline-editor,[\s\S]*\.aux-editor-page \.scratchpad-page-editor,[\s\S]*\.outline-panel \.outline-editor\s*{[\s\S]*min-height:\s*0;[\s\S]*height:\s*100%;/
    );
    expect(css).toMatch(/\.aux-editor-footer,\s*\.outline-footer\s*{[\s\S]*flex:\s*0 0 auto/);
    expect(css).toMatch(
      /\.aux-editor-footer \.secondary-button,[\s\S]*\.outline-footer \.secondary-button\s*{[\s\S]*height:\s*40px;/
    );
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

  it("keeps writing workflow intact after adding the relationship graph module", () => {
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");
    const app = readSource("src/renderer/App.tsx");

    expect(writingPage).toContain("flushBeforeNavigation");
    expect(writingPage).toContain("onOpenAiChat");
    expect(writingPage).toContain("onOpenFloatingAiChat");
    expect(writingPage).toContain("RightUtilitySidebar");
    expect(writingPage).toContain("FloatingWorkspaceLayer");
    expect(writingPage).toContain("EditorContextMenu");
    expect(app).toContain("setSidebarOpen(true)");
    expect(app).toContain('setSidebarTab("chat")');
  });
});
