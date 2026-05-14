import type {
  RelationshipEntityRecord,
  RelationshipIndexRepository,
  RelationshipMentionRecord
} from "../db/repositories/relationship-index-repo";
import {
  relationshipEntityKey,
  type RelationshipDimension,
  type RelationshipEntityImportance,
  type RelationshipGraphDimensionSummary,
  type RelationshipGraphEdge,
  type RelationshipGraphEdgeStage,
  type RelationshipGraphGetInput,
  type RelationshipGraphNode,
  type RelationshipGraphResult,
  type RelationshipMentionDirection
} from "../shared/relationship-index";

const DEFAULT_NODE_CAP = 120;
const FOCUS_NODE_CAP = 80;
const STRONG_SUPPORT_THRESHOLD = 0.65;

type NodeAccumulator = {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly entityKind: RelationshipGraphNode["entityKind"];
  readonly importance: RelationshipEntityImportance;
  readonly roleSummary: string | null;
  readonly faction: string | null;
  readonly chapterIds: Set<string>;
  readonly relationIds: Set<string>;
  firstChapterOrder: number | null;
  latestChapterOrder: number | null;
  evidenceCount: number;
  confidenceSum: number;
  intensitySum: number;
};

type EdgeGroup = {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly sourceName: string;
  readonly targetName: string;
  readonly direction: RelationshipMentionDirection;
  readonly mentions: RelationshipMentionRecord[];
};

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function graphNodeIdForName(name: string): string {
  return `name:${relationshipEntityKey(name)}`;
}

function compareByOrderThenName(a: RelationshipGraphNode, b: RelationshipGraphNode): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  return a.name.localeCompare(b.name, "zh-CN");
}

function isMain(importance: RelationshipEntityImportance): boolean {
  return importance === "main";
}

function isSupportingOrAbove(importance: RelationshipEntityImportance): boolean {
  return importance === "main" || importance === "supporting";
}

function stageFromMention(mention: RelationshipMentionRecord): RelationshipGraphEdgeStage {
  return {
    chapterId: mention.chapterId,
    chapterTitle: mention.chapterTitle,
    chapterOrder: mention.chapterOrder,
    baseRelationLabel: mention.baseRelationLabel,
    baseRelationSummary: mention.baseRelationSummary,
    plotRelationLabel: mention.plotRelationLabel,
    plotRelationSummary: mention.plotRelationSummary,
    primaryDimensionName: mention.primaryDimensionName,
    relationshipDimensions: mention.relationshipDimensions,
    semanticMarkers: mention.semanticMarkers,
    direction: mention.direction,
    polarity: mention.polarity,
    intensity: mention.intensity,
    changeSummary: mention.changeSummary,
    startState: mention.startState,
    endState: mention.endState,
    reason: mention.reason,
    evidenceQuote: mention.evidenceQuote,
    confidence: mention.confidence,
    uncertainty: mention.uncertainty
  };
}

function chooseCurrentMention(mentions: readonly RelationshipMentionRecord[]): RelationshipMentionRecord {
  const confident = [...mentions].reverse().find((mention) => mention.confidence >= 0.5);
  return confident ?? mentions[mentions.length - 1];
}

function uniqueDimensions(dimensions: readonly RelationshipDimension[]): RelationshipDimension[] {
  const byName = new Map<string, RelationshipDimension>();
  for (const dimension of dimensions) {
    const existing = byName.get(dimension.name);
    if (!existing || dimension.confidence >= existing.confidence) {
      byName.set(dimension.name, dimension);
    }
  }
  return [...byName.values()];
}

function mergeMarkers(markers: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const marker of markers) {
    if (seen.has(marker)) {
      continue;
    }
    seen.add(marker);
    result.push(marker);
  }
  return result;
}

function relationEndpoint(input: {
  readonly mention: RelationshipMentionRecord;
  readonly entityById: ReadonlyMap<string, RelationshipEntityRecord>;
  readonly side: "source" | "target";
}): { readonly id: string; readonly name: string } {
  const entityId = input.side === "source" ? input.mention.sourceEntityId : input.mention.targetEntityId;
  const name = input.side === "source" ? input.mention.sourceName : input.mention.targetName;
  if (entityId) {
    const entity = input.entityById.get(entityId);
    if (entity) {
      return { id: entity.id, name: entity.canonicalName };
    }
  }
  return { id: graphNodeIdForName(name), name };
}

function edgeEndpoints(
  mention: RelationshipMentionRecord,
  entityById: ReadonlyMap<string, RelationshipEntityRecord>
): { readonly sourceId: string; readonly targetId: string; readonly sourceName: string; readonly targetName: string; readonly direction: RelationshipMentionDirection } {
  const source = relationEndpoint({ mention, entityById, side: "source" });
  const target = relationEndpoint({ mention, entityById, side: "target" });
  if (mention.direction === "undirected" || mention.direction === "unclear") {
    const ordered = [source, target].sort((a, b) => a.id.localeCompare(b.id));
    return {
      sourceId: ordered[0].id,
      targetId: ordered[1].id,
      sourceName: ordered[0].name,
      targetName: ordered[1].name,
      direction: mention.direction
    };
  }
  if (mention.direction === "target_to_source") {
    return {
      sourceId: target.id,
      targetId: source.id,
      sourceName: target.name,
      targetName: source.name,
      direction: mention.direction
    };
  }
  return {
    sourceId: source.id,
    targetId: target.id,
    sourceName: source.name,
    targetName: target.name,
    direction: mention.direction
  };
}

function edgeKey(input: ReturnType<typeof edgeEndpoints>): string {
  return `${input.direction}:${input.sourceId}->${input.targetId}`;
}

function mentionMatchesQuery(mention: RelationshipMentionRecord, query: string): boolean {
  const haystack = [
    mention.sourceName,
    mention.targetName,
    mention.baseRelationLabel,
    mention.plotRelationLabel,
    mention.primaryDimensionName,
    ...mention.semanticMarkers,
    ...mention.relationshipDimensions.map((dimension) => `${dimension.name} ${dimension.description}`)
  ]
    .join("\n")
    .toLocaleLowerCase("zh-CN");
  return haystack.includes(query.toLocaleLowerCase("zh-CN"));
}

export class RelationshipGraphAggregator {
  constructor(private readonly relationshipRepo: RelationshipIndexRepository) {}

  getGraph(input: RelationshipGraphGetInput, generatedAt = new Date().toISOString()): RelationshipGraphResult {
    const roleScope = input.roleScope ?? "main";
    const mode = input.mode ?? (input.focusEntityId || input.focusName ? "focus" : "global");
    const allMentions = this.relationshipRepo.listMentions(input.projectId);
    const availableChapters = this.relationshipRepo.listChapterIndexStates(input.projectId).map((chapter) => ({
      chapterId: chapter.chapterId,
      chapterTitle: chapter.chapterTitle,
      chapterOrder: chapter.chapterOrder,
      status: chapter.status,
      indexedAt: chapter.indexedAt
    }));
    const resolvedChapterCursor = this.resolveChapterCursor(input, allMentions);
    const rangeFilteredMentions = allMentions.filter((mention) => this.isMentionInRange(mention, input, resolvedChapterCursor));
    const filteredMentions = rangeFilteredMentions.filter((mention) => this.isMentionVisibleByQueryAndConfidence(mention, input));
    const entityById = new Map(this.relationshipRepo.listEntities(input.projectId).map((entity) => [entity.id, entity]));
    const nodeAccumulators = this.buildNodeAccumulators(entityById, filteredMentions);
    const edgeGroups = this.groupEdges(filteredMentions, entityById);
    const roleNodeIds = this.resolveRoleScopeNodeIds(roleScope, nodeAccumulators, edgeGroups);
    const focusNodeIds = this.resolveFocusNodeIds(input, mode, roleNodeIds, nodeAccumulators, edgeGroups);
    const scopedNodeIds = focusNodeIds ?? roleNodeIds;
    const scopedEdgeGroups = edgeGroups.filter((edge) => scopedNodeIds.has(edge.sourceId) && scopedNodeIds.has(edge.targetId));
    const scoredNodes = [...scopedNodeIds]
      .map((id) => nodeAccumulators.get(id))
      .filter((node): node is NodeAccumulator => Boolean(node))
      .map((node) => this.toGraphNode(node, allMentions))
      .sort(compareByOrderThenName);
    const cap = mode === "focus" ? FOCUS_NODE_CAP : DEFAULT_NODE_CAP;
    const truncated = scoredNodes.length > cap;
    const nodes = scoredNodes.slice(0, cap);
    const keptNodeIds = new Set(nodes.map((node) => node.id));
    const edges = scopedEdgeGroups
      .filter((edge) => keptNodeIds.has(edge.sourceId) && keptNodeIds.has(edge.targetId))
      .map((edge) => this.toGraphEdge(edge))
      .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
    const usedMentions = scopedEdgeGroups
      .filter((edge) => keptNodeIds.has(edge.sourceId) && keptNodeIds.has(edge.targetId))
      .flatMap((edge) => edge.mentions);

    return {
      projectId: input.projectId,
      mode,
      roleScope,
      chapterCursor: input.chapterCursor ?? "latest",
      resolvedChapterCursor,
      nodes,
      edges,
      availableChapters,
      relationshipDimensions: this.aggregateDimensions(usedMentions),
      indexStatus: this.relationshipRepo.getIndexStatus(input.projectId),
      graphStats: {
        totalMentionCount: allMentions.length,
        usedMentionCount: usedMentions.length,
        hiddenMentionCount: Math.max(0, allMentions.length - usedMentions.length),
        visibleChapterCount: new Set(usedMentions.map((mention) => mention.chapterId)).size
      },
      truncated,
      generatedAt
    };
  }

  private resolveChapterCursor(input: RelationshipGraphGetInput, mentions: readonly RelationshipMentionRecord[]): number | null {
    if (input.chapterCursor === "all") {
      return null;
    }
    if (typeof input.chapterCursor === "number") {
      return input.chapterCursor;
    }
    const inRange = mentions.filter(
      (mention) =>
        (!input.chapterFrom || mention.chapterOrder >= input.chapterFrom) &&
        (!input.chapterTo || mention.chapterOrder <= input.chapterTo)
    );
    if (inRange.length === 0) {
      return null;
    }
    return Math.max(...inRange.map((mention) => mention.chapterOrder));
  }

  private isMentionInRange(mention: RelationshipMentionRecord, input: RelationshipGraphGetInput, resolvedCursor: number | null): boolean {
    if (input.chapterFrom && mention.chapterOrder < input.chapterFrom) {
      return false;
    }
    if (input.chapterTo && mention.chapterOrder > input.chapterTo) {
      return false;
    }
    if (resolvedCursor !== null && mention.chapterOrder > resolvedCursor) {
      return false;
    }
    return true;
  }

  private isMentionVisibleByQueryAndConfidence(mention: RelationshipMentionRecord, input: RelationshipGraphGetInput): boolean {
    if (!input.includeUncertain && mention.uncertainty) {
      return false;
    }
    if (input.minConfidence !== undefined && mention.confidence < input.minConfidence) {
      return false;
    }
    const query = input.query?.trim();
    if (query && !mentionMatchesQuery(mention, query)) {
      return false;
    }
    return true;
  }

  private buildNodeAccumulators(
    entityById: ReadonlyMap<string, RelationshipEntityRecord>,
    mentions: readonly RelationshipMentionRecord[]
  ): Map<string, NodeAccumulator> {
    const nodes = new Map<string, NodeAccumulator>();
    const ensureNode = (id: string, name: string, entity: RelationshipEntityRecord | undefined): NodeAccumulator => {
      const existing = nodes.get(id);
      if (existing) {
        return existing;
      }
      const node: NodeAccumulator = {
        id,
        name,
        aliases: entity?.aliases ?? [],
        entityKind: entity?.entityKind ?? "unknown",
        importance: entity?.importance ?? "unknown",
        roleSummary: entity?.roleSummary ?? null,
        faction: entity?.faction ?? null,
        chapterIds: new Set<string>(),
        relationIds: new Set<string>(),
        firstChapterOrder: entity?.firstChapterOrder ?? null,
        latestChapterOrder: entity?.latestChapterOrder ?? null,
        evidenceCount: 0,
        confidenceSum: 0,
        intensitySum: 0
      };
      nodes.set(id, node);
      return node;
    };

    for (const mention of mentions) {
      const endpoints = edgeEndpoints(mention, entityById);
      const sourceEntity = entityById.get(endpoints.sourceId);
      const targetEntity = entityById.get(endpoints.targetId);
      const source = ensureNode(endpoints.sourceId, endpoints.sourceName, sourceEntity);
      const target = ensureNode(endpoints.targetId, endpoints.targetName, targetEntity);
      for (const node of [source, target]) {
        node.chapterIds.add(mention.chapterId);
        node.evidenceCount += 1;
        node.confidenceSum += mention.confidence;
        node.intensitySum += mention.intensity;
        node.firstChapterOrder = node.firstChapterOrder === null ? mention.chapterOrder : Math.min(node.firstChapterOrder, mention.chapterOrder);
        node.latestChapterOrder = node.latestChapterOrder === null ? mention.chapterOrder : Math.max(node.latestChapterOrder, mention.chapterOrder);
      }
      source.relationIds.add(target.id);
      target.relationIds.add(source.id);
    }

    return nodes;
  }

  private groupEdges(mentions: readonly RelationshipMentionRecord[], entityById: ReadonlyMap<string, RelationshipEntityRecord>): EdgeGroup[] {
    const groups = new Map<string, EdgeGroup>();
    for (const mention of mentions) {
      const endpoints = edgeEndpoints(mention, entityById);
      const key = edgeKey(endpoints);
      const group = groups.get(key);
      if (group) {
        group.mentions.push(mention);
        continue;
      }
      groups.set(key, {
        id: key,
        sourceId: endpoints.sourceId,
        targetId: endpoints.targetId,
        sourceName: endpoints.sourceName,
        targetName: endpoints.targetName,
        direction: endpoints.direction,
        mentions: [mention]
      });
    }
    return [...groups.values()].map((group) => ({
      ...group,
      mentions: group.mentions.sort((a, b) => a.chapterOrder - b.chapterOrder)
    }));
  }

  private resolveRoleScopeNodeIds(
    roleScope: RelationshipGraphGetInput["roleScope"] | undefined,
    nodes: ReadonlyMap<string, NodeAccumulator>,
    edges: readonly EdgeGroup[]
  ): Set<string> {
    if (roleScope === "all") {
      return new Set(nodes.keys());
    }
    if (roleScope === "supporting") {
      return new Set([...nodes.values()].filter((node) => isSupportingOrAbove(node.importance)).map((node) => node.id));
    }

    const mainIds = new Set([...nodes.values()].filter((node) => isMain(node.importance)).map((node) => node.id));
    const result = new Set(mainIds);
    for (const edge of edges) {
      const touchesMain = mainIds.has(edge.sourceId) || mainIds.has(edge.targetId);
      if (!touchesMain) {
        continue;
      }
      const strong = edge.mentions.some((mention) => mention.confidence >= STRONG_SUPPORT_THRESHOLD || mention.intensity >= STRONG_SUPPORT_THRESHOLD);
      if (!strong) {
        continue;
      }
      result.add(edge.sourceId);
      result.add(edge.targetId);
    }
    return result;
  }

  private resolveFocusNodeIds(
    input: RelationshipGraphGetInput,
    mode: "global" | "focus",
    scopedIds: ReadonlySet<string>,
    nodes: ReadonlyMap<string, NodeAccumulator>,
    edges: readonly EdgeGroup[]
  ): Set<string> | null {
    if (mode !== "focus") {
      return null;
    }
    const focusId = this.findFocusId(input, nodes);
    if (!focusId) {
      return new Set();
    }
    const maxDepth = input.hopDepth ?? 1;
    const adjacency = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!scopedIds.has(edge.sourceId) || !scopedIds.has(edge.targetId)) {
        continue;
      }
      if (!adjacency.has(edge.sourceId)) {
        adjacency.set(edge.sourceId, new Set());
      }
      if (!adjacency.has(edge.targetId)) {
        adjacency.set(edge.targetId, new Set());
      }
      adjacency.get(edge.sourceId)!.add(edge.targetId);
      adjacency.get(edge.targetId)!.add(edge.sourceId);
    }

    const visited = new Set<string>([focusId]);
    let frontier = new Set<string>([focusId]);
    for (let depth = 0; depth < maxDepth; depth += 1) {
      const next = new Set<string>();
      for (const id of frontier) {
        for (const neighbor of adjacency.get(id) ?? []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            next.add(neighbor);
          }
        }
      }
      frontier = next;
    }
    return visited;
  }

  private findFocusId(input: RelationshipGraphGetInput, nodes: ReadonlyMap<string, NodeAccumulator>): string | null {
    if (input.focusEntityId && nodes.has(input.focusEntityId)) {
      return input.focusEntityId;
    }
    const name = input.focusName?.trim();
    if (!name) {
      return null;
    }
    const key = relationshipEntityKey(name);
    for (const node of nodes.values()) {
      if (relationshipEntityKey(node.name) === key || node.aliases.some((alias) => relationshipEntityKey(alias) === key)) {
        return node.id;
      }
    }
    return null;
  }

  private toGraphNode(node: NodeAccumulator, allMentions: readonly RelationshipMentionRecord[]): RelationshipGraphNode {
    const averageConfidence = node.evidenceCount === 0 ? 0 : node.confidenceSum / node.evidenceCount;
    const averageIntensity = node.evidenceCount === 0 ? 0 : node.intensitySum / node.evidenceCount;
    const maxChapterOrder = Math.max(1, ...allMentions.map((mention) => mention.chapterOrder));
    const recencyBonus = node.latestChapterOrder === null ? 0 : node.latestChapterOrder / maxChapterOrder;
    return {
      id: node.id,
      name: node.name,
      aliases: node.aliases,
      entityKind: node.entityKind,
      importance: node.importance,
      roleSummary: node.roleSummary,
      faction: node.faction,
      chapterIds: [...node.chapterIds],
      firstChapterOrder: node.firstChapterOrder,
      latestChapterOrder: node.latestChapterOrder,
      evidenceCount: node.evidenceCount,
      relationCount: node.relationIds.size,
      averageConfidence: roundMetric(averageConfidence),
      averageIntensity: roundMetric(averageIntensity),
      score: roundMetric(node.evidenceCount * 2 + node.relationIds.size * 3 + averageConfidence * 5 + averageIntensity * 4 + recencyBonus)
    };
  }

  private toGraphEdge(edge: EdgeGroup): RelationshipGraphEdge {
    const current = chooseCurrentMention(edge.mentions);
    const timeline = edge.mentions.map(stageFromMention);
    const confidence = edge.mentions.reduce((sum, mention) => sum + mention.confidence, 0) / edge.mentions.length;
    const intensity = edge.mentions.reduce((sum, mention) => sum + mention.intensity, 0) / edge.mentions.length;
    return {
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      sourceName: edge.sourceName,
      targetName: edge.targetName,
      baseRelationLabel: current.baseRelationLabel,
      baseRelationSummary: current.baseRelationSummary,
      plotRelationLabel: current.plotRelationLabel,
      plotRelationSummary: current.plotRelationSummary,
      primaryDimensionName: current.primaryDimensionName,
      relationshipDimensions: uniqueDimensions(current.relationshipDimensions),
      semanticMarkers: mergeMarkers(current.semanticMarkers),
      direction: current.direction,
      polarity: current.polarity,
      intensity: roundMetric(intensity),
      confidence: roundMetric(confidence),
      weight: roundMetric(edge.mentions.length * (0.5 + confidence) * (0.5 + intensity)),
      evidenceCount: edge.mentions.length,
      chapterIds: [...new Set(edge.mentions.map((mention) => mention.chapterId))],
      firstChapterOrder: edge.mentions[0].chapterOrder,
      latestChapterOrder: edge.mentions[edge.mentions.length - 1].chapterOrder,
      timeline
    };
  }

  private aggregateDimensions(mentions: readonly RelationshipMentionRecord[]): RelationshipGraphDimensionSummary[] {
    const byName = new Map<
      string,
      {
        description: string;
        mentionCount: number;
        confidenceSum: number;
        bestConfidence: number;
      }
    >();
    for (const mention of mentions) {
      for (const dimension of mention.relationshipDimensions) {
        const existing = byName.get(dimension.name);
        if (!existing) {
          byName.set(dimension.name, {
            description: dimension.description,
            mentionCount: 1,
            confidenceSum: dimension.confidence,
            bestConfidence: dimension.confidence
          });
          continue;
        }
        existing.mentionCount += 1;
        existing.confidenceSum += dimension.confidence;
        if (dimension.confidence >= existing.bestConfidence) {
          existing.description = dimension.description;
          existing.bestConfidence = dimension.confidence;
        }
      }
    }
    return [...byName.entries()]
      .map(([name, value]) => ({
        name,
        description: value.description,
        mentionCount: value.mentionCount,
        averageConfidence: roundMetric(value.confidenceSum / value.mentionCount)
      }))
      .sort((a, b) => b.mentionCount - a.mentionCount || a.name.localeCompare(b.name, "zh-CN"));
  }
}
