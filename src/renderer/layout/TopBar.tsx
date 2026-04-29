import { BookOpen, CornersIn, CornersOut, GearSix, MagnifyingGlass, UploadSimple } from "@phosphor-icons/react";
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
  readonly onImport?: () => void;
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
  { value: "wide", label: "宽栏" }
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
  { value: "fangsong", label: "仿宋感" }
] as const;

const fontSizeOptions = [
  { value: 18, label: "小" },
  { value: 20, label: "标准" },
  { value: 22, label: "大" }
] as const;

const lineHeightOptions = [
  { value: 1.82, label: "紧凑" },
  { value: 2.08, label: "标准" },
  { value: 2.32, label: "舒展" }
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

const presetSettings: Record<Exclude<EditorSettings["layoutPreset"], "custom">, Partial<EditorSettings>> = {
  immersive: {
    layoutPreset: "immersive",
    pageWidth: "medium",
    fontFamily: "system",
    fontSize: 20,
    lineHeight: 2.32,
    paragraphSpacing: "standard",
    firstLineIndent: "two",
    theme: "light"
  },
  review: {
    layoutPreset: "review",
    pageWidth: "wide",
    fontFamily: "hei",
    fontSize: 18,
    lineHeight: 2.08,
    paragraphSpacing: "compact",
    firstLineIndent: "none",
    theme: "light"
  },
  reading: {
    layoutPreset: "reading",
    pageWidth: "narrow",
    fontFamily: "song",
    fontSize: 22,
    lineHeight: 2.32,
    paragraphSpacing: "loose",
    firstLineIndent: "two",
    theme: "eye"
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
  onImport,
  onEditorSettingsChange,
  onFocusModeToggle,
  onSearchChange,
  onWelcome,
  onSettings,
  searchValue = ""
}: TopBarProps) {
  const [layoutPanelOpen, setLayoutPanelOpen] = useState(false);
  const canShowLayoutPanel = mode === "writing" && editorSettings && onEditorSettingsChange && !focusMode;
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
              <aside className="global-style-panel">
                <div className="global-style-head">
                  <div className="global-style-title">
                    <span className="global-style-title-icon">T</span>
                    <span>页面与排版</span>
                  </div>
                  <button className="global-style-close" onClick={() => setLayoutPanelOpen(false)} type="button" aria-label="关闭页面与排版">
                    ×
                  </button>
                </div>
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
                <div className="global-style-row">
                  <div className="global-style-group">
                    <span className="global-style-label">页面宽度</span>
                    <div className="global-style-options">
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
                <div className="global-style-group">
                  <span className="global-style-label">正文风格</span>
                  <div className="global-style-options four">
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
                    <div className="global-style-options">
                      {fontSizeOptions.map((option) => (
                        <button
                          className={`global-style-option ${isActive(editorSettings.fontSize, option.value)}`}
                          data-editor-style="fontSize"
                          data-editor-style-value={option.value}
                          key={option.value}
                          onClick={() => updateEditorSetting({ layoutPreset: "custom", fontSize: option.value })}
                          type="button"
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="global-style-group">
                    <span className="global-style-label">行距</span>
                    <div className="global-style-options">
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
                <div className="global-style-note">这些设置只影响当前写作环境的显示，不改写正文内容。</div>
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
