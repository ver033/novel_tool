import type { RelationshipGraphEdge, RelationshipGraphNode } from "../../main/shared/relationship-graph";

export type RelationshipGraphFocusPosition = {
  readonly x: number;
  readonly y: number;
  readonly ring: "center" | "one-hop" | "two-hop";
  readonly hop: 0 | 1 | 2;
  readonly angle?: number;
};

type RelationshipFocusLayoutInput = {
  readonly nodes: readonly RelationshipGraphNode[];
  readonly edges: readonly RelationshipGraphEdge[];
  readonly focusNodeId: string;
  readonly width: number;
  readonly height: number;
};

function roundPosition(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function buildAdjacency(edges: readonly RelationshipGraphEdge[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.sourceId)) {
      adjacency.set(edge.sourceId, new Set());
    }
    if (!adjacency.has(edge.targetId)) {
      adjacency.set(edge.targetId, new Set());
    }
    adjacency.get(edge.sourceId)?.add(edge.targetId);
    adjacency.get(edge.targetId)?.add(edge.sourceId);
  }
  return adjacency;
}

function buildStrengths(edges: readonly RelationshipGraphEdge[]): Map<string, number> {
  const strengths = new Map<string, number>();
  for (const edge of edges) {
    const strength = edge.weight + edge.confidence + edge.intensity;
    strengths.set(edge.sourceId, (strengths.get(edge.sourceId) ?? 0) + strength);
    strengths.set(edge.targetId, (strengths.get(edge.targetId) ?? 0) + strength);
  }
  return strengths;
}

function compareByStrengthThenName(
  strengths: ReadonlyMap<string, number>,
  nodeById: ReadonlyMap<string, RelationshipGraphNode>,
  a: string,
  b: string
): number {
  const strengthDiff = (strengths.get(b) ?? 0) - (strengths.get(a) ?? 0);
  if (strengthDiff !== 0) {
    return strengthDiff;
  }
  return (nodeById.get(a)?.name ?? a).localeCompare(nodeById.get(b)?.name ?? b, "zh-CN");
}

function collectHops(focusNodeId: string, adjacency: ReadonlyMap<string, ReadonlySet<string>>): Map<string, 0 | 1 | 2> {
  const hops = new Map<string, 0 | 1 | 2>([[focusNodeId, 0]]);
  const oneHop = [...(adjacency.get(focusNodeId) ?? [])].sort();
  for (const nodeId of oneHop) {
    hops.set(nodeId, 1);
  }
  for (const nodeId of oneHop) {
    for (const neighborId of adjacency.get(nodeId) ?? []) {
      if (!hops.has(neighborId)) {
        hops.set(neighborId, 2);
      }
    }
  }
  return hops;
}

function placeRing(
  nodeIds: readonly string[],
  hop: 1 | 2,
  centerX: number,
  centerY: number,
  radius: number,
  positions: Map<string, RelationshipGraphFocusPosition>
): void {
  const ring = hop === 1 ? "one-hop" : "two-hop";
  const step = (Math.PI * 2) / Math.max(1, nodeIds.length);
  nodeIds.forEach((nodeId, index) => {
    const angle = -Math.PI / 2 + step * index;
    positions.set(nodeId, {
      x: roundPosition(centerX + Math.cos(angle) * radius),
      y: roundPosition(centerY + Math.sin(angle) * radius),
      ring,
      hop,
      angle: roundPosition(angle)
    });
  });
}

export function buildRelationshipFocusLayoutPositions(input: RelationshipFocusLayoutInput): Map<string, RelationshipGraphFocusPosition> {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const positions = new Map<string, RelationshipGraphFocusPosition>();
  if (!nodeById.has(input.focusNodeId)) {
    return positions;
  }

  const centerX = roundPosition(input.width / 2);
  const centerY = roundPosition(input.height / 2);
  const baseRadius = Math.max(120, Math.min(input.width, input.height) * 0.25);
  const secondRingRadius = Math.max(baseRadius + 90, Math.min(input.width, input.height) * 0.4);
  const adjacency = buildAdjacency(input.edges);
  const strengths = buildStrengths(input.edges);
  const hops = collectHops(input.focusNodeId, adjacency);

  positions.set(input.focusNodeId, {
    x: centerX,
    y: centerY,
    ring: "center",
    hop: 0
  });

  const oneHop = [...hops.entries()]
    .filter(([, hop]) => hop === 1)
    .map(([nodeId]) => nodeId)
    .filter((nodeId) => nodeById.has(nodeId))
    .sort((a, b) => compareByStrengthThenName(strengths, nodeById, a, b));
  const twoHop = [...hops.entries()]
    .filter(([, hop]) => hop === 2)
    .map(([nodeId]) => nodeId)
    .filter((nodeId) => nodeById.has(nodeId))
    .sort((a, b) => compareByStrengthThenName(strengths, nodeById, a, b));

  placeRing(oneHop, 1, centerX, centerY, baseRadius, positions);
  placeRing(twoHop, 2, centerX, centerY, secondRingRadius, positions);

  return positions;
}
