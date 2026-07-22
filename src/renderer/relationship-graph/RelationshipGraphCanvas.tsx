import type { RelationshipGraphEdge, RelationshipGraphNode } from "../../main/shared/relationship-graph";
import { useLocalizedCopy } from "../i18n/localized-copy";
import { SigmaRelationshipGraph } from "./SigmaRelationshipGraph";
import type { RelationshipGraphDisplaySettings } from "./relationship-graph-display-settings";

type RelationshipGraphCanvasProps = {
  readonly nodes: readonly RelationshipGraphNode[];
  readonly edges: readonly RelationshipGraphEdge[];
  readonly displaySettings: RelationshipGraphDisplaySettings;
  readonly graphSource?: "ai" | "author";
  readonly layoutMode?: "auto" | "manual";
  readonly selectedId: string | null;
  readonly focusNodeId?: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onSelect: (id: string) => void;
  readonly onNodePositionChange?: (nodeId: string, position: { readonly x: number; readonly y: number }) => void;
};

export function RelationshipGraphCanvas({
  nodes,
  edges,
  displaySettings,
  graphSource = "ai",
  layoutMode = "auto",
  selectedId,
  focusNodeId,
  loading,
  error,
  onSelect,
  onNodePositionChange
}: RelationshipGraphCanvasProps) {
  const copy = useLocalizedCopy({
    "zh-CN": {
      failed: "关系图读取失败",
      loading: "正在读取关系图",
      loadingAuthor: "正在读取作者设定图谱。",
      loadingAi: "正在读取阶段摘要和全书摘要中的人物关系图来源。",
      noAuthor: "作者还没有录入人物关系",
      noAi: "还没有可展示的人物关系",
      noAuthorHint: "添加人物和关系后，这里会显示作者设定图谱。",
      noAiHint: "阶段摘要和全书摘要完成后，这里会显示人物与关系变化。",
      people: "人物",
      relations: "关系",
      zoomHint: "滚轮缩放，点击人物查看邻域",
      baseHint: "基础关系默认显示",
      edgeHint: "点击关系线查看剧情关系",
      uncertainHint: "虚线表示不确定关系",
      keyboard: "图谱键盘选择",
      selectPerson: "选择人物",
      selectRelation: "选择关系"
    },
    "ja-JP": {
      failed: "人物関係図の読み込みに失敗しました",
      loading: "人物関係図を読み込んでいます",
      loadingAuthor: "作者設定の人物関係図を読み込んでいます。",
      loadingAi: "章と作品の要約から人物関係を読み込んでいます。",
      noAuthor: "作者設定の人物関係はまだありません",
      noAi: "表示できる人物関係はまだありません",
      noAuthorHint: "人物と関係を追加すると、作者設定の関係図がここに表示されます。",
      noAiHint: "章と作品の要約が作成されると、人物と関係の変化がここに表示されます。",
      people: "人物",
      relations: "関係",
      zoomHint: "ホイールで拡大縮小、人物を選ぶと周辺を表示",
      baseHint: "基本関係は常に表示",
      edgeHint: "関係線を選ぶと物語内の変化を表示",
      uncertainHint: "破線は不確かな関係",
      keyboard: "キーボードで関係図を選択",
      selectPerson: "人物を選択",
      selectRelation: "関係を選択"
    }
  });
  if (error) {
    return (
      <section className="relationship-graph-canvas empty" role="alert">
        <h2>{copy.failed}</h2>
        <p>{error}</p>
      </section>
    );
  }

  if (loading && nodes.length === 0) {
    return (
      <section className="relationship-graph-canvas empty" aria-busy="true">
        <h2>{copy.loading}</h2>
        <p>{graphSource === "author" ? copy.loadingAuthor : copy.loadingAi}</p>
      </section>
    );
  }

  if (nodes.length === 0) {
    return (
      <section className="relationship-graph-canvas empty">
        <h2>{graphSource === "author" ? copy.noAuthor : copy.noAi}</h2>
        <p>{graphSource === "author" ? copy.noAuthorHint : copy.noAiHint}</p>
      </section>
    );
  }

  return (
    <section className="relationship-graph-canvas" aria-busy={loading}>
      <div className="relationship-graph-toolbar">
        <span>
          <b>{nodes.length}</b> {copy.people}
        </span>
        <span>
          <b>{edges.length}</b> {copy.relations}
        </span>
        <span>{copy.zoomHint}</span>
        <span>{copy.baseHint}</span>
        <span>{copy.edgeHint}</span>
        <span>{copy.uncertainHint}</span>
      </div>
      <SigmaRelationshipGraph
        edges={edges}
        displaySettings={displaySettings}
        focusNodeId={focusNodeId}
        layoutMode={layoutMode}
        nodes={nodes}
        selectedId={selectedId}
        onSelectEdge={onSelect}
        onSelectNode={onSelect}
        onNodePositionChange={onNodePositionChange}
      />
      <div className="sr-only relationship-graph-accessible-controls" aria-label={copy.keyboard}>
        {nodes.map((node) => (
          <button key={node.id} onClick={() => onSelect(node.id)} type="button">
            {copy.selectPerson} {node.name}
          </button>
        ))}
        {edges.map((edge) => (
          <button key={edge.id} onClick={() => onSelect(edge.id)} type="button">
            {copy.selectRelation} {edge.sourceName} - {edge.targetName}
          </button>
        ))}
      </div>
    </section>
  );
}
