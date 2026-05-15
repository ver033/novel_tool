import { CaretLeft } from "@phosphor-icons/react";
import type { RelationshipGraphSourceStatus } from "../../main/shared/relationship-graph";
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

type RelationshipGraphFiltersProps = {
  readonly filters: RelationshipGraphFilterState;
  readonly displaySettings: RelationshipGraphDisplaySettings;
  readonly loading: boolean;
  readonly status: RelationshipGraphSourceStatus | null;
  readonly onChange: (filters: RelationshipGraphFilterState) => void;
  readonly onDisplaySettingsChange: (settings: RelationshipGraphDisplaySettings) => void;
  readonly onCollapse: () => void;
  readonly onRefresh: () => void;
  readonly onResetDisplaySettings: () => void;
};

const roleScopeOptions: ReadonlyArray<{ readonly value: RelationshipGraphFilterState["roleScope"]; readonly label: string }> = [
  { value: "main", label: "主要角色" },
  { value: "supporting", label: "配角" },
  { value: "all", label: "全部" }
];

const labelDensityOptions: ReadonlyArray<{ readonly value: RelationshipGraphLabelDensity; readonly label: string }> = [
  { value: "essential", label: "重点" },
  { value: "balanced", label: "均衡" },
  { value: "full", label: "完整" }
];

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
  displaySettings,
  loading,
  status,
  onChange,
  onDisplaySettingsChange,
  onCollapse,
  onRefresh,
  onResetDisplaySettings
}: RelationshipGraphFiltersProps) {
  const indexLabel = status ? `图谱：${status.message}` : "图谱：正在读取";
  const displaySettingsChanged = !isDefaultDisplaySettings(displaySettings);

  return (
    <aside className="relationship-graph-filters relationship-display-controls">
      <div className="relationship-graph-filter-head">
        <h1>显示设置</h1>
        <div className="relationship-filter-actions">
          <button className="small-button" disabled={loading} onClick={onRefresh} type="button">
            {loading ? "读取中" : "刷新图谱"}
          </button>
          <button
            aria-label="收起显示设置"
            className="relationship-panel-icon-button"
            onClick={onCollapse}
            title="收起显示设置"
            type="button"
          >
            <CaretLeft size={16} weight="bold" />
          </button>
        </div>
      </div>
      <p className="relationship-filter-note">只调整当前图谱视图，不改动章节内容或缓存结果。</p>

      <div className="relationship-filter-group">
        <label className="relationship-filter-label" htmlFor="relationship-graph-query">
          搜索
        </label>
        <input
          className="relationship-filter-input"
          id="relationship-graph-query"
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          placeholder="人物、关系或章节"
          value={filters.query}
        />
      </div>

      <div className="relationship-filter-group">
        <span className="relationship-filter-label">角色范围</span>
        <div className="relationship-segmented role-scope" role="group" aria-label="角色范围">
          {roleScopeOptions.map((option) => (
            <button
              className={filters.roleScope === option.value ? "active" : ""}
              key={option.value}
              onClick={() => onChange({ ...filters, roleScope: option.value })}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relationship-filter-group">
        <span className="relationship-filter-label">章节范围</span>
        <div className="relationship-range-inputs">
          <input
            aria-label="起始章节"
            className="relationship-filter-input"
            inputMode="numeric"
            onChange={(event) => onChange({ ...filters, chapterFrom: event.target.value })}
            placeholder="第1章"
            value={filters.chapterFrom}
          />
          <input
            aria-label="结束章节"
            className="relationship-filter-input"
            inputMode="numeric"
            onChange={(event) => onChange({ ...filters, chapterTo: event.target.value })}
            placeholder="第10章"
            value={filters.chapterTo}
          />
        </div>
      </div>

      <div className="relationship-filter-group">
        <span className="relationship-filter-label">最低置信度 {formatPercent(filters.minConfidence)}</span>
        <input
          aria-label="最低置信度"
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
          显示不确定关系
        </label>
      </div>

      <div className="relationship-filter-group relationship-display-tuning">
        <span className="relationship-filter-label">节点排斥力 {formatMultiplier(displaySettings.nodeRepulsionScale)}</span>
        <input
          aria-label="节点排斥力"
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
        <span className="relationship-filter-label">连线长度 {formatMultiplier(displaySettings.linkDistanceScale)}</span>
        <input
          aria-label="连线长度"
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
        <span className="relationship-filter-label">标签密度</span>
        <div className="relationship-segmented density" role="group" aria-label="标签密度">
          {labelDensityOptions.map((option) => (
            <button
              className={displaySettings.labelDensity === option.value ? "active" : ""}
              key={option.value}
              onClick={() => onDisplaySettingsChange({ ...displaySettings, labelDensity: option.value })}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          className="small-button relationship-reset-display-button"
          disabled={!displaySettingsChanged}
          onClick={onResetDisplaySettings}
          type="button"
        >
          重置布局
        </button>
      </div>

      <p className="relationship-source-status">{indexLabel}</p>
    </aside>
  );
}
