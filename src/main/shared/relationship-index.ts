import { z } from "zod";

export const relationshipEntityKindSchema = z.enum(["person", "nonhuman", "group", "identity", "unknown"]);
export const relationshipEntityImportanceSchema = z.enum(["main", "supporting", "minor", "unknown"]);
export const relationshipMentionDirectionSchema = z.enum(["undirected", "source_to_target", "target_to_source", "unclear"]);
export const relationshipMentionPolaritySchema = z.enum(["positive", "negative", "mixed", "neutral", "unknown"]);
export const relationshipIndexChapterStatusSchema = z.enum([
  "waiting_stable",
  "queued",
  "running",
  "ready",
  "stale",
  "legacy_missing_relationships",
  "failed",
  "skipped_too_short"
]);
export const relationshipIndexJobStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled", "skipped"]);
export const relationshipExtractionSourceSchema = z.enum(["summary_payload", "legacy_original_text_upgrade", "original_text_enhancement"]);
export const relationshipEvidenceSourceSchema = z.enum(["summary_payload", "original_text"]);

export const relationshipGraphRoleScopeSchema = z.enum(["main", "supporting", "all"]);
export const relationshipGraphModeSchema = z.enum(["global", "focus"]);

export type RelationshipEntityKind = z.infer<typeof relationshipEntityKindSchema>;
export type RelationshipEntityImportance = z.infer<typeof relationshipEntityImportanceSchema>;
export type RelationshipMentionDirection = z.infer<typeof relationshipMentionDirectionSchema>;
export type RelationshipMentionPolarity = z.infer<typeof relationshipMentionPolaritySchema>;
export type RelationshipIndexChapterStatus = z.infer<typeof relationshipIndexChapterStatusSchema>;
export type RelationshipIndexJobStatus = z.infer<typeof relationshipIndexJobStatusSchema>;
export type RelationshipExtractionSource = z.infer<typeof relationshipExtractionSourceSchema>;
export type RelationshipEvidenceSource = z.infer<typeof relationshipEvidenceSourceSchema>;

export function normalizeRelationshipCharacterName(name: string): string {
  return name.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function relationshipEntityKey(name: string): string {
  return normalizeRelationshipCharacterName(name).toLocaleLowerCase("zh-CN");
}

const relationshipAddressGroups: readonly (readonly string[])[] = [
  ["母亲", "妈妈", "妈", "娘", "阿娘", "娘亲", "母后", "额娘", "妈咪"],
  ["父亲", "爸爸", "爸", "爹", "阿爹", "爹爹", "父王", "父皇"],
  ["大姨", "大姨母"],
  ["二姨", "二姨母"],
  ["小姨", "小姨母"],
  ["姨母", "姨妈"],
  ["师父", "师傅", "师尊"]
];

const relationshipAddressKeyByName = new Map<string, string>(
  relationshipAddressGroups.flatMap((group) => {
    const canonical = relationshipEntityKey(group[0]);
    return group.map((name) => [relationshipEntityKey(name), `address:${canonical}`] as const);
  })
);

export function relationshipEntityLookupKeys(name: string): string[] {
  const key = relationshipEntityKey(name);
  if (!key) {
    return [];
  }
  return [relationshipAddressKeyByName.get(key) ?? key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringifyStructuredValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyStructuredValue(item)).filter(Boolean).join("；");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => {
        const text = stringifyStructuredValue(item);
        return text ? `${key}：${text}` : key;
      })
      .filter(Boolean)
      .join("；");
  }
  return String(value);
}

function normalizeText(value: unknown): string {
  return stringifyStructuredValue(value).normalize("NFKC").trim();
}

function firstText(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const text = normalizeText(record[key]);
    if (text) {
      return text;
    }
  }
  return "";
}

function normalizeArrayInput(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [value];
}

function normalizeStringList(value: unknown, options: { readonly normalizeName?: boolean } = {}): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of normalizeArrayInput(value)) {
    const text = options.normalizeName ? normalizeRelationshipCharacterName(stringifyStructuredValue(item)) : normalizeText(item);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
  }
  return result;
}

function clamp01(value: unknown, fallback = 0.5): number {
  const number = typeof value === "number" ? value : Number.parseFloat(normalizeText(value));
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, number));
}

function parseEnumValue<T extends z.ZodEnum>(schema: T, value: unknown, fallback: z.infer<T>): z.infer<T> {
  const parsed = schema.safeParse(normalizeText(value));
  return parsed.success ? parsed.data : fallback;
}

export const relationshipDimensionSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  confidence: z.number().min(0).max(1)
});

export type RelationshipDimension = z.infer<typeof relationshipDimensionSchema>;
export const relationshipDimensionListSchema = z.array(relationshipDimensionSchema);

const relationshipExtractionCharacterSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()),
  entityKind: relationshipEntityKindSchema,
  importance: relationshipEntityImportanceSchema,
  roleSummary: z.string(),
  faction: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  evidenceQuotes: z.array(z.string())
});

export type RelationshipExtractionCharacter = z.infer<typeof relationshipExtractionCharacterSchema>;

const relationshipExtractionMentionSchema = z.object({
  sourceName: z.string().min(1),
  targetName: z.string().min(1),
  relationshipDimensions: z.array(relationshipDimensionSchema).min(1),
  primaryDimensionName: z.string().min(1),
  baseRelationLabel: z.string().min(1),
  baseRelationSummary: z.string().nullable(),
  plotRelationLabel: z.string().min(1),
  plotRelationSummary: z.string(),
  semanticMarkers: z.array(z.string()),
  direction: relationshipMentionDirectionSchema,
  polarity: relationshipMentionPolaritySchema,
  intensity: z.number().min(0).max(1),
  changeSummary: z.string(),
  startState: z.string().nullable(),
  endState: z.string().nullable(),
  reason: z.string().nullable(),
  evidenceQuote: z.string(),
  confidence: z.number().min(0).max(1),
  uncertainty: z.string().nullable()
});

export type RelationshipExtractionMention = z.infer<typeof relationshipExtractionMentionSchema>;

export const relationshipIndexExtractionPayloadSchema = z.object({
  indexInfo: z.object({
    cacheVersion: z.string(),
    chapterOrder: z.number().int().nonnegative().nullable(),
    chapterTitle: z.string(),
    language: z.string()
  }),
  characters: z.array(relationshipExtractionCharacterSchema),
  mentions: z.array(relationshipExtractionMentionSchema),
  uncertainties: z.array(z.string()),
  warnings: z.array(z.string())
});

export type RelationshipIndexExtractionPayload = z.infer<typeof relationshipIndexExtractionPayloadSchema>;

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

export type RelationshipGraphIndexStatus = {
  readonly ready: number;
  readonly stale: number;
  readonly legacyMissingRelationships: number;
  readonly waitingStable: number;
  readonly queued: number;
  readonly running: number;
  readonly failed: number;
  readonly skippedTooShort: number;
  readonly total: number;
};

export type RelationshipGraphAvailableChapter = {
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly chapterOrder: number;
  readonly status: RelationshipIndexChapterStatus;
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
  readonly indexStatus: RelationshipGraphIndexStatus;
  readonly graphStats: RelationshipGraphStats;
  readonly truncated: boolean;
  readonly generatedAt: string;
};

function parseCharacter(value: unknown, warnings: string[], index: number): RelationshipExtractionCharacter | null {
  if (!isRecord(value)) {
    warnings.push(`人物${index + 1}不是对象，已忽略。`);
    return null;
  }
  const name = normalizeRelationshipCharacterName(firstText(value, ["姓名", "name"]));
  if (!name) {
    warnings.push(`人物${index + 1}缺少姓名，已忽略。`);
    return null;
  }
  return relationshipExtractionCharacterSchema.parse({
    name,
    aliases: normalizeStringList(value.别名 ?? value.aliases, { normalizeName: true }).filter((alias) => alias !== name),
    entityKind: parseEnumValue(relationshipEntityKindSchema, value.实体类型 ?? value.entityKind, "unknown"),
    importance: parseEnumValue(relationshipEntityImportanceSchema, value.重要程度 ?? value.importance, "unknown"),
    roleSummary: firstText(value, ["身份摘要", "身份", "作用", "roleSummary"]),
    faction: firstText(value, ["阵营", "所属", "faction"]) || null,
    confidence: clamp01(value.置信度 ?? value.confidence),
    evidenceQuotes: normalizeStringList(value.证据短句 ?? value.evidenceQuotes)
  });
}

function parseDimensions(value: unknown): RelationshipDimension[] {
  const dimensions: RelationshipDimension[] = [];
  const seen = new Set<string>();
  for (const item of normalizeArrayInput(value)) {
    if (!isRecord(item)) {
      continue;
    }
    const name = normalizeText(item.名称 ?? item.name);
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    dimensions.push(
      relationshipDimensionSchema.parse({
        name,
        description: normalizeText(item.说明 ?? item.description),
        confidence: clamp01(item.置信度 ?? item.confidence)
      })
    );
  }
  return dimensions;
}

function parseRelationshipSide(record: Record<string, unknown>, keys: readonly string[]): string {
  return normalizeRelationshipCharacterName(firstText(record, keys));
}

function parseRelationBlock(value: unknown): { readonly label: string; readonly summary: string } {
  if (isRecord(value)) {
    return {
      label: firstText(value, ["名称", "name"]),
      summary: firstText(value, ["说明", "摘要", "summary", "description"])
    };
  }
  const text = normalizeText(value);
  return { label: text, summary: "" };
}

function parseMention(value: unknown, warnings: string[], index: number): RelationshipExtractionMention | null {
  if (!isRecord(value)) {
    warnings.push(`关系事件${index + 1}不是对象，已忽略。`);
    return null;
  }

  const sourceName = parseRelationshipSide(value, ["主体", "source", "sourceName"]);
  const targetName = parseRelationshipSide(value, ["客体", "target", "targetName"]);
  if (!sourceName || !targetName) {
    warnings.push(`关系事件${index + 1}缺少主体或客体，已忽略。`);
    return null;
  }

  const relationshipDimensions = parseDimensions(value.关系维度 ?? value.relationshipDimensions);
  if (relationshipDimensions.length === 0) {
    warnings.push(`关系事件${index + 1}缺少有效关系维度，已忽略。`);
    return null;
  }

  const baseRelation = parseRelationBlock(value.基础关系 ?? value.baseRelation);
  if (!baseRelation.label) {
    warnings.push(`关系事件${index + 1}缺少基础关系名称，已忽略。`);
    return null;
  }

  const plotRelation = parseRelationBlock(value.剧情关系 ?? value.plotRelation);
  if (!plotRelation.label) {
    warnings.push(`关系事件${index + 1}缺少剧情关系名称，已忽略。`);
    return null;
  }

  const requestedPrimaryDimension = normalizeText(value.主维度 ?? value.primaryDimensionName);
  const primaryDimensionName = relationshipDimensions.some((dimension) => dimension.name === requestedPrimaryDimension)
    ? requestedPrimaryDimension
    : relationshipDimensions[0].name;

  return relationshipExtractionMentionSchema.parse({
    sourceName,
    targetName,
    relationshipDimensions,
    primaryDimensionName,
    baseRelationLabel: baseRelation.label,
    baseRelationSummary: baseRelation.summary || null,
    plotRelationLabel: plotRelation.label,
    plotRelationSummary: plotRelation.summary || plotRelation.label,
    semanticMarkers: normalizeStringList(value.语义标记 ?? value.semanticMarkers),
    direction: parseEnumValue(relationshipMentionDirectionSchema, value.方向 ?? value.direction, "unclear"),
    polarity: parseEnumValue(relationshipMentionPolaritySchema, value.极性 ?? value.polarity, "unknown"),
    intensity: clamp01(value.强度 ?? value.intensity),
    changeSummary: firstText(value, ["本章变化", "变化", "changeSummary"]),
    startState: firstText(value, ["开始状态", "startState"]) || null,
    endState: firstText(value, ["结束状态", "endState"]) || null,
    reason: firstText(value, ["变化原因", "原因", "reason"]) || null,
    evidenceQuote: firstText(value, ["证据短句", "evidenceQuote"]),
    confidence: clamp01(value.置信度 ?? value.confidence),
    uncertainty: firstText(value, ["不确定说明", "uncertainty"]) || null
  });
}

function parseChapterOrder(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number.parseInt(normalizeText(value), 10);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

export function parseRelationshipExtractionPayload(value: unknown): RelationshipIndexExtractionPayload {
  const record = isRecord(value) ? value : {};
  const indexInfo = isRecord(record.索引信息) ? record.索引信息 : {};
  const warnings: string[] = [];
  const characters = normalizeArrayInput(record.人物)
    .map((item, index) => parseCharacter(item, warnings, index))
    .filter((item): item is RelationshipExtractionCharacter => Boolean(item));
  const mentions = normalizeArrayInput(record.关系事件)
    .map((item, index) => parseMention(item, warnings, index))
    .filter((item): item is RelationshipExtractionMention => Boolean(item));

  return relationshipIndexExtractionPayloadSchema.parse({
    indexInfo: {
      cacheVersion: firstText(indexInfo, ["缓存版本", "cacheVersion"]),
      chapterOrder: parseChapterOrder(indexInfo.章节序号 ?? indexInfo.chapterOrder),
      chapterTitle: firstText(indexInfo, ["章节标题", "chapterTitle"]),
      language: firstText(indexInfo, ["语言", "language"])
    },
    characters,
    mentions,
    uncertainties: normalizeStringList(record.不确定项 ?? record.uncertainties),
    warnings
  });
}
