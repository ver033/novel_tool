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
      fontSize: 34,
      lineHeight: 2.32,
      autosaveMs: 1000,
      layoutPreset: "reading",
      pageWidth: "narrow",
      fontFamily: "kai",
      editorPadding: "relaxed",
      paragraphSpacing: "loose",
      firstLineIndent: "two",
      theme: "eye",
      ruledPaperIntensity: "strong"
    });

    expect(result).toMatchObject({
      fontSize: 34,
      layoutPreset: "reading",
      pageWidth: "narrow",
      fontFamily: "kai",
      editorPadding: "relaxed",
      paragraphSpacing: "loose",
      firstLineIndent: "two",
      theme: "eye",
      ruledPaperIntensity: "strong"
    });
  });

  it("defaults first-line indent to none across renderer and persisted settings", () => {
    const editorStore = readSource("src/renderer/state/editor-store.ts");
    const settingsService = readSource("src/main/settings/settings-service.ts");
    const settingsPage = readSource("src/renderer/routes/SettingsPage.tsx");
    const topBar = readSource("src/renderer/layout/TopBar.tsx");

    expect(editorStore).toContain('firstLineIndent: "none"');
    expect(settingsService).toContain('firstLineIndent: "none"');
    expect(settingsPage).toContain('firstLineIndent: "none"');
    expect(topBar).toContain('firstLineIndent: "none"');
    expect(editorStore).not.toContain('firstLineIndent: "two",');
    expect(settingsService).not.toContain('firstLineIndent: "two",');
    expect(settingsPage).not.toContain('firstLineIndent: "two",');
  });

  it("uses a real wide writing canvas with optional ruled paper lines", () => {
    const result = editorSettingsSchema.parse({
      fontSize: 20,
      lineHeight: 2.08,
      autosaveMs: 1000,
      layoutPreset: "immersive",
      pageWidth: "screen",
      fontFamily: "system",
      editorPadding: "compact",
      paragraphSpacing: "standard",
      firstLineIndent: "two",
      theme: "light",
      ruledPaper: true,
      ruledPaperIntensity: "standard"
    });
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");
    const novelEditor = readSource("src/renderer/editor/NovelEditor.tsx");
    const topBar = readSource("src/renderer/layout/TopBar.tsx");
    const editorStore = readSource("src/renderer/state/editor-store.ts");
    const settingsService = readSource("src/main/settings/settings-service.ts");
    const css = readSource("src/renderer/styles/globals.css");

    expect(result).toMatchObject({ pageWidth: "screen", ruledPaper: true });
    expect(editorStore).toContain('pageWidth: "screen"');
    expect(editorStore).toContain('editorPadding: "compact"');
    expect(editorStore).toContain("ruledPaper: true");
    expect(editorStore).toContain('ruledPaperIntensity: "standard"');
    expect(settingsService).toContain('pageWidth: "screen"');
    expect(settingsService).toContain('editorPadding: "compact"');
    expect(settingsService).toContain("ruledPaper: true");
    expect(settingsService).toContain('ruledPaperIntensity: "standard"');
    expect(topBar).toContain("宽屏");
    expect(topBar).toContain("正文边距");
    expect(topBar).toContain("稿纸横格");
    expect(topBar).toContain("ruledPaperIntensityOptions");
    expect(topBar).toContain("ruledPaper");
    expect(topBar).toContain("fontSizeOptions = Array.from");
    expect(topBar).toContain("global-style-select");
    expect(topBar).toContain("<select");
    expect(topBar).toContain("fontSize: Number(event.target.value)");
    expect(css).toContain(".global-style-select");
    expect(topBar).toContain("{ value: 2.6");
    expect(topBar).toContain("楷体感");
    expect(writingPage).toContain("--editor-shell-padding-x");
    expect(writingPage).toContain("editorPaddingBySetting");
    expect(writingPage).toContain('screen: "none"');
    expect(writingPage).toContain('editorUsesFullWidth ? "none"');
    expect(css).toMatch(/\.editor-scroll\s*{[\s\S]*padding:\s*22px var\(--editor-shell-padding-x, 14px\) 70px/);
    expect(css).toContain("var(--editor-shell-padding-x");
    expect(css).toMatch(/\.editor-inner\s*{[\s\S]*width:\s*100%/);
    expect(css).toMatch(/\.workspace\.focus-mode \.editor-scroll\s*{[\s\S]*padding-left:\s*var\(--editor-shell-padding-x, 6px\)/);
    expect(css).toMatch(/\.workspace\.focus-mode \.editor-scroll\s*{[\s\S]*padding-right:\s*var\(--editor-shell-padding-x, 6px\)/);
    expect(novelEditor).toContain("--editor-line-step");
    expect(novelEditor).toContain("ruledPaperClass");
    expect(novelEditor).toContain("ruledPaperIntensity");
    expect(novelEditor).toContain('standard: "var(--editor-line-step)"');
    expect(novelEditor).toContain('loose: "calc(var(--editor-line-step) * 2)"');
    expect(css).toContain(".novel-editor-content.ruled-paper .tiptap-manuscript");
    expect(css).toContain(".novel-editor-content.ruled-paper-soft");
    expect(css).toContain(".novel-editor-content.ruled-paper-strong");
    expect(css).toContain("repeating-linear-gradient");
    expect(css).toContain("calc(var(--editor-line-step, 42px) - 1px)");
    expect(css).toContain("background-size: 100% var(--editor-line-step");
  });

  it("keeps a compact layout panel available in focus mode while forcing the editor full width", () => {
    const topBar = readSource("src/renderer/layout/TopBar.tsx");
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");
    const css = readSource("src/renderer/styles/globals.css");
    const canShowLayoutPanelLine = topBar.split("\n").find((line) => line.includes("canShowLayoutPanel")) ?? "";

    expect(topBar).toContain("canShowLayoutPanel = mode === \"writing\" && editorSettings && onEditorSettingsChange");
    expect(canShowLayoutPanelLine).not.toContain("!focusMode");
    expect(topBar).toContain("layoutPanelMode");
    expect(topBar).toContain("focus-mode-style-panel");
    expect(topBar).toContain("专注排版");
    expect(topBar).toContain("专注模式下正文区域自动铺满");
    expect(topBar).toContain("!focusMode ? (");
    expect(topBar).toContain("页面宽度");
    expect(writingPage).toContain("editorUsesFullWidth = focusMode || chapterListHidden || !sidebarOpen");
    expect(writingPage).toContain('maxWidth: editorUsesFullWidth ? "none"');
    expect(css).toMatch(/\.global-style-panel\s*{[\s\S]*position:\s*fixed/);
    expect(css).toMatch(/\.global-style-panel\s*{[\s\S]*max-height:\s*calc\(100vh - var\(--topbar\) - 24px\)/);
    expect(css).toContain(".global-style-panel.focus-mode-style-panel");
    expect(css).toMatch(/\.global-style-panel\.focus-mode-style-panel \.global-style-row\s*{[\s\S]*grid-template-columns:\s*1fr/);
    expect(css).toMatch(
      /\.global-style-panel\.focus-mode-style-panel \.global-style-options\.(four|five)[\s\S]*grid-template-columns:\s*repeat\(auto-fit, minmax\(58px, 1fr\)\)/
    );
  });
});
