import { CaretLeft } from "@phosphor-icons/react";
import type { RelationshipGraphSourceStatus } from "../../main/shared/relationship-graph";
import { useI18n } from "../i18n";
import { useLocalizedCopy } from "../i18n/localized-copy";
import {
  defaultRelationshipGraphDisplaySettings,
  type RelationshipGraphDisplaySettings,
  type RelationshipGraphLabelDensity
} from "./relationship-graph-display-settings";

export type RelationshipGraphFilterState = {
  readonly chapterFrom: string;
  readonly chapterTo: string;
  readonly roleScope: "main" | "supporting" | "all";
  readonly minConfidence: number;
  readonly includeUncertain: boolean;
  readonly query: string;
};

export type RelationshipGraphSourceMode = "ai" | "author";

type RelationshipGraphFiltersProps = {
  readonly filters: RelationshipGraphFilterState;
  readonly graphSource: RelationshipGraphSourceMode;
  readonly displaySettings: RelationshipGraphDisplaySettings;
  readonly loading: boolean;
  readonly status: RelationshipGraphSourceStatus | null;
  readonly onChange: (filters: RelationshipGraphFilterState) => void;
  readonly onDisplaySettingsChange: (settings: RelationshipGraphDisplaySettings) => void;
  readonly onCollapse: () => void;
  readonly onRefresh: () => void;
  readonly onResetDisplaySettings: () => void;
};

const roleScopeOptions: ReadonlyArray<RelationshipGraphFilterState["roleScope"]> = ["main", "supporting", "all"];
const labelDensityOptions: ReadonlyArray<RelationshipGraphLabelDensity> = ["essential", "balanced", "full"];

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatMultiplier(value: number): string {
  return `${value.toFixed(1)}x`;
}

function isDefaultDisplaySettings(settings: RelationshipGraphDisplaySettings): boolean {
  return (
    settings.nodeRepulsionScale === defaultRelationshipGraphDisplaySettings.nodeRepulsionScale &&
    settings.linkDistanceScale === defaultRelationshipGraphDisplaySettings.linkDistanceScale &&
    settings.labelDensity === defaultRelationshipGraphDisplaySettings.labelDensity
  );
}

export function RelationshipGraphFilters({
  filters,
  graphSource,
  displaySettings,
  loading,
  status,
  onChange,
  onDisplaySettingsChange,
  onCollapse,
  onRefresh,
  onResetDisplaySettings
}: RelationshipGraphFiltersProps) {
  const { locale } = useI18n();
  const copy = useLocalizedCopy({
    "zh-CN": {
      graph: "图谱", reading: "正在读取", ready: "来源已就绪", heading: "筛选与显示", loading: "读取中", refresh: "刷新图谱",
      collapse: "收起显示设置", note: "只调整当前图谱视图，不改动章节内容或缓存结果。", search: "搜索",
      searchPlaceholder: "人物、关系或章节", roleScope: "角色范围", roles: { main: "主要角色", supporting: "配角", all: "全部" },
      chapterRange: "章节范围", from: "起始章节", fromPlaceholder: "第1章", to: "结束章节", toPlaceholder: "第10章",
      confidence: "最低置信度", uncertain: "显示不确定关系", repulsion: "节点排斥力", linkLength: "连线长度",
      density: "标签密度", densities: { essential: "重点", balanced: "均衡", full: "完整" }, reset: "重置布局"
    },
    "ja-JP": {
      graph: "関係図", reading: "読み込み中", ready: "取得元を確認済み", heading: "絞り込みと表示", loading: "読み込み中", refresh: "関係図を更新",
      collapse: "表示設定を閉じる", note: "現在の表示だけを調整します。章の本文やキャッシュ結果は変更しません。", search: "検索",
      searchPlaceholder: "人物・関係・章", roleScope: "人物の範囲", roles: { main: "主要人物", supporting: "脇役", all: "すべて" },
      chapterRange: "章の範囲", from: "開始章", fromPlaceholder: "第1章", to: "終了章", toPlaceholder: "第10章",
      confidence: "最低信頼度", uncertain: "不確かな関係も表示", repulsion: "ノード間の反発", linkLength: "線の長さ",
      density: "ラベル密度", densities: { essential: "重要", balanced: "標準", full: "すべて" }, reset: "配置をリセット"
    }
  });
  const indexLabel = status ? `${copy.graph}：${locale === "ja-JP" ? copy.ready : status.message}` : `${copy.graph}：${copy.reading}`;
  const displaySettingsChanged = !isDefaultDisplaySettings(displaySettings);

  return (
    <aside className="relationship-graph-filters relationship-display-controls">
      <div className="relationship-graph-filter-head">
        <h1>{copy.heading}</h1>
        <div className="relationship-filter-actions">
          <button className="small-button" disabled={loading} onClick={onRefresh} type="button">
            {loading ? copy.loading : copy.refresh}
          </button>
          <button
            aria-label={copy.collapse}
            className="relationship-panel-icon-button"
            onClick={onCollapse}
            title={copy.collapse}
            type="button"
          >
            <CaretLeft size={16} weight="bold" />
          </button>
        </div>
      </div>
      <p className="relationship-filter-note">{copy.note}</p>

      <div className="relationship-filter-group">
        <label className="relationship-filter-label" htmlFor="relationship-graph-query">
          {copy.search}
        </label>
        <input
          className="relationship-filter-input"
          id="relationship-graph-query"
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          placeholder={copy.searchPlaceholder}
          value={filters.query}
        />
      </div>

      {graphSource === "ai" ? (
        <>
          <div className="relationship-filter-group">
            <span className="relationship-filter-label">{copy.roleScope}</span>
            <div className="relationship-segmented role-scope" role="group" aria-label={copy.roleScope}>
              {roleScopeOptions.map((option) => (
                <button
                  className={filters.roleScope === option ? "active" : ""}
                  key={option}
                  onClick={() => onChange({ ...filters, roleScope: option })}
                  type="button"
                >
                  {copy.roles[option]}
                </button>
              ))}
            </div>
          </div>

          <div className="relationship-filter-group">
            <span className="relationship-filter-label">{copy.chapterRange}</span>
            <div className="relationship-range-inputs">
              <input
                aria-label={copy.from}
                className="relationship-filter-input"
                inputMode="numeric"
                onChange={(event) => onChange({ ...filters, chapterFrom: event.target.value })}
                placeholder={copy.fromPlaceholder}
                value={filters.chapterFrom}
              />
              <input
                aria-label={copy.to}
                className="relationship-filter-input"
                inputMode="numeric"
                onChange={(event) => onChange({ ...filters, chapterTo: event.target.value })}
                placeholder={copy.toPlaceholder}
                value={filters.chapterTo}
              />
            </div>
          </div>

          <div className="relationship-filter-group">
            <span className="relationship-filter-label">{copy.confidence} {formatPercent(filters.minConfidence)}</span>
            <input
              aria-label={copy.confidence}
              className="relationship-filter-slider"
              max="1"
              min="0"
              onChange={(event) => onChange({ ...filters, minConfidence: Number(event.target.value) })}
              step="0.05"
              type="range"
              value={filters.minConfidence}
            />
            <label className="relationship-checkline">
              <input
                checked={filters.includeUncertain}
                onChange={(event) => onChange({ ...filters, includeUncertain: event.target.checked })}
                type="checkbox"
              />
              {copy.uncertain}
            </label>
          </div>
        </>
      ) : null}

      <div className="relationship-filter-group relationship-display-tuning">
        <span className="relationship-filter-label">{copy.repulsion} {formatMultiplier(displaySettings.nodeRepulsionScale)}</span>
        <input
          aria-label={copy.repulsion}
          className="relationship-filter-slider"
          max="4"
          min="0.4"
          onChange={(event) =>
            onDisplaySettingsChange({ ...displaySettings, nodeRepulsionScale: Number(event.target.value) })
          }
          step="0.05"
          type="range"
          value={displaySettings.nodeRepulsionScale}
        />
        <span className="relationship-filter-label">{copy.linkLength} {formatMultiplier(displaySettings.linkDistanceScale)}</span>
        <input
          aria-label={copy.linkLength}
          className="relationship-filter-slider"
          max="1.8"
          min="0.8"
          onChange={(event) =>
            onDisplaySettingsChange({ ...displaySettings, linkDistanceScale: Number(event.target.value) })
          }
          step="0.05"
          type="range"
          value={displaySettings.linkDistanceScale}
        />
        <span className="relationship-filter-label">{copy.density}</span>
        <div className="relationship-segmented density" role="group" aria-label={copy.density}>
          {labelDensityOptions.map((option) => (
            <button
              className={displaySettings.labelDensity === option ? "active" : ""}
              key={option}
              onClick={() => onDisplaySettingsChange({ ...displaySettings, labelDensity: option })}
              type="button"
            >
              {copy.densities[option]}
            </button>
          ))}
        </div>
        <button
          className="small-button relationship-reset-display-button"
          disabled={!displaySettingsChanged}
          onClick={onResetDisplaySettings}
          type="button"
        >
          {copy.reset}
        </button>
      </div>

      <p className="relationship-source-status">{indexLabel}</p>
    </aside>
  );
}
