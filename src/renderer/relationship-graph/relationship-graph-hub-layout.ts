import type { RelationshipGraphEdge, RelationshipGraphNode } from "../../main/shared/relationship-index";
import type { RelationshipGraphPosition } from "./relationship-graph-position";

type RelationshipHubSeedLayoutInput = {
  readonly nodes: readonly RelationshipGraphNode[];
  readonly edges: readonly RelationshipGraphEdge[];
  readonly width: number;
  readonly height: number;
};

type NodeLayoutStats = {
  readonly id: string;
  readonly degree: number;
  readonly strength: number;
};

type HubAssignment = {
  readonly nodeId: string;
  readonly strength: number;
};

type BestHubForNode = {
  readonly hubId: string;
  readonly strength: number;
};

const minSeededNodeCount = 12;
const minSeededEdgeCount = 10;
const minHubDegree = 3;
const hubSpineAnchors: ReadonlyArray<{ readonly xRatio: number; readonly yRatio: number }> = [
  { xRatio: 0.36, yRatio: 0.52 },
  { xRatio: 0.72, yRatio: 0.55 },
  { xRatio: 0.56, yRatio: 0.26 },
  { xRatio: 0.58, yRatio: 0.76 },
  { xRatio: 0.23, yRatio: 0.3 },
  { xRatio: 0.84, yRatio: 0.31 },
  { xRatio: 0.25, yRatio: 0.76 },
  { xRatio: 0.85, yRatio: 0.73 }
];

function roundPosition(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function edgeStrength(edge: RelationshipGraphEdge): number {
  return Math.max(0.1, edge.weight * 1.4 + edge.evidenceCount * 0.4 + edge.intensity + edge.confidence);
}

function importanceRank(node: RelationshipGraphNode | undefined): number {
  if (!node) {
    return 0;
  }
  if (node.importance === "main") {
    return 3;
  }
  if (node.importance === "supporting") {
    return 2;
  }
  if (node.importance === "minor") {
    return 1;
  }
  return 0;
}

function compareStatsByConnectivity(
  nodeById: ReadonlyMap<string, RelationshipGraphNode>,
  left: NodeLayoutStats,
  right: NodeLayoutStats
): number {
  const leftIsMain = importanceRank(nodeById.get(left.id)) === 3;
  const rightIsMain = importanceRank(nodeById.get(right.id)) === 3;
  if (leftIsMain !== rightIsMain) {
    return rightIsMain ? 1 : -1;
  }
  const degreeDiff = right.degree - left.degree;
  if (degreeDiff !== 0) {
    return degreeDiff;
  }
  const strengthDiff = right.strength - left.strength;
  if (strengthDiff !== 0) {
    return strengthDiff;
  }
  return (nodeById.get(left.id)?.name ?? left.id).localeCompare(nodeById.get(right.id)?.name ?? right.id, "zh-CN");
}

function buildNodeStats(
  nodeIds: ReadonlySet<string>,
  edges: readonly RelationshipGraphEdge[]
): Map<string, { degree: number; strength: number }> {
  const stats = new Map<string, { degree: number; strength: number }>();
  for (const nodeId of nodeIds) {
    stats.set(nodeId, { degree: 0, strength: 0 });
  }
  for (const edge of edges) {
    if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) {
      continue;
    }
    const strength = edgeStrength(edge);
    const source = stats.get(edge.sourceId);
    const target = stats.get(edge.targetId);
    if (source) {
      source.degree += 1;
      source.strength += strength;
    }
    if (target) {
      target.degree += 1;
      target.strength += strength;
    }
  }
  return stats;
}

function selectHubIds(
  nodes: readonly RelationshipGraphNode[],
  edges: readonly RelationshipGraphEdge[]
): readonly string[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const stats = buildNodeStats(new Set(nodeById.keys()), edges);
  const candidates = [...stats.entries()]
    .map(([id, item]) => ({ id, degree: item.degree, strength: item.strength }))
    .filter((item) => item.degree >= minHubDegree)
    .sort((left, right) => compareStatsByConnectivity(nodeById, left, right));

  const connectivityHubCount = Math.ceil(Math.sqrt(Math.max(1, candidates.length + nodes.length / 6)));
  const denseGraphMinimum = nodes.length >= 36 ? 8 : nodes.length >= 24 ? 6 : 2;
  const maxHubCount = nodes.length >= 100 ? 10 : 8;
  const hubCount = Math.min(candidates.length, maxHubCount, Math.max(2, denseGraphMinimum, connectivityHubCount));
  return candidates.slice(0, hubCount).map((item) => item.id);
}

function hubAngle(index: number, total: number): number {
  if (total === 2) {
    return index === 0 ? Math.PI : 0;
  }
  return -Math.PI / 2 + (Math.PI * 2 * index) / total;
}

function assignToHubs(
  nodes: readonly RelationshipGraphNode[],
  edges: readonly RelationshipGraphEdge[],
  hubIds: readonly string[]
): Map<string, HubAssignment[]> {
  const hubSet = new Set(hubIds);
  const assignments = new Map(hubIds.map((hubId): [string, HubAssignment[]] => [hubId, []]));
  const bestHubByNode = new Map<string, BestHubForNode>();

  for (const edge of edges) {
    const sourceIsHub = hubSet.has(edge.sourceId);
    const targetIsHub = hubSet.has(edge.targetId);
    if (sourceIsHub === targetIsHub) {
      continue;
    }
    const hubId = sourceIsHub ? edge.sourceId : edge.targetId;
    const nodeId = sourceIsHub ? edge.targetId : edge.sourceId;
    const strength = edgeStrength(edge);
    const current = bestHubByNode.get(nodeId);
    if (!current || strength > current.strength || (strength === current.strength && hubId.localeCompare(current.hubId, "zh-CN") < 0)) {
      bestHubByNode.set(nodeId, { hubId, strength });
    }
  }

  const nonHubNodes = nodes.filter((node) => !hubSet.has(node.id));
  for (const node of nonHubNodes) {
    const bestHub = bestHubByNode.get(node.id);
    if (!bestHub) {
      continue;
    }
    assignments.get(bestHub.hubId)?.push({ nodeId: node.id, strength: bestHub.strength });
  }
  for (const entries of assignments.values()) {
    entries.sort((left, right) => right.strength - left.strength || left.nodeId.localeCompare(right.nodeId, "zh-CN"));
  }
  return assignments;
}

function setClampedPosition(
  positions: Map<string, RelationshipGraphPosition>,
  nodeId: string,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  positions.set(nodeId, {
    x: roundPosition(clamp(x, 28, Math.max(28, width - 28))),
    y: roundPosition(clamp(y, 28, Math.max(28, height - 28)))
  });
}

function strongestHubSkew(stats: readonly NodeLayoutStats[]): number {
  if (stats.length < 2) {
    return 0;
  }
  const sortedStats = [...stats].sort((left, right) => right.degree - left.degree || right.strength - left.strength);
  return sortedStats[0].degree / Math.max(1, sortedStats[1].degree);
}

function hubSpinePosition(index: number, total: number, width: number, height: number): RelationshipGraphPosition {
  const anchor = hubSpineAnchors[index];
  if (anchor) {
    return {
      x: roundPosition(width * anchor.xRatio),
      y: roundPosition(height * anchor.yRatio)
    };
  }

  const overflowIndex = index - hubSpineAnchors.length;
  const overflowTotal = Math.max(1, total - hubSpineAnchors.length);
  const angle = -Math.PI / 2 + (Math.PI * 2 * overflowIndex) / overflowTotal;
  return {
    x: roundPosition(width / 2 + Math.cos(angle) * width * 0.32),
    y: roundPosition(height / 2 + Math.sin(angle) * height * 0.34)
  };
}

function satelliteSectorWidth(assignmentCount: number, hubIndex: number): number {
  const baseWidth = hubIndex < 2 ? Math.PI * 0.92 : Math.PI * 0.74;
  return Math.min(Math.PI * 1.12, baseWidth + Math.max(0, assignmentCount - 8) * 0.035);
}

function satelliteAngle(
  hubPosition: RelationshipGraphPosition,
  centerX: number,
  centerY: number,
  index: number,
  slotCount: number,
  assignmentCount: number,
  hubIndex: number
): number {
  const outwardAngle = Math.atan2(hubPosition.y - centerY, hubPosition.x - centerX);
  const sectorWidth = satelliteSectorWidth(assignmentCount, hubIndex);
  if (slotCount <= 1) {
    return outwardAngle;
  }
  const offsetRatio = (index % slotCount) / (slotCount - 1) - 0.5;
  return outwardAngle + offsetRatio * sectorWidth;
}

export function shouldUseRelationshipHubSectorLayout(
  nodes: readonly RelationshipGraphNode[],
  edges: readonly RelationshipGraphEdge[]
): boolean {
  if (nodes.length < 24 || edges.length < 18) {
    return false;
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const stats = [...buildNodeStats(new Set(nodeById.keys()), edges).entries()]
    .map(([id, item]) => ({ id, degree: item.degree, strength: item.strength }))
    .sort((left, right) => compareStatsByConnectivity(nodeById, left, right));
  const highDegreeNodes = stats.filter((item) => item.degree >= minHubDegree);
  if (highDegreeNodes.length < 2) {
    return false;
  }
  const maxDegree = highDegreeNodes[0].degree;
  return maxDegree >= 10 && (nodes.length >= 36 || strongestHubSkew(highDegreeNodes) >= 1.6);
}

export function buildRelationshipHubSeedLayoutPositions(input: RelationshipHubSeedLayoutInput): Map<string, RelationshipGraphPosition> {
  const positions = new Map<string, RelationshipGraphPosition>();
  const nodeIds = new Set(input.nodes.map((node) => node.id));
  const validEdges = input.edges.filter((edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId));
  if (input.nodes.length < minSeededNodeCount || validEdges.length < minSeededEdgeCount) {
    return positions;
  }

  const hubIds = selectHubIds(input.nodes, validEdges);
  if (hubIds.length < 2) {
    return positions;
  }

  const centerX = input.width / 2;
  const centerY = input.height / 2;
  const hubRadiusX = Math.max(240, input.width * 0.36);
  const hubRadiusY = Math.max(220, input.height * 0.4);
  const useHubSectorLayout = shouldUseRelationshipHubSectorLayout(input.nodes, validEdges);
  const hubPositions = new Map<string, RelationshipGraphPosition>();
  hubIds.forEach((hubId, index) => {
    const position = useHubSectorLayout
      ? hubSpinePosition(index, hubIds.length, input.width, input.height)
      : {
        x: roundPosition(centerX + Math.cos(hubAngle(index, hubIds.length)) * hubRadiusX),
        y: roundPosition(centerY + Math.sin(hubAngle(index, hubIds.length)) * hubRadiusY)
      };
    hubPositions.set(hubId, position);
    setClampedPosition(positions, hubId, position.x, position.y, input.width, input.height);
  });

  const assignments = assignToHubs(input.nodes, validEdges, hubIds);
  const placedNodeIds = new Set(hubIds);
  hubIds.forEach((hubId, hubIndex) => {
    const hubPosition = hubPositions.get(hubId);
    if (!hubPosition) {
      return;
    }
    const assignedNodes = assignments.get(hubId) ?? [];
    assignedNodes.forEach((assignment, index) => {
      const ring = Math.floor(index / 8);
      const slotCount = Math.min(8 + ring * 4, Math.max(1, assignedNodes.length - ring * 8));
      const angle = useHubSectorLayout
        ? satelliteAngle(hubPosition, centerX, centerY, index, slotCount, assignedNodes.length, hubIndex)
        : hubAngle(hubIndex, hubIds.length) + Math.PI + (Math.PI * 2 * (index % slotCount)) / slotCount;
      const radius = useHubSectorLayout ? 100 + ring * 66 : 78 + ring * 54;
      setClampedPosition(
        positions,
        assignment.nodeId,
        hubPosition.x + Math.cos(angle) * radius,
        hubPosition.y + Math.sin(angle) * radius,
        input.width,
        input.height
      );
      placedNodeIds.add(assignment.nodeId);
    });
  });

  const unplacedNodes = input.nodes.filter((node) => !placedNodeIds.has(node.id));
  unplacedNodes.forEach((node, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, unplacedNodes.length);
    setClampedPosition(
      positions,
      node.id,
      centerX + Math.cos(angle) * input.width * 0.28,
      centerY + Math.sin(angle) * input.height * 0.26,
      input.width,
      input.height
    );
  });

  return positions;
}
