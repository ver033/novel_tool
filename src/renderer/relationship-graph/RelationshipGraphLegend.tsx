export function RelationshipGraphLegend() {
  return (
    <section className="relationship-graph-legend" aria-label="图例">
      <span>
        <span aria-hidden="true" className="legend-marker legend-marker-main" />主要节点
      </span>
      <span>
        <span aria-hidden="true" className="legend-marker legend-marker-supporting" />次要节点
      </span>
      <span>
        <b className="legend-line high" />线越粗表示强度越高
      </span>
      <span>
        <b className="legend-line uncertain" />虚线表示不确定
      </span>
      <p>基础关系默认显示；拥挤时优先常驻关键关系，点击关系线时显示该关系的剧情变化。</p>
    </section>
  );
}
