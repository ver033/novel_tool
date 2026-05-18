import type {
  AuthorRelationshipCharacterRecord,
  AuthorRelationshipRecord,
  AuthorRelationshipRepository
} from "../db/repositories/author-relationship-repo";
import type {
  RelationshipDimension,
  RelationshipGraphDimensionSummary,
  RelationshipGraphEdge,
  RelationshipGraphGetInput,
  RelationshipGraphNode,
  RelationshipGraphResult,
  RelationshipGraphSourceStatus
} from "../shared/relationship-graph";

const AUTHOR_DIMENSION: RelationshipDimension = {
  name: "作者关系",
  description: "作者手动录入的固定人物关系",
  confidence: 1
};

function roundMetric(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1000) / 1000;
}

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function sourceStatusFromAuthorData(
  characters: readonly AuthorRelationshipCharacterRecord[],
  relationships: readonly AuthorRelationshipRecord[]
): RelationshipGraphSourceStatus {
  const hasData = characters.length > 0 || relationships.length > 0;
  const edgeCount = relationships.reduce((total, relationship) => total + authorRelationshipEdgeCount(relationship), 0);
  return {
    state: hasData ? "ready" : "empty",
    nodeCount: characters.length,
    edgeCount,
    chapterRange: null,
    arcSummary: {
      total: 0,
      readyForGraph: 0,
      missingGraphFields: 0,
      failed: 0,
      blocked: 0
    },
    bookSummary: {
      exists: false,
      hasRelationshipGraph: false,
      failed: false
    },
    message: hasData
      ? `作者手工人物关系已就绪：${characters.length} 个人物，${edgeCount} 条关系。`
      : "作者还没有录入人物关系。",
    latestFailure: null
  };
}

function authorRelationshipEdgeCount(relationship: Pick<AuthorRelationshipRecord, "targetToSourceLabel">): number {
  return normalizeText(relationship.targetToSourceLabel) ? 2 : 1;
}

function authorRelationshipGraphEdgeCount(relationships: readonly AuthorRelationshipRecord[]): number {
  return relationships.reduce((total, relationship) => total + authorRelationshipEdgeCount(relationship), 0);
}

function relationshipMatchesQuery(
  relationship: AuthorRelationshipRecord,
  charactersById: ReadonlyMap<string, AuthorRelationshipCharacterRecord>,
  query: string
): boolean {
  if (!query) {
    return true;
  }
  const source = charactersById.get(relationship.sourceCharacterId);
  const target = charactersById.get(relationship.targetCharacterId);
  const haystack = [
    source?.name,
    target?.name,
    ...(source?.aliases ?? []),
    ...(target?.aliases ?? []),
    relationship.sourceToTargetLabel,
    relationship.targetToSourceLabel
  ]
    .filter(Boolean)
    .join("\n")
    .toLocaleLowerCase("zh-CN");
  return haystack.includes(query.toLocaleLowerCase("zh-CN"));
}

function characterMatchesQuery(character: AuthorRelationshipCharacterRecord, query: string): boolean {
  if (!query) {
    return true;
  }
  const haystack = [character.name, ...character.aliases].join("\n").toLocaleLowerCase("zh-CN");
  return haystack.includes(query.toLocaleLowerCase("zh-CN"));
}

export class AuthorRelationshipGraphService {
  constructor(private readonly repo: AuthorRelationshipRepository) {}

  getGraph(input: RelationshipGraphGetInput, generatedAt = new Date().toISOString()): RelationshipGraphResult {
    const characters = this.repo.listCharacters(input.projectId);
    const relationships = this.repo.listRelationships(input.projectId);
    const charactersById = new Map(characters.map((character) => [character.id, character]));
    const query = normalizeText(input.query);
    const queryRelationships = relationships.filter((relationship) => relationshipMatchesQuery(relationship, charactersById, query));
    const relationCounts = this.relationCounts(queryRelationships);
    const initialNodeIds = new Set(
      characters
        .filter((character) => characterMatchesQuery(character, query) || relationCounts.has(character.id))
        .map((character) => character.id)
    );
    const mode = input.mode ?? (input.focusEntityId || input.focusName ? "focus" : "global");
    const scopedNodeIds = mode === "focus" ? this.focusNodeIds(input, initialNodeIds, queryRelationships, characters) : initialNodeIds;
    const edges = queryRelationships
      .filter((relationship) => scopedNodeIds.has(relationship.sourceCharacterId) && scopedNodeIds.has(relationship.targetCharacterId))
      .flatMap((relationship) => this.toGraphEdges(relationship, charactersById))
      .filter((edge): edge is RelationshipGraphEdge => Boolean(edge))
      .sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id));
    const visibleRelationCounts = this.relationCounts(edges.map((edge) => this.relationshipFromEdge(edge)));
    const nodes = characters
      .filter((character) => scopedNodeIds.has(character.id))
      .map((character) => this.toGraphNode(character, visibleRelationCounts.get(character.id) ?? 0))
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "zh-CN"));

    return {
      projectId: input.projectId,
      mode,
      roleScope: "all",
      chapterCursor: input.chapterCursor ?? "all",
      resolvedChapterCursor: null,
      nodes,
      edges,
      availableChapters: [],
      relationshipDimensions: this.dimensionSummary(edges),
      sourceStatus: sourceStatusFromAuthorData(characters, relationships),
      graphStats: {
        totalMentionCount: authorRelationshipGraphEdgeCount(relationships),
        usedMentionCount: edges.length,
        hiddenMentionCount: Math.max(0, authorRelationshipGraphEdgeCount(relationships) - edges.length),
        visibleChapterCount: 0
      },
      truncated: false,
      generatedAt
    };
  }

  private relationCounts(relationships: readonly Pick<AuthorRelationshipRecord, "sourceCharacterId" | "targetCharacterId">[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const relationship of relationships) {
      counts.set(relationship.sourceCharacterId, (counts.get(relationship.sourceCharacterId) ?? 0) + 1);
      counts.set(relationship.targetCharacterId, (counts.get(relationship.targetCharacterId) ?? 0) + 1);
    }
    return counts;
  }

  private focusNodeIds(
    input: RelationshipGraphGetInput,
    candidateNodeIds: ReadonlySet<string>,
    relationships: readonly AuthorRelationshipRecord[],
    characters: readonly AuthorRelationshipCharacterRecord[]
  ): Set<string> {
    const focusId = this.findFocusId(input, characters);
    if (!focusId || !candidateNodeIds.has(focusId)) {
      return new Set();
    }
    const adjacency = new Map<string, Set<string>>();
    for (const relationship of relationships) {
      if (!candidateNodeIds.has(relationship.sourceCharacterId) || !candidateNodeIds.has(relationship.targetCharacterId)) {
        continue;
      }
      if (!adjacency.has(relationship.sourceCharacterId)) {
        adjacency.set(relationship.sourceCharacterId, new Set());
      }
      if (!adjacency.has(relationship.targetCharacterId)) {
        adjacency.set(relationship.targetCharacterId, new Set());
      }
      adjacency.get(relationship.sourceCharacterId)!.add(relationship.targetCharacterId);
      adjacency.get(relationship.targetCharacterId)!.add(relationship.sourceCharacterId);
    }
    const visited = new Set<string>([focusId]);
    let frontier = new Set<string>([focusId]);
    for (let depth = 0; depth < (input.hopDepth ?? 1); depth += 1) {
      const next = new Set<string>();
      for (const nodeId of frontier) {
        for (const neighborId of adjacency.get(nodeId) ?? []) {
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            next.add(neighborId);
          }
        }
      }
      frontier = next;
    }
    return visited;
  }

  private findFocusId(input: RelationshipGraphGetInput, characters: readonly AuthorRelationshipCharacterRecord[]): string | null {
    if (input.focusEntityId && characters.some((character) => character.id === input.focusEntityId)) {
      return input.focusEntityId;
    }
    const focusName = normalizeText(input.focusName);
    if (!focusName) {
      return null;
    }
    const normalizedFocusName = focusName.toLocaleLowerCase("zh-CN");
    const matched = characters.find(
      (character) =>
        character.name.toLocaleLowerCase("zh-CN") === normalizedFocusName ||
        character.aliases.some((alias) => alias.toLocaleLowerCase("zh-CN") === normalizedFocusName)
    );
    return matched?.id ?? null;
  }

  private toGraphNode(character: AuthorRelationshipCharacterRecord, relationCount: number): RelationshipGraphNode {
    return {
      id: character.id,
      name: character.name,
      aliases: character.aliases,
      entityKind: character.entityKind,
      importance: character.importance,
      roleSummary: character.roleSummary,
      faction: character.faction,
      authorNotes: character.notes,
      chapterIds: [],
      firstChapterOrder: null,
      latestChapterOrder: null,
      evidenceCount: relationCount,
      relationCount,
      averageConfidence: 1,
      averageIntensity: relationCount > 0 ? 0.55 : 0,
      score: roundMetric(1 + relationCount * 8),
      layoutPosition: character.layoutPosition
    };
  }

  private toGraphEdges(
    relationship: AuthorRelationshipRecord,
    charactersById: ReadonlyMap<string, AuthorRelationshipCharacterRecord>
  ): RelationshipGraphEdge[] {
    const source = charactersById.get(relationship.sourceCharacterId);
    const target = charactersById.get(relationship.targetCharacterId);
    if (!source || !target) {
      return [];
    }
    const sourceToTargetLabel = normalizeText(relationship.sourceToTargetLabel);
    const targetToSourceLabel = normalizeText(relationship.targetToSourceLabel) || null;
    const edges = [
      this.toDirectedGraphEdge({
        relationship,
        sourceId: relationship.sourceCharacterId,
        targetId: relationship.targetCharacterId,
        sourceName: source.name,
        targetName: target.name,
        label: sourceToTargetLabel,
        directionKey: "source_to_target"
      })
    ];
    if (targetToSourceLabel) {
      edges.push(
        this.toDirectedGraphEdge({
          relationship,
          sourceId: relationship.targetCharacterId,
          targetId: relationship.sourceCharacterId,
          sourceName: target.name,
          targetName: source.name,
          label: targetToSourceLabel,
          directionKey: "target_to_source"
        })
      );
    }
    return edges;
  }

  private toDirectedGraphEdge(input: {
    readonly relationship: AuthorRelationshipRecord;
    readonly sourceId: string;
    readonly targetId: string;
    readonly sourceName: string;
    readonly targetName: string;
    readonly label: string;
    readonly directionKey: "source_to_target" | "target_to_source";
  }): RelationshipGraphEdge {
    const summary = `${input.sourceName} → ${input.targetName}：${input.label}`;
    const semanticMarkers = [AUTHOR_DIMENSION.name, input.label].filter((value): value is string => Boolean(value));
    return {
      id: `author_relationship:${input.relationship.id}:${input.directionKey}`,
      authorRelationshipId: input.relationship.id,
      sourceId: input.sourceId,
      targetId: input.targetId,
      sourceName: input.sourceName,
      targetName: input.targetName,
      baseRelationLabel: input.label,
      baseRelationSourceToTargetLabel: input.label,
      baseRelationTargetToSourceLabel: null,
      baseRelationSummary: summary,
      plotRelationLabel: "",
      plotRelationSummary: summary,
      primaryDimensionName: AUTHOR_DIMENSION.name,
      relationshipDimensions: [AUTHOR_DIMENSION],
      semanticMarkers,
      direction: "source_to_target",
      polarity: "unknown",
      intensity: 0.55,
      confidence: 1,
      weight: 1,
      evidenceCount: 1,
      evidenceSources: ["author_manual"],
      chapterIds: [],
      firstChapterOrder: 1,
      latestChapterOrder: 1,
      timeline: [
        {
          chapterId: `author:manual:${input.relationship.id}:${input.directionKey}`,
          chapterTitle: "作者手工关系",
          chapterOrder: 1,
          baseRelationLabel: input.label,
          baseRelationSourceToTargetLabel: input.label,
          baseRelationTargetToSourceLabel: null,
          baseRelationSummary: summary,
          plotRelationLabel: "",
          plotRelationSummary: summary,
          primaryDimensionName: AUTHOR_DIMENSION.name,
          relationshipDimensions: [AUTHOR_DIMENSION],
          semanticMarkers,
          direction: "source_to_target",
          polarity: "unknown",
          intensity: 0.55,
          changeSummary: summary,
          startState: null,
          endState: null,
          reason: null,
          evidenceQuote: "作者手动录入",
          evidenceSource: "author_manual",
          confidence: 1,
          uncertainty: null
        }
      ]
    };
  }

  private relationshipFromEdge(edge: RelationshipGraphEdge): Pick<AuthorRelationshipRecord, "sourceCharacterId" | "targetCharacterId"> {
    return {
      sourceCharacterId: edge.sourceId,
      targetCharacterId: edge.targetId
    };
  }

  private dimensionSummary(edges: readonly RelationshipGraphEdge[]): readonly RelationshipGraphDimensionSummary[] {
    if (edges.length === 0) {
      return [];
    }
    return [
      {
        name: AUTHOR_DIMENSION.name,
        description: AUTHOR_DIMENSION.description,
        mentionCount: edges.length,
        averageConfidence: 1
      }
    ];
  }
}
