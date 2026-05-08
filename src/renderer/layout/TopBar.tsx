import {
  ArrowClockwise,
  ArrowCounterClockwise,
  BookOpen,
  CornersIn,
  CornersOut,
  DownloadSimple,
  GearSix,
  MagnifyingGlass,
  UploadSimple
} from "@phosphor-icons/react";
import { useState } from "react";
import type { EditorSettings } from "../../main/shared/types";
import { IconButton } from "../components/IconButton";

type TopBarProps = {
  readonly title: string;
  readonly subtitle?: string;
  readonly mode?: "welcome" | "writing";
  readonly saveStatus?: "saved" | "dirty" | "saving" | "failed";
  readonly editorSettings?: EditorSettings;
  readonly focusMode?: boolean;
  readonly canRedo?: boolean;
  readonly canUndo?: boolean;
  readonly onExport?: () => void;
  readonly onImport?: () => void;
  readonly onRedo?: () => void;
  readonly onUndo?: () => void;
  readonly onEditorSettingsChange?: (patch: Partial<EditorSettings>) => void | Promise<void>;
  readonly onFocusModeToggle?: () => void;
  readonly onSearchChange?: (value: string) => void;
  readonly onWelcome: () => void;
  readonly onSettings: () => void;
  readonly searchValue?: string;
};

function saveStatusLabel(status: NonNullable<TopBarProps["saveStatus"]>): string {
  if (status === "dirty") {
    return "编辑中";
  }
  if (status === "saving") {
    return "保存中";
  }
  if (status === "failed") {
    return "保存失败";
  }
  return "已自动保存";
}

const layoutPresets = [
  { value: "immersive", label: "沉浸写作", description: "窄页舒展" },
  { value: "review", label: "审稿校对", description: "宽页紧凑" },
  { value: "reading", label: "长文阅读", description: "护眼大字" }
] as const;

const pageWidthOptions = [
  { value: "narrow", label: "窄栏" },
  { value: "medium", label: "适中" },
  { value: "wide", label: "宽栏" },
  { value: "screen", label: "宽屏" }
] as const;

const themeOptions = [
  { value: "light", label: "浅色" },
  { value: "eye", label: "护眼" },
  { value: "night", label: "夜间" }
] as const;

const fontFamilyOptions = [
  { value: "system", label: "默认" },
  { value: "song", label: "宋体感" },
  { value: "hei", label: "黑体感" },
  { value: "fangsong", label: "仿宋感" },
  { value: "kai", label: "楷体感" }
] as const;

const fontSizeOptions = Array.from({ length: 25 }, (_, index) => {
  const value = index + 12;
  return { value, label: `${value}px` };
});

const lineHeightOptions = [
  { value: 1.6, label: "1.6" },
  { value: 1.82, label: "1.82" },
  { value: 2.08, label: "2.08" },
  { value: 2.32, label: "2.32" },
  { value: 2.6, label: "2.6" }
] as const;

const editorPaddingOptions = [
  { value: "compact", label: "紧凑" },
  { value: "standard", label: "标准" },
  { value: "relaxed", label: "舒展" }
] as const;

const paragraphSpacingOptions = [
  { value: "compact", label: "紧凑" },
  { value: "standard", label: "标准" },
  { value: "loose", label: "宽松" }
] as const;

const firstLineIndentOptions = [
  { value: "none", label: "无" },
  { value: "two", label: "2字" },
  { value: "four", label: "4字" }
] as const;

const ruledPaperIntensityOptions = [
  { value: "off", label: "关闭", ruledPaper: false },
  { value: "soft", label: "淡", ruledPaper: true },
  { value: "standard", label: "标准", ruledPaper: true },
  { value: "strong", label: "清晰", ruledPaper: true }
] as const;

const presetSettings: Record<Exclude<EditorSettings["layoutPreset"], "custom">, Partial<EditorSettings>> = {
  immersive: {
    layoutPreset: "immersive",
    pageWidth: "screen",
    fontFamily: "system",
    editorPadding: "compact",
    fontSize: 20,
    lineHeight: 2.32,
    paragraphSpacing: "standard",
    firstLineIndent: "none",
    theme: "light",
    ruledPaper: true,
    ruledPaperIntensity: "standard"
  },
  review: {
    layoutPreset: "review",
    pageWidth: "wide",
    fontFamily: "hei",
    editorPadding: "standard",
    fontSize: 18,
    lineHeight: 2.08,
    paragraphSpacing: "compact",
    firstLineIndent: "none",
    theme: "light",
    ruledPaper: true,
    ruledPaperIntensity: "soft"
  },
  reading: {
    layoutPreset: "reading",
    pageWidth: "narrow",
    fontFamily: "song",
    editorPadding: "relaxed",
    fontSize: 22,
    lineHeight: 2.32,
    paragraphSpacing: "loose",
    firstLineIndent: "none",
    theme: "eye",
    ruledPaper: true,
    ruledPaperIntensity: "standard"
  }
};

function isActive<T extends string | number>(current: T, value: T): string {
  return current === value ? "active" : "";
}

export function TopBar({
  title,
  subtitle,
  mode = "writing",
  saveStatus = "saved",
  editorSettings,
  focusMode = false,
  canRedo = false,
  canUndo = false,
  onExport,
  onImport,
  onRedo,
  onUndo,
  onEditorSettingsChange,
  onFocusModeToggle,
  onSearchChange,
  onWelcome,
  onSettings,
  searchValue = ""
}: TopBarProps) {
  const [layoutPanelOpen, setLayoutPanelOpen] = useState(false);
  const canShowLayoutPanel = mode === "writing" && editorSettings && onEditorSettingsChange;
  const layoutPanelMode = focusMode ? "focus" : "normal";
  const updateEditorSetting = (patch: Partial<EditorSettings>) => {
    if (!onEditorSettingsChange) {
      return;
    }
    void onEditorSettingsChange(patch);
  };

  return (
    <header className={`topbar ${focusMode ? "focus-mode" : ""}`}>
      <button className="brand brand-button" onClick={onWelcome} title="返回开始页" type="button">
        <span className={mode === "welcome" ? "logo" : "line-icon"}>
          <BookOpen size={24} weight="regular" />
        </span>
        <span>
          {title}
          {subtitle ? <small>{subtitle}</small> : null}
        </span>
      </button>
      <div className="topbar-center">
        {mode === "writing" && !focusMode ? (
          <div className="undo-redo-group" aria-label="撤销和重做">
            <IconButton className="undo-redo-button" disabled={!onUndo || !canUndo} label="撤销" onClick={() => onUndo?.()}>
              <ArrowCounterClockwise size={22} weight="regular" />
            </IconButton>
            <IconButton className="undo-redo-button" disabled={!onRedo || !canRedo} label="重做" onClick={() => onRedo?.()}>
              <ArrowClockwise size={22} weight="regular" />
            </IconButton>
          </div>
        ) : null}
        {focusMode ? (
          <span className="focus-mode-label">专注写作</span>
        ) : (
          <label className="search">
            <MagnifyingGlass size={21} />
            <input
              aria-label={mode === "welcome" ? "搜索作品或章节" : "搜索章节或内容"}
              disabled={!onSearchChange}
              onChange={(event) => onSearchChange?.(event.target.value)}
              placeholder={mode === "welcome" ? "搜索作品或章节" : "搜索章节或内容"}
              value={searchValue}
            />
          </label>
        )}
      </div>
      <div className="top-actions">
        {mode === "writing" && onFocusModeToggle ? (
          <IconButton label={focusMode ? "退出专注" : "专注模式"} onClick={onFocusModeToggle}>
            {focusMode ? <CornersOut size={24} weight="regular" /> : <CornersIn size={24} weight="regular" />}
          </IconButton>
        ) : null}
        {mode === "writing" && onImport && !focusMode ? (
          <IconButton label="导入 TXT" onClick={() => onImport()}>
            <UploadSimple size={24} weight="regular" />
          </IconButton>
        ) : null}
        {mode === "writing" && onExport && !focusMode ? (
          <IconButton label="导出 TXT" onClick={() => onExport()}>
            <DownloadSimple size={24} weight="regular" />
          </IconButton>
        ) : null}
        {canShowLayoutPanel ? (
          <div className="layout-control">
            <button
              aria-expanded={layoutPanelOpen}
              aria-label="页面与排版"
              className={`global-style-toggle ${layoutPanelOpen ? "active" : ""}`}
              data-action="toggle-global-style"
              onClick={() => setLayoutPanelOpen((current) => !current)}
              type="button"
            >
              Aa
            </button>
            {layoutPanelOpen ? (
              <aside className={`global-style-panel ${layoutPanelMode === "focus" ? "focus-mode-style-panel" : ""}`}>
                <div className="global-style-head">
                  <div className="global-style-title">
                    <span className="global-style-title-icon">T</span>
                    <span>{focusMode ? "专注排版" : "页面与排版"}</span>
                  </div>
                  <button className="global-style-close" onClick={() => setLayoutPanelOpen(false)} type="button" aria-label="关闭页面与排版">
                    ×
                  </button>
                </div>
                {!focusMode ? (
                  <div className="global-style-group">
                    <span className="global-style-label">写作预设</span>
                    <div className="preset-grid">
                      {layoutPresets.map((preset) => (
                        <button
                          className={`preset-button ${isActive(editorSettings.layoutPreset, preset.value)}`}
                          data-editor-preset={preset.value}
                          key={preset.value}
                          onClick={() => updateEditorSetting(presetSettings[preset.value])}
                          type="button"
                        >
                          <strong>{preset.label}</strong>
                          <span>{preset.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {!focusMode ? (
                  <div className="global-style-row">
                    <div className="global-style-group">
                      <span className="global-style-label">页面宽度</span>
                      <div className="global-style-options four">
                        {pageWidthOptions.map((option) => (
                          <button
                            className={`global-style-option ${isActive(editorSettings.pageWidth, option.value)}`}
                            data-editor-style="pageWidth"
                            data-editor-style-value={option.value}
                            key={option.value}
                            onClick={() => updateEditorSetting({ layoutPreset: "custom", pageWidth: option.value })}
                            type="button"
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="global-style-group">
                      <span className="global-style-label">主题</span>
                      <div className="global-style-options">
                        {themeOptions.map((option) => (
                          <button
                            className={`global-style-option ${isActive(editorSettings.theme, option.value)}`}
                            data-editor-style="theme"
                            data-editor-style-value={option.value}
                            key={option.value}
                            onClick={() => updateEditorSetting({ layoutPreset: "custom", theme: option.value })}
                            type="button"
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="global-style-group">
                    <span className="global-style-label">主题</span>
                    <div className="global-style-options">
                      {themeOptions.map((option) => (
                        <button
                          className={`global-style-option ${isActive(editorSettings.theme, option.value)}`}
                          data-editor-style="theme"
                          data-editor-style-value={option.value}
                          key={option.value}
                          onClick={() => updateEditorSetting({ layoutPreset: "custom", theme: option.value })}
                          type="button"
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="global-style-group">
                  <span className="global-style-label">正文风格</span>
                  <div className="global-style-options five">
                    {fontFamilyOptions.map((option) => (
                      <button
                        className={`global-style-option ${isActive(editorSettings.fontFamily, option.value)}`}
                        data-editor-style="fontFamily"
                        data-editor-style-value={option.value}
                        key={option.value}
                        onClick={() => updateEditorSetting({ layoutPreset: "custom", fontFamily: option.value })}
                        type="button"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="global-style-row">
                  <div className="global-style-group">
                    <span className="global-style-label">正文字号</span>
                    <select
                      className="global-style-select"
                      data-editor-style="fontSize"
                      onChange={(event) =>
                        updateEditorSetting({ layoutPreset: "custom", fontSize: Number(event.target.value) })
                      }
                      value={editorSettings.fontSize}
                    >
                      {fontSizeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="global-style-group">
                    <span className="global-style-label">行距</span>
                    <div className="global-style-options five">
                      {lineHeightOptions.map((option) => (
                        <button
                          className={`global-style-option ${isActive(editorSettings.lineHeight, option.value)}`}
                          data-editor-style="lineHeight"
                          data-editor-style-value={option.value}
                          key={option.value}
                          onClick={() => updateEditorSetting({ layoutPreset: "custom", lineHeight: option.value })}
                          type="button"
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="global-style-group">
                  <span className="global-style-label">正文边距</span>
                  <div className="global-style-options">
                    {editorPaddingOptions.map((option) => (
                      <button
                        className={`global-style-option ${isActive(editorSettings.editorPadding, option.value)}`}
                        data-editor-style="editorPadding"
                        data-editor-style-value={option.value}
                        key={option.value}
                        onClick={() => updateEditorSetting({ layoutPreset: "custom", editorPadding: option.value })}
                        type="button"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                {!focusMode ? (
                  <div className="global-style-row">
                    <div className="global-style-group">
                      <span className="global-style-label">段间距</span>
                      <div className="global-style-options">
                        {paragraphSpacingOptions.map((option) => (
                          <button
                            className={`global-style-option ${isActive(editorSettings.paragraphSpacing, option.value)}`}
                            data-editor-style="paragraphSpacing"
                            data-editor-style-value={option.value}
                            key={option.value}
                            onClick={() => updateEditorSetting({ layoutPreset: "custom", paragraphSpacing: option.value })}
                            type="button"
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="global-style-group">
                      <span className="global-style-label">首行缩进</span>
                      <div className="global-style-options">
                        {firstLineIndentOptions.map((option) => (
                          <button
                            className={`global-style-option ${isActive(editorSettings.firstLineIndent, option.value)}`}
                            data-editor-style="firstLineIndent"
                            data-editor-style-value={option.value}
                            key={option.value}
                            onClick={() => updateEditorSetting({ layoutPreset: "custom", firstLineIndent: option.value })}
                            type="button"
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="global-style-group">
                  <span className="global-style-label">稿纸横格</span>
                  <div className="global-style-options four">
                    {ruledPaperIntensityOptions.map((option) => {
                      const activeIntensity = editorSettings.ruledPaper ? editorSettings.ruledPaperIntensity : "off";
                      return (
                        <button
                          className={`global-style-option ${isActive(activeIntensity, option.value)}`}
                          data-editor-style="ruledPaperIntensity"
                          data-editor-style-value={option.value}
                          key={option.value}
                          onClick={() =>
                            updateEditorSetting({
                              layoutPreset: "custom",
                              ruledPaper: option.ruledPaper,
                              ruledPaperIntensity: option.value
                            })
                          }
                          type="button"
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="global-style-note">
                  {focusMode ? "专注模式下正文区域自动铺满，页面宽度设置退出专注后生效。" : "这些设置只影响当前写作环境的显示，不改写正文内容。"}
                </div>
              </aside>
            ) : null}
          </div>
        ) : null}
        {!focusMode ? (
          <IconButton label="设置" onClick={onSettings}>
            <GearSix size={24} weight="regular" />
          </IconButton>
        ) : null}
        {mode === "writing" ? (
          <span className={`status-pill ${saveStatus}`}>
            <span className="dot" />
            {saveStatusLabel(saveStatus)}
          </span>
        ) : null}
      </div>
    </header>
  );
}
