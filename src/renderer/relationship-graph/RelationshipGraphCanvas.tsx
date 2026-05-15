import type { RelationshipGraphEdge, RelationshipGraphNode } from "../../main/shared/relationship-graph";
import { SigmaRelationshipGraph } from "./SigmaRelationshipGraph";
import type { RelationshipGraphDisplaySettings } from "./relationship-graph-display-settings";

type RelationshipGraphCanvasProps = {
  readonly nodes: readonly RelationshipGraphNode[];
  readonly edges: readonly RelationshipGraphEdge[];
  readonly displaySettings: RelationshipGraphDisplaySettings;
  readonly selectedId: string | null;
  readonly focusNodeId?: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onSelect: (id: string) => void;
};

export function RelationshipGraphCanvas({
  nodes,
  edges,
  displaySettings,
  selectedId,
  focusNodeId,
  loading,
  error,
  onSelect
}: RelationshipGraphCanvasProps) {
  if (error) {
    return (
      <section className="relationship-graph-canvas empty" role="alert">
        <h2>关系图读取失败</h2>
        <p>{error}</p>
      </section>
    );
  }

  if (loading && nodes.length === 0) {
    return (
      <section className="relationship-graph-canvas empty" aria-busy="true">
        <h2>正在读取关系图</h2>
        <p>正在读取阶段摘要和全书摘要中的人物关系图来源。</p>
      </section>
    );
  }

  if (nodes.length === 0) {
    return (
      <section className="relationship-graph-canvas empty">
        <h2>还没有可展示的人物关系</h2>
        <p>阶段摘要和全书摘要完成后，这里会显示人物与关系变化。</p>
      </section>
    );
  }

  return (
    <section className="relationship-graph-canvas" aria-busy={loading}>
      <div className="relationship-graph-toolbar">
        <span>
          <b>{nodes.length}</b> 人物
        </span>
        <span>
          <b>{edges.length}</b> 关系
        </span>
        <span>滚轮缩放，点击人物查看邻域</span>
        <span>基础关系默认显示</span>
        <span>点击关系线查看剧情关系</span>
        <span>虚线表示不确定关系</span>
      </div>
      <SigmaRelationshipGraph
        edges={edges}
        displaySettings={displaySettings}
        focusNodeId={focusNodeId}
        nodes={nodes}
        selectedId={selectedId}
        onSelectEdge={onSelect}
        onSelectNode={onSelect}
      />
      <div className="sr-only relationship-graph-accessible-controls" aria-label="图谱键盘选择">
        {nodes.map((node) => (
          <button key={node.id} onClick={() => onSelect(node.id)} type="button">
            选择人物 {node.name}
          </button>
        ))}
        {edges.map((edge) => (
          <button key={edge.id} onClick={() => onSelect(edge.id)} type="button">
            选择关系 {edge.sourceName} - {edge.targetName}
          </button>
        ))}
      </div>
    </section>
  );
}
