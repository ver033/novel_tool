import "@react-sigma/core/lib/style.css";
import { SigmaContainer, useLoadGraph, useRegisterEvents, useSetSettings, useSigma } from "@react-sigma/core";
import Graph from "graphology";
import type { GraphOptions } from "graphology-types";
import forceAtlas2 from "graphology-layout-forceatlas2";
import FA2LayoutSupervisor from "graphology-layout-forceatlas2/worker";
import noverlap from "graphology-layout-noverlap";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { EdgeLabelDrawingFunction, NodeHoverDrawingFunction, NodeLabelDrawingFunction } from "sigma/rendering";
import { animateNodes } from "sigma/utils";
import type { RelationshipGraphEdge, RelationshipGraphNode } from "../../main/shared/relationship-graph";
import {
  relationshipGraphToSigmaGraphData,
  type RelationshipGraphSigmaEdgeData,
  type RelationshipGraphSigmaNodeData
} from "./relationship-graph-elements";
import type { RelationshipGraphDisplaySettings } from "./relationship-graph-display-settings";
import { buildRelationshipFocusLayoutPositions } from "./relationship-graph-focus-layout";
import {
  buildRelationshipHubSeedLayoutPositions,
  shouldUseRelationshipHubSectorLayout
} from "./relationship-graph-hub-layout";
import {
  getRelationshipEdgeLabelBoxes,
  reserveRelationshipEdgeLabelBox,
  resetRelationshipEdgeLabelRegistry,
  resolveRelationshipEdgeLabelPlacement
} from "./relationship-edge-label-layout";
import type { RelationshipGraphPosition } from "./relationship-graph-position";

type SigmaRelationshipGraphProps = {
  readonly nodes: readonly RelationshipGraphNode[];
  readonly edges: readonly RelationshipGraphEdge[];
  readonly displaySettings: RelationshipGraphDisplaySettings;
  readonly selectedId: string | null;
  readonly focusNodeId?: string | null;
  readonly onSelectNode: (id: string) => void;
  readonly onSelectEdge: (id: string) => void;
};

type GraphDensity = "spacious" | "balanced" | "dense";

type GraphDensityConfig = {
  readonly baseNodeSize: number;
  readonly maxNodeSize: number;
  readonly edgeSizeBase: number;
  readonly edgeSizeRange: number;
  readonly labelThreshold: number;
  readonly iterations: number;
  readonly scalingRatio: number;
  readonly gravity: number;
  readonly edgeWeightInfluence: number;
  readonly slowDown: number;
};

type SigmaNodeAttributes = RelationshipGraphSigmaNodeData & {
  readonly data: RelationshipGraphSigmaNodeData;
  x: number;
  y: number;
  size: number;
  color: string;
  forceLabel: boolean;
  highlighted: boolean;
  dimmed: boolean;
  hovering: boolean;
  dragging: boolean;
  fixed: boolean;
  zIndex: number;
};

type SigmaEdgeAttributes = RelationshipGraphSigmaEdgeData & {
  readonly data: RelationshipGraphSigmaEdgeData;
  size: number;
  color: string;
  forceLabel: boolean;
  hidden: boolean;
  highlighted: boolean;
  dimmed: boolean;
  layoutWeight: number;
  zIndex: number;
};

type SigmaGraph = Graph<SigmaNodeAttributes, SigmaEdgeAttributes>;
type LayoutAnimationTargets = Record<string, { readonly x: number; readonly y: number }>;

type SigmaGraphBuildResult = {
  readonly graph: SigmaGraph;
  readonly animationTargets: LayoutAnimationTargets;
};

type StopSettlingLayoutOptions = {
  readonly resolveOverlap?: boolean;
};

const BASE_NODE_SIZE = 5.5;
const MAX_DENSE_NODE_SIZE = 12;
const EDGE_LABEL_MAX_WIDTH = 150;
const NODE_LABEL_BOX_FONT_SIZE = 12;

class RelationshipSigmaGraphConstructor extends Graph<SigmaNodeAttributes, SigmaEdgeAttributes> {
  constructor(_options?: GraphOptions) {
    super({ allowSelfLoops: false, multi: true, type: "mixed" });
  }
}

const graphDensityConfig: Record<GraphDensity, GraphDensityConfig> = {
  spacious: {
    baseNodeSize: 7,
    maxNodeSize: 18,
    edgeSizeBase: 0.7,
    edgeSizeRange: 2.1,
    labelThreshold: 6,
    iterations: 180,
    scalingRatio: 22,
    gravity: 0.08,
    edgeWeightInfluence: 0.65,
    slowDown: 1.2
  },
  balanced: {
    baseNodeSize: BASE_NODE_SIZE,
    maxNodeSize: 15,
    edgeSizeBase: 0.55,
    edgeSizeRange: 1.7,
    labelThreshold: 8,
    iterations: 260,
    scalingRatio: 34,
    gravity: 0.045,
    edgeWeightInfluence: 0.45,
    slowDown: 1.8
  },
  dense: {
    baseNodeSize: 4.4,
    maxNodeSize: MAX_DENSE_NODE_SIZE,
    edgeSizeBase: 0.42,
    edgeSizeRange: 1.35,
    labelThreshold: 10,
    iterations: 360,
    scalingRatio: 48,
    gravity: 0.025,
    edgeWeightInfluence: 0.25,
    slowDown: 2.4
  }
};

function resolveGraphDensity(nodeCount: number): GraphDensity {
  if (nodeCount >= 80) {
    return "dense";
  }
  if (nodeCount >= 36) {
    return "balanced";
  }
  return "spacious";
}

function nodeColor(node: RelationshipGraphSigmaNodeData): string {
  if (node.importance === "main") {
    return "#1e88e5";
  }
  if (node.importance === "supporting") {
    return "#22c55e";
  }
  return "#94a3b8";
}

function edgeColor(edge: RelationshipGraphSigmaEdgeData): string {
  if (edge.polarity === "positive") {
    return "#1e88e5";
  }
  if (edge.polarity === "negative") {
    return "#dc2626";
  }
  if (edge.polarity === "mixed") {
    return "#d97706";
  }
  return "#94a3b8";
}

function nodeSize(relationCount: number, maxRelations: number, config: GraphDensityConfig): number {
  const ratio = maxRelations > 0 ? Math.sqrt(Math.max(0, relationCount) / maxRelations) : 0;
  return config.baseNodeSize + ratio * (config.maxNodeSize - config.baseNodeSize);
}

function edgeSize(edge: RelationshipGraphSigmaEdgeData, config: GraphDensityConfig): number {
  return config.edgeSizeBase + Math.min(1, Math.max(0, edge.intensity)) * config.edgeSizeRange;
}

function ellipsizeCanvasText(context: CanvasRenderingContext2D, label: string, maxWidth: number): string {
  if (context.measureText(label).width <= maxWidth) {
    return label;
  }
  const ellipsis = "...";
  let nextLabel = label;
  while (nextLabel.length > 1 && context.measureText(`${nextLabel}${ellipsis}`).width > maxWidth) {
    nextLabel = nextLabel.slice(0, -1);
  }
  return nextLabel.length <= 1 ? "" : `${nextLabel}${ellipsis}`;
}

function estimateNodeLabelWidth(label: string, fontSize: number): number {
  let width = 0;
  for (const character of Array.from(label)) {
    width += character.codePointAt(0)! > 0x7f ? fontSize : fontSize * 0.62;
  }
  return Math.min(220, width + 10);
}

const drawRelationshipNodeLabel: NodeLabelDrawingFunction<SigmaNodeAttributes, SigmaEdgeAttributes> = (
  context,
  data,
  settings
) => {
  const label = typeof data.label === "string" ? data.label : "";
  if (!label) {
    return;
  }

  const fontSize = settings.labelSize;
  const labelColor: string = settings.labelColor.attribute
    ? (data[settings.labelColor.attribute] as string | undefined) || settings.labelColor.color || "#172033"
    : settings.labelColor.color || "#172033";
  const x = data.x + data.size + 4;
  const y = data.y + fontSize / 3;

  context.save();
  context.font = `${settings.labelWeight} ${fontSize}px ${settings.labelFont}`;
  context.lineJoin = "round";
  context.strokeStyle = "rgba(255, 255, 255, 0.88)";
  context.lineWidth = 3.5;
  context.strokeText(label, x, y);
  context.fillStyle = labelColor;
  context.fillText(label, x, y);
  context.restore();
};

const drawRelationshipNodeHover: NodeHoverDrawingFunction<SigmaNodeAttributes, SigmaEdgeAttributes> = (
  context,
  data
) => {
  const isPrimary = Boolean(
    (data as Partial<SigmaNodeAttributes>).hovering ||
    (data as Partial<SigmaNodeAttributes>).dragging
  );
  const radius = data.size + (isPrimary ? 5.5 : 3.5);

  context.save();
  context.beginPath();
  context.arc(data.x, data.y, radius, 0, Math.PI * 2);
  context.fillStyle = isPrimary ? "rgba(37, 99, 235, 0.08)" : "rgba(37, 99, 235, 0.035)";
  context.fill();

  context.beginPath();
  context.arc(data.x, data.y, radius, 0, Math.PI * 2);
  context.shadowBlur = isPrimary ? 10 : 0;
  context.shadowColor = "rgba(37, 99, 235, 0.22)";
  context.strokeStyle = isPrimary ? "rgba(37, 99, 235, 0.72)" : "rgba(37, 99, 235, 0.28)";
  context.lineWidth = isPrimary ? 2.2 : 1.15;
  context.stroke();

  if (isPrimary) {
    context.beginPath();
    context.arc(data.x, data.y, data.size + 1.8, 0, Math.PI * 2);
    context.shadowBlur = 0;
    context.strokeStyle = "rgba(255, 255, 255, 0.92)";
    context.lineWidth = 2;
    context.stroke();
  }
  context.restore();
};

const drawRelationshipEdgeLabel: EdgeLabelDrawingFunction<SigmaNodeAttributes, SigmaEdgeAttributes> = (
  context,
  edgeData,
  sourceData,
  targetData,
  settings
) => {
  const label = edgeData.label;
  if (!label) {
    return;
  }

  const dx = targetData.x - sourceData.x;
  const dy = targetData.y - sourceData.y;
  const length = Math.hypot(dx, dy);
  if (length <= sourceData.size + targetData.size + 8) {
    return;
  }

  const fontSize = settings.edgeLabelSize;
  const edgeKey = String((edgeData as { readonly key?: string }).key ?? label);
  context.save();
  context.font = `${settings.edgeLabelWeight} ${fontSize}px ${settings.edgeLabelFont}`;
  const availableWidth = Math.min(
    EDGE_LABEL_MAX_WIDTH,
    Math.max(20, length - sourceData.size - targetData.size - fontSize * 2)
  );
  const visibleLabel = ellipsizeCanvasText(context, label, availableWidth);
  if (!visibleLabel) {
    context.restore();
    return;
  }

  const textWidth = context.measureText(visibleLabel).width;
  const textHeight = fontSize + 6;
  const edgeLabelFont = context.font;
  const sourceNodeLabel = typeof sourceData.label === "string" ? sourceData.label : "";
  const targetNodeLabel = typeof targetData.label === "string" ? targetData.label : "";
  context.font = `${settings.labelWeight} ${settings.labelSize}px ${settings.labelFont}`;
  const sourceNodeLabelWidth = sourceNodeLabel ? context.measureText(sourceNodeLabel).width : undefined;
  const targetNodeLabelWidth = targetNodeLabel ? context.measureText(targetNodeLabel).width : undefined;
  context.font = edgeLabelFont;
  const canvasBounds = context.canvas.getBoundingClientRect();
  const placement = resolveRelationshipEdgeLabelPlacement({
    edgeKey,
    label,
    source: {
      x: sourceData.x,
      y: sourceData.y,
      size: sourceData.size,
      relationshipWeight: (sourceData as Partial<SigmaNodeAttributes>).relationCount ?? 0,
      labelWidth: sourceNodeLabelWidth,
      labelHeight: sourceNodeLabelWidth ? settings.labelSize + 6 : undefined
    },
    target: {
      x: targetData.x,
      y: targetData.y,
      size: targetData.size,
      relationshipWeight: (targetData as Partial<SigmaNodeAttributes>).relationCount ?? 0,
      labelWidth: targetNodeLabelWidth,
      labelHeight: targetNodeLabelWidth ? settings.labelSize + 6 : undefined
    },
    edgeSize: edgeData.size,
    fontSize,
    textWidth,
    textHeight,
    viewport: {
      width: canvasBounds.width || context.canvas.width,
      height: canvasBounds.height || context.canvas.height
    },
    occupiedBoxes: getRelationshipEdgeLabelBoxes(context.canvas)
  });
  if (placement.box) {
    reserveRelationshipEdgeLabelBox(context.canvas, placement.box);
  }
  const labelColor: string = settings.edgeLabelColor.attribute
    ? (edgeData[settings.edgeLabelColor.attribute] as string | undefined) || settings.edgeLabelColor.color || "#334155"
    : settings.edgeLabelColor.color || "#334155";

  context.translate(placement.x, placement.y);
  context.rotate(placement.angle);
  context.lineJoin = "round";
  context.strokeStyle = "rgba(255, 253, 243, 0.92)";
  context.lineWidth = 4;
  context.fillStyle = labelColor;
  context.strokeText(visibleLabel, -textWidth / 2, fontSize / 3);
  context.fillText(visibleLabel, -textWidth / 2, fontSize / 3);
  context.restore();
};

function fallbackPosition(index: number, total: number): RelationshipGraphPosition {
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, total);
  const radius = 220 + Math.sqrt(total) * 16;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius
  };
}

function buildLayoutDataKey(
  nodes: readonly RelationshipGraphNode[],
  edges: readonly RelationshipGraphEdge[],
  focusNodeId: string | null | undefined
): string {
  const nodeKey = nodes
    .map((node) => `${node.id}:${node.relationCount}:${Math.round(node.score * 100)}`)
    .sort()
    .join("|");
  const edgeKey = edges
    .map((edge) => `${edge.id}:${edge.sourceId}:${edge.targetId}:${Math.round(edge.weight * 100)}`)
    .sort()
    .join("|");
  return `${focusNodeId ?? "global"}::${nodeKey}::${edgeKey}`;
}

function buildSeedPositions(
  nodes: readonly RelationshipGraphNode[],
  edges: readonly RelationshipGraphEdge[],
  focusNodeId: string | null | undefined
): Map<string, RelationshipGraphPosition> {
  if (focusNodeId && nodes.some((node) => node.id === focusNodeId)) {
    return buildRelationshipFocusLayoutPositions({
      nodes,
      edges,
      focusNodeId,
      width: 980,
      height: 680
    });
  }
  return buildRelationshipHubSeedLayoutPositions({
    nodes,
    edges,
    width: 1100,
    height: 760
  });
}

function buildForceAtlas2Settings(
  graph: SigmaGraph,
  config: GraphDensityConfig,
  displaySettings: RelationshipGraphDisplaySettings
) {
  const inferred = forceAtlas2.inferSettings(graph);
  return {
    ...inferred,
    barnesHutOptimize: graph.order >= 70,
    barnesHutTheta: 0.6,
    adjustSizes: true,
    edgeWeightInfluence: config.edgeWeightInfluence,
    gravity: config.gravity,
    linLogMode: graph.order >= 36,
    outboundAttractionDistribution: true,
    scalingRatio: config.scalingRatio * displaySettings.nodeRepulsionScale,
    slowDown: config.slowDown
  };
}

function applyNoverlapLayout(
  graph: SigmaGraph,
  config: GraphDensityConfig,
  displaySettings: RelationshipGraphDisplaySettings
): void {
  if (graph.order < 2) {
    return;
  }

  noverlap.assign(graph, {
    maxIterations: graph.order >= 80 ? 180 : 120,
    inputReducer: (node, attributes) => {
      const graphLabel = graph.getNodeAttribute(node, "label") ?? graph.getNodeAttribute(node, "name");
      const label = typeof graphLabel === "string" ? graphLabel : "";
      const labelAllowance = Math.min(42, Math.max(12, label.length * 2.6));
      return {
        x: attributes.x,
        y: attributes.y,
        size: (attributes.size ?? graph.getNodeAttribute(node, "size") ?? BASE_NODE_SIZE) + labelAllowance
      };
    },
    outputReducer: (_node, attributes) => ({
      x: attributes.x,
      y: attributes.y
    }),
    settings: {
      expansion: 1.08,
      gridSize: 20,
      margin: graph.order >= 80 ? 10 : 14,
      ratio: Math.max(1, displaySettings.nodeRepulsionScale) * (config === graphDensityConfig.dense ? 1.28 : 1.16),
      speed: 3
    }
  });
}

function cacheGraphPositions(graph: SigmaGraph, positionCache: Map<string, RelationshipGraphPosition>): void {
  graph.forEachNode((node, attributes) => {
    positionCache.set(node, { x: attributes.x, y: attributes.y });
  });
}

function buildGraph(
  input: {
    readonly nodes: readonly RelationshipGraphNode[];
    readonly edges: readonly RelationshipGraphEdge[];
    readonly displaySettings: RelationshipGraphDisplaySettings;
    readonly focusNodeId?: string | null;
  },
  positionCache: Map<string, RelationshipGraphPosition>
): SigmaGraphBuildResult {
  const { displaySettings } = input;
  const config = graphDensityConfig[resolveGraphDensity(input.nodes.length)];
  const seedPositions = buildSeedPositions(input.nodes, input.edges, input.focusNodeId);
  const useStaticHubSectorLayout =
    !input.focusNodeId &&
    seedPositions.size === input.nodes.length &&
    shouldUseRelationshipHubSectorLayout(input.nodes, input.edges);
  const data = relationshipGraphToSigmaGraphData(
    { nodes: input.nodes, edges: input.edges },
    { labelDensity: displaySettings.labelDensity, positions: seedPositions }
  );
  const graph: SigmaGraph = new RelationshipSigmaGraphConstructor();
  const maxRelations = Math.max(1, ...data.nodes.map((node) => node.data.relationCount));
  const initialPositions = new Map<string, RelationshipGraphPosition>();
  const animationTargets: LayoutAnimationTargets = {};

  data.nodes.forEach((nodeElement, index) => {
    const node = nodeElement.data;
    const cached = positionCache.get(nodeElement.id);
    const seeded = node.position;
    const position = cached ?? seeded ?? fallbackPosition(index, data.nodes.length);
    initialPositions.set(nodeElement.id, position);
    graph.addNode(nodeElement.id, {
      ...node,
      data: node,
      x: position.x,
      y: position.y,
      size: nodeSize(node.relationCount, maxRelations, config),
      color: nodeColor(node),
      forceLabel: node.importance === "main" || input.nodes.length <= 36,
      highlighted: false,
      dimmed: false,
      hovering: false,
      dragging: false,
      fixed: false,
      zIndex: 4
    });
  });

  data.edges.forEach((edge) => {
    graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
      ...edge.data,
      data: edge.data,
      label: edge.data.baseLabelText,
      size: edgeSize(edge.data, config),
      color: edgeColor(edge.data),
      forceLabel: edge.data.baseLabelPinned,
      hidden: false,
      highlighted: false,
      dimmed: false,
      layoutWeight: Math.max(0.05, edge.data.weight / displaySettings.linkDistanceScale),
      zIndex: 2
    });
  });

  if (!input.focusNodeId && graph.order > 1 && !useStaticHubSectorLayout) {
    forceAtlas2.assign(graph, {
      iterations: config.iterations,
      getEdgeWeight: "layoutWeight",
      settings: buildForceAtlas2Settings(graph, config, displaySettings)
    });
    applyNoverlapLayout(graph, config, displaySettings);
    graph.forEachNode((node, attributes) => {
      const initial = initialPositions.get(node);
      if (!initial) {
        return;
      }
      animationTargets[node] = { x: attributes.x, y: attributes.y };
      positionCache.set(node, { x: attributes.x, y: attributes.y });
      graph.setNodeAttribute(node, "x", initial.x);
      graph.setNodeAttribute(node, "y", initial.y);
    });
  } else {
    cacheGraphPositions(graph, positionCache);
  }

  return { graph, animationTargets };
}

function clearHoverState(graph: SigmaGraph): void {
  graph.forEachNode((node) => {
    graph.setNodeAttribute(node, "dimmed", false);
    graph.setNodeAttribute(node, "highlighted", false);
    graph.setNodeAttribute(node, "hovering", false);
  });
  graph.forEachEdge((edge) => {
    graph.setEdgeAttribute(edge, "dimmed", false);
    graph.setEdgeAttribute(edge, "highlighted", false);
  });
}

function applyHoverState(graph: SigmaGraph, node: string): void {
  const neighbors = new Set(graph.neighbors(node));
  neighbors.add(node);
  graph.forEachNode((n) => {
    graph.setNodeAttribute(n, "hovering", n === node);
    graph.setNodeAttribute(n, "highlighted", neighbors.has(n));
    if (neighbors.has(n)) {
      graph.setNodeAttribute(n, "dimmed", false);
    } else {
      graph.setNodeAttribute(n, "dimmed", true);
    }
  });
  graph.forEachEdge((e, _attributes, source, target) => {
    const highlighted = source === node || target === node;
    if (highlighted) {
      graph.setEdgeAttribute(e, "highlighted", true);
      graph.setEdgeAttribute(e, "dimmed", false);
    } else {
      graph.setEdgeAttribute(e, "highlighted", false);
      graph.setEdgeAttribute(e, "dimmed", true);
    }
  });
}

function SigmaGraphController({
  nodes,
  edges,
  displaySettings,
  selectedId,
  focusNodeId,
  onSelectNode,
  onSelectEdge
}: SigmaRelationshipGraphProps) {
  const sigma = useSigma<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const loadGraph = useLoadGraph<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const registerEvents = useRegisterEvents<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const setSettings = useSetSettings<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const positionCache = useRef<Map<string, RelationshipGraphPosition>>(new Map());
  const lastLayoutDataKey = useRef<string | null>(null);
  const onSelectNodeRef = useRef(onSelectNode);
  const onSelectEdgeRef = useRef(onSelectEdge);
  const cancelAnimationRef = useRef<(() => void) | null>(null);
  const draggedNodeRef = useRef<string | null>(null);
  const dragStartRef = useRef<RelationshipGraphPosition | null>(null);
  const layoutSupervisorRef = useRef<FA2LayoutSupervisor<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const settlingFixedNodeRef = useRef<string | null>(null);
  const suppressClickAfterDragRef = useRef(false);

  useEffect(() => {
    const resetEdgeLabelBoxes = () => {
      const canvases = Object.values(sigma.getCanvases());
      canvases.forEach((canvas) => resetRelationshipEdgeLabelRegistry(canvas));

      const activeGraph = sigma.getGraph() as SigmaGraph;
      activeGraph.forEachNode((node, attributes) => {
        const displayData = sigma.getNodeDisplayData(node);
        const label = typeof attributes.label === "string" ? attributes.label : "";
        if (!displayData || !label) {
          return;
        }

        const height = NODE_LABEL_BOX_FONT_SIZE + 6;
        const box = {
          x: displayData.x + displayData.size + 6,
          y: displayData.y - height / 2,
          width: estimateNodeLabelWidth(label, NODE_LABEL_BOX_FONT_SIZE),
          height
        };
        canvases.forEach((canvas) => reserveRelationshipEdgeLabelBox(canvas, box));
      });
    };
    sigma.on("beforeRender", resetEdgeLabelBoxes);
    return () => {
      sigma.off("beforeRender", resetEdgeLabelBoxes);
    };
  }, [sigma]);

  useEffect(() => {
    onSelectNodeRef.current = onSelectNode;
  }, [onSelectNode]);

  useEffect(() => {
    onSelectEdgeRef.current = onSelectEdge;
  }, [onSelectEdge]);

  const layoutDataKey = useMemo(() => buildLayoutDataKey(nodes, edges, focusNodeId), [edges, focusNodeId, nodes]);
  const graphBuild = useMemo(() => {
    if (lastLayoutDataKey.current !== layoutDataKey) {
      positionCache.current.clear();
      lastLayoutDataKey.current = layoutDataKey;
    }
    return buildGraph({ nodes, edges, displaySettings, focusNodeId }, positionCache.current);
  }, [displaySettings, edges, focusNodeId, layoutDataKey, nodes]);
  const graph = graphBuild.graph;

  const stopSettlingLayout = useCallback((options: StopSettlingLayoutOptions = {}) => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    if (layoutSupervisorRef.current) {
      layoutSupervisorRef.current.stop();
      layoutSupervisorRef.current.kill();
      layoutSupervisorRef.current = null;
    }
    const fixedNode = settlingFixedNodeRef.current;
    const activeGraph = sigma.getGraph() as SigmaGraph;
    if (fixedNode && activeGraph.hasNode(fixedNode)) {
      activeGraph.setNodeAttribute(fixedNode, "fixed", false);
      activeGraph.setNodeAttribute(fixedNode, "dragging", false);
    }
    settlingFixedNodeRef.current = null;
    if (options.resolveOverlap && !focusNodeId && activeGraph.order > 1) {
      applyNoverlapLayout(activeGraph, graphDensityConfig[resolveGraphDensity(activeGraph.order)], displaySettings);
    }
    cacheGraphPositions(activeGraph, positionCache.current);
  }, [displaySettings, focusNodeId, sigma]);

  const startSettlingLayout = useCallback(
    (activeGraph: SigmaGraph, fixedNode: string | null = null, duration = 900) => {
      stopSettlingLayout();
      if (focusNodeId || activeGraph.order < 3 || shouldUseRelationshipHubSectorLayout(nodes, edges)) {
        return;
      }
      if (fixedNode && activeGraph.hasNode(fixedNode)) {
        activeGraph.setNodeAttribute(fixedNode, "fixed", true);
        settlingFixedNodeRef.current = fixedNode;
      }
      const config = graphDensityConfig[resolveGraphDensity(activeGraph.order)];
      const supervisor = new FA2LayoutSupervisor<SigmaNodeAttributes, SigmaEdgeAttributes>(activeGraph, {
        getEdgeWeight: "layoutWeight",
        settings: buildForceAtlas2Settings(activeGraph, config, displaySettings)
      });
      layoutSupervisorRef.current = supervisor;
      supervisor.start();
      settleTimerRef.current = window.setTimeout(() => {
        stopSettlingLayout({ resolveOverlap: true });
        sigma.refresh();
      }, duration);
    },
    [displaySettings, edges, focusNodeId, nodes, sigma, stopSettlingLayout]
  );

  useEffect(() => {
    cancelAnimationRef.current?.();
    cancelAnimationRef.current = null;
    stopSettlingLayout();
    loadGraph(graph);
    const activeGraph = sigma.getGraph() as SigmaGraph;
    sigma.getCamera().animatedReset({ duration: 420 });
    if (Object.keys(graphBuild.animationTargets).length > 0) {
      cancelAnimationRef.current = animateNodes(
        activeGraph,
        graphBuild.animationTargets,
        { duration: 650, easing: "quadraticInOut" },
        () => {
          cancelAnimationRef.current = null;
          cacheGraphPositions(activeGraph, positionCache.current);
          startSettlingLayout(activeGraph, null, 650);
        }
      );
    } else {
      cacheGraphPositions(activeGraph, positionCache.current);
    }
    return () => {
      cancelAnimationRef.current?.();
      cancelAnimationRef.current = null;
    };
  }, [graph, graphBuild.animationTargets, loadGraph, sigma, startSettlingLayout, stopSettlingLayout]);

  useEffect(() => {
    return () => {
      cancelAnimationRef.current?.();
      cancelAnimationRef.current = null;
      stopSettlingLayout();
    };
  }, [stopSettlingLayout]);

  useEffect(() => {
    setSettings({
      edgeReducer: (edge, attrs) => {
        const selected = selectedId === edge;
        const label = selected ? attrs.plotLabelText : attrs.baseLabelText;
        const nextAttrs = { ...attrs };
        nextAttrs.color = attrs.dimmed ? "rgba(148, 163, 184, 0.14)" : attrs.highlighted || selected ? attrs.color : `${attrs.color}cc`;
        nextAttrs.forceLabel = Boolean(label && !attrs.dimmed && (selected || attrs.highlighted || attrs.forceLabel));
        nextAttrs.hidden = false;
        nextAttrs.label = attrs.dimmed ? "" : label;
        nextAttrs.size = selected || attrs.highlighted ? attrs.size + 0.7 : attrs.dimmed ? Math.max(0.25, attrs.size * 0.55) : attrs.size;
        nextAttrs.zIndex = selected || attrs.highlighted ? 10 : attrs.dimmed ? 0 : 2;
        return nextAttrs;
      },
      labelRenderedSizeThreshold: graphDensityConfig[resolveGraphDensity(nodes.length)].labelThreshold,
      nodeReducer: (node, attrs) => {
        const selected = selectedId === node;
        const nextAttrs = { ...attrs };
        nextAttrs.color = attrs.dimmed ? "#e2e8f0" : attrs.dragging || attrs.hovering || selected ? "#2563eb" : attrs.color;
        nextAttrs.forceLabel = attrs.dimmed ? false : Boolean(attrs.dragging || selected || attrs.hovering || attrs.highlighted || attrs.forceLabel);
        nextAttrs.highlighted = attrs.dragging || attrs.highlighted || selected;
        nextAttrs.label = attrs.dimmed ? "" : attrs.label;
        nextAttrs.size = attrs.dragging ? attrs.size + 3 : selected || attrs.hovering ? attrs.size + 2 : attrs.dimmed ? Math.max(BASE_NODE_SIZE, attrs.size * 0.72) : attrs.size;
        nextAttrs.zIndex = attrs.dragging ? 30 : selected || attrs.hovering ? 20 : attrs.highlighted ? 12 : attrs.dimmed ? 0 : 4;
        return nextAttrs;
      },
      renderEdgeLabels: true
    });
    sigma.refresh();
  }, [selectedId, setSettings, sigma, nodes.length]);

  useEffect(() => {
    const finishDragging = () => {
      const draggedNode = draggedNodeRef.current;
      if (!draggedNode) {
        return;
      }
      const activeGraph = sigma.getGraph() as SigmaGraph;
      draggedNodeRef.current = null;
      dragStartRef.current = null;
      sigma.getCamera().enable();
      sigma.getContainer().style.cursor = "";
      if (activeGraph.hasNode(draggedNode)) {
        activeGraph.setNodeAttribute(draggedNode, "dragging", false);
        activeGraph.setNodeAttribute(draggedNode, "fixed", false);
        positionCache.current.set(draggedNode, {
          x: activeGraph.getNodeAttribute(draggedNode, "x"),
          y: activeGraph.getNodeAttribute(draggedNode, "y")
        });
      }
      sigma.refresh();
      startSettlingLayout(activeGraph, draggedNode, 900);
    };

    registerEvents({
      clickEdge: ({ edge }) => onSelectEdgeRef.current(edge),
      clickNode: ({ node: nodeId }) => {
        if (suppressClickAfterDragRef.current) {
          suppressClickAfterDragRef.current = false;
          return;
        }
        onSelectNodeRef.current(nodeId);
      },
      downNode: ({ node, event }) => {
        event.preventSigmaDefault();
        event.original.preventDefault();
        cancelAnimationRef.current?.();
        cancelAnimationRef.current = null;
        stopSettlingLayout();
        draggedNodeRef.current = node;
        dragStartRef.current = { x: event.x, y: event.y };
        suppressClickAfterDragRef.current = false;
        const activeGraph = sigma.getGraph() as SigmaGraph;
        if (activeGraph.hasNode(node)) {
          activeGraph.setNodeAttribute(node, "dragging", true);
          activeGraph.setNodeAttribute(node, "fixed", true);
        }
        sigma.getCamera().disable();
        sigma.getContainer().style.cursor = "grabbing";
        sigma.refresh();
      },
      enterNode: ({ node }) => {
        const activeGraph = sigma.getGraph() as SigmaGraph;
        clearHoverState(activeGraph);
        activeGraph.setNodeAttribute(node, "hovering", true);
        applyHoverState(activeGraph, node);
        sigma.refresh();
      },
      leaveNode: () => {
        if (draggedNodeRef.current) {
          return;
        }
        clearHoverState(sigma.getGraph() as SigmaGraph);
        sigma.refresh();
      },
      mousemovebody: (event) => {
        const draggedNode = draggedNodeRef.current;
        if (!draggedNode) {
          return;
        }
        event.preventSigmaDefault();
        event.original.preventDefault();
        const start = dragStartRef.current;
        if (start && Math.hypot(event.x - start.x, event.y - start.y) > 3) {
          suppressClickAfterDragRef.current = true;
        }
        const activeGraph = sigma.getGraph() as SigmaGraph;
        if (!activeGraph.hasNode(draggedNode)) {
          return;
        }
        const nextPosition = sigma.viewportToGraph({ x: event.x, y: event.y });
        if (!Number.isFinite(nextPosition.x) || !Number.isFinite(nextPosition.y)) {
          return;
        }
        activeGraph.setNodeAttribute(draggedNode, "x", nextPosition.x);
        activeGraph.setNodeAttribute(draggedNode, "y", nextPosition.y);
        positionCache.current.set(draggedNode, nextPosition);
        sigma.refresh();
      },
      mouseup: finishDragging,
      touchup: finishDragging
    });
  }, [graph, registerEvents, sigma, startSettlingLayout, stopSettlingLayout]);

  useEffect(() => {
    return () => {
      if (draggedNodeRef.current) {
        sigma.getCamera().enable();
        sigma.getContainer().style.cursor = "";
      }
    };
  }, [sigma]);

  return null;
}

export function SigmaRelationshipGraph(props: SigmaRelationshipGraphProps) {
  const settings = useMemo(
    () => ({
      allowInvalidContainer: true,
      autoCenter: true,
      autoRescale: true,
      defaultEdgeColor: "#94a3b8",
      defaultDrawEdgeLabel: drawRelationshipEdgeLabel,
      defaultDrawNodeHover: drawRelationshipNodeHover,
      defaultDrawNodeLabel: drawRelationshipNodeLabel,
      defaultNodeColor: "#1e88e5",
      edgeLabelColor: { color: "#334155" },
      edgeLabelFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      edgeLabelSize: 10,
      edgeLabelWeight: "650",
      enableEdgeEvents: true,
      hideEdgesOnMove: false,
      hideLabelsOnMove: false,
      labelColor: { color: "#172033" },
      labelDensity: 0.12,
      labelFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      labelGridCellSize: 130,
      labelRenderedSizeThreshold: 8,
      labelSize: 12,
      labelWeight: "720",
      maxCameraRatio: 8,
      minCameraRatio: 0.08,
      minEdgeThickness: 0.15,
      renderEdgeLabels: true,
      renderLabels: true,
      zIndex: true
    }),
    []
  );

  return (
    <SigmaContainer className="relationship-sigma" graph={RelationshipSigmaGraphConstructor} settings={settings}>
      <SigmaGraphController {...props} />
    </SigmaContainer>
  );
}
