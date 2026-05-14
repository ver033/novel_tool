import type { RelationshipGraphIndexStatus, RelationshipGraphResult } from "../../main/shared/relationship-index";

type RelationshipGraphCachePanelProps = {
  readonly graph: RelationshipGraphResult | null;
  readonly loading: boolean;
  readonly status: RelationshipGraphIndexStatus | null;
};

const chapterStatusLabels: Record<string, string> = {
  ready: "已完成",
  stale: "已过期",
  waiting_stable: "等待稳定",
  queued: "队列中",
  running: "分析中",
  failed: "失败",
  skipped_too_short: "过短跳过"
};

function cacheSummary(status: RelationshipGraphIndexStatus | null, loading: boolean): string {
  if (loading && !status) {
    return "正在读取缓存状态";
  }
  if (!status || status.total === 0) {
    return "还没有人物关系缓存记录";
  }
  if (status.ready > 0) {
    return `已完成 ${status.ready} 章人物关系缓存`;
  }
  if (status.running > 0) {
    return `正在分析 ${status.running} 章`;
  }
  if (status.queued > 0 || status.waitingStable > 0) {
    return `等待稳定 ${status.waitingStable} 章，队列 ${status.queued} 章`;
  }
  if (status.failed > 0) {
    return `有 ${status.failed} 章缓存失败`;
  }
  return "暂无可用缓存结果";
}

function chapterStatusLabel(status: string): string {
  return chapterStatusLabels[status] ?? status;
}

export function RelationshipGraphCachePanel({ graph, loading, status }: RelationshipGraphCachePanelProps) {
  const dimensions = graph?.relationshipDimensions.slice(0, 6) ?? [];
  const chapters = graph?.availableChapters.slice(0, 10) ?? [];
  const hiddenChapterCount = Math.max(0, (graph?.availableChapters.length ?? 0) - chapters.length);

  return (
    <section className="relationship-cache-panel" aria-label="人物关系缓存结果">
      <div className="relationship-cache-head">
        <h2>缓存结果</h2>
        <span>{cacheSummary(status, loading)}</span>
        <span>随章节缓存同次生成，不单独二次读取正文</span>
      </div>

      <div className="relationship-cache-metrics">
        <span>
          <b>{status?.ready ?? 0}</b>
          已完成
        </span>
        <span>
          <b>{status?.waitingStable ?? 0}</b>
          等待稳定
        </span>
        <span>
          <b>{(status?.queued ?? 0) + (status?.running ?? 0)}</b>
          队列/分析
        </span>
        <span>
          <b>{status?.failed ?? 0}</b>
          失败
        </span>
      </div>

      <div className="relationship-cache-current">
        <span>当前图谱结果</span>
        {graph ? (
          <p>
            {graph.nodes.length} 个人物，{graph.edges.length} 条关系，使用 {graph.graphStats.usedMentionCount}/{graph.graphStats.totalMentionCount} 条关系证据。
          </p>
        ) : (
          <p>当前还没有可展示的缓存结果。</p>
        )}
      </div>

      {dimensions.length ? (
        <div className="relationship-cache-dimensions" aria-label="缓存关系维度">
          {dimensions.map((dimension) => (
            <span key={dimension.name}>
              {dimension.name}
              <em>{dimension.mentionCount}</em>
            </span>
          ))}
        </div>
      ) : null}

      <div className="relationship-cache-chapter-block">
        <span>缓存章节</span>
        {chapters.length ? (
          <div className="relationship-cache-chapters">
            {chapters.map((chapter) => (
              <span key={chapter.chapterId} title={chapter.indexedAt ? `索引时间：${chapter.indexedAt}` : chapterStatusLabel(chapter.status)}>
                第{chapter.chapterOrder}章
                <em>{chapterStatusLabel(chapter.status)}</em>
              </span>
            ))}
            {hiddenChapterCount > 0 ? <span className="more">+{hiddenChapterCount}</span> : null}
          </div>
        ) : (
          <p>还没有章节进入人物关系缓存。</p>
        )}
      </div>
    </section>
  );
}
