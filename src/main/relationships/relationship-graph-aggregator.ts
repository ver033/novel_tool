import type { ChapterSummary } from "../shared/types";
import type { ChapterRepository } from "../db/repositories/chapter-repo";
import type { ArcAiSummaryRecord, BookAiSummaryRecord, SummaryJobRecord, SummaryRepository } from "../db/repositories/summary-repo";
import type {
  RelationshipDimension,
  RelationshipEntityImportance,
  RelationshipEvidenceSource,
  RelationshipGraphDimensionSummary,
  RelationshipGraphEdge,
  RelationshipGraphEdgeStage,
  RelationshipGraphGetInput,
  RelationshipGraphNode,
  RelationshipGraphResult,
  RelationshipGraphSourceStatus,
  RelationshipMentionDirection,
  RelationshipMentionPolarity
} from "../shared/relationship-graph";

const DEFAULT_NODE_CAP = 120;
const FOCUS_NODE_CAP = 80;

type BookRelationshipGraph = NonNullable<BookAiSummaryRecord["structured"]["人物关系图谱"]>;
type BookGraphCharacter = BookRelationshipGraph["人物"][number];
type BookGraphRelation = BookRelationshipGraph["关系"][number];
type BookGraphRelationLabel = BookGraphRelation["labels"][number];
type BookGraphRelationEvidence = BookGraphRelation["evidence"][number];

type SourceSnapshot = {
  readonly chapters: readonly ChapterSummary[];
  readonly arcs: readonly ArcAiSummaryRecord[];
  readonly book: BookAiSummaryRecord | null;
  readonly jobs: readonly SummaryJobRecord[];
};

type GraphBuildContext = {
  readonly graph: BookRelationshipGraph;
  readonly chaptersByOrder: ReadonlyMap<number, ChapterSummary>;
};

type NodeAccumulator = RelationshipGraphNode & {
  readonly relationIds: Set<string>;
};

type EdgeWithScore = RelationshipGraphEdge & {
  readonly score: number;
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

function uniqueText(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = normalizeText(value);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
  }
  return result;
}

function importanceFromSummary(value: BookGraphCharacter["importance"]): RelationshipEntityImportance {
  if (value === "major") {
    return "main";
  }
  if (value === "supporting") {
    return "supporting";
  }
  if (value === "minor") {
    return "minor";
  }
  return "unknown";
}

function polarityFromSummary(value: BookGraphRelation["polarity"]): RelationshipMentionPolarity {
  if (value === "positive" || value === "negative" || value === "mixed" || value === "neutral") {
    return value;
  }
  return "unknown";
}

function directionFromSummary(relation: BookGraphRelation): RelationshipMentionDirection {
  return relation.directed ? "source_to_target" : "undirected";
}

function categoryDimensionName(category: BookGraphRelation["category"]): string {
  return category;
}

function categoryDescription(category: BookGraphRelation["category"]): string {
  if (category === "基础关系") {
    return "亲缘、身份、师承、职务等相对稳定的基础关系";
  }
  if (category === "剧情关系") {
    return "随情节推进变化的合作、冲突、隐瞒、交易等关系";
  }
  if (category === "阵营关系") {
    return "阵营、组织、权力结构与归属关系";
  }
  if (category === "情感关系") {
    return "情感、亲密度、信任与疏离关系";
  }
  if (category === "冲突关系") {
    return "敌对、竞争、威胁与利益冲突关系";
  }
  if (category === "社会关系") {
    return "同学、邻里、同事、村社等社会身份关系";
  }
  return "未归入固定类别的关系";
}

function chapterNumberFromSummary(chapter: ChapterSummary): number {
  return chapter.sortOrder + 1;
}

function relationDimensions(relation: BookGraphRelation): RelationshipDimension[] {
  return [
    {
      name: categoryDimensionName(relation.category),
      description: categoryDescription(relation.category),
      confidence: Math.max(0.1, Math.min(1, relation.labels[0]?.confidence ?? 0.6))
    }
  ];
}

function isBasicRelation(relation: BookGraphRelation): boolean {
  return relation.stable || relation.category === "基础关系" || relation.category === "社会关系";
}

function chooseCurrentLabel(relation: BookGraphRelation): BookGraphRelationLabel | null {
  const labels = [...relation.labels].sort((a, b) => a.lastSeenChapter - b.lastSeenChapter);
  return labels[labels.length - 1] ?? null;
}

function relationConfidence(relation: BookGraphRelation): number {
  const labelConfidence = relation.labels.length
    ? relation.labels.reduce((sum, label) => sum + label.confidence, 0) / relation.labels.length
    : 0.6;
  return Math.max(0, Math.min(1, roundMetric(labelConfidence)));
}

function relationIntensity(relation: BookGraphRelation): number {
  const evidenceBonus = Math.min(0.25, relation.evidence.length * 0.04);
  const categoryBase = relation.category === "冲突关系" || relation.category === "情感关系" ? 0.68 : relation.stable ? 0.48 : 0.58;
  return roundMetric(Math.min(1, categoryBase + evidenceBonus));
}

function stageFromEvidence(
  relation: BookGraphRelation,
  evidence: BookGraphRelationEvidence,
  label: BookGraphRelationLabel | null,
  chaptersByOrder: ReadonlyMap<number, ChapterSummary>
): RelationshipGraphEdgeStage {
  const chapter = chaptersByOrder.get(evidence.chapterNumber);
  const currentLabel = label?.label ?? relation.primaryLabel;
  const basic = isBasicRelation(relation);
  const dimensions = relationDimensions(relation);
  return {
    chapterId: chapter?.id ?? `chapter:${evidence.chapterNumber}`,
    chapterTitle: chapter?.title ?? `第${evidence.chapterNumber}章`,
    chapterOrder: evidence.chapterNumber,
    baseRelationLabel: basic ? relation.primaryLabel : "",
    baseRelationSummary: basic ? evidence.reason || relation.primaryLabel : null,
    plotRelationLabel: basic && currentLabel === relation.primaryLabel ? "" : currentLabel,
    plotRelationSummary: evidence.reason || evidence.text || currentLabel,
    primaryDimensionName: dimensions[0].name,
    relationshipDimensions: dimensions,
    semanticMarkers: uniqueText([relation.category, relation.primaryLabel, currentLabel]),
    direction: directionFromSummary(relation),
    polarity: polarityFromSummary(relation.polarity),
    intensity: relationIntensity(relation),
    changeSummary: evidence.reason || currentLabel,
    startState: null,
    endState: null,
    reason: evidence.reason || null,
    evidenceQuote: evidence.text,
    evidenceSource: "summary_book",
    confidence: label?.confidence ?? relationConfidence(relation),
    uncertainty: (label?.confidence ?? relationConfidence(relation)) < 0.55 ? "全书摘要置信度偏低，建议回看阶段摘要或原文确认。" : null
  };
}

function stageFromLabelOnly(
  relation: BookGraphRelation,
  label: BookGraphRelationLabel,
  chaptersByOrder: ReadonlyMap<number, ChapterSummary>
): RelationshipGraphEdgeStage {
  return stageFromEvidence(
    relation,
    {
      chapterNumber: label.lastSeenChapter,
      arcRange: `${label.firstSeenChapter}-${label.lastSeenChapter}`,
      text: label.label,
      reason: label.label
    },
    label,
    chaptersByOrder
  );
}

function jobIsCoveredByReadyArc(job: SummaryJobRecord, arcs: readonly ArcAiSummaryRecord[]): boolean {
  if (!job.targetId) {
    return false;
  }
  const arc = arcs.find((candidate) => candidate.arcKey === job.targetId);
  return Boolean(arc?.status === "ready" && (arc.sourceHash === job.sourceHash || arc.updatedAt >= job.updatedAt));
}

function jobIsCoveredByReadyBook(job: SummaryJobRecord, book: BookAiSummaryRecord | null): boolean {
  return Boolean(book?.status === "ready" && (book.sourceHash === job.sourceHash || book.updatedAt >= job.updatedAt));
}

function currentFailedSummaryJobs(snapshot: SourceSnapshot, jobType: SummaryJobRecord["jobType"]): SummaryJobRecord[] {
  return snapshot.jobs.filter((job) => {
    if (job.status !== "failed" || job.jobType !== jobType) {
      return false;
    }
    if (jobType === "arc_summary") {
      return !jobIsCoveredByReadyArc(job, snapshot.arcs);
    }
    if (jobType === "book_summary") {
      return !jobIsCoveredByReadyBook(job, snapshot.book);
    }
    return false;
  });
}

function latestFailureFromJobs(jobs: readonly SummaryJobRecord[]): string | null {
  return [...jobs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.error ?? null;
}

function sourceStatusFromSnapshot(snapshot: SourceSnapshot): RelationshipGraphSourceStatus {
  const readyArcs = snapshot.arcs.filter((arc) => arc.status === "ready");
  const graphReadyArcs = readyArcs.filter((arc) => Boolean(arc.structured.人物图谱));
  const missingGraphFields = readyArcs.length - graphReadyArcs.length;
  const failedArcJobs = currentFailedSummaryJobs(snapshot, "arc_summary");
  const failedBookJobs = currentFailedSummaryJobs(snapshot, "book_summary");
  const failedArcs = snapshot.arcs.filter((arc) => arc.status === "failed").length + failedArcJobs.length;
  const bookGraph = snapshot.book?.structured.人物关系图谱;
  const bookFailed = snapshot.book?.status === "failed" || failedBookJobs.length > 0;
  const range = bookGraph?.生成来源.chapterRange
    ? { start: bookGraph.生成来源.chapterRange.start, end: bookGraph.生成来源.chapterRange.end }
    : graphReadyArcs.length
      ? {
          start: Math.min(...graphReadyArcs.map((arc) => arc.chapterFrom)),
          end: Math.max(...graphReadyArcs.map((arc) => arc.chapterTo))
        }
      : null;
  const base = {
    nodeCount: bookGraph?.人物.length ?? 0,
    edgeCount: bookGraph?.关系.length ?? 0,
    chapterRange: range,
    arcSummary: {
      total: snapshot.arcs.length,
      readyForGraph: graphReadyArcs.length,
      missingGraphFields,
      failed: failedArcs,
      blocked: 0
    },
    bookSummary: {
      exists: Boolean(snapshot.book),
      hasRelationshipGraph: Boolean(bookGraph),
      failed: bookFailed
    },
    latestFailure:
      latestFailureFromJobs([...failedArcJobs, ...failedBookJobs]) ??
      snapshot.book?.error ??
      snapshot.arcs.find((arc) => arc.status === "failed")?.error ??
      null
  } satisfies Omit<RelationshipGraphSourceStatus, "state" | "message">;

  if (snapshot.chapters.length === 0) {
    return { ...base, state: "empty", message: "项目还没有章节，人物关系图暂无来源。" };
  }
  if (bookGraph) {
    return {
      ...base,
      state: "ready",
      message: `全书人物关系图已就绪：${bookGraph.人物.length} 个人物，${bookGraph.关系.length} 条关系。`
    };
  }
  if (bookFailed || (failedArcs > 0 && graphReadyArcs.length === 0)) {
    return { ...base, state: "failed", message: "人物关系图来源生成失败，需要在缓存设置里重试摘要任务。" };
  }
  if (readyArcs.length === 0) {
    return {
      ...base,
      state: "needs_arc_summary",
      message: "正在等待阶段摘要。阶段摘要生成后会派生人物关系图。"
    };
  }
  if (missingGraphFields > 0 && graphReadyArcs.length === 0) {
    return {
      ...base,
      state: "needs_arc_graph_fields",
      message: "已有阶段摘要缺少人物图谱字段，需要重试阶段摘要。"
    };
  }
  if (!snapshot.book) {
    return {
      ...base,
      state: "needs_book_summary",
      message: "阶段人物图谱已准备，正在等待全书摘要聚合关系图。"
    };
  }
  return {
    ...base,
    state: "needs_book_graph_fields",
    message: "全书摘要缺少人物关系图谱字段，需要重试全书摘要。"
  };
}

function resolveChapterCursor(input: RelationshipGraphGetInput, graph: BookRelationshipGraph): number | null {
  if (input.chapterCursor === "all") {
    return null;
  }
  if (typeof input.chapterCursor === "number") {
    return input.chapterCursor;
  }
  const allChapterNumbers = graph.人物.flatMap((character) => character.chapterActivity.map((activity) => activity.chapterNumber));
  if (allChapterNumbers.length === 0) {
    return graph.生成来源.chapterRange.end;
  }
  return Math.max(...allChapterNumbers);
}

function chapterMatchesRange(chapterNumber: number, input: RelationshipGraphGetInput, resolvedCursor: number | null): boolean {
  if (input.chapterFrom && chapterNumber < input.chapterFrom) {
    return false;
  }
  if (input.chapterTo && chapterNumber > input.chapterTo) {
    return false;
  }
  if (resolvedCursor !== null && chapterNumber > resolvedCursor) {
    return false;
  }
  return true;
}

function relationMatchesRange(relation: BookGraphRelation, input: RelationshipGraphGetInput, resolvedCursor: number | null): boolean {
  const chapterNumbers = [
    ...relation.labels.flatMap((label) => [label.firstSeenChapter, label.lastSeenChapter]),
    ...relation.evidence.map((evidence) => evidence.chapterNumber)
  ];
  return chapterNumbers.some((chapterNumber) => chapterMatchesRange(chapterNumber, input, resolvedCursor));
}

function characterMatchesRange(character: BookGraphCharacter, input: RelationshipGraphGetInput, resolvedCursor: number | null): boolean {
  if (character.chapterActivity.some((activity) => chapterMatchesRange(activity.chapterNumber, input, resolvedCursor))) {
    return true;
  }
  return (
    chapterMatchesRange(character.firstSeenChapter, input, resolvedCursor) ||
    chapterMatchesRange(character.lastSeenChapter, input, resolvedCursor)
  );
}

function matchesQuery(character: BookGraphCharacter, query: string): boolean {
  const haystack = [character.name, ...character.aliases, ...character.mentionForms, ...character.roleHints].join("\n").toLocaleLowerCase("zh-CN");
  return haystack.includes(query.toLocaleLowerCase("zh-CN"));
}

function relationMatchesQuery(relation: BookGraphRelation, query: string): boolean {
  const haystack = [
    relation.primaryLabel,
    relation.category,
    ...relation.labels.map((label) => label.label),
    ...relation.evidence.flatMap((evidence) => [evidence.text, evidence.reason])
  ]
    .join("\n")
    .toLocaleLowerCase("zh-CN");
  return haystack.includes(query.toLocaleLowerCase("zh-CN"));
}

function compareNodes(left: RelationshipGraphNode, right: RelationshipGraphNode): number {
  return right.score - left.score || left.name.localeCompare(right.name, "zh-CN");
}

export class SummaryRelationshipGraphAggregator {
  constructor(
    private readonly summaryRepo: SummaryRepository,
    private readonly chapterRepo: ChapterRepository
  ) {}

  getSourceStatus(projectId: string): RelationshipGraphSourceStatus {
    return sourceStatusFromSnapshot(this.getSourceSnapshot(projectId));
  }

  getGraph(input: RelationshipGraphGetInput, generatedAt = new Date().toISOString()): RelationshipGraphResult {
    const snapshot = this.getSourceSnapshot(input.projectId);
    const sourceStatus = sourceStatusFromSnapshot(snapshot);
    const bookGraph = snapshot.book?.structured.人物关系图谱;
    if (!bookGraph) {
      return this.emptyGraph(input, sourceStatus, generatedAt, snapshot.chapters);
    }

    const roleScope = input.roleScope ?? "main";
    const mode = input.mode ?? (input.focusEntityId || input.focusName ? "focus" : "global");
    const resolvedChapterCursor = resolveChapterCursor(input, bookGraph);
    const chaptersByOrder = new Map(snapshot.chapters.map((chapter) => [chapterNumberFromSummary(chapter), chapter]));
    const context = { graph: bookGraph, chaptersByOrder };
    const query = normalizeText(input.query);
    const characterById = new Map(bookGraph.人物.map((character) => [character.id, character]));
    const rangeRelations = bookGraph.关系.filter((relation) => relationMatchesRange(relation, input, resolvedChapterCursor));
    const confidenceFilteredRelations = rangeRelations.filter((relation) => {
      const confidence = relationConfidence(relation);
      if (input.minConfidence !== undefined && confidence < input.minConfidence) {
        return false;
      }
      if (!input.includeUncertain && confidence < 0.5) {
        return false;
      }
      return true;
    });
    const rangeCharacters = bookGraph.人物.filter((character) => characterMatchesRange(character, input, resolvedChapterCursor));
    const queryCharacterIds = query ? new Set(rangeCharacters.filter((character) => matchesQuery(character, query)).map((character) => character.id)) : null;
    const queryRelations = query
      ? confidenceFilteredRelations.filter(
          (relation) => relationMatchesQuery(relation, query) || queryCharacterIds?.has(relation.sourceId) || queryCharacterIds?.has(relation.targetId)
        )
      : confidenceFilteredRelations;
    const nodeAccumulators = this.buildNodes(context, rangeCharacters, queryRelations);
    const roleNodeIds = this.resolveRoleScopeNodeIds(roleScope, nodeAccumulators, queryRelations);
    const focusNodeIds = this.resolveFocusNodeIds(input, mode, roleNodeIds, nodeAccumulators, queryRelations);
    const scopedNodeIds = focusNodeIds ?? roleNodeIds;
    const scopedEdges = queryRelations
      .filter((relation) => scopedNodeIds.has(relation.sourceId) && scopedNodeIds.has(relation.targetId))
      .map((relation) => this.toGraphEdge(context, relation, characterById))
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
    const scopedNodes = [...scopedNodeIds]
      .map((id) => nodeAccumulators.get(id))
      .filter((node): node is NodeAccumulator => Boolean(node))
      .map((node) => {
        const relationIds = new Set(scopedEdges.filter((edge) => edge.sourceId === node.id || edge.targetId === node.id).map((edge) => edge.id));
        return {
          ...node,
          relationCount: relationIds.size,
          score: roundMetric(node.score + relationIds.size * 2)
        };
      })
      .sort(compareNodes);
    const cap = mode === "focus" ? FOCUS_NODE_CAP : DEFAULT_NODE_CAP;
    const truncated = scopedNodes.length > cap;
    const nodes = scopedNodes.slice(0, cap);
    const keptNodeIds = new Set(nodes.map((node) => node.id));
    const edges = scopedEdges.filter((edge) => keptNodeIds.has(edge.sourceId) && keptNodeIds.has(edge.targetId));
    const stages = edges.flatMap((edge) => edge.timeline);

    return {
      projectId: input.projectId,
      mode,
      roleScope,
      chapterCursor: input.chapterCursor ?? "all",
      resolvedChapterCursor,
      nodes,
      edges,
      availableChapters: this.availableChapters(snapshot.chapters, bookGraph),
      relationshipDimensions: this.aggregateDimensions(stages),
      sourceStatus,
      graphStats: {
        totalMentionCount: confidenceFilteredRelations.length,
        usedMentionCount: edges.reduce((sum, edge) => sum + edge.evidenceCount, 0),
        hiddenMentionCount: Math.max(0, confidenceFilteredRelations.length - edges.length),
        visibleChapterCount: new Set(stages.map((stage) => stage.chapterId)).size
      },
      truncated,
      generatedAt
    };
  }

  private getSourceSnapshot(projectId: string): SourceSnapshot {
    return {
      chapters: this.chapterRepo.listByProject(projectId),
      arcs: this.summaryRepo.listArcSummaries(projectId),
      book: this.summaryRepo.getLatestBookSummary(projectId),
      jobs: this.summaryRepo.listSummaryJobs(projectId)
    };
  }

  private emptyGraph(
    input: RelationshipGraphGetInput,
    sourceStatus: RelationshipGraphSourceStatus,
    generatedAt: string,
    chapters: readonly ChapterSummary[]
  ): RelationshipGraphResult {
    return {
      projectId: input.projectId,
      mode: input.mode ?? "global",
      roleScope: input.roleScope ?? "main",
      chapterCursor: input.chapterCursor ?? "all",
      resolvedChapterCursor: null,
      nodes: [],
      edges: [],
      availableChapters: chapters.map((chapter) => ({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterOrder: chapterNumberFromSummary(chapter),
        status: "missing",
        indexedAt: null
      })),
      relationshipDimensions: [],
      sourceStatus,
      graphStats: {
        totalMentionCount: 0,
        usedMentionCount: 0,
        hiddenMentionCount: 0,
        visibleChapterCount: 0
      },
      truncated: false,
      generatedAt
    };
  }

  private availableChapters(chapters: readonly ChapterSummary[], graph: BookRelationshipGraph): RelationshipGraphResult["availableChapters"] {
    const activeChapterNumbers = new Set<number>();
    for (const character of graph.人物) {
      for (const activity of character.chapterActivity) {
        activeChapterNumbers.add(activity.chapterNumber);
      }
    }
    for (const relation of graph.关系) {
      for (const evidence of relation.evidence) {
        activeChapterNumbers.add(evidence.chapterNumber);
      }
    }
    return chapters.map((chapter) => ({
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      chapterOrder: chapterNumberFromSummary(chapter),
      status: activeChapterNumbers.has(chapterNumberFromSummary(chapter)) ? "ready" : "missing",
      indexedAt: null
    }));
  }

  private buildNodes(
    context: GraphBuildContext,
    characters: readonly BookGraphCharacter[],
    relations: readonly BookGraphRelation[]
  ): Map<string, NodeAccumulator> {
    const relationIdsByCharacter = new Map<string, Set<string>>();
    for (const relation of relations) {
      if (!relationIdsByCharacter.has(relation.sourceId)) {
        relationIdsByCharacter.set(relation.sourceId, new Set());
      }
      if (!relationIdsByCharacter.has(relation.targetId)) {
        relationIdsByCharacter.set(relation.targetId, new Set());
      }
      relationIdsByCharacter.get(relation.sourceId)!.add(relation.id);
      relationIdsByCharacter.get(relation.targetId)!.add(relation.id);
    }

    const nodes = new Map<string, NodeAccumulator>();
    for (const character of characters) {
      const relationIds = relationIdsByCharacter.get(character.id) ?? new Set<string>();
      if (relationIds.size === 0) {
        continue;
      }
      const activityWeight = character.chapterActivity.reduce((sum, activity) => sum + activity.weight + activity.relationEventCount, 0);
      const chapterIds = character.chapterActivity
        .map((activity) => context.chaptersByOrder.get(activity.chapterNumber)?.id ?? `chapter:${activity.chapterNumber}`)
        .filter(Boolean);
      const importance = importanceFromSummary(character.importance);
      const importanceBonus = importance === "main" ? 10 : importance === "supporting" ? 5 : 0;
      nodes.set(character.id, {
        id: character.id,
        name: character.name,
        aliases: uniqueText([...character.aliases, ...character.mentionForms].filter((alias) => alias !== character.name)),
        entityKind: "person",
        importance,
        roleSummary: character.roleHints.join("；") || null,
        faction: null,
        chapterIds,
        firstChapterOrder: character.firstSeenChapter,
        latestChapterOrder: character.lastSeenChapter,
        evidenceCount: character.chapterActivity.reduce((sum, activity) => sum + activity.relationEventCount, 0),
        relationCount: relationIds.size,
        averageConfidence: roundMetric(character.confidence),
        averageIntensity: roundMetric(Math.min(1, activityWeight / Math.max(1, character.chapterActivity.length * 4))),
        score: roundMetric(activityWeight + relationIds.size * 4 + character.confidence * 6 + importanceBonus),
        relationIds
      });
    }
    return nodes;
  }

  private resolveRoleScopeNodeIds(
    roleScope: RelationshipGraphGetInput["roleScope"],
    nodes: ReadonlyMap<string, NodeAccumulator>,
    relations: readonly BookGraphRelation[]
  ): Set<string> {
    if (roleScope === "all") {
      return new Set(nodes.keys());
    }
    if (roleScope === "supporting") {
      return new Set([...nodes.values()].filter((node) => node.importance === "main" || node.importance === "supporting").map((node) => node.id));
    }

    const mainIds = new Set([...nodes.values()].filter((node) => node.importance === "main").map((node) => node.id));
    const result = new Set(mainIds);
    for (const relation of relations) {
      const touchesMain = mainIds.has(relation.sourceId) || mainIds.has(relation.targetId);
      if (!touchesMain) {
        continue;
      }
      if (relationConfidence(relation) >= 0.62 || relation.stable) {
        result.add(relation.sourceId);
        result.add(relation.targetId);
      }
    }
    return result;
  }

  private resolveFocusNodeIds(
    input: RelationshipGraphGetInput,
    mode: "global" | "focus",
    scopedIds: ReadonlySet<string>,
    nodes: ReadonlyMap<string, NodeAccumulator>,
    relations: readonly BookGraphRelation[]
  ): Set<string> | null {
    if (mode !== "focus") {
      return null;
    }
    const focusId = this.findFocusId(input, nodes);
    if (!focusId) {
      return new Set();
    }
    const adjacency = new Map<string, Set<string>>();
    for (const relation of relations) {
      if (!scopedIds.has(relation.sourceId) || !scopedIds.has(relation.targetId)) {
        continue;
      }
      if (!adjacency.has(relation.sourceId)) {
        adjacency.set(relation.sourceId, new Set());
      }
      if (!adjacency.has(relation.targetId)) {
        adjacency.set(relation.targetId, new Set());
      }
      adjacency.get(relation.sourceId)!.add(relation.targetId);
      adjacency.get(relation.targetId)!.add(relation.sourceId);
    }
    const visited = new Set<string>([focusId]);
    let frontier = new Set<string>([focusId]);
    for (let depth = 0; depth < (input.hopDepth ?? 1); depth += 1) {
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
    const name = normalizeText(input.focusName);
    if (!name) {
      return null;
    }
    const lowered = name.toLocaleLowerCase("zh-CN");
    for (const node of nodes.values()) {
      if (node.name.toLocaleLowerCase("zh-CN") === lowered || node.aliases.some((alias) => alias.toLocaleLowerCase("zh-CN") === lowered)) {
        return node.id;
      }
    }
    return null;
  }

  private toGraphEdge(
    context: GraphBuildContext,
    relation: BookGraphRelation,
    characters: ReadonlyMap<string, BookGraphCharacter>
  ): EdgeWithScore {
    const currentLabel = chooseCurrentLabel(relation);
    const timeline =
      relation.evidence.length > 0
        ? relation.evidence
            .map((evidence) => {
              const label =
                relation.labels.find(
                  (item) => item.firstSeenChapter <= evidence.chapterNumber && item.lastSeenChapter >= evidence.chapterNumber
                ) ?? currentLabel;
              return stageFromEvidence(relation, evidence, label, context.chaptersByOrder);
            })
            .sort((left, right) => left.chapterOrder - right.chapterOrder)
        : relation.labels.map((label) => stageFromLabelOnly(relation, label, context.chaptersByOrder));
    const confidence = relationConfidence(relation);
    const intensity = relationIntensity(relation);
    const basic = isBasicRelation(relation);
    const dimensions = relationDimensions(relation);
    const sourceName = characters.get(relation.sourceId)?.name ?? relation.sourceId;
    const targetName = characters.get(relation.targetId)?.name ?? relation.targetId;
    const evidenceCount = Math.max(1, timeline.length);
    const weight = roundMetric(evidenceCount * (0.5 + confidence) * (0.5 + intensity));
    return {
      id: relation.id,
      sourceId: relation.sourceId,
      targetId: relation.targetId,
      sourceName,
      targetName,
      baseRelationLabel: basic ? relation.primaryLabel : "",
      baseRelationSummary: basic ? timeline[timeline.length - 1]?.plotRelationSummary ?? relation.primaryLabel : null,
      plotRelationLabel: basic && currentLabel?.label === relation.primaryLabel ? "" : currentLabel?.label ?? relation.primaryLabel,
      plotRelationSummary: timeline[timeline.length - 1]?.plotRelationSummary ?? relation.primaryLabel,
      primaryDimensionName: dimensions[0].name,
      relationshipDimensions: dimensions,
      semanticMarkers: uniqueText([relation.category, relation.primaryLabel, ...(relation.labels.map((label) => label.label) ?? [])]),
      direction: directionFromSummary(relation),
      polarity: polarityFromSummary(relation.polarity),
      intensity,
      confidence,
      weight,
      evidenceCount,
      evidenceSources: ["summary_book" satisfies RelationshipEvidenceSource],
      chapterIds: uniqueText(timeline.map((stage) => stage.chapterId)),
      firstChapterOrder: Math.min(...timeline.map((stage) => stage.chapterOrder)),
      latestChapterOrder: Math.max(...timeline.map((stage) => stage.chapterOrder)),
      timeline,
      score: weight + (basic ? 1.5 : 0)
    };
  }

  private aggregateDimensions(stages: readonly RelationshipGraphEdgeStage[]): RelationshipGraphDimensionSummary[] {
    const byName = new Map<string, { description: string; mentionCount: number; confidenceSum: number }>();
    for (const stage of stages) {
      for (const dimension of stage.relationshipDimensions) {
        const existing = byName.get(dimension.name);
        if (!existing) {
          byName.set(dimension.name, {
            description: dimension.description,
            mentionCount: 1,
            confidenceSum: dimension.confidence
          });
          continue;
        }
        existing.mentionCount += 1;
        existing.confidenceSum += dimension.confidence;
      }
    }
    return [...byName.entries()]
      .map(([name, value]) => ({
        name,
        description: value.description,
        mentionCount: value.mentionCount,
        averageConfidence: roundMetric(value.confidenceSum / value.mentionCount)
      }))
      .sort((left, right) => right.mentionCount - left.mentionCount || left.name.localeCompare(right.name, "zh-CN"));
  }
}

export const RelationshipGraphAggregator = SummaryRelationshipGraphAggregator;
