import type { RelationshipGraphEdge, RelationshipGraphNode } from "../../main/shared/relationship-graph";
import type { RelationshipGraphLabelDensity } from "./relationship-graph-display-settings";
import type { RelationshipGraphPosition } from "./relationship-graph-position";

type RelationshipGraphElementInput = {
  readonly nodes: readonly RelationshipGraphNode[];
  readonly edges: readonly RelationshipGraphEdge[];
};

type RelationshipGraphElementOptions = {
  readonly labelDensity?: RelationshipGraphLabelDensity;
  readonly positions?: ReadonlyMap<string, RelationshipGraphPosition>;
};

export type RelationshipGraphSigmaNodeData = {
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly entityKind: RelationshipGraphNode["entityKind"];
  readonly importance: RelationshipGraphNode["importance"];
  readonly role: RelationshipGraphNode["importance"];
  readonly roleSummary: string | null;
  readonly faction: string | null;
  readonly firstChapterOrder: number | null;
  readonly latestChapterOrder: number | null;
  readonly evidenceCount: number;
  readonly relationCount: number;
  readonly averageConfidence: number;
  readonly confidence: number;
  readonly averageIntensity: number;
  readonly score: number;
  readonly position?: RelationshipGraphPosition;
};

export type RelationshipGraphSigmaEdgeData = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly sourceName: string;
  readonly targetName: string;
  readonly label: string;
  readonly baseLabel: string;
  readonly baseLabelText: string;
  readonly baseLabelSourceToTargetText: string;
  readonly baseLabelTargetToSourceText: string;
  readonly baseLabelDirection: "single" | "same_both_ways" | "different_both_ways";
  readonly baseLabelPinned: boolean;
  readonly baseSummary: string | null;
  readonly edgeType: "line" | "arrow" | "doubleArrow" | "curvedArrow";
  readonly curvature: number | null;
  readonly manualReciprocalEdge: boolean;
  readonly plotLabel: string;
  readonly plotLabelText: string;
  readonly plotSummary: string;
  readonly primaryDimension: string;
  readonly dimensions: readonly string[];
  readonly dimensionDetails: readonly RelationshipGraphEdge["relationshipDimensions"][number][];
  readonly semanticMarkers: readonly string[];
  readonly direction: RelationshipGraphEdge["direction"];
  readonly polarity: RelationshipGraphEdge["polarity"];
  readonly intensity: number;
  readonly confidence: number;
  readonly weight: number;
  readonly evidenceCount: number;
  readonly firstChapterOrder: number | null;
  readonly latestChapterOrder: number | null;
  readonly chapterIds: readonly string[];
  readonly timeline: RelationshipGraphEdge["timeline"];
  readonly uncertain: boolean;
};

export type RelationshipGraphSigmaNodeElement = {
  readonly id: string;
  readonly data: RelationshipGraphSigmaNodeData;
};

export type RelationshipGraphSigmaEdgeElement = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly data: RelationshipGraphSigmaEdgeData;
};

export type RelationshipGraphSigmaData = {
  readonly nodes: readonly RelationshipGraphSigmaNodeElement[];
  readonly edges: readonly RelationshipGraphSigmaEdgeElement[];
};

const MANUAL_RECIPROCAL_EDGE_CURVATURE = 0.32;

function roundGraphMetric(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1000) / 1000;
}

function edgeHasUncertainty(edge: RelationshipGraphEdge): boolean {
  return edge.timeline.some((stage) => Boolean(stage.uncertainty?.trim()));
}

function isAuthorManualEdge(edge: RelationshipGraphEdge): boolean {
  return Boolean(edge.authorRelationshipId && edge.evidenceSources.includes("author_manual"));
}

function normalizeGraphLabel(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function compactGraphLabel(value: string, maxLength = 16): string {
  const normalized = normalizeGraphLabel(value);
  const characters = Array.from(normalized);
  if (characters.length <= maxLength) {
    return normalized;
  }
  return `${characters.slice(0, maxLength).join("")}...`;
}

function scoreEdgeForLabelVisibility(edge: RelationshipGraphEdge): number {
  return edge.weight * 1.2 + edge.evidenceCount * 0.8 + edge.intensity * 2 + edge.confidence;
}

function buildNodeDegrees(edges: readonly RelationshipGraphEdge[]): ReadonlyMap<string, number> {
  const degrees = new Map<string, number>();
  for (const edge of edges) {
    degrees.set(edge.sourceId, (degrees.get(edge.sourceId) ?? 0) + 1);
    degrees.set(edge.targetId, (degrees.get(edge.targetId) ?? 0) + 1);
  }
  return degrees;
}

function baseLabelEndpointCap(degree: number, labelDensity: RelationshipGraphLabelDensity): number {
  if (labelDensity === "full") {
    return Number.POSITIVE_INFINITY;
  }
  if (labelDensity === "essential") {
    return degree >= 8 ? 1 : 2;
  }
  if (degree >= 12) {
    return 3;
  }
  if (degree >= 6) {
    return 3;
  }
  return 4;
}

function baseLabelGlobalQuota(
  nodeCount: number,
  edgeCount: number,
  labelDensity: RelationshipGraphLabelDensity
): number {
  if (labelDensity === "full") {
    return edgeCount;
  }
  if (nodeCount <= 10 && edgeCount <= 14) {
    return edgeCount;
  }
  if (labelDensity === "essential") {
    return Math.min(10, Math.max(4, Math.ceil(edgeCount * 0.12)));
  }
  return Math.min(18, Math.max(6, Math.ceil(edgeCount * 0.22)));
}

function scoreEdgeForBaseLabel(edge: RelationshipGraphEdge, nodesById: ReadonlyMap<string, RelationshipGraphNode>): number {
  const sourceScore = nodesById.get(edge.sourceId)?.score ?? 0;
  const targetScore = nodesById.get(edge.targetId)?.score ?? 0;
  return scoreEdgeForLabelVisibility(edge) + (sourceScore + targetScore) * 0.08;
}

function buildForcedBaseLabelIds(
  nodes: readonly RelationshipGraphNode[],
  edges: readonly RelationshipGraphEdge[],
  labelDensity: RelationshipGraphLabelDensity
): ReadonlySet<string> {
  const labeledEdges = edges.filter((edge) => Boolean(normalizeGraphLabel(edge.baseRelationLabel)));
  if (labelDensity === "full") {
    return new Set(labeledEdges.map((edge) => edge.id));
  }

  const visibleEdgeIds = new Set<string>();
  const globalQuota = baseLabelGlobalQuota(nodes.length, labeledEdges.length, labelDensity);
  const degrees = buildNodeDegrees(labeledEdges);
  const labelCounts = new Map<string, number>();
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const sortedEdges = [...labeledEdges].sort((left, right) => {
    const scoreDifference = scoreEdgeForBaseLabel(right, nodesById) - scoreEdgeForBaseLabel(left, nodesById);
    return scoreDifference || left.id.localeCompare(right.id, "zh-Hans-CN");
  });

  for (const edge of sortedEdges) {
    if (visibleEdgeIds.size >= globalQuota) {
      break;
    }

    const sourceVisibleCount = labelCounts.get(edge.sourceId) ?? 0;
    const targetVisibleCount = labelCounts.get(edge.targetId) ?? 0;
    const sourceCap = baseLabelEndpointCap(degrees.get(edge.sourceId) ?? 0, labelDensity);
    const targetCap = baseLabelEndpointCap(degrees.get(edge.targetId) ?? 0, labelDensity);
    if (sourceVisibleCount >= sourceCap || targetVisibleCount >= targetCap) {
      continue;
    }

    visibleEdgeIds.add(edge.id);
    labelCounts.set(edge.sourceId, sourceVisibleCount + 1);
    labelCounts.set(edge.targetId, targetVisibleCount + 1);
  }

  return visibleEdgeIds;
}

function buildManualReciprocalRelationshipIds(edges: readonly RelationshipGraphEdge[]): ReadonlySet<string> {
  const edgeCounts = new Map<string, number>();
  for (const edge of edges) {
    if (!isAuthorManualEdge(edge) || !edge.authorRelationshipId) {
      continue;
    }
    edgeCounts.set(edge.authorRelationshipId, (edgeCounts.get(edge.authorRelationshipId) ?? 0) + 1);
  }
  return new Set([...edgeCounts].filter(([, count]) => count > 1).map(([relationshipId]) => relationshipId));
}

function stripReverseAuthorLabel(edge: RelationshipGraphEdge, label: string): RelationshipGraphEdge {
  return {
    ...edge,
    baseRelationLabel: label,
    baseRelationSourceToTargetLabel: label,
    baseRelationTargetToSourceLabel: null,
    timeline: edge.timeline.map((stage) => ({
      ...stage,
      baseRelationLabel: label,
      baseRelationSourceToTargetLabel: label,
      baseRelationTargetToSourceLabel: null
    }))
  };
}

function expandAuthorManualDirectionalEdges(edges: readonly RelationshipGraphEdge[]): RelationshipGraphEdge[] {
  return edges.flatMap((edge) => {
    const targetToSourceLabel = normalizeGraphLabel(edge.baseRelationTargetToSourceLabel);
    if (!isAuthorManualEdge(edge) || !targetToSourceLabel) {
      return [edge];
    }

    const sourceToTargetLabel = normalizeGraphLabel(edge.baseRelationSourceToTargetLabel) || normalizeGraphLabel(edge.baseRelationLabel);
    const forwardEdge = stripReverseAuthorLabel(
      {
        ...edge,
        id: edge.id.endsWith(":source_to_target") ? edge.id : `${edge.id}:source_to_target`
      },
      sourceToTargetLabel
    );
    const reverseEdge = stripReverseAuthorLabel(
      {
        ...edge,
        id: edge.id.endsWith(":target_to_source") ? edge.id : `${edge.id}:target_to_source`,
        sourceId: edge.targetId,
        targetId: edge.sourceId,
        sourceName: edge.targetName,
        targetName: edge.sourceName,
        direction: "source_to_target"
      },
      targetToSourceLabel
    );
    return [forwardEdge, reverseEdge];
  });
}

function resolveVisibleBaseLabel(
  edge: RelationshipGraphEdge
): string {
  const baseLabel = normalizeGraphLabel(edge.baseRelationLabel);
  if (!baseLabel) {
    return "";
  }
  return compactGraphLabel(baseLabel, 12);
}

function normalizeComparableLabel(value: string): string {
  return normalizeGraphLabel(value).toLocaleLowerCase("zh-CN");
}

function resolveBaseLabelRenderParts(edge: RelationshipGraphEdge): {
  readonly baseLabelText: string;
  readonly sourceToTargetText: string;
  readonly targetToSourceText: string;
  readonly direction: RelationshipGraphSigmaEdgeData["baseLabelDirection"];
  readonly edgeType: RelationshipGraphSigmaEdgeData["edgeType"];
} {
  const baseLabel = normalizeGraphLabel(edge.baseRelationLabel);
  const sourceToTargetLabel = normalizeGraphLabel(edge.baseRelationSourceToTargetLabel) || baseLabel;
  const targetToSourceLabel = normalizeGraphLabel(edge.baseRelationTargetToSourceLabel);
  const sourceToTargetText = compactGraphLabel(sourceToTargetLabel, 12);
  const targetToSourceText = compactGraphLabel(targetToSourceLabel, 12);

  if (targetToSourceLabel) {
    const direction =
      normalizeComparableLabel(sourceToTargetLabel) === normalizeComparableLabel(targetToSourceLabel)
        ? "same_both_ways"
        : "different_both_ways";
    return {
      baseLabelText: sourceToTargetText,
      sourceToTargetText,
      targetToSourceText,
      direction,
      edgeType: "doubleArrow"
    };
  }

  return {
    baseLabelText: resolveVisibleBaseLabel(edge),
    sourceToTargetText,
    targetToSourceText: "",
    direction: "single",
    edgeType: edge.evidenceSources.includes("author_manual") && edge.direction === "source_to_target" ? "arrow" : "line"
  };
}

function resolveVisiblePlotLabel(edge: RelationshipGraphEdge): string {
  const baseLabel = normalizeGraphLabel(edge.baseRelationLabel);
  const plotLabel = normalizeGraphLabel(edge.plotRelationLabel);
  const plotSummary = normalizeGraphLabel(edge.plotRelationSummary);
  const label = plotLabel && plotLabel !== baseLabel ? plotLabel : plotSummary || plotLabel || baseLabel;
  return compactGraphLabel(label, 18);
}

export function relationshipGraphToSigmaGraphData(
  graph: RelationshipGraphElementInput,
  options: RelationshipGraphElementOptions = {}
): RelationshipGraphSigmaData {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const validEdges = expandAuthorManualDirectionalEdges(graph.edges.filter((edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId)));
  const labelDensity = options.labelDensity ?? "balanced";
  const forcedBaseLabelIds = buildForcedBaseLabelIds(graph.nodes, validEdges, labelDensity);
  const manualReciprocalRelationshipIds = buildManualReciprocalRelationshipIds(validEdges);
  const nodeElements: RelationshipGraphSigmaNodeElement[] = graph.nodes.map((node) => {
    const position = options.positions?.get(node.id);
    return {
      id: node.id,
      data: {
        id: node.id,
        label: node.name,
        name: node.name,
        aliases: [...node.aliases],
        entityKind: node.entityKind,
        importance: node.importance,
        role: node.importance,
        roleSummary: node.roleSummary,
        faction: node.faction,
        firstChapterOrder: node.firstChapterOrder,
        latestChapterOrder: node.latestChapterOrder,
        evidenceCount: node.evidenceCount,
        relationCount: node.relationCount,
        averageConfidence: roundGraphMetric(node.averageConfidence),
        confidence: roundGraphMetric(node.averageConfidence),
        averageIntensity: roundGraphMetric(node.averageIntensity),
        score: roundGraphMetric(node.score),
        ...(position ? { position } : {})
      }
    };
  });

  const edgeElements: RelationshipGraphSigmaEdgeElement[] = validEdges.map((edge) => {
    const baseLabelParts = resolveBaseLabelRenderParts(edge);
    const manualReciprocalEdge = Boolean(edge.authorRelationshipId && manualReciprocalRelationshipIds.has(edge.authorRelationshipId));
    return {
      id: edge.id,
      source: edge.sourceId,
      target: edge.targetId,
      data: {
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        sourceName: edge.sourceName,
        targetName: edge.targetName,
        label: edge.baseRelationLabel,
        baseLabel: edge.baseRelationLabel,
        baseLabelText: baseLabelParts.baseLabelText,
        baseLabelSourceToTargetText: baseLabelParts.sourceToTargetText,
        baseLabelTargetToSourceText: baseLabelParts.targetToSourceText,
        baseLabelDirection: baseLabelParts.direction,
        baseLabelPinned: forcedBaseLabelIds.has(edge.id),
        baseSummary: edge.baseRelationSummary,
        edgeType: manualReciprocalEdge ? "curvedArrow" : baseLabelParts.edgeType,
        curvature: manualReciprocalEdge ? MANUAL_RECIPROCAL_EDGE_CURVATURE : null,
        manualReciprocalEdge,
        plotLabel: edge.plotRelationLabel,
        plotLabelText: resolveVisiblePlotLabel(edge),
        plotSummary: edge.plotRelationSummary,
        primaryDimension: edge.primaryDimensionName,
        dimensions: edge.relationshipDimensions.map((dimension) => dimension.name),
        dimensionDetails: edge.relationshipDimensions.map((dimension) => ({ ...dimension })),
        semanticMarkers: [...edge.semanticMarkers],
        direction: edge.direction,
        polarity: edge.polarity,
        intensity: roundGraphMetric(edge.intensity),
        confidence: roundGraphMetric(edge.confidence),
        weight: roundGraphMetric(edge.weight),
        evidenceCount: edge.evidenceCount,
        firstChapterOrder: edge.firstChapterOrder,
        latestChapterOrder: edge.latestChapterOrder,
        chapterIds: [...edge.chapterIds],
        timeline: edge.timeline.map((stage) => ({
          ...stage,
          relationshipDimensions: stage.relationshipDimensions.map((dimension) => ({ ...dimension })),
          semanticMarkers: [...stage.semanticMarkers]
        })),
        uncertain: edgeHasUncertainty(edge)
      }
    };
  });

  return { nodes: nodeElements, edges: edgeElements };
}
