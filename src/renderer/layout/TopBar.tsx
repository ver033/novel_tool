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
import { useI18n } from "../i18n";

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
  readonly searchPlaceholder?: string;
  readonly showSearch?: boolean;
  readonly showEditorHistoryControls?: boolean;
  readonly showSaveStatus?: boolean;
};

function saveStatusLabel(status: NonNullable<TopBarProps["saveStatus"]>, japanese: boolean): string {
  if (status === "dirty") {
    return japanese ? "編集中" : "编辑中";
  }
  if (status === "saving") {
    return japanese ? "保存中" : "保存中";
  }
  if (status === "failed") {
    return japanese ? "保存に失敗しました" : "保存失败";
  }
  return japanese ? "自動保存済み" : "已自动保存";
}

const layoutPresets = [
  { value: "immersive", label: "沉浸写作", jaLabel: "没入執筆", description: "窄页舒展", jaDescription: "広がりのある狭幅" },
  { value: "review", label: "审稿校对", jaLabel: "レビュー", description: "宽页紧凑", jaDescription: "コンパクトな広幅" },
  { value: "reading", label: "长文阅读", jaLabel: "長文閲覧", description: "护眼大字", jaDescription: "目に優しい大きな文字" }
] as const;

const pageWidthOptions = [
  { value: "narrow", label: "窄栏", jaLabel: "狭い" },
  { value: "medium", label: "适中", jaLabel: "標準" },
  { value: "wide", label: "宽栏", jaLabel: "広い" },
  { value: "screen", label: "宽屏", jaLabel: "全幅" }
] as const;

const themeOptions = [
  { value: "light", label: "浅色", jaLabel: "ライト" },
  { value: "eye", label: "护眼", jaLabel: "アイケア" },
  { value: "night", label: "夜间", jaLabel: "ダーク" }
] as const;

const fontFamilyOptions = [
  { value: "system", label: "默认", jaLabel: "標準" },
  { value: "song", label: "宋体感", jaLabel: "明朝体" },
  { value: "hei", label: "黑体感", jaLabel: "ゴシック体" },
  { value: "fangsong", label: "仿宋感", jaLabel: "細明朝" },
  { value: "kai", label: "楷体感", jaLabel: "楷書体" }
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
  { value: "compact", label: "紧凑", jaLabel: "コンパクト" },
  { value: "standard", label: "标准", jaLabel: "標準" },
  { value: "relaxed", label: "舒展", jaLabel: "ゆったり" }
] as const;

const paragraphSpacingOptions = [
  { value: "compact", label: "紧凑", jaLabel: "狭い" },
  { value: "standard", label: "标准", jaLabel: "標準" },
  { value: "loose", label: "宽松", jaLabel: "広い" }
] as const;

const firstLineIndentOptions = [
  { value: "none", label: "无", jaLabel: "なし" },
  { value: "two", label: "2字", jaLabel: "2字" },
  { value: "four", label: "4字", jaLabel: "4字" }
] as const;

const ruledPaperIntensityOptions = [
  { value: "off", label: "关闭", jaLabel: "オフ", ruledPaper: false },
  { value: "soft", label: "淡", jaLabel: "薄い", ruledPaper: true },
  { value: "standard", label: "标准", jaLabel: "標準", ruledPaper: true },
  { value: "strong", label: "清晰", jaLabel: "濃い", ruledPaper: true }
] as const;

const presetSettings: Record<Exclude<EditorSettings["layoutPreset"], "custom">, Partial<EditorSettings>> = {
  immersive: {
    layoutPreset: "immersive",
    pageWidth: "narrow",
    fontFamily: "song",
    editorPadding: "standard",
    fontSize: 18,
    lineHeight: 1.82,
    paragraphSpacing: "standard",
    firstLineIndent: "none",
    theme: "light",
    ruledPaper: false,
    ruledPaperIntensity: "soft"
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
  searchValue = "",
  searchPlaceholder,
  showSearch = true,
  showEditorHistoryControls = true,
  showSaveStatus = true
}: TopBarProps) {
  const { locale, t } = useI18n();
  const japanese = locale === "ja-JP";
  const [layoutPanelOpen, setLayoutPanelOpen] = useState(false);
  const canShowLayoutPanel = mode === "writing" && editorSettings && onEditorSettingsChange;
  const layoutPanelMode = focusMode ? "focus" : "normal";
  const resolvedSearchPlaceholder = searchPlaceholder ?? (mode === "welcome" ? t("searchWorksOrChapters") : t("searchChaptersOrContent"));
  const updateEditorSetting = (patch: Partial<EditorSettings>) => {
    if (!onEditorSettingsChange) {
      return;
    }
    void onEditorSettingsChange(patch);
  };

  return (
    <header className={`topbar ${focusMode ? "focus-mode" : ""}`}>
      <button className="brand brand-button" onClick={onWelcome} title={t("backToStart")} type="button">
        <span className={mode === "welcome" ? "logo" : "line-icon"}>
          <BookOpen size={24} weight="regular" />
        </span>
        <span>
          {title}
          {subtitle ? <small>{subtitle}</small> : null}
        </span>
      </button>
      <div className="topbar-center">
        {mode === "writing" && !focusMode && showEditorHistoryControls ? (
          <div className="undo-redo-group" aria-label={t("undoAndRedo")}>
            <IconButton className="undo-redo-button" disabled={!onUndo || !canUndo} label={t("undo")} onClick={() => onUndo?.()}>
              <ArrowCounterClockwise size={22} weight="regular" />
            </IconButton>
            <IconButton className="undo-redo-button" disabled={!onRedo || !canRedo} label={t("redo")} onClick={() => onRedo?.()}>
              <ArrowClockwise size={22} weight="regular" />
            </IconButton>
          </div>
        ) : null}
        {focusMode ? (
          <span className="focus-mode-label">{t("focusWriting")}</span>
        ) : !showSearch ? (
          <span className="focus-mode-label">{searchPlaceholder ?? title}</span>
        ) : (
          <label className="search">
            <MagnifyingGlass size={21} />
            <input
              aria-label={resolvedSearchPlaceholder}
              disabled={!onSearchChange}
              onChange={(event) => onSearchChange?.(event.target.value)}
              placeholder={resolvedSearchPlaceholder}
              value={searchValue}
            />
          </label>
        )}
      </div>
      <div className="top-actions">
        {mode === "writing" && onFocusModeToggle ? (
          <IconButton label={focusMode ? t("exitFocus") : t("focusMode")} onClick={onFocusModeToggle}>
            {focusMode ? <CornersOut size={24} weight="regular" /> : <CornersIn size={24} weight="regular" />}
          </IconButton>
        ) : null}
        {mode === "writing" && onImport && !focusMode ? (
          <IconButton label={t("importTxt")} onClick={() => onImport()}>
            <UploadSimple size={24} weight="regular" />
          </IconButton>
        ) : null}
        {mode === "writing" && onExport && !focusMode ? (
          <IconButton label={t("exportTxt")} onClick={() => onExport()}>
            <DownloadSimple size={24} weight="regular" />
          </IconButton>
        ) : null}
        {canShowLayoutPanel ? (
          <div className="layout-control">
            <button
              aria-expanded={layoutPanelOpen}
              aria-label={t("pageAndTypography")}
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
                    <span>{focusMode ? t("focusTypography") : t("pageAndTypography")}</span>
                  </div>
                  <button className="global-style-close" onClick={() => setLayoutPanelOpen(false)} type="button" aria-label={t("closeTypography")}>
                    ×
                  </button>
                </div>
                {!focusMode ? (
                  <div className="global-style-group">
                    <span className="global-style-label">{t("writingPreset")}</span>
                    <div className="preset-grid">
                      {layoutPresets.map((preset) => (
                        <button
                          className={`preset-button ${isActive(editorSettings.layoutPreset, preset.value)}`}
                          data-editor-preset={preset.value}
                          key={preset.value}
                          onClick={() => updateEditorSetting(presetSettings[preset.value])}
                          type="button"
                        >
                          <strong>{japanese ? preset.jaLabel : preset.label}</strong>
                          <span>{japanese ? preset.jaDescription : preset.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {!focusMode ? (
                  <div className="global-style-row">
                    <div className="global-style-group">
                      <span className="global-style-label">{t("pageWidth")}</span>
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
                            {japanese ? option.jaLabel : option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="global-style-group">
                      <span className="global-style-label">{t("theme")}</span>
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
                            {japanese ? option.jaLabel : option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="global-style-group">
                    <span className="global-style-label">{t("theme")}</span>
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
                          {japanese ? option.jaLabel : option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="global-style-group">
                  <span className="global-style-label">{t("bodyStyle")}</span>
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
                        {japanese ? option.jaLabel : option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="global-style-row">
                  <div className="global-style-group">
                    <span className="global-style-label">{t("bodyFontSize")}</span>
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
                    <span className="global-style-label">{t("lineHeight")}</span>
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
                  <span className="global-style-label">{t("bodyPadding")}</span>
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
                        {japanese ? option.jaLabel : option.label}
                      </button>
                    ))}
                  </div>
                </div>
                {!focusMode ? (
                  <div className="global-style-row">
                    <div className="global-style-group">
                      <span className="global-style-label">{t("paragraphSpacing")}</span>
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
                            {japanese ? option.jaLabel : option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="global-style-group">
                      <span className="global-style-label">{t("firstLineIndent")}</span>
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
                            {japanese ? option.jaLabel : option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="global-style-group">
                  <span className="global-style-label">{t("ruledPaper")}</span>
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
                          {japanese ? option.jaLabel : option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="global-style-note">
                  {focusMode ? t("focusTypographyNote") : t("typographyNote")}
                </div>
              </aside>
            ) : null}
          </div>
        ) : null}
        {!focusMode ? (
          <IconButton label={t("settings")} onClick={onSettings}>
            <GearSix size={24} weight="regular" />
          </IconButton>
        ) : null}
        {mode === "writing" && showSaveStatus ? (
          <span className={`status-pill ${saveStatus}`}>
            <span className="dot" />
            {saveStatusLabel(saveStatus, japanese)}
          </span>
        ) : null}
      </div>
    </header>
  );
}
