import type { RelationshipGraphIndexStatus, RelationshipGraphStats } from "../../main/shared/relationship-index";

type RelationshipGraphStatusBarProps = {
  readonly status: RelationshipGraphIndexStatus | null;
  readonly stats: RelationshipGraphStats | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly rebuilding: boolean;
  readonly onRebuild: () => void;
};

function statusText(status: RelationshipGraphIndexStatus | null, loading: boolean, error: string | null): string {
  if (error) {
    return `读取失败：${error}`;
  }
  if (loading && !status) {
    return "正在读取人物关系缓存";
  }
  if (!status || status.total === 0) {
    return "等待稳定章节进入人物关系索引";
  }
  if (status.running > 0) {
    return "正在后台分析人物关系";
  }
  if (status.queued > 0 || status.waitingStable > 0) {
    return `等待稳定 ${status.waitingStable} 章，队列 ${status.queued} 章`;
  }
  if (status.failed > 0) {
    return `有 ${status.failed} 章关系索引失败`;
  }
  return "关系图缓存已就绪";
}

export function RelationshipGraphStatusBar({ status, stats, loading, error, rebuilding, onRebuild }: RelationshipGraphStatusBarProps) {
  return (
    <div className="relationship-status-bar" aria-live="polite">
      <span>{statusText(status, loading, error)}</span>
      {stats ? (
        <span>
          当前显示 {stats.visibleChapterCount} 章，使用 {stats.usedMentionCount}/{stats.totalMentionCount} 条关系证据
        </span>
      ) : null}
      <button disabled={rebuilding} onClick={onRebuild} type="button">
        {rebuilding ? "已加入队列" : "重建章节缓存并更新关系"}
      </button>
    </div>
  );
}
