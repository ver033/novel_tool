import { z } from "zod";

export const relationshipEntityKindSchema = z.enum(["person", "nonhuman", "group", "identity", "unknown"]);
export const relationshipEntityImportanceSchema = z.enum(["main", "supporting", "minor", "unknown"]);
export const relationshipMentionDirectionSchema = z.enum(["undirected", "source_to_target", "target_to_source", "unclear"]);
export const relationshipMentionPolaritySchema = z.enum(["positive", "negative", "mixed", "neutral", "unknown"]);
export const relationshipEvidenceSourceSchema = z.enum(["summary_payload", "summary_arc", "summary_book", "author_manual"]);
export const relationshipGraphRoleScopeSchema = z.enum(["main", "supporting", "all"]);
export const relationshipGraphModeSchema = z.enum(["global", "focus"]);

export type RelationshipEntityKind = z.infer<typeof relationshipEntityKindSchema>;
export type RelationshipEntityImportance = z.infer<typeof relationshipEntityImportanceSchema>;
export type RelationshipMentionDirection = z.infer<typeof relationshipMentionDirectionSchema>;
export type RelationshipMentionPolarity = z.infer<typeof relationshipMentionPolaritySchema>;
export type RelationshipEvidenceSource = z.infer<typeof relationshipEvidenceSourceSchema>;

export const relationshipDimensionSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  confidence: z.number().min(0).max(1)
});

export type RelationshipDimension = z.infer<typeof relationshipDimensionSchema>;

export const relationshipGraphGetInputSchema = z.object({
  projectId: z.string().min(1),
  chapterFrom: z.number().int().positive().optional(),
  chapterTo: z.number().int().positive().optional(),
  chapterCursor: z.union([z.number().int().positive(), z.literal("latest"), z.literal("all")]).optional(),
  roleScope: relationshipGraphRoleScopeSchema.optional(),
  mode: relationshipGraphModeSchema.optional(),
  focusEntityId: z.string().min(1).optional(),
  focusName: z.string().min(1).optional(),
  hopDepth: z.union([z.literal(1), z.literal(2)]).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  includeUncertain: z.boolean().optional(),
  query: z.string().optional()
});

export type RelationshipGraphGetInput = z.infer<typeof relationshipGraphGetInputSchema>;

export type RelationshipGraphSourceState =
  | "ready"
  | "empty"
  | "needs_chapter_cache"
  | "needs_arc_summary"
  | "blocked_by_prior_arc"
  | "needs_arc_graph_fields"
  | "needs_book_summary"
  | "needs_book_graph_fields"
  | "failed";

export type RelationshipGraphSourceStatus = {
  readonly state: RelationshipGraphSourceState;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly chapterRange: { readonly start: number; readonly end: number } | null;
  readonly arcSummary: {
    readonly total: number;
    readonly readyForGraph: number;
    readonly missingGraphFields: number;
    readonly failed: number;
    readonly blocked: number;
  };
  readonly bookSummary: {
    readonly exists: boolean;
    readonly hasRelationshipGraph: boolean;
    readonly failed: boolean;
  };
  readonly message: string;
  readonly latestFailure: string | null;
};

export type RelationshipGraphAvailableChapter = {
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly chapterOrder: number;
  readonly status: "ready" | "stale" | "missing" | "failed" | "skipped_too_short";
  readonly indexedAt: string | null;
};

export type RelationshipGraphDimensionSummary = {
  readonly name: string;
  readonly description: string;
  readonly mentionCount: number;
  readonly averageConfidence: number;
};

export type RelationshipGraphNode = {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly entityKind: RelationshipEntityKind;
  readonly importance: RelationshipEntityImportance;
  readonly roleSummary: string | null;
  readonly faction: string | null;
  readonly authorNotes?: string | null;
  readonly chapterIds: readonly string[];
  readonly firstChapterOrder: number | null;
  readonly latestChapterOrder: number | null;
  readonly evidenceCount: number;
  readonly relationCount: number;
  readonly averageConfidence: number;
  readonly averageIntensity: number;
  readonly score: number;
};

export type RelationshipGraphEdgeStage = {
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly chapterOrder: number;
  readonly baseRelationLabel: string;
  readonly baseRelationSummary: string | null;
  readonly plotRelationLabel: string;
  readonly plotRelationSummary: string;
  readonly primaryDimensionName: string;
  readonly relationshipDimensions: readonly RelationshipDimension[];
  readonly semanticMarkers: readonly string[];
  readonly direction: RelationshipMentionDirection;
  readonly polarity: RelationshipMentionPolarity;
  readonly intensity: number;
  readonly changeSummary: string;
  readonly startState: string | null;
  readonly endState: string | null;
  readonly reason: string | null;
  readonly evidenceQuote: string;
  readonly evidenceSource: RelationshipEvidenceSource;
  readonly confidence: number;
  readonly uncertainty: string | null;
};

export type RelationshipGraphEdge = {
  readonly id: string;
  readonly authorRelationshipId?: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly sourceName: string;
  readonly targetName: string;
  readonly baseRelationLabel: string;
  readonly baseRelationSummary: string | null;
  readonly plotRelationLabel: string;
  readonly plotRelationSummary: string;
  readonly primaryDimensionName: string;
  readonly relationshipDimensions: readonly RelationshipDimension[];
  readonly semanticMarkers: readonly string[];
  readonly direction: RelationshipMentionDirection;
  readonly polarity: RelationshipMentionPolarity;
  readonly intensity: number;
  readonly confidence: number;
  readonly weight: number;
  readonly evidenceCount: number;
  readonly evidenceSources: readonly RelationshipEvidenceSource[];
  readonly chapterIds: readonly string[];
  readonly firstChapterOrder: number;
  readonly latestChapterOrder: number;
  readonly timeline: readonly RelationshipGraphEdgeStage[];
};

export type RelationshipGraphStats = {
  readonly totalMentionCount: number;
  readonly usedMentionCount: number;
  readonly hiddenMentionCount: number;
  readonly visibleChapterCount: number;
};

export type RelationshipGraphResult = {
  readonly projectId: string;
  readonly mode: "global" | "focus";
  readonly roleScope: "main" | "supporting" | "all";
  readonly chapterCursor: "all" | "latest" | number;
  readonly resolvedChapterCursor: number | null;
  readonly nodes: readonly RelationshipGraphNode[];
  readonly edges: readonly RelationshipGraphEdge[];
  readonly availableChapters: readonly RelationshipGraphAvailableChapter[];
  readonly relationshipDimensions: readonly RelationshipGraphDimensionSummary[];
  readonly sourceStatus: RelationshipGraphSourceStatus;
  readonly graphStats: RelationshipGraphStats;
  readonly truncated: boolean;
  readonly generatedAt: string;
};
