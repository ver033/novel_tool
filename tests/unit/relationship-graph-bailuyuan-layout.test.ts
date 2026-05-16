import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type {
  RelationshipDimension,
  RelationshipGraphEdge,
  RelationshipGraphEdgeStage,
  RelationshipGraphNode,
  RelationshipMentionDirection,
  RelationshipMentionPolarity
} from "../../src/main/shared/relationship-graph";
import { relationshipGraphToSigmaGraphData } from "../../src/renderer/relationship-graph/relationship-graph-elements";
import { buildRelationshipHubSeedLayoutPositions } from "../../src/renderer/relationship-graph/relationship-graph-hub-layout";

const bailuyuanProjectPath = join(__dirname, "..", "..", "..", "test_novel", "《白鹿原》全集.noveltool");

function hasBailuyuanRelationshipFixture(): boolean {
  if (!existsSync(bailuyuanProjectPath)) {
    return false;
  }
  const db = Database(bailuyuanProjectPath, { readonly: true, fileMustExist: true });
  try {
    const entityTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'relationship_entities'").get();
    const mentionTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'relationship_mentions'").get();
    return Boolean(entityTable && mentionTable);
  } finally {
    db.close();
  }
}

type EntityRow = {
  readonly id: string;
  readonly canonical_name: string;
  readonly aliases_json: string;
  readonly entity_kind: RelationshipGraphNode["entityKind"];
  readonly importance: RelationshipGraphNode["importance"];
  readonly role_summary: string | null;
  readonly faction: string | null;
  readonly first_chapter_order: number | null;
  readonly latest_chapter_order: number | null;
  readonly source_chapter_ids_json: string;
  readonly confidence: number;
};

type MentionRow = {
  readonly id: string;
  readonly chapter_id: string;
  readonly chapter_title: string;
  readonly chapter_order: number;
  readonly source_name: string;
  readonly target_name: string;
  readonly source_entity_id: string | null;
  readonly target_entity_id: string | null;
  readonly base_relation_label: string;
  readonly base_relation_summary: string | null;
  readonly plot_relation_label: string;
  readonly plot_relation_summary: string;
  readonly primary_dimension_name: string;
  readonly relationship_dimensions_json: string;
  readonly semantic_markers_json: string;
  readonly direction: RelationshipMentionDirection;
  readonly polarity: RelationshipMentionPolarity;
  readonly intensity: number;
  readonly change_summary: string;
  readonly start_state: string | null;
  readonly end_state: string | null;
  readonly reason: string | null;
  readonly evidence_quote: string;
  readonly evidence_source?: RelationshipGraphEdgeStage["evidenceSource"];
  readonly confidence: number;
  readonly uncertainty: string | null;
};

type NodeAccumulator = {
  readonly row: EntityRow;
  readonly chapterIds: Set<string>;
  readonly relationIds: Set<string>;
  evidenceCount: number;
  confidenceSum: number;
  intensitySum: number;
};

type EdgeAccumulator = {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly sourceName: string;
  readonly targetName: string;
  readonly direction: RelationshipMentionDirection;
  readonly mentions: MentionRow[];
};

const openedDatabases: Array<ReturnType<typeof Database>> = [];

afterAll(() => {
  for (const db of openedDatabases) {
    db.close();
  }
});

function parseJsonArray<T>(value: string): T[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function endpointForMention(
  mention: MentionRow,
  side: "source" | "target",
  entitiesById: ReadonlyMap<string, EntityRow>
): { readonly id: string; readonly name: string; readonly row: EntityRow } {
  const entityId = side === "source" ? mention.source_entity_id : mention.target_entity_id;
  const fallbackName = side === "source" ? mention.source_name : mention.target_name;
  const row = entityId ? entitiesById.get(entityId) : undefined;
  if (!row) {
    throw new Error(`白鹿原关系缓存中缺少实体：${fallbackName}`);
  }
  return { id: row.id, name: row.canonical_name, row };
}

function normalizeEndpoints(
  mention: MentionRow,
  entitiesById: ReadonlyMap<string, EntityRow>
): {
  readonly sourceId: string;
  readonly targetId: string;
  readonly sourceName: string;
  readonly targetName: string;
  readonly sourceRow: EntityRow;
  readonly targetRow: EntityRow;
  readonly direction: RelationshipMentionDirection;
} {
  const source = endpointForMention(mention, "source", entitiesById);
  const target = endpointForMention(mention, "target", entitiesById);
  if (mention.direction === "undirected" || mention.direction === "unclear") {
    const ordered = [source, target].sort((left, right) => left.id.localeCompare(right.id));
    return {
      sourceId: ordered[0].id,
      targetId: ordered[1].id,
      sourceName: ordered[0].name,
      targetName: ordered[1].name,
      sourceRow: ordered[0].row,
      targetRow: ordered[1].row,
      direction: mention.direction
    };
  }
  if (mention.direction === "target_to_source") {
    return {
      sourceId: target.id,
      targetId: source.id,
      sourceName: target.name,
      targetName: source.name,
      sourceRow: target.row,
      targetRow: source.row,
      direction: mention.direction
    };
  }
  return {
    sourceId: source.id,
    targetId: target.id,
    sourceName: source.name,
    targetName: target.name,
    sourceRow: source.row,
    targetRow: target.row,
    direction: mention.direction
  };
}

function stageFromMention(mention: MentionRow): RelationshipGraphEdgeStage {
  return {
    chapterId: mention.chapter_id,
    chapterTitle: mention.chapter_title,
    chapterOrder: mention.chapter_order,
    baseRelationLabel: mention.base_relation_label,
    baseRelationSummary: mention.base_relation_summary,
    plotRelationLabel: mention.plot_relation_label,
    plotRelationSummary: mention.plot_relation_summary,
    primaryDimensionName: mention.primary_dimension_name,
    relationshipDimensions: parseJsonArray<RelationshipDimension>(mention.relationship_dimensions_json),
    semanticMarkers: parseJsonArray<string>(mention.semantic_markers_json),
    direction: mention.direction,
    polarity: mention.polarity,
    intensity: mention.intensity,
    changeSummary: mention.change_summary,
    startState: mention.start_state,
    endState: mention.end_state,
    reason: mention.reason,
    evidenceQuote: mention.evidence_quote,
    evidenceSource: mention.evidence_source ?? "summary_payload",
    confidence: mention.confidence,
    uncertainty: mention.uncertainty
  };
}

function loadBailuyuanRelationshipGraph(): { readonly nodes: RelationshipGraphNode[]; readonly edges: RelationshipGraphEdge[] } {
  const db = Database(bailuyuanProjectPath, { readonly: true, fileMustExist: true });
  openedDatabases.push(db);
  const entityRows = db.prepare("SELECT * FROM relationship_entities").all() as EntityRow[];
  const mentionRows = db
    .prepare("SELECT * FROM relationship_mentions WHERE source_entity_id IS NOT NULL AND target_entity_id IS NOT NULL ORDER BY chapter_order ASC, rowid ASC")
    .all() as MentionRow[];
  const entitiesById = new Map(entityRows.map((row) => [row.id, row]));
  const nodesById = new Map<string, NodeAccumulator>();
  const edgesById = new Map<string, EdgeAccumulator>();

  const ensureNode = (row: EntityRow): NodeAccumulator => {
    const existing = nodesById.get(row.id);
    if (existing) {
      return existing;
    }
    const node: NodeAccumulator = {
      row,
      chapterIds: new Set(parseJsonArray<string>(row.source_chapter_ids_json)),
      relationIds: new Set(),
      evidenceCount: 0,
      confidenceSum: 0,
      intensitySum: 0
    };
    nodesById.set(row.id, node);
    return node;
  };

  for (const mention of mentionRows) {
    const endpoints = normalizeEndpoints(mention, entitiesById);
    const source = ensureNode(endpoints.sourceRow);
    const target = ensureNode(endpoints.targetRow);
    source.relationIds.add(target.row.id);
    target.relationIds.add(source.row.id);
    for (const node of [source, target]) {
      node.chapterIds.add(mention.chapter_id);
      node.evidenceCount += 1;
      node.confidenceSum += mention.confidence;
      node.intensitySum += mention.intensity;
    }

    const edgeId = `${endpoints.direction}:${endpoints.sourceId}->${endpoints.targetId}`;
    const existing = edgesById.get(edgeId);
    if (existing) {
      existing.mentions.push(mention);
      continue;
    }
    edgesById.set(edgeId, {
      id: edgeId,
      sourceId: endpoints.sourceId,
      targetId: endpoints.targetId,
      sourceName: endpoints.sourceName,
      targetName: endpoints.targetName,
      direction: endpoints.direction,
      mentions: [mention]
    });
  }

  const nodes = [...nodesById.values()].map((node) => {
    const averageConfidence = node.evidenceCount === 0 ? 0 : node.confidenceSum / node.evidenceCount;
    const averageIntensity = node.evidenceCount === 0 ? 0 : node.intensitySum / node.evidenceCount;
    return {
      id: node.row.id,
      name: node.row.canonical_name,
      aliases: parseJsonArray<string>(node.row.aliases_json),
      entityKind: node.row.entity_kind,
      importance: node.row.importance,
      roleSummary: node.row.role_summary,
      faction: node.row.faction,
      chapterIds: [...node.chapterIds],
      firstChapterOrder: node.row.first_chapter_order,
      latestChapterOrder: node.row.latest_chapter_order,
      evidenceCount: node.evidenceCount,
      relationCount: node.relationIds.size,
      averageConfidence,
      averageIntensity,
      score: node.evidenceCount * 2 + node.relationIds.size * 3 + averageConfidence * 5 + averageIntensity * 4
    } satisfies RelationshipGraphNode;
  });

  const edges = [...edgesById.values()].map((edge) => {
    const mentions = edge.mentions.sort((left, right) => left.chapter_order - right.chapter_order);
    const current = mentions[mentions.length - 1];
    const confidence = mentions.reduce((sum, mention) => sum + mention.confidence, 0) / mentions.length;
    const intensity = mentions.reduce((sum, mention) => sum + mention.intensity, 0) / mentions.length;
    return {
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      sourceName: edge.sourceName,
      targetName: edge.targetName,
      baseRelationLabel: current.base_relation_label,
      baseRelationSummary: current.base_relation_summary,
      plotRelationLabel: current.plot_relation_label,
      plotRelationSummary: current.plot_relation_summary,
      primaryDimensionName: current.primary_dimension_name,
      relationshipDimensions: parseJsonArray<RelationshipDimension>(current.relationship_dimensions_json),
      semanticMarkers: parseJsonArray<string>(current.semantic_markers_json),
      direction: current.direction,
      polarity: current.polarity,
      intensity,
      confidence,
      weight: mentions.length * (0.5 + confidence) * (0.5 + intensity),
      evidenceCount: mentions.length,
      evidenceSources: [...new Set(mentions.map((mention) => mention.evidence_source ?? "summary_payload"))],
      chapterIds: [...new Set(mentions.map((mention) => mention.chapter_id))],
      firstChapterOrder: mentions[0].chapter_order,
      latestChapterOrder: current.chapter_order,
      timeline: mentions.map(stageFromMention)
    } satisfies RelationshipGraphEdge;
  });

  return { nodes, edges };
}

function distance(left: { readonly x: number; readonly y: number }, right: { readonly x: number; readonly y: number }): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

describe.skipIf(!hasBailuyuanRelationshipFixture())("白鹿原人物关系图布局", () => {
  it("seeds the real high-degree characters into separate readable sectors without locking them", () => {
    const graph = loadBailuyuanRelationshipGraph();
    const positions = buildRelationshipHubSeedLayoutPositions({ ...graph, width: 1100, height: 760 });
    const expectedHubIds = ["白嘉轩", "黑娃", "鹿子霖", "鹿三", "白孝文", "田小娥"]
      .map((name) => graph.nodes.find((node) => node.name === name)?.id)
      .filter((id): id is string => Boolean(id));

    expect(positions.size).toBe(graph.nodes.length);
    expect(expectedHubIds.length).toBe(6);

    for (let leftIndex = 0; leftIndex < expectedHubIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < expectedHubIds.length; rightIndex += 1) {
        const left = positions.get(expectedHubIds[leftIndex]);
        const right = positions.get(expectedHubIds[rightIndex]);
        expect(left).toBeDefined();
        expect(right).toBeDefined();
        expect(distance(left!, right!)).toBeGreaterThan(180);
      }
    }
  });

  it("anchors the two strongest real hubs on a horizontal reading spine", () => {
    const graph = loadBailuyuanRelationshipGraph();
    const positions = buildRelationshipHubSeedLayoutPositions({ ...graph, width: 1100, height: 760 });
    const baiJiaxuan = graph.nodes.find((node) => node.name === "白嘉轩");
    const heiWa = graph.nodes.find((node) => node.name === "黑娃");

    expect(baiJiaxuan).toBeDefined();
    expect(heiWa).toBeDefined();

    const baiPosition = positions.get(baiJiaxuan!.id);
    const heiPosition = positions.get(heiWa!.id);

    expect(baiPosition).toBeDefined();
    expect(heiPosition).toBeDefined();
    expect(baiPosition!.x).toBeLessThan(1100 * 0.48);
    expect(heiPosition!.x).toBeGreaterThan(1100 * 0.62);
    expect(heiPosition!.x - baiPosition!.x).toBeGreaterThan(330);
    expect(Math.abs(heiPosition!.y - baiPosition!.y)).toBeLessThan(150);
  });

  it("keeps every base label available but limits forced labels around real high-degree characters", () => {
    const graph = loadBailuyuanRelationshipGraph();
    const baiJiaxuan = graph.nodes.find((node) => node.name === "白嘉轩");
    expect(baiJiaxuan).toBeDefined();

    const balanced = relationshipGraphToSigmaGraphData(graph);
    const full = relationshipGraphToSigmaGraphData(graph, { labelDensity: "full" });
    const pinnedIncidentLabels = balanced.edges.filter(
      (edge) =>
        edge.data.baseLabelPinned &&
        (edge.data.source === baiJiaxuan!.id || edge.data.target === baiJiaxuan!.id)
    );
    const allVisibleFullLabels = full.edges.filter((edge) => Boolean(edge.data.baseLabelText));

    expect(balanced.edges.every((edge) => Boolean(edge.data.baseLabelText))).toBe(true);
    expect(allVisibleFullLabels.length).toBe(graph.edges.filter((edge) => Boolean(edge.baseRelationLabel.trim())).length);
    expect(pinnedIncidentLabels.length).toBeGreaterThan(0);
    expect(pinnedIncidentLabels.length).toBeLessThanOrEqual(3);
  });
});
