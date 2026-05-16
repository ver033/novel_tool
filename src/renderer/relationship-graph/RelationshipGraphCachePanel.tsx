import type { RelationshipGraphResult, RelationshipGraphSourceStatus } from "../../main/shared/relationship-graph";

type RelationshipGraphCachePanelProps = {
  readonly graph: RelationshipGraphResult | null;
  readonly loading: boolean;
  readonly status: RelationshipGraphSourceStatus | null;
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

export function RelationshipGraphCachePanel({ graph, loading, status }: RelationshipGraphCachePanelProps) {
  const dimensions = graph?.relationshipDimensions.slice(0, 6) ?? [];
  const coverageLabel = status?.chapterRange ? `第 ${status.chapterRange.start}-${status.chapterRange.end} 章` : null;

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
        <span>图谱覆盖</span>
        {coverageLabel ? (
          <p>{coverageLabel}</p>
        ) : (
          <p>阶段摘要和全书摘要生成后会显示图谱覆盖范围。</p>
        )}
      </div>
    </section>
  );
}
