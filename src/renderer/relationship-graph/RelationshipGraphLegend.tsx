import { useLocalizedCopy } from "../i18n/localized-copy";

export function RelationshipGraphLegend() {
  const copy = useLocalizedCopy({
    "zh-CN": { legend: "图例", main: "主要节点", supporting: "次要节点", strength: "线越粗表示强度越高", uncertain: "虚线表示不确定", hint: "基础关系默认显示；拥挤时优先常驻关键关系，点击关系线时显示该关系的剧情变化。" },
    "ja-JP": { legend: "凡例", main: "主要人物", supporting: "脇役", strength: "線が太いほど関係が強い", uncertain: "破線は不確かな関係", hint: "基本関係は常に表示されます。混雑時は重要な関係を優先し、関係線を選ぶと物語内の変化を表示します。" }
  });
  return (
    <section className="relationship-graph-legend" aria-label={copy.legend}>
      <span>
        <span aria-hidden="true" className="legend-marker legend-marker-main" />{copy.main}
      </span>
      <span>
        <span aria-hidden="true" className="legend-marker legend-marker-supporting" />{copy.supporting}
      </span>
      <span>
        <b className="legend-line high" />{copy.strength}
      </span>
      <span>
        <b className="legend-line uncertain" />{copy.uncertain}
      </span>
      <p>{copy.hint}</p>
    </section>
  );
}
