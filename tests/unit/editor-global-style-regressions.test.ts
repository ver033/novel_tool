import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_EDITOR_SETTINGS } from "../../src/main/shared/editor-settings";
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
    const updateEditorSettingsBlock = editorStore.slice(
      editorStore.indexOf("const updateEditorSettings"),
      editorStore.indexOf("const flushPendingSave")
    );
    const loadEditorSettingsBlock = editorStore.slice(
      editorStore.indexOf("async function loadEditorSettings"),
      editorStore.indexOf("editorScope.current += 1")
    );

    expect(topBar).toContain('t("pageAndTypography")');
    expect(topBar).toContain("global-style-panel");
    expect(topBar).toContain("data-editor-preset");
    expect(writingPage).toContain("editorSettings={editorStore.editorSettings}");
    expect(writingPage).toContain("onEditorSettingsChange={editorStore.updateEditorSettings}");
    expect(novelEditor).not.toContain("showGlobalToolbar");
    expect(novelEditor).not.toContain("editor-global-style-toggle");
    expect(novelEditor).not.toContain("EditorToolbar");
    expect(editorStore).toContain("updateEditorSettings");
    expect(editorStore).toContain("api.settings.save");
    expect(editorStore).toContain("editorSettingsSaveQueue");
    expect(editorStore).toContain("setEditorSettings(optimistic)");
    expect(editorStore).toContain("editorSettingsRevision");
    expect(editorStore).toContain("confirmedEditorSettingsRef");
    expect(updateEditorSettingsBlock).toContain("setEditorSettings(confirmedEditorSettingsRef.current)");
    expect(updateEditorSettingsBlock).not.toContain('setSaveStatus("failed")');
    expect(loadEditorSettingsBlock).not.toContain('setSaveStatus("failed")');
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
    const sharedDefaults = readSource("src/main/shared/editor-settings.ts");
    const editorStore = readSource("src/renderer/state/editor-store.ts");
    const settingsService = readSource("src/main/settings/settings-service.ts");
    const settingsPage = readSource("src/renderer/routes/SettingsPage.tsx");
    const topBar = readSource("src/renderer/layout/TopBar.tsx");

    expect(DEFAULT_EDITOR_SETTINGS.firstLineIndent).toBe("none");
    expect(sharedDefaults).toContain('firstLineIndent: "none"');
    expect(editorStore).toContain("DEFAULT_EDITOR_SETTINGS");
    expect(settingsService).toContain("DEFAULT_EDITOR_SETTINGS");
    expect(settingsPage).toContain("editor: DEFAULT_EDITOR_SETTINGS");
    expect(topBar).toContain('firstLineIndent: "none"');
    expect(editorStore).not.toContain("const DEFAULT_EDITOR_SETTINGS");
    expect(settingsService).not.toContain("const DEFAULT_EDITOR_SETTINGS");
    expect(settingsPage).not.toMatch(/editor:\s*\{\s*fontSize:/);
  });

  it("uses restrained editorial defaults while keeping wide canvas and ruled paper controls available", () => {
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
    const sharedDefaults = readSource("src/main/shared/editor-settings.ts");
    const css = readSource("src/renderer/styles/globals.css");

    expect(result).toMatchObject({ pageWidth: "screen", ruledPaper: true });
    expect(DEFAULT_EDITOR_SETTINGS).toMatchObject({
      editorPadding: "standard",
      pageWidth: "narrow",
      ruledPaper: false,
      ruledPaperIntensity: "soft"
    });
    expect(sharedDefaults).toContain('pageWidth: "narrow"');
    expect(sharedDefaults).toContain('editorPadding: "standard"');
    expect(sharedDefaults).toContain("ruledPaper: false");
    expect(sharedDefaults).toContain('ruledPaperIntensity: "soft"');
    expect(editorStore).toContain('from "../../main/shared/editor-settings"');
    expect(settingsService).toContain('from "../shared/editor-settings"');
    expect(topBar).toContain('{ value: "screen", label: "宽屏", jaLabel: "全幅" }');
    expect(topBar).toContain('t("bodyPadding")');
    expect(topBar).toContain('t("ruledPaper")');
    expect(topBar).toContain("ruledPaperIntensityOptions");
    expect(topBar).toContain("ruledPaper");
    expect(topBar).toContain("fontSizeOptions = Array.from");
    expect(topBar).toContain("global-style-select");
    expect(topBar).toContain("<select");
    expect(topBar).toContain("fontSize: Number(event.target.value)");
    expect(css).toContain(".global-style-select");
    expect(topBar).toContain("{ value: 2.6");
    expect(topBar).toContain('{ value: "kai", label: "楷体感", jaLabel: "楷書体" }');
    expect(writingPage).toContain("--editor-shell-padding-x");
    expect(writingPage).toContain("editorPaddingBySetting");
    expect(writingPage).toContain('compact: "16px"');
    expect(writingPage).toContain('standard: "28px"');
    expect(writingPage).toContain('relaxed: "48px"');
    expect(writingPage).toContain('screen: "none"');
    expect(writingPage).toContain('maxWidth: focusMode ? "none"');
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
    expect(css).not.toContain(".writing-page .novel-editor-content.ruled-paper .tiptap-manuscript {\n  background-image: none;");
    expect(css).toContain("--editor-canvas-background");
    expect(css).toContain("background: var(--editor-canvas-background, #fffefa)");
    expect(css).toMatch(/\.global-style-option\.active\s*{[\s\S]*border-color:\s*var\(--blue-line\);[\s\S]*background:\s*var\(--blue-soft\)/);
    expect(css).toMatch(/\.preset-button:hover,[\s\S]*\.preset-button\.active\s*{[\s\S]*border-color:\s*var\(--blue-line\)/);
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
    expect(topBar).toContain('t("focusTypography")');
    expect(topBar).toContain('t("focusTypographyNote")');
    expect(topBar).toContain("closeOnOutsidePointer");
    expect(topBar).toContain("closeOnEscape");
    expect(topBar).toContain("global-style-save-status");
    expect(topBar).toContain('t("displaySettingsSaving")');
    expect(topBar).toContain("!focusMode ? (");
    expect(topBar).toContain('t("pageWidth")');
    expect(writingPage).toContain("editorUsesFullWidth = focusMode || chapterListHidden || !sidebarOpen");
    expect(writingPage).toContain('maxWidth: focusMode ? "none"');
    expect(css).toMatch(/\.global-style-panel\s*{[\s\S]*position:\s*fixed/);
    expect(css).toMatch(/\.global-style-panel\s*{[\s\S]*max-height:\s*calc\(100vh - var\(--topbar\) - 24px\)/);
    expect(css).toContain(".global-style-panel.focus-mode-style-panel");
    expect(css).toMatch(/\.global-style-panel\.focus-mode-style-panel \.global-style-row\s*{[\s\S]*grid-template-columns:\s*1fr/);
    expect(css).toMatch(
      /\.global-style-panel\.focus-mode-style-panel \.global-style-options\.(four|five)[\s\S]*grid-template-columns:\s*repeat\(auto-fit, minmax\(58px, 1fr\)\)/
    );
  });
});
