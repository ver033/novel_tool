import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("relationship graph page v2 renderer wiring", () => {
  it("uses the Sigma renderer instead of Cytoscape or the legacy SVG layout", () => {
    const canvas = readSource("src/renderer/relationship-graph/RelationshipGraphCanvas.tsx");
    const packageJson = readSource("package.json");

    expect(canvas).toContain("SigmaRelationshipGraph");
    expect(canvas).not.toContain("CytoscapeRelationshipGraph");
    expect(canvas).not.toContain("relationship-graph-layout");
    expect(canvas).not.toContain("<svg");
    expect(packageJson).toContain('"sigma"');
    expect(packageJson).toContain('"graphology"');
    expect(packageJson).toContain('"graphology-layout-forceatlas2"');
    expect(packageJson).not.toContain('"cytoscape"');
  });

  it("keeps graph canvas rendering pure and exposes node and edge selection callbacks", () => {
    const component = readSource("src/renderer/relationship-graph/SigmaRelationshipGraph.tsx");

    expect(component).toContain('import Graph from "graphology"');
    expect(component).toContain('import { SigmaContainer');
    expect(component).toContain('from "@react-sigma/core"');
    expect(component).toContain('import forceAtlas2 from "graphology-layout-forceatlas2"');
    expect(component).toContain("onSelectNode");
    expect(component).toContain("onSelectEdge");
    expect(component).toContain("clickNode");
    expect(component).toContain("clickEdge");
    expect(component).toContain("positionCache");
    expect(component).toContain("lastLayoutDataKey");
    expect(component).not.toContain("relationshipGraph.getGraph");
    expect(component).not.toContain("requestRelationshipGraph");
  });

  it("keeps Sigma hover styling separate from clicked graph selection", () => {
    const component = readSource("src/renderer/relationship-graph/SigmaRelationshipGraph.tsx");

    expect(component).toContain("enterNode");
    expect(component).toContain("leaveNode");
    expect(component).toContain('activeGraph.setNodeAttribute(node, "hovering", true)');
    expect(component).toContain('graph.setNodeAttribute(n, "dimmed", true)');
    expect(component).toContain('graph.setEdgeAttribute(e, "highlighted", true)');
    expect(component).not.toContain("onSelectNodeRef.current(node)");
  });

  it("uses a quiet neighbor-preview hover state without leaving unrelated labels on the graph", () => {
    const component = readSource("src/renderer/relationship-graph/SigmaRelationshipGraph.tsx");

    expect(component).toContain("const drawRelationshipNodeHover");
    expect(component).toContain("const drawRelationshipNodeLabel");
    expect(component).toContain("defaultDrawNodeHover: drawRelationshipNodeHover");
    expect(component).toContain("defaultDrawNodeLabel: drawRelationshipNodeLabel");
    expect(component).toContain('nextAttrs.label = attrs.dimmed ? "" : label;');
    expect(component).toContain('nextAttrs.forceLabel = Boolean(label && !attrs.dimmed');
    expect(component).toContain('nextAttrs.label = attrs.dimmed ? "" : attrs.label;');
    expect(component).toContain("attrs.highlighted || attrs.forceLabel");
    expect(component).not.toContain('context.fillStyle = "#FFF"');
  });

  it("preserves Sigma node and edge display data inside reducers so x and y survive rendering", () => {
    const component = readSource("src/renderer/relationship-graph/SigmaRelationshipGraph.tsx");

    expect(component).toContain("const nextAttrs = { ...attrs }");
    expect(component).toContain("return nextAttrs");
    expect(component).not.toContain("nodeReducer: (node, attrs) => {\n        const selected = selectedId === node;\n        return {");
    expect(component).not.toContain("edgeReducer: (edge, attrs) => {\n        const selected = selectedId === edge;\n        const label = selected ? attrs.plotLabelVisible : attrs.baseLabelVisible;\n        return {");
  });

  it("supports direct Sigma node dragging without moving the camera or triggering click selection", () => {
    const component = readSource("src/renderer/relationship-graph/SigmaRelationshipGraph.tsx");

    expect(component).toContain("draggedNodeRef");
    expect(component).toContain("downNode:");
    expect(component).toContain("mousemovebody:");
    expect(component).toContain("mouseup:");
    expect(component).toContain("sigma.viewportToGraph");
    expect(component).toContain("sigma.getCamera().disable()");
    expect(component).toContain("sigma.getCamera().enable()");
    expect(component).toContain("suppressClickAfterDragRef");
    expect(component).toContain("positionCache.current.set(draggedNode");
  });

  it("animates into ForceAtlas2 positions and briefly settles the graph after drag", () => {
    const component = readSource("src/renderer/relationship-graph/SigmaRelationshipGraph.tsx");

    expect(component).toContain('import { animateNodes } from "sigma/utils"');
    expect(component).toContain('import FA2LayoutSupervisor from "graphology-layout-forceatlas2/worker"');
    expect(component).toContain("animationTargets");
    expect(component).toContain("animateNodes(");
    expect(component).toContain("activeGraph,");
    expect(component).toContain("startSettlingLayout");
    expect(component).toContain('activeGraph.setNodeAttribute(fixedNode, "fixed", true)');
    expect(component).toContain("layoutSupervisorRef");
    expect(component).toContain("settleTimerRef");
  });

  it("renders V2 controls for role scope, chapter cursor, focus mode, status, and dynamic relationship system", () => {
    const page = readSource("src/renderer/relationship-graph/CharacterRelationshipGraphPage.tsx");
    const filters = readSource("src/renderer/relationship-graph/RelationshipGraphFilters.tsx");
    const inspector = readSource("src/renderer/relationship-graph/RelationshipGraphInspector.tsx");
    const statusBar = readSource("src/renderer/relationship-graph/RelationshipGraphStatusBar.tsx");
    const legend = readSource("src/renderer/relationship-graph/RelationshipGraphLegend.tsx");

    expect(page).toContain("RelationshipGraphChapterSlider");
    expect(page).toContain("RelationshipGraphStatusBar");
    expect(page).toContain("chapterCursor");
    expect(page).toContain("displaySettings");
    expect(page).toContain("defaultRelationshipGraphDisplaySettings");
    expect(page).toContain("refreshStatus");
    expect(page).toContain("loadRequestIdRef");
    expect(filters).toContain("主要角色");
    expect(filters).toContain("配角");
    expect(filters).toContain("全部");
    expect(filters).toContain('className="relationship-segmented role-scope"');
    expect(filters).toContain("显示设置");
    expect(filters).toContain("节点排斥力");
    expect(filters).toContain("连线长度");
    expect(filters).toContain("标签密度");
    expect(filters).toContain("重置布局");
    expect(filters).toContain("只调整当前图谱视图");
    expect(filters).not.toContain("visibleBaseLabels");
    expect(filters).not.toContain("LLM 识别的具体关系");
    expect(inspector).toContain("以此为中心");
    expect(inspector).toContain("返回全局图");
    expect(inspector).toContain("基础关系");
    expect(inspector).toContain("剧情关系");
    expect(statusBar).toContain("人物关系图");
    expect(statusBar).not.toContain("等待稳定");
    expect(statusBar).toContain("缓存设置");
    expect(legend).toContain("基础关系默认显示");
    expect(legend).toContain("优先常驻关键关系");
    expect(legend).toContain("点击关系线");
  });

  it("keeps the role-scope segmented control readable inside the narrow display panel", () => {
    const styles = readSource("src/renderer/styles/globals.css");

    expect(styles).toContain(".relationship-segmented.role-scope");
    expect(styles).toContain("grid-template-columns: minmax(72px, 1.2fr) minmax(48px, 0.8fr) minmax(44px, 0.75fr);");
    expect(styles).toContain("white-space: nowrap;");
    expect(styles).toContain("text-overflow: ellipsis;");
  });

  it("styles the main-node legend marker explicitly instead of relying on the generic node marker", () => {
    const legend = readSource("src/renderer/relationship-graph/RelationshipGraphLegend.tsx");
    const styles = readSource("src/renderer/styles/globals.css");

    expect(legend).toContain('className="legend-marker legend-marker-main"');
    expect(legend).toContain('aria-hidden="true"');
    expect(styles).toContain(".legend-marker");
    expect(styles).toContain("display: inline-block;");
    expect(styles).toContain("flex: 0 0 auto;");
    expect(styles).toContain("box-sizing: border-box;");
    expect(styles).toContain("aspect-ratio: 1 / 1;");
    expect(styles).toContain(".legend-marker-main");
    expect(styles).toContain("box-shadow: 0 0 0 3px");
  });

  it("keeps the graph page focused on author-facing display controls, canvas, and selected detail", () => {
    const page = readSource("src/renderer/relationship-graph/CharacterRelationshipGraphPage.tsx");
    const filters = readSource("src/renderer/relationship-graph/RelationshipGraphFilters.tsx");
    const styles = readSource("src/renderer/styles/globals.css");

    const displayPanelIndex = page.indexOf('className="relationship-graph-display-panel"');
    const filtersIndex = page.indexOf("<RelationshipGraphFilters");
    const canvasIndex = page.indexOf("<RelationshipGraphCanvas");
    const inspectorIndex = page.indexOf("<RelationshipGraphInspector");

    expect(displayPanelIndex).toBeGreaterThan(-1);
    expect(filtersIndex).toBeGreaterThan(displayPanelIndex);
    expect(filtersIndex).toBeLessThan(canvasIndex);
    expect(canvasIndex).toBeLessThan(inspectorIndex);
    expect(page).toContain('className="relationship-graph-detail-panel"');
    expect(page).not.toContain("RelationshipGraphCachePanel");
    expect(filters).toContain("relationship-display-controls");
    expect(styles).toContain("grid-template-columns: var(--relationship-display-panel-width) minmax(0, 1fr) var(--relationship-detail-panel-width);");
    expect(styles).toContain(".relationship-graph-display-panel");
    expect(styles).toContain(".relationship-graph-detail-panel");
  });

  it("lets both side panels collapse and keeps the detail panel hidden until a graph item is selected", () => {
    const page = readSource("src/renderer/relationship-graph/CharacterRelationshipGraphPage.tsx");
    const filters = readSource("src/renderer/relationship-graph/RelationshipGraphFilters.tsx");
    const inspector = readSource("src/renderer/relationship-graph/RelationshipGraphInspector.tsx");
    const styles = readSource("src/renderer/styles/globals.css");

    expect(page).toContain("displayPanelCollapsed");
    expect(page).toContain("const [displayPanelCollapsed, setDisplayPanelCollapsed] = useState(true);");
    expect(page).toContain("detailPanelCollapsed");
    expect(page).toContain("shouldShowDetailPanel");
    expect(page).toContain("handleGraphSelect");
    expect(page).toContain("setDetailPanelCollapsed(false)");
    expect(filters).toContain("onCollapse");
    expect(filters).toContain("CaretLeft");
    expect(filters).toContain('aria-label="收起显示设置"');
    expect(page).toContain("CaretRight");
    expect(page).toContain('aria-label="展开显示设置"');
    expect(inspector).toContain("onCollapse");
    expect(inspector).toContain("CaretRight");
    expect(inspector).toContain('aria-label="收起人物信息"');
    expect(styles).toContain("--relationship-display-panel-width");
    expect(styles).toContain("--relationship-detail-panel-width: 0px;");
    expect(styles).toContain(".relationship-panel-icon-button");
    expect(styles).toContain(".relationship-graph-workspace.display-collapsed");
    expect(styles).toContain(".relationship-graph-workspace.detail-open");
  });

  it("uses ForceAtlas2 with cached positions for dense long-novel graphs", () => {
    const component = readSource("src/renderer/relationship-graph/SigmaRelationshipGraph.tsx");
    const hubLayout = readSource("src/renderer/relationship-graph/relationship-graph-hub-layout.ts");
    const packageJson = readSource("package.json");

    expect(component).toContain("resolveGraphDensity");
    expect(component).toContain("buildRelationshipHubSeedLayoutPositions");
    expect(component).not.toContain("lockedNodeIds");
    expect(hubLayout).not.toContain("lockedNodeIds");
    expect(hubLayout).not.toContain("buildRelationshipHubSeedLayoutPlan");
    expect(component).toContain("fixed: false");
    expect(component).toContain("forceAtlas2.inferSettings(graph)");
    expect(component).toContain("forceAtlas2.assign(graph");
    expect(component).toContain("shouldUseRelationshipHubSectorLayout");
    expect(component).toContain("!useStaticHubSectorLayout");
    expect(component).toContain('import noverlap from "graphology-layout-noverlap"');
    expect(packageJson).toContain('"graphology-layout-noverlap"');
    expect(component).toContain("applyNoverlapLayout(graph");
    expect(component).toContain("stopSettlingLayout({ resolveOverlap: true })");
    expect(component).toContain("adjustSizes: true");
    expect(component).toContain("outboundAttractionDistribution: true");
    expect(component).toContain("linLogMode: graph.order >= 36");
    expect(component).toContain("barnesHutOptimize");
    expect(component).toContain("positionCache.set");
    expect(component).toContain("loadGraph(graph)");
    expect(component).toContain("displaySettings.nodeRepulsionScale");
    expect(component).toContain("displaySettings.linkDistanceScale");
    expect(component).toContain("displaySettings.labelDensity");
    expect(component).toContain("scalingRatio: config.scalingRatio * displaySettings.nodeRepulsionScale");
    expect(component).toContain("gravity: config.gravity");
    expect(component).toContain("iterations: config.iterations");
    expect(component).toContain("nodeSize(node.relationCount, maxRelations, config)");
    expect(component).toContain("BASE_NODE_SIZE");
    expect(component).toContain("MAX_DENSE_NODE_SIZE");
  });

  it("applies display tuning to hub-sector static layouts", () => {
    const component = readSource("src/renderer/relationship-graph/SigmaRelationshipGraph.tsx");
    const hubLayout = readSource("src/renderer/relationship-graph/relationship-graph-hub-layout.ts");

    expect(component).toContain("displaySettings: displaySettings");
    expect(hubLayout).toContain("nodeRepulsionScale");
    expect(hubLayout).toContain("linkDistanceScale");
    expect(hubLayout).toContain("displayScale");
  });

  it("animates hub-sector layout targets instead of letting cached positions hide display tuning", () => {
    const component = readSource("src/renderer/relationship-graph/SigmaRelationshipGraph.tsx");

    expect(component).toContain("const targetPosition = useStaticHubSectorLayout && seeded ? seeded : null");
    expect(component).toContain("cached ?? fallbackPosition(index, data.nodes.length)");
    expect(component).toContain("animationTargets[nodeElement.id] = { x: targetPosition.x, y: targetPosition.y }");
    expect(component).not.toContain("focusNodeId || activeGraph.order < 3 || shouldUseRelationshipHubSectorLayout(nodes, edges)");
  });

  it("creates the Sigma container with a multi graph so parallel relationship edges cannot crash startup", () => {
    const component = readSource("src/renderer/relationship-graph/SigmaRelationshipGraph.tsx");

    expect(component).toContain("class RelationshipSigmaGraphConstructor extends Graph");
    expect(component).toContain('super({ allowSelfLoops: false, multi: true, type: "mixed" })');
    expect(component).toContain("graph={RelationshipSigmaGraphConstructor}");
  });

  it("keeps basic relationship labels visible and reveals plot labels only after clicking an edge", () => {
    const component = readSource("src/renderer/relationship-graph/SigmaRelationshipGraph.tsx");
    const canvas = readSource("src/renderer/relationship-graph/RelationshipGraphCanvas.tsx");

    expect(component).toContain("baseLabelText");
    expect(component).toContain("plotLabelText");
    expect(component).toContain("baseLabelPinned");
    expect(component).toContain("selectedId === edge");
    expect(component).toContain("attrs.plotLabelText");
    expect(component).toContain("attrs.baseLabelText");
    expect(component).toContain("defaultDrawEdgeLabel: drawRelationshipEdgeLabel");
    expect(canvas).toContain("基础关系默认显示");
    expect(canvas).toContain("点击关系线查看剧情关系");
  });

  it("reserves toolbar height so graph nodes are not hidden under the top chips", () => {
    const styles = readSource("src/renderer/styles/globals.css");
    const toolbarRule = styles.slice(
      styles.indexOf(".relationship-graph-toolbar {"),
      styles.indexOf(".relationship-graph-toolbar span")
    );

    expect(styles).toContain("grid-template-rows: auto minmax(0, 1fr);");
    expect(styles).toContain("grid-row: 2;");
    expect(toolbarRule).toContain("position: relative;");
    expect(toolbarRule).not.toContain("position: absolute;");
  });

  it("keeps legend with display controls and reserves the right rail for selected story context", () => {
    const page = readSource("src/renderer/relationship-graph/CharacterRelationshipGraphPage.tsx");
    const styles = readSource("src/renderer/styles/globals.css");

    expect(page.indexOf("<RelationshipGraphLegend")).toBeLessThan(page.indexOf('className="relationship-graph-main-area"'));
    expect(page.indexOf("<RelationshipGraphInspector")).toBeGreaterThan(page.indexOf('className="relationship-graph-detail-panel"'));
    expect(styles).toContain("align-items: center;");
    expect(styles).toContain("flex: 0 0 auto;");
  });

  it("shows a narrative-focused character inspector with readable activity bars, arc, key relationships, and evidence snippets", () => {
    const inspector = readSource("src/renderer/relationship-graph/RelationshipGraphInspector.tsx");
    const styles = readSource("src/renderer/styles/globals.css");

    expect(inspector).toContain("出场章节活动");
    expect(inspector).toContain("人物弧线");
    expect(inspector).toContain("关键关系");
    expect(inspector).toContain("证据摘录");
    expect(inspector).toContain("添加备注");
    expect(inspector).not.toContain("打开第");
    expect(inspector).toContain("buildChapterActivity");
    expect(inspector).toContain("relationship-activity-chart");
    expect(inspector).toContain("relationship-activity-item");
    expect(inspector).toContain("relationship-activity-bar");
    expect(inspector).toContain("relationship-activity-chapter");
    expect(inspector).toContain("relationship-character-timeline");
    expect(inspector).toContain("relationship-key-relation-list");
    expect(inspector).not.toContain("BookOpen");
    expect(inspector.indexOf("返回全局图", inspector.indexOf('relationship-character-action-row footer'))).toBeGreaterThan(-1);
    expect(styles).toContain(".relationship-activity-chart");
    expect(styles).toContain(".relationship-activity-item");
    expect(styles).toContain(".relationship-activity-bar");
    expect(styles).toContain(".relationship-character-action-row.footer");
    expect(styles).toContain(".relationship-character-action-row.footer > button");
    expect(styles).toContain(".relationship-character-action-row.footer .relationship-segmented button.active");
    expect(styles).not.toContain(".relationship-character-action-row.footer button:first-child");
    expect(styles).toContain("position: sticky;");
    expect(styles).toContain(".relationship-character-timeline");
    expect(styles).toContain(".relationship-key-relation-list");
    expect(styles).toContain(".relationship-character-action-row");
  });

  it("keeps the chapter slider cache-read-only and avoids product-fixed semantic dimensions", () => {
    const slider = readSource("src/renderer/relationship-graph/RelationshipGraphChapterSlider.tsx");
    const filters = readSource("src/renderer/relationship-graph/RelationshipGraphFilters.tsx");
    const legend = readSource("src/renderer/relationship-graph/RelationshipGraphLegend.tsx");

    expect(slider).toContain("全书汇总");
    expect(slider).toContain("availableChapters");
    expect(slider).not.toContain("rebuild");
    expect(slider).not.toContain("relationshipGraph");
    expect(filters).not.toContain("relationOptions");
    expect(filters).not.toContain("family");
    expect(filters).not.toContain("mentor");
    expect(legend).not.toContain("盟友");
    expect(legend).not.toContain("宿敌");
  });
});
