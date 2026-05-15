import type { RelationshipGraphResult, RelationshipGraphSourceStatus } from "../../main/shared/relationship-graph";

type RelationshipGraphCachePanelProps = {
  readonly graph: RelationshipGraphResult | null;
  readonly loading: boolean;
  readonly status: RelationshipGraphSourceStatus | null;
};

const chapterStatusLabels: Record<string, string> = {
  ready: "已完成",
  stale: "内容已更新",
  failed: "失败",
  missing: "缺失",
  skipped_too_short: "过短跳过"
};

function cacheSummary(status: RelationshipGraphSourceStatus | null, loading: boolean): string {
  if (loading && !status) {
    return "正在读取人物关系图来源状态";
  }
  if (!status) {
    return "还没有人物关系图来源状态";
  }
  return status.message;
}

function chapterStatusLabel(status: string): string {
  return chapterStatusLabels[status] ?? status;
}

export function RelationshipGraphCachePanel({ graph, loading, status }: RelationshipGraphCachePanelProps) {
  const dimensions = graph?.relationshipDimensions.slice(0, 6) ?? [];
  const chapters = graph?.availableChapters.slice(0, 10) ?? [];
  const hiddenChapterCount = Math.max(0, (graph?.availableChapters.length ?? 0) - chapters.length);

  return (
    <section className="relationship-cache-panel" aria-label="人物关系图结果">
      <div className="relationship-cache-head">
        <h2>图谱结果</h2>
        <span>{cacheSummary(status, loading)}</span>
        <span>由阶段摘要和全书摘要派生，不再逐章二次读取正文</span>
      </div>

      <div className="relationship-cache-metrics">
        <span>
          <b>{status?.nodeCount ?? 0}</b>
          人物
        </span>
        <span>
          <b>{status?.edgeCount ?? 0}</b>
          关系
        </span>
        <span>
          <b>{status ? `${status.arcSummary.readyForGraph}/${status.arcSummary.total}` : "0/0"}</b>
          阶段图谱
        </span>
        <span>
          <b>{(status?.arcSummary.failed ?? 0) + (status?.bookSummary.failed ? 1 : 0)}</b>
          摘要失败
        </span>
      </div>

      <div className="relationship-cache-current">
        <span>当前图谱结果</span>
        {graph ? (
          <p>
            {graph.nodes.length} 个人物，{graph.edges.length} 条关系，使用 {graph.graphStats.usedMentionCount}/{graph.graphStats.totalMentionCount} 条关系证据。
          </p>
        ) : (
          <p>当前还没有可展示的图谱结果。</p>
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
        <span>可用章节范围</span>
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
          <p>阶段摘要和全书摘要生成后会显示可用章节范围。</p>
        )}
      </div>
    </section>
  );
}
