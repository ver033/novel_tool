import { describe, expect, it } from "vitest";
import {
  buildRelationshipFocusLayoutPositions,
  type RelationshipGraphFocusPosition
} from "../../src/renderer/relationship-graph/relationship-graph-focus-layout";
import { relationshipGraphToSigmaGraphData } from "../../src/renderer/relationship-graph/relationship-graph-elements";
import type { RelationshipGraphEdge, RelationshipGraphNode } from "../../src/main/shared/relationship-graph";

const nodes: RelationshipGraphNode[] = [
  {
    id: "node_lin",
    name: "林砚",
    aliases: ["林公子"],
    entityKind: "person",
    importance: "main",
    roleSummary: "主角",
    faction: "迷雾小队",
    chapterIds: ["chapter_1", "chapter_2"],
    firstChapterOrder: 1,
    latestChapterOrder: 2,
    evidenceCount: 4,
    relationCount: 2,
    averageConfidence: 0.92,
    averageIntensity: 0.76,
    score: 12
  },
  {
    id: "node_wu",
    name: "雾灵",
    aliases: [],
    entityKind: "nonhuman",
    importance: "supporting",
    roleSummary: "同行者",
    faction: null,
    chapterIds: ["chapter_1"],
    firstChapterOrder: 1,
    latestChapterOrder: 1,
    evidenceCount: 2,
    relationCount: 2,
    averageConfidence: 0.88,
    averageIntensity: 0.7,
    score: 8
  },
  {
    id: "node_shen",
    name: "沈照",
    aliases: [],
    entityKind: "person",
    importance: "supporting",
    roleSummary: null,
    faction: null,
    chapterIds: ["chapter_2"],
    firstChapterOrder: 2,
    latestChapterOrder: 2,
    evidenceCount: 1,
    relationCount: 1,
    averageConfidence: 0.7,
    averageIntensity: 0.5,
    score: 4
  }
];

const edges: RelationshipGraphEdge[] = [
  {
    id: "edge_lin_wu",
    sourceId: "node_lin",
    targetId: "node_wu",
    sourceName: "林砚",
    targetName: "雾灵",
    baseRelationLabel: "旧契约牵连者",
    baseRelationSummary: "两人被旧契约绑定",
    plotRelationLabel: "临时互相试探",
    plotRelationSummary: "在迷雾中暂时合作但彼此保留",
    primaryDimensionName: "契约张力",
    relationshipDimensions: [
      { name: "契约张力", description: "由契约带来的结构性牵引", confidence: 0.9 },
      { name: "信息差", description: "双方掌握的信息不对等", confidence: 0.82 }
    ],
    semanticMarkers: ["隐瞒", "互相试探"],
    direction: "source_to_target",
    polarity: "mixed",
    intensity: 0.8,
    confidence: 0.93,
    weight: 3,
    evidenceCount: 3,
    evidenceSources: ["summary_payload"],
    chapterIds: ["chapter_1", "chapter_2"],
    firstChapterOrder: 1,
    latestChapterOrder: 2,
    timeline: [
      {
        chapterId: "chapter_1",
        chapterTitle: "第1章",
        chapterOrder: 1,
        baseRelationLabel: "旧契约牵连者",
        baseRelationSummary: "两人被旧契约绑定",
        plotRelationLabel: "初次互相试探",
        plotRelationSummary: "第一次正面试探",
        primaryDimensionName: "信息差",
        relationshipDimensions: [{ name: "信息差", description: "信息不对等", confidence: 0.82 }],
        semanticMarkers: ["试探"],
        direction: "source_to_target",
        polarity: "mixed",
        intensity: 0.6,
        changeSummary: "开始试探",
        startState: null,
        endState: "互相防备",
        reason: "正文推进",
        evidenceQuote: "林砚看向雾灵",
        evidenceSource: "summary_payload",
        confidence: 0.84,
        uncertainty: null
      }
    ]
  },
  {
    id: "edge_wu_shen",
    sourceId: "node_wu",
    targetId: "node_shen",
    sourceName: "雾灵",
    targetName: "沈照",
    baseRelationLabel: "旧识",
    baseRelationSummary: null,
    plotRelationLabel: "疑似背离",
    plotRelationSummary: "正文没有确认是否真的背离",
    primaryDimensionName: "不确定动机",
    relationshipDimensions: [{ name: "不确定动机", description: "动机尚未确认", confidence: 0.6 }],
    semanticMarkers: ["疑似"],
    direction: "unclear",
    polarity: "unknown",
    intensity: 0.4,
    confidence: 0.55,
    weight: 1,
    evidenceCount: 1,
    evidenceSources: ["summary_payload"],
    chapterIds: ["chapter_2"],
    firstChapterOrder: 2,
    latestChapterOrder: 2,
    timeline: [
      {
        chapterId: "chapter_2",
        chapterTitle: "第2章",
        chapterOrder: 2,
        baseRelationLabel: "旧识",
        baseRelationSummary: null,
        plotRelationLabel: "疑似背离",
        plotRelationSummary: "正文没有确认是否真的背离",
        primaryDimensionName: "不确定动机",
        relationshipDimensions: [{ name: "不确定动机", description: "动机尚未确认", confidence: 0.6 }],
        semanticMarkers: ["疑似"],
        direction: "unclear",
        polarity: "unknown",
        intensity: 0.4,
        changeSummary: "关系变得可疑",
        startState: "旧识",
        endState: "疑似背离",
        reason: null,
        evidenceQuote: "雾灵避开沈照",
        evidenceSource: "summary_payload",
        confidence: 0.55,
        uncertainty: "只出现暗示，没有明说"
      }
    ]
  }
];

describe("relationshipGraphToSigmaGraphData", () => {
  it("converts API nodes to Sigma node data with role, importance, and confidence data", () => {
    const originalNodes = structuredClone(nodes);
    const elements = relationshipGraphToSigmaGraphData({ nodes, edges: [] });

    expect(elements.nodes).toHaveLength(3);
    expect(elements.nodes[0]).toMatchObject({
      id: "node_lin",
      data: {
        id: "node_lin",
        label: "林砚",
        name: "林砚",
        entityKind: "person",
        importance: "main",
        averageConfidence: 0.92,
        evidenceCount: 4,
        relationCount: 2,
        score: 12
      }
    });
    expect(nodes).toEqual(originalNodes);
  });

  it("converts API edges with dual-layer labels, dynamic dimensions, timeline, and uncertainty data", () => {
    const elements = relationshipGraphToSigmaGraphData({ nodes, edges });
    const convertedEdge = elements.edges.find((element) => element.id === "edge_lin_wu");
    const uncertainEdge = elements.edges.find((element) => element.id === "edge_wu_shen");

    expect(convertedEdge).toMatchObject({
      id: "edge_lin_wu",
      source: "node_lin",
      target: "node_wu",
      data: {
        id: "edge_lin_wu",
        label: "旧契约牵连者",
        baseLabel: "旧契约牵连者",
        baseLabelText: "旧契约牵连者",
        baseLabelPinned: true,
        plotLabel: "临时互相试探",
        plotLabelText: "临时互相试探",
        primaryDimension: "契约张力",
        dimensions: ["契约张力", "信息差"],
        dimensionDetails: [
          { name: "契约张力", description: "由契约带来的结构性牵引", confidence: 0.9 },
          { name: "信息差", description: "双方掌握的信息不对等", confidence: 0.82 }
        ],
        intensity: 0.8,
        confidence: 0.93,
        polarity: "mixed",
        uncertain: false,
        timeline: edges[0].timeline
      }
    });
    expect(uncertainEdge?.data.uncertain).toBe(true);
  });

  it("normalizes graph relationship labels to one line before rendering", () => {
    const multilineEdges: RelationshipGraphEdge[] = [
      {
        ...edges[0],
        id: "edge_multiline_label",
        baseRelationLabel: "父子\n兼宗族长辈",
        plotRelationLabel: "公开对立\t但仍受家族牵连",
        plotRelationSummary: "第一阶段\n第二阶段"
      }
    ];

    const elements = relationshipGraphToSigmaGraphData({ nodes, edges: multilineEdges });
    const convertedEdge = elements.edges[0].data;

    expect(convertedEdge.baseLabelText).toBe("父子 兼宗族长辈");
    expect(convertedEdge.plotLabelText).toBe("公开对立 但仍受家族牵连");
    expect(convertedEdge.baseLabelText).not.toMatch(/\n|\r|\t/);
    expect(convertedEdge.plotLabelText).not.toMatch(/\n|\r|\t/);
  });

  it("keeps long-novel base labels available while reserving forced labels for important edges", () => {
    const manyNodes = Array.from({ length: 48 }, (_, index): RelationshipGraphNode => ({
      ...nodes[2],
      id: `node_${index}`,
      name: `角色${index}`,
      score: index === 0 ? 12 : 3
    }));
    const manyEdges: RelationshipGraphEdge[] = Array.from({ length: 72 }, (_, index) => ({
      ...edges[index % edges.length],
      id: `edge_${index}`,
      sourceId: `node_${index % 48}`,
      targetId: `node_${(index + 1) % 48}`,
      sourceName: `角色${index % 48}`,
      targetName: `角色${(index + 1) % 48}`,
      baseRelationLabel: `基础关系${index}`,
      plotRelationLabel: `剧情关系${index}`,
      evidenceCount: index === 0 ? 4 : 1,
      weight: index === 0 ? 3 : 1,
      intensity: index === 0 ? 0.8 : 0.2,
      confidence: index === 0 ? 0.95 : 0.5
    }));

    const elements = relationshipGraphToSigmaGraphData({ nodes: manyNodes, edges: manyEdges });
    const edgeElements = elements.edges;
    const pinnedBaseLabels = edgeElements.filter((element) => element.data.baseLabelPinned);

    expect(edgeElements[0].data.baseLabelText).toBe("基础关系0");
    expect(edgeElements.every((element) => Boolean(element.data.baseLabelText))).toBe(true);
    expect(edgeElements[0].data.plotLabelText).toBe("剧情关系0");
    expect(pinnedBaseLabels.length).toBeGreaterThan(0);
    expect(pinnedBaseLabels.length).toBeLessThan(edgeElements.length);
  });

  it("lets display settings expand or reduce forced persistent basic relationship labels", () => {
    const manyNodes = Array.from({ length: 48 }, (_, index): RelationshipGraphNode => ({
      ...nodes[2],
      id: `density_node_${index}`,
      name: `角色${index}`,
      score: 3
    }));
    const manyEdges: RelationshipGraphEdge[] = Array.from({ length: 72 }, (_, index) => ({
      ...edges[index % edges.length],
      id: `density_edge_${index}`,
      sourceId: `density_node_${index % 48}`,
      targetId: `density_node_${(index + 1) % 48}`,
      sourceName: `角色${index % 48}`,
      targetName: `角色${(index + 1) % 48}`,
      baseRelationLabel: `基础关系${index}`,
      plotRelationLabel: `剧情关系${index}`,
      evidenceCount: 1,
      weight: 1,
      intensity: 0.2,
      confidence: 0.5
    }));

    const full = relationshipGraphToSigmaGraphData({ nodes: manyNodes, edges: manyEdges }, { labelDensity: "full" }).edges;
    const essential = relationshipGraphToSigmaGraphData({ nodes: manyNodes, edges: manyEdges }, { labelDensity: "essential" }).edges;

    expect(full.every((element) => Boolean(element.data.baseLabelText))).toBe(true);
    expect(essential.every((element) => Boolean(element.data.baseLabelText))).toBe(true);
    expect(full.every((element) => element.data.baseLabelPinned)).toBe(true);
    expect(essential.filter((element) => element.data.baseLabelPinned).length).toBeLessThan(full.length);
  });

  it("keeps every base label available but caps forced labels around hub characters", () => {
    const hub: RelationshipGraphNode = { ...nodes[0], id: "hub_bai", name: "白嘉轩", relationCount: 24, score: 16 };
    const satellites = Array.from({ length: 24 }, (_, index): RelationshipGraphNode => ({
      ...nodes[1],
      id: `satellite_${index}`,
      name: `角色${index}`,
      relationCount: 1,
      score: 4
    }));
    const hubEdges: RelationshipGraphEdge[] = satellites.map((node, index) => ({
      ...edges[0],
      id: `hub_edge_${index}`,
      sourceId: hub.id,
      targetId: node.id,
      sourceName: hub.name,
      targetName: node.name,
      baseRelationLabel: `稳定关系${index}`,
      plotRelationLabel: `剧情变化${index}`,
      evidenceCount: 4,
      weight: 3,
      intensity: 0.8,
      confidence: 0.94
    }));

    const balanced = relationshipGraphToSigmaGraphData({ nodes: [hub, ...satellites], edges: hubEdges }).edges;
    const full = relationshipGraphToSigmaGraphData({ nodes: [hub, ...satellites], edges: hubEdges }, { labelDensity: "full" }).edges;
    const pinnedBalancedLabels = balanced.filter((element) => element.data.baseLabelPinned);

    expect(full.every((element) => Boolean(element.data.baseLabelText))).toBe(true);
    expect(full.every((element) => element.data.baseLabelPinned)).toBe(true);
    expect(balanced.every((element) => Boolean(element.data.baseLabelText))).toBe(true);
    expect(pinnedBalancedLabels.length).toBeGreaterThan(0);
    expect(pinnedBalancedLabels.length).toBeLessThanOrEqual(3);
    expect(pinnedBalancedLabels.length).toBeLessThan(hubEdges.length / 4);
  });
});

describe("buildRelationshipFocusLayoutPositions", () => {
  it("places the focused node at center and one-hop/two-hop nodes on deterministic rings", () => {
    const positions = buildRelationshipFocusLayoutPositions({
      nodes,
      edges,
      focusNodeId: "node_lin",
      width: 900,
      height: 600
    });

    expect(positions.get("node_lin")).toEqual<RelationshipGraphFocusPosition>({
      x: 450,
      y: 300,
      ring: "center",
      hop: 0
    });
    expect(positions.get("node_wu")?.ring).toBe("one-hop");
    expect(positions.get("node_shen")?.ring).toBe("two-hop");
    expect(Math.hypot((positions.get("node_wu")?.x ?? 0) - 450, (positions.get("node_wu")?.y ?? 0) - 300)).toBeCloseTo(150, 5);
    expect(Math.hypot((positions.get("node_shen")?.x ?? 0) - 450, (positions.get("node_shen")?.y ?? 0) - 300)).toBeCloseTo(240, 5);
  });

  it("sorts ring positions by edge strength and then Chinese name for stable test output", () => {
    const tiedNodes = [
      nodes[0],
      { ...nodes[1], id: "node_a", name: "阿宁" },
      { ...nodes[2], id: "node_b", name: "白桥" }
    ];
    const tiedEdges: RelationshipGraphEdge[] = [
      { ...edges[0], id: "edge_a", sourceId: "node_lin", targetId: "node_a", targetName: "阿宁", weight: 1 },
      { ...edges[1], id: "edge_b", sourceId: "node_lin", targetId: "node_b", sourceName: "林砚", targetName: "白桥", weight: 1 }
    ];

    const positions = buildRelationshipFocusLayoutPositions({
      nodes: tiedNodes,
      edges: tiedEdges,
      focusNodeId: "node_lin",
      width: 900,
      height: 600
    });

    expect(positions.get("node_a")?.angle).toBeLessThan(positions.get("node_b")?.angle ?? Number.POSITIVE_INFINITY);
  });
});
