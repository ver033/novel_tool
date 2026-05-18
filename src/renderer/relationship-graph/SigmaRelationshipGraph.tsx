import "@react-sigma/core/lib/style.css";
import { SigmaContainer, useLoadGraph, useRegisterEvents, useSetSettings, useSigma } from "@react-sigma/core";
import Graph from "graphology";
import type { GraphOptions } from "graphology-types";
import forceAtlas2 from "graphology-layout-forceatlas2";
import FA2LayoutSupervisor from "graphology-layout-forceatlas2/worker";
import noverlap from "graphology-layout-noverlap";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  EdgeArrowProgram,
  EdgeDoubleArrowProgram,
  EdgeLineProgram,
  type EdgeLabelDrawingFunction,
  type NodeHoverDrawingFunction,
  type NodeLabelDrawingFunction
} from "sigma/rendering";
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
import { resolveNodeLabelAnchor, type RelationshipNodeLabelAnchor } from "./relationship-node-label-layout";
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
  readonly layoutMode?: RelationshipGraphLayoutMode;
  readonly selectedId: string | null;
  readonly focusNodeId?: string | null;
  readonly onSelectNode: (id: string) => void;
  readonly onSelectEdge: (id: string) => void;
  readonly onNodePositionChange?: (nodeId: string, position: RelationshipGraphPosition) => void;
};

type RelationshipGraphLayoutMode = "auto" | "manual";
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
  labelAnchorX: RelationshipNodeLabelAnchor["x"];
  labelAnchorY: RelationshipNodeLabelAnchor["y"];
  labelTextAlign: CanvasTextAlign;
  zIndex: number;
};

type SigmaEdgeAttributes = RelationshipGraphSigmaEdgeData & {
  readonly data: RelationshipGraphSigmaEdgeData;
  type: RelationshipGraphSigmaEdgeData["edgeType"];
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
type SigmaGraphBBox = {
  x: [number, number];
  y: [number, number];
};

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

function labelAnchorFromNodeData(data: Partial<SigmaNodeAttributes>): RelationshipNodeLabelAnchor {
  const anchorX = data.labelAnchorX === -1 || data.labelAnchorX === 0 || data.labelAnchorX === 1 ? data.labelAnchorX : 1;
  const anchorY = data.labelAnchorY === -1 || data.labelAnchorY === 0 || data.labelAnchorY === 1 ? data.labelAnchorY : 0;
  return {
    x: anchorX,
    y: anchorY,
    textAlign: data.labelTextAlign ?? (anchorX < 0 ? "right" : anchorX > 0 ? "left" : "center")
  };
}

function nodeLabelPoint(input: {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly anchor: RelationshipNodeLabelAnchor;
}): { readonly x: number; readonly y: number } {
  const padding = input.size + 7;
  return {
    x: input.x + input.anchor.x * padding,
    y: input.y + input.anchor.y * padding
  };
}

function nodeLabelBox(input: {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly label: string;
  readonly fontSize: number;
  readonly anchor: RelationshipNodeLabelAnchor;
}): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const width = estimateNodeLabelWidth(input.label, input.fontSize);
  const height = input.fontSize + 6;
  const point = nodeLabelPoint(input);
  const x =
    input.anchor.textAlign === "right"
      ? point.x - width
      : input.anchor.textAlign === "center"
        ? point.x - width / 2
        : point.x;
  return {
    x,
    y: point.y - height / 2,
    width,
    height
  };
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
  const anchor = labelAnchorFromNodeData(data as Partial<SigmaNodeAttributes>);
  const point = nodeLabelPoint({
    x: data.x,
    y: data.y,
    size: data.size,
    anchor
  });

  context.save();
  context.font = `${settings.labelWeight} ${fontSize}px ${settings.labelFont}`;
  context.textAlign = anchor.textAlign;
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.strokeStyle = "rgba(255, 255, 255, 0.88)";
  context.lineWidth = 3.5;
  context.strokeText(label, point.x, point.y);
  context.fillStyle = labelColor;
  context.fillText(label, point.x, point.y);
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
  const relationshipEdgeData = edgeData as Partial<SigmaEdgeAttributes>;
  context.save();
  context.font = `${settings.edgeLabelWeight} ${fontSize}px ${settings.edgeLabelFont}`;
  const labelColor: string = settings.edgeLabelColor.attribute
    ? (edgeData[settings.edgeLabelColor.attribute] as string | undefined) || settings.edgeLabelColor.color || "#334155"
    : settings.edgeLabelColor.color || "#334155";
  if (
    relationshipEdgeData.baseLabelDirection === "different_both_ways" &&
    relationshipEdgeData.baseLabelSourceToTargetText &&
    relationshipEdgeData.baseLabelTargetToSourceText &&
    label === relationshipEdgeData.baseLabelText
  ) {
    drawBidirectionalRelationshipEdgeLabels(
      context,
      sourceData,
      targetData,
      {
        sourceToTargetLabel: relationshipEdgeData.baseLabelSourceToTargetText,
        targetToSourceLabel: relationshipEdgeData.baseLabelTargetToSourceText,
        edgeSize: edgeData.size,
        fontSize,
        labelColor
      }
    );
    context.restore();
    return;
  }
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

function drawBidirectionalRelationshipEdgeLabels(
  context: CanvasRenderingContext2D,
  sourceData: { readonly x: number; readonly y: number; readonly size: number },
  targetData: { readonly x: number; readonly y: number; readonly size: number },
  options: {
    readonly sourceToTargetLabel: string;
    readonly targetToSourceLabel: string;
    readonly edgeSize: number;
    readonly fontSize: number;
    readonly labelColor: string;
  }
): void {
  const dx = targetData.x - sourceData.x;
  const dy = targetData.y - sourceData.y;
  const length = Math.hypot(dx, dy);
  const usableLength = length - sourceData.size - targetData.size - options.fontSize * 2;
  if (usableLength <= 48) {
    return;
  }

  const maxLabelWidth = Math.min(EDGE_LABEL_MAX_WIDTH * 0.58, Math.max(24, usableLength * 0.38));
  const sourceToTargetLabel = ellipsizeCanvasText(context, options.sourceToTargetLabel, maxLabelWidth);
  const targetToSourceLabel = ellipsizeCanvasText(context, options.targetToSourceLabel, maxLabelWidth);
  if (!sourceToTargetLabel && !targetToSourceLabel) {
    return;
  }

  const unitX = dx / length;
  const unitY = dy / length;
  const normalX = -unitY;
  const normalY = unitX;
  const offset = Math.max(8, options.edgeSize + options.fontSize * 0.55);
  const angle = Math.atan2(dy, dx);
  const readableAngle = angle > Math.PI / 2 || angle < -Math.PI / 2 ? angle + Math.PI : angle;

  drawEdgeLabelAtPoint(context, {
    text: sourceToTargetLabel,
    x: sourceData.x + unitX * length * 0.38 + normalX * offset,
    y: sourceData.y + unitY * length * 0.38 + normalY * offset,
    angle: readableAngle,
    fontSize: options.fontSize,
    labelColor: options.labelColor
  });
  drawEdgeLabelAtPoint(context, {
    text: targetToSourceLabel,
    x: sourceData.x + unitX * length * 0.62 - normalX * offset,
    y: sourceData.y + unitY * length * 0.62 - normalY * offset,
    angle: readableAngle,
    fontSize: options.fontSize,
    labelColor: options.labelColor
  });
}

function drawEdgeLabelAtPoint(
  context: CanvasRenderingContext2D,
  input: {
    readonly text: string;
    readonly x: number;
    readonly y: number;
    readonly angle: number;
    readonly fontSize: number;
    readonly labelColor: string;
  }
): void {
  if (!input.text) {
    return;
  }
  const textWidth = context.measureText(input.text).width;
  const textHeight = input.fontSize + 6;
  const box = {
    x: input.x - textWidth / 2,
    y: input.y - textHeight / 2,
    width: textWidth,
    height: textHeight
  };
  reserveRelationshipEdgeLabelBox(context.canvas, box);

  context.save();
  context.translate(input.x, input.y);
  context.rotate(input.angle);
  context.lineJoin = "round";
  context.strokeStyle = "rgba(255, 253, 243, 0.95)";
  context.lineWidth = 4;
  context.fillStyle = input.labelColor;
  context.strokeText(input.text, -textWidth / 2, input.fontSize / 3);
  context.fillText(input.text, -textWidth / 2, input.fontSize / 3);
  context.restore();
}

function fallbackPosition(index: number, total: number): RelationshipGraphPosition {
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, total);
  const radius = 220 + Math.sqrt(total) * 16;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius
  };
}

function roundPosition(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function layoutPositionFromNode(node: RelationshipGraphNode): RelationshipGraphPosition | null {
  const position = node.layoutPosition;
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return null;
  }
  return {
    x: roundPosition(position.x),
    y: roundPosition(position.y)
  };
}

function buildManualSeedPositions(nodes: readonly RelationshipGraphNode[]): Map<string, RelationshipGraphPosition> {
  const positions = new Map<string, RelationshipGraphPosition>();
  if (nodes.length === 0) {
    return positions;
  }
  nodes.forEach((node) => {
    const position = layoutPositionFromNode(node);
    if (position) {
      positions.set(node.id, position);
    }
  });
  if (nodes.length === 1) {
    if (positions.has(nodes[0].id)) {
      return positions;
    }
    positions.set(nodes[0].id, { x: 0, y: 0 });
    return positions;
  }
  if (nodes.length === 2) {
    if (!positions.has(nodes[0].id)) {
      positions.set(nodes[0].id, { x: -220, y: 0 });
    }
    if (!positions.has(nodes[1].id)) {
      positions.set(nodes[1].id, { x: 220, y: 0 });
    }
    return positions;
  }

  const radius = 190 + Math.min(8, nodes.length) * 14;
  nodes.forEach((node, index) => {
    if (positions.has(node.id)) {
      return;
    }
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / nodes.length;
    positions.set(node.id, {
      x: roundPosition(Math.cos(angle) * radius),
      y: roundPosition(Math.sin(angle) * radius)
    });
  });
  return positions;
}

function prunePositionCache(
  positionCache: Map<string, RelationshipGraphPosition>,
  nodes: readonly RelationshipGraphNode[]
): void {
  const currentNodeIds = new Set(nodes.map((node) => node.id));
  for (const nodeId of positionCache.keys()) {
    if (!currentNodeIds.has(nodeId)) {
      positionCache.delete(nodeId);
    }
  }
}

function buildManualGraphBBox(graph: SigmaGraph): SigmaGraphBBox | null {
  if (graph.order === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  graph.forEachNode((_node, attributes) => {
    minX = Math.min(minX, attributes.x);
    maxX = Math.max(maxX, attributes.x);
    minY = Math.min(minY, attributes.y);
    maxY = Math.max(maxY, attributes.y);
  });
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const width = Math.max(900, maxX - minX + 360);
  const height = Math.max(640, maxY - minY + 320);
  return {
    x: [centerX - width / 2, centerX + width / 2],
    y: [centerY - height / 2, centerY + height / 2]
  };
}

function buildLayoutDataKey(
  nodes: readonly RelationshipGraphNode[],
  edges: readonly RelationshipGraphEdge[],
  focusNodeId: string | null | undefined
): string {
  const nodeKey = nodes
    .map((node) => {
      const position = layoutPositionFromNode(node);
      const positionKey = position ? `${position.x}:${position.y}` : "auto";
      return `${node.id}:${node.relationCount}:${Math.round(node.score * 100)}:${positionKey}`;
    })
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
  focusNodeId: string | null | undefined,
  displaySettings: RelationshipGraphDisplaySettings,
  layoutMode: RelationshipGraphLayoutMode
): Map<string, RelationshipGraphPosition> {
  if (layoutMode === "manual") {
    return buildManualSeedPositions(nodes);
  }
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
    height: 760,
    displaySettings: displaySettings
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

function updateNodeLabelAnchors(graph: SigmaGraph): void {
  graph.forEachNode((node, attributes) => {
    const vectors = graph.neighbors(node).map((neighbor) => {
      const neighborAttributes = graph.getNodeAttributes(neighbor);
      return {
        dx: neighborAttributes.x - attributes.x,
        dy: neighborAttributes.y - attributes.y,
        weight: Math.max(1, neighborAttributes.relationCount ?? 1)
      };
    });
    const anchor = resolveNodeLabelAnchor(vectors);
    graph.mergeNodeAttributes(node, {
      labelAnchorX: anchor.x,
      labelAnchorY: anchor.y,
      labelTextAlign: anchor.textAlign
    });
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
    readonly layoutMode: RelationshipGraphLayoutMode;
    readonly focusNodeId?: string | null;
  },
  positionCache: Map<string, RelationshipGraphPosition>
): SigmaGraphBuildResult {
  const { displaySettings } = input;
  const config = graphDensityConfig[resolveGraphDensity(input.nodes.length)];
  const isManualLayout = input.layoutMode === "manual";
  const seedPositions = buildSeedPositions(input.nodes, input.edges, input.focusNodeId, displaySettings, input.layoutMode);
  const useStaticHubSectorLayout =
    !isManualLayout &&
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
    const targetPosition = useStaticHubSectorLayout && seeded ? seeded : null;
    const position = targetPosition
      ? cached ?? fallbackPosition(index, data.nodes.length)
      : cached ?? seeded ?? fallbackPosition(index, data.nodes.length);
    initialPositions.set(nodeElement.id, position);
    if (targetPosition) {
      animationTargets[nodeElement.id] = { x: targetPosition.x, y: targetPosition.y };
      positionCache.set(nodeElement.id, targetPosition);
    }
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
      labelAnchorX: 1,
      labelAnchorY: 0,
      labelTextAlign: "left",
      zIndex: 4
    });
  });

  data.edges.forEach((edge) => {
    graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
      ...edge.data,
      data: edge.data,
      label: edge.data.baseLabelText,
      type: edge.data.edgeType,
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

  if (!isManualLayout && !input.focusNodeId && graph.order > 1 && !useStaticHubSectorLayout) {
    forceAtlas2.assign(graph, {
      iterations: config.iterations,
      getEdgeWeight: "layoutWeight",
      settings: buildForceAtlas2Settings(graph, config, displaySettings)
    });
    applyNoverlapLayout(graph, config, displaySettings);
    updateNodeLabelAnchors(graph);
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
  } else if (Object.keys(animationTargets).length === 0) {
    updateNodeLabelAnchors(graph);
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
  layoutMode = "auto",
  selectedId,
  focusNodeId,
  onSelectNode,
  onSelectEdge,
  onNodePositionChange
}: SigmaRelationshipGraphProps) {
  const sigma = useSigma<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const loadGraph = useLoadGraph<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const registerEvents = useRegisterEvents<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const setSettings = useSetSettings<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const positionCache = useRef<Map<string, RelationshipGraphPosition>>(new Map());
  const lastLayoutDataKey = useRef<string | null>(null);
  const onSelectNodeRef = useRef(onSelectNode);
  const onSelectEdgeRef = useRef(onSelectEdge);
  const onNodePositionChangeRef = useRef(onNodePositionChange);
  const cancelAnimationRef = useRef<(() => void) | null>(null);
  const draggedNodeRef = useRef<string | null>(null);
  const dragStartRef = useRef<RelationshipGraphPosition | null>(null);
  const lastCameraLayoutModeRef = useRef<RelationshipGraphLayoutMode | null>(null);
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

        const box = nodeLabelBox({
          x: displayData.x,
          y: displayData.y,
          size: displayData.size,
          label,
          fontSize: NODE_LABEL_BOX_FONT_SIZE,
          anchor: labelAnchorFromNodeData(attributes)
        });
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

  useEffect(() => {
    onNodePositionChangeRef.current = onNodePositionChange;
  }, [onNodePositionChange]);

  const skipSettlingLayout = layoutMode === "manual";
  const layoutDataKey = useMemo(() => buildLayoutDataKey(nodes, edges, focusNodeId), [edges, focusNodeId, nodes]);
  const graphBuild = useMemo(() => {
    if (lastLayoutDataKey.current !== layoutDataKey) {
      if (layoutMode === "manual") {
        prunePositionCache(positionCache.current, nodes);
      } else {
        positionCache.current.clear();
      }
      lastLayoutDataKey.current = layoutDataKey;
    }
    return buildGraph({ nodes, edges, displaySettings, layoutMode, focusNodeId }, positionCache.current);
  }, [displaySettings, edges, focusNodeId, layoutDataKey, layoutMode, nodes]);
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
    if (!skipSettlingLayout && options.resolveOverlap && !focusNodeId && activeGraph.order > 1) {
      applyNoverlapLayout(activeGraph, graphDensityConfig[resolveGraphDensity(activeGraph.order)], displaySettings);
    }
    updateNodeLabelAnchors(activeGraph);
    cacheGraphPositions(activeGraph, positionCache.current);
  }, [displaySettings, focusNodeId, sigma, skipSettlingLayout]);

  const startSettlingLayout = useCallback(
    (activeGraph: SigmaGraph, fixedNode: string | null = null, duration = 900) => {
      stopSettlingLayout();
      if (skipSettlingLayout || focusNodeId || activeGraph.order < 3) {
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
    [displaySettings, focusNodeId, sigma, skipSettlingLayout, stopSettlingLayout]
  );

  useEffect(() => {
    cancelAnimationRef.current?.();
    cancelAnimationRef.current = null;
    stopSettlingLayout();
    const manualGraphBBox = layoutMode === "manual" ? buildManualGraphBBox(graph) : null;
    if (layoutMode === "manual") {
      sigma.setCustomBBox(manualGraphBBox);
    } else {
      sigma.setCustomBBox(null);
    }
    loadGraph(graph);
    const activeGraph = sigma.getGraph() as SigmaGraph;
    if (layoutMode === "manual") {
      if (lastCameraLayoutModeRef.current !== "manual") {
        sigma.getCamera().setState({ x: 0.5, y: 0.5, angle: 0, ratio: 1 });
      }
      lastCameraLayoutModeRef.current = "manual";
    } else {
      lastCameraLayoutModeRef.current = "auto";
      sigma.getCamera().animatedReset({ duration: 420 });
    }
    if (Object.keys(graphBuild.animationTargets).length > 0) {
      cancelAnimationRef.current = animateNodes(
        activeGraph,
        graphBuild.animationTargets,
        { duration: 650, easing: "quadraticInOut" },
        () => {
          cancelAnimationRef.current = null;
          updateNodeLabelAnchors(activeGraph);
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
  }, [graph, graphBuild.animationTargets, layoutMode, loadGraph, sigma, startSettlingLayout, stopSettlingLayout]);

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
        const label = attrs.baseLabelDirection === "different_both_ways" ? attrs.baseLabelText : selected ? attrs.plotLabelText : attrs.baseLabelText;
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
        updateNodeLabelAnchors(activeGraph);
        const nextPosition = {
          x: roundPosition(activeGraph.getNodeAttribute(draggedNode, "x")),
          y: roundPosition(activeGraph.getNodeAttribute(draggedNode, "y"))
        };
        positionCache.current.set(draggedNode, nextPosition);
        onNodePositionChangeRef.current?.(draggedNode, nextPosition);
      }
      sigma.refresh();
      if (!skipSettlingLayout) {
        startSettlingLayout(activeGraph, draggedNode, 900);
      }
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
        updateNodeLabelAnchors(activeGraph);
        sigma.refresh();
      },
      mouseup: finishDragging,
      touchup: finishDragging
    });
  }, [graph, registerEvents, sigma, skipSettlingLayout, startSettlingLayout, stopSettlingLayout]);

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
  const layoutMode = props.layoutMode ?? "auto";
  const settings = useMemo(
    () => ({
      allowInvalidContainer: true,
      autoCenter: layoutMode !== "manual",
      autoRescale: layoutMode !== "manual",
      defaultEdgeColor: "#94a3b8",
      defaultEdgeType: "line",
      defaultDrawEdgeLabel: drawRelationshipEdgeLabel,
      defaultDrawNodeHover: drawRelationshipNodeHover,
      defaultDrawNodeLabel: drawRelationshipNodeLabel,
      defaultNodeColor: "#1e88e5",
      edgeLabelColor: { color: "#334155" },
      edgeLabelFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      edgeLabelSize: 10,
      edgeLabelWeight: "650",
      edgeProgramClasses: {
        arrow: EdgeArrowProgram,
        doubleArrow: EdgeDoubleArrowProgram,
        line: EdgeLineProgram
      },
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
    [layoutMode]
  );

  return (
    <SigmaContainer className="relationship-sigma" graph={RelationshipSigmaGraphConstructor} settings={settings}>
      <SigmaGraphController {...props} />
    </SigmaContainer>
  );
}
