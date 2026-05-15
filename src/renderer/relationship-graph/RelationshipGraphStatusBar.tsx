import type { RelationshipGraphSourceStatus, RelationshipGraphStats } from "../../main/shared/relationship-graph";

type RelationshipGraphStatusBarProps = {
  readonly status: RelationshipGraphSourceStatus | null;
  readonly stats: RelationshipGraphStats | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onOpenSettings: () => void;
};

function statusText(status: RelationshipGraphSourceStatus | null, loading: boolean, error: string | null): string {
  if (error) {
    return `读取失败：${error}`;
  }
  if (loading && !status) {
    return "正在读取人物关系图";
  }
  if (!status) {
    return "还没有读取图谱来源状态";
  }
  return status.message;
}

export function RelationshipGraphStatusBar({ status, stats, loading, error, onOpenSettings }: RelationshipGraphStatusBarProps) {
  return (
    <div className="relationship-status-bar" aria-live="polite">
      <span>{statusText(status, loading, error)}</span>
      {stats ? (
        <span>
          当前显示 {stats.visibleChapterCount} 章，使用 {stats.usedMentionCount}/{stats.totalMentionCount} 条关系证据
        </span>
      ) : null}
      <button onClick={onOpenSettings} type="button">
        缓存设置
      </button>
    </div>
  );
}
