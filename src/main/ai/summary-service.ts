import type { SummaryIndexInvalidationInput, SummaryIndexInvalidator } from "../chapter/chapter-service";
import type { ChapterRepository } from "../db/repositories/chapter-repo";
import {
  SummaryRepository,
  type ArcAiSummaryRecord,
  type ChapterAiSummaryChunkRecord,
  type BookAiSummaryRecord,
  type ChapterAiSummaryRecord,
  type SummaryJobRecord
} from "../db/repositories/summary-repo";
import { createId } from "../shared/ids";
import {
  computeChapterContentHash,
  computeSourceHash,
  getArcSummaryText,
  getBookSummaryLongText,
  getBookSummaryShortText,
  getChapterSummaryLongText,
  getChapterSummaryShortText,
  isChapterAiSummaryPayloadV3Lite,
  type ArcAiSummaryPayload,
  type BookAiSummaryPayload,
  type BookSummaryCoverage,
  type ChapterAiSummaryChunkPayload,
  type ChapterAiSummaryPayload,
  type ChapterAiSummaryPayloadV3Lite,
  type SummaryJobType
} from "../shared/summary-index";
import { countWritingUnits } from "../shared/text";
import type {
  ChapterContent,
  ChapterSummary,
  SummaryArcCacheDetail,
  SummaryArcCacheEntry,
  SummaryBookCacheDetail,
  SummaryChapterCacheDetail,
  SummaryChapterCacheEntry,
  SummaryIndexJobDetail,
  SummaryIndexPausedReason,
  SummaryIndexStatus
} from "../shared/types";
import { getChapterSummaryCacheState, isFreshReadyChapterSummary, isFreshSkippedTooShortChapterSummary } from "./chapter-summary-freshness";
import { estimateTextTokens } from "./token-estimator";
import type { ArcIndexSummaryInput, BookIndexSummaryInput, ChapterChunkIndexSummaryInput, ChapterChunkMergeSummaryInput, ChapterIndexSummaryInput } from "./summary-prompts";

export const MIN_AUTO_SUMMARY_UNITS = 200;
export const MIN_MANUAL_SUMMARY_UNITS = 80;
export const ACTIVE_CHAPTER_IDLE_MS = 5 * 60 * 1000;
export const LATEST_CHAPTER_AUTO_PRIORITY = 11;
export const FIRST_LATEST_CHAPTER_IMMEDIATE_CACHE_MILESTONE_UNITS = 200;
export const LATEST_CHAPTER_IMMEDIATE_CACHE_MILESTONE_STEP_UNITS = 500;
export const MIN_HIGH_PRIORITY_DELTA_UNITS = 500;
export const MIN_NORMAL_PRIORITY_DELTA_UNITS = 100;
export const AUTO_ARC_CHAPTER_COUNT = 20;
export const CHAPTER_INDEX_DIRECT_MAX_UNITS = 6000;
export const CHAPTER_INDEX_CHUNK_TARGET_UNITS = 3500;
export const CHAPTER_INDEX_CHUNK_OVERLAP_UNITS = 120;
export const CHAPTER_INDEX_MEDIUM_CONTEXT_DIRECT_MAX_UNITS = 15_000;
export const CHAPTER_INDEX_LARGE_CONTEXT_DIRECT_MAX_UNITS = 24_000;
export const CHAPTER_INDEX_HUGE_CONTEXT_DIRECT_MAX_UNITS = 30_000;
export const CHAPTER_INDEX_MEDIUM_CONTEXT_CHUNK_TARGET_UNITS = 8_000;
export const CHAPTER_INDEX_LARGE_CONTEXT_CHUNK_TARGET_UNITS = 10_000;
export const CHAPTER_INDEX_HUGE_CONTEXT_CHUNK_TARGET_UNITS = 12_000;

export class SummarySourceChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SummarySourceChangedError";
  }
}

export class SummaryDependencyPendingError extends Error {
  constructor(
    message: string,
    readonly delayMinutes = 5
  ) {
    super(message);
    this.name = "SummaryDependencyPendingError";
  }
}

export type ChapterSummaryQueueTrigger = "auto_idle" | "chapter_inactive" | "import" | "manual_continue" | "manual_rebuild";

export type SummaryIndexGenerator = {
  readonly getSummaryIndexBudget?: () => Promise<SummaryIndexBudgetInfo>;
  readonly summarizeChapterForIndex: (input: ChapterIndexSummaryInput, options?: { readonly signal?: AbortSignal }) => Promise<ChapterAiSummaryPayload>;
  readonly summarizeChapterChunkForIndex?: (
    input: ChapterChunkIndexSummaryInput,
    options?: { readonly signal?: AbortSignal }
  ) => Promise<ChapterAiSummaryChunkPayload>;
  readonly mergeChapterChunksForIndex?: (
    input: ChapterChunkMergeSummaryInput,
    options?: { readonly signal?: AbortSignal }
  ) => Promise<ChapterAiSummaryPayload>;
  readonly summarizeArcForIndex?: (input: ArcIndexSummaryInput, options?: { readonly signal?: AbortSignal }) => Promise<ArcAiSummaryPayload>;
  readonly summarizeBookForIndex?: (input: BookIndexSummaryInput, options?: { readonly signal?: AbortSignal }) => Promise<BookAiSummaryPayload>;
};

export type SummaryIndexBudgetInfo = {
  readonly maxInputTokens: number;
  readonly modelContextTokens: number | null;
};

type ChapterIndexSizing = {
  readonly directMaxUnits: number;
  readonly chunkTargetUnits: number;
};

type SummaryServiceOptions = {
  readonly generator?: SummaryIndexGenerator;
};

export type MaybeEnqueueChapterSummaryInput = {
  readonly projectId: string;
  readonly chapterId: string;
  readonly trigger: ChapterSummaryQueueTrigger;
  readonly now: string;
};

type SummaryIndexStatusOptions = {
  readonly pausedReason?: SummaryIndexPausedReason;
};

type SummaryRebuildProjectIndexOptions = SummaryIndexStatusOptions & {
  readonly force?: boolean;
};

type SummarySetBackgroundIndexOptions = SummaryIndexStatusOptions & {
  readonly cancelQueuedAndRunning?: boolean;
};

type SummaryJobRelevanceCache = {
  readonly arcSummaries: ReadonlyMap<string, ArcAiSummaryRecord>;
  readonly bookSummary: BookAiSummaryRecord | null;
  readonly chapterById: ReadonlyMap<string, ChapterSummary>;
  readonly chapterIds: ReadonlySet<string>;
  readonly chapterSummaries: ReadonlyMap<string, ChapterAiSummaryRecord>;
  readonly chapters: readonly ChapterSummary[];
};

type ArcPriorCharacterLedgerEntry = {
  readonly canonicalName: string;
  readonly aliases: readonly string[];
  readonly mentionForms: readonly string[];
  readonly roleHints: readonly string[];
  readonly firstSeenChapter: number;
  readonly lastSeenChapter: number;
  readonly importance: "major" | "supporting" | "minor" | "unknown";
};

export type ChapterSummaryIndexChunk = {
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly text: string;
  readonly textStart: number;
  readonly textEnd: number;
};

function keyFor(projectId: string, chapterId: string): string {
  return `${projectId}:${chapterId}`;
}

function parseTime(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getSummaryJobOutputLabel(jobType?: SummaryJobType): string {
  if (jobType === "arc_summary") {
    return "阶段摘要";
  }
  if (jobType === "book_summary") {
    return "全书摘要";
  }
  return "章节缓存";
}

function getTruncatedSummaryJobActionHint(jobType?: SummaryJobType): string {
  const label = getSummaryJobOutputLabel(jobType);
  if (jobType === "arc_summary") {
    return `${label}输出超出模型额度。系统会保留人物关系判断信息并使用更高输出额度；如果仍反复失败，请换用输出上限更高的模型后重试。`;
  }
  if (jobType === "book_summary") {
    return `${label}输出超出模型额度。请先确认阶段摘要已完成，必要时换用输出上限更高的模型后重试。`;
  }
  return `${label}输出超出模型额度。请换用输出上限更高的模型，或先按单章手动重试确认该模型能返回完整 JSON。`;
}

function getInvalidJsonSummaryJobActionHint(jobType?: SummaryJobType): string {
  const label = getSummaryJobOutputLabel(jobType);
  if (jobType === "arc_summary" || jobType === "book_summary") {
    return `模型没有返回合法${label} JSON。这通常不是章节正文内容问题；建议继续建立索引让系统重新排队，或换用更稳定的模型。`;
  }
  return `模型没有返回合法${label} JSON。这通常不是章节正文内容问题；此类错误不会自动反复重试，建议换用更稳定的模型或手动重试单章。`;
}

function classifySummaryJobError(error: string | null, jobType?: SummaryJobType): { readonly failureCategory: string | null; readonly actionHint: string | null } {
  const normalizedError = error?.trim();
  if (!normalizedError) {
    return { failureCategory: null, actionHint: null };
  }
  if (isKnownInternalSummaryJobBindingError(normalizedError)) {
    return {
      failureCategory: "应用内部错误",
      actionHint: "这是旧版本阶段/全书缓存任务的内部调用错误，不是章节内容或模型问题。请继续建立索引，系统会用已缓存章节重新排队。"
    };
  }
  if (
    normalizedError.includes("429") ||
    normalizedError.includes("限流") ||
    /rate.?limit/i.test(normalizedError) ||
    normalizedError.includes("Resource has been exhausted")
  ) {
    return {
      failureCategory: "上游限流",
      actionHint: "当前 AI Provider 或上游模型暂时限流。系统只会延迟自动重试一次；如果反复失败，请稍后重试或换用更稳定的模型。"
    };
  }
  if (normalizedError.includes("finish_reason: length") || normalizedError.includes("被截断") || /truncated/i.test(normalizedError)) {
    return {
      failureCategory: "输出被截断",
      actionHint: getTruncatedSummaryJobActionHint(jobType)
    };
  }
  if (
    normalizedError.includes("结构无效") ||
    normalizedError.includes("索引摘要无效") ||
    normalizedError.includes("Unexpected end of JSON") ||
    /JSON|schema|zod/i.test(normalizedError)
  ) {
    return {
      failureCategory: "模型输出结构无效",
      actionHint: getInvalidJsonSummaryJobActionHint(jobType)
    };
  }
  if (/timeout|timed?out|network|ECONN|ENOTFOUND|EAI_AGAIN/i.test(normalizedError) || normalizedError.includes("超时")) {
    return {
      failureCategory: "网络或上游超时",
      actionHint: "请求没有稳定完成。系统只会延迟自动重试一次；如果反复失败，请稍后重试或换模型。"
    };
  }
  if (normalizedError.includes("API Key") || normalizedError.includes("模型名称") || normalizedError.includes("未配置")) {
    return {
      failureCategory: "AI 配置不可用",
      actionHint: "请先在 AI 服务设置中测试并保存当前 Provider 的 API Key 和模型。"
    };
  }
  return {
    failureCategory: null,
    actionHint: "若同一缓存任务多次失败，建议先单章重试或换用更稳定的模型。"
  };
}

function hasSummaryJobError(job: SummaryJobRecord): boolean {
  return Boolean(job.error?.trim());
}

function isKnownInternalSummaryJobBindingError(error: string | null): boolean {
  return /Cannot read propert(?:y|ies) of undefined \(reading ['"]createClient['"]\)/.test(error ?? "");
}

function isLegacyInternalDerivedSummaryFailure(job: SummaryJobRecord): boolean {
  return (job.jobType === "arc_summary" || job.jobType === "book_summary") && isKnownInternalSummaryJobBindingError(job.error);
}

function getChapterIndexSizing(budget: SummaryIndexBudgetInfo | null): ChapterIndexSizing {
  const contextTokens = budget?.modelContextTokens ?? 0;
  const maxInputTokens = budget?.maxInputTokens ?? 0;
  if (contextTokens >= 128_000 || maxInputTokens >= 80_000) {
    return {
      directMaxUnits: CHAPTER_INDEX_HUGE_CONTEXT_DIRECT_MAX_UNITS,
      chunkTargetUnits: CHAPTER_INDEX_HUGE_CONTEXT_CHUNK_TARGET_UNITS
    };
  }
  if (contextTokens >= 64_000 || maxInputTokens >= 36_000) {
    return {
      directMaxUnits: CHAPTER_INDEX_LARGE_CONTEXT_DIRECT_MAX_UNITS,
      chunkTargetUnits: CHAPTER_INDEX_LARGE_CONTEXT_CHUNK_TARGET_UNITS
    };
  }
  if (contextTokens >= 32_000 || maxInputTokens >= 18_000) {
    return {
      directMaxUnits: CHAPTER_INDEX_MEDIUM_CONTEXT_DIRECT_MAX_UNITS,
      chunkTargetUnits: CHAPTER_INDEX_MEDIUM_CONTEXT_CHUNK_TARGET_UNITS
    };
  }
  if (maxInputTokens >= 10_000) {
    return {
      directMaxUnits: 10_000,
      chunkTargetUnits: 6_000
    };
  }
  return {
    directMaxUnits: CHAPTER_INDEX_DIRECT_MAX_UNITS,
    chunkTargetUnits: CHAPTER_INDEX_CHUNK_TARGET_UNITS
  };
}

function skippedTooShortPayload(content: ChapterContent): ChapterAiSummaryPayload {
  return {
    章节信息: {
      章节序号: content.sortOrder + 1,
      章节标题: content.title,
      正文覆盖: "不完整",
      缓存类型: "章节缓存",
      缓存版本: "三-Lite",
      语言: "简体中文"
    },
    缓存质量: {
      覆盖完整度: "不完整",
      信息密度: "低",
      需要回读原文: "是",
      缺失说明: ["章节内容过短，未建立完整事实索引"]
    },
    一句话摘要: "章节内容过短，暂不建立完整事实索引。",
    短摘要: "章节内容过短，当前只记录跳过状态，等待正文成形后再建立章节缓存。",
    详细梗概: "章节内容过短，当前只记录跳过状态，不消耗模型额度建立完整事实索引。等作者继续写到足够长度后，系统会在空闲时重新进入摘要队列。",
    章节作用: {
      剧情作用: "未明确",
      人物作用: "未明确",
      后文作用: "正文成形后重新建立章节缓存"
    },
    场景推进: ["章节内容过短，暂未提取场景推进"],
    关键事件: [
      {
        事件: "章节内容过短，暂未建立关键事件索引",
        涉及人物: [],
        时间地点: "未明确",
        结果: "当前只记录跳过状态",
        后续影响: "需要正文成形后重新分析",
        证据短句: []
      }
    ],
    人物状态: [
      {
        人物: "未明确",
        本章变化: "未明确",
        行动: [],
        目标或动机: "未明确",
        新获得信息: [],
        仍不知道的信息: [],
        关系变化: [],
        证据短句: []
      }
    ],
    人物认知边界: [],
    关系变化: [],
    时间地点: {
      本章时间: "未明确",
      主要地点: [],
      时间线索: [],
      地点移动: [],
      可能风险: []
    },
    道具设定变化: [],
    伏笔与线索: [],
    可核对事实: ["章节内容过短，暂未建立完整索引"],
    连续性风险: [],
    未解决问题: [],
    文风要点: [],
    不可丢失信息: ["章节内容过短，等待正文成形后重新建立事实索引"],
    不确定项: ["正文信息不足"]
  };
}

function priorityFor(trigger: ChapterSummaryQueueTrigger, changedWritingUnits: number | null, isLatestChapter: boolean): number {
  if (trigger === "manual_rebuild" || trigger === "manual_continue") {
    return 10;
  }
  if (isLatestChapter) {
    return LATEST_CHAPTER_AUTO_PRIORITY;
  }
  if (trigger === "import") {
    return 8;
  }
  const delta = changedWritingUnits ?? MIN_HIGH_PRIORITY_DELTA_UNITS;
  if (delta >= MIN_HIGH_PRIORITY_DELTA_UNITS) {
    return 8;
  }
  if (delta >= MIN_NORMAL_PRIORITY_DELTA_UNITS) {
    return 5;
  }
  return 1;
}

function crossesImmediateLatestChapterCacheMilestone(previousWordCount: number, nextWordCount: number): boolean {
  if (nextWordCount <= previousWordCount || nextWordCount < FIRST_LATEST_CHAPTER_IMMEDIATE_CACHE_MILESTONE_UNITS) {
    return false;
  }
  if (previousWordCount < FIRST_LATEST_CHAPTER_IMMEDIATE_CACHE_MILESTONE_UNITS) {
    return true;
  }

  const nextMilestone =
    Math.floor(previousWordCount / LATEST_CHAPTER_IMMEDIATE_CACHE_MILESTONE_STEP_UNITS) *
      LATEST_CHAPTER_IMMEDIATE_CACHE_MILESTONE_STEP_UNITS +
    LATEST_CHAPTER_IMMEDIATE_CACHE_MILESTONE_STEP_UNITS;
  return nextWordCount >= nextMilestone;
}

function isManualSummaryTrigger(trigger: ChapterSummaryQueueTrigger): boolean {
  return trigger === "manual_rebuild" || trigger === "manual_continue";
}

function formatAutoArcKey(chapterFrom: number, chapterTo: number): string {
  return `auto:${String(chapterFrom).padStart(3, "0")}-${String(chapterTo).padStart(3, "0")}`;
}

function parseAutoArcKey(arcKey: string): { readonly from: number; readonly to: number } | null {
  const match = /^auto:(\d+)-(\d+)$/.exec(arcKey);
  if (!match) {
    return null;
  }
  const from = Number.parseInt(match[1], 10);
  const to = Number.parseInt(match[2], 10);
  return Number.isSafeInteger(from) && Number.isSafeInteger(to) && from > 0 && to >= from ? { from, to } : null;
}

function isReadyChapterSummary(summary: ChapterAiSummaryRecord, sourceHash: string): boolean {
  return summary.status === "ready" && summary.contentHash === sourceHash;
}

function formatChapterCoverageLabel(chapterOrder: number, title: string): string {
  if (title.startsWith(`第${chapterOrder}章`)) {
    return title;
  }
  return `第${chapterOrder}章 ${title}`;
}

function formatArcCoverageLabel(chapterFrom: number, chapterTo: number): string {
  return chapterFrom === chapterTo ? `第${chapterFrom}章` : `第${chapterFrom}-${chapterTo}章`;
}

function limitText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function uniqueStrings(values: readonly string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value || value === "未明确" || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function strongerArcImportance(
  left: ArcPriorCharacterLedgerEntry["importance"],
  right: ArcPriorCharacterLedgerEntry["importance"]
): ArcPriorCharacterLedgerEntry["importance"] {
  const rank: Record<ArcPriorCharacterLedgerEntry["importance"], number> = {
    major: 3,
    supporting: 2,
    minor: 1,
    unknown: 0
  };
  return rank[left] >= rank[right] ? left : right;
}

function uniqueRecords<T>(items: readonly T[], keyForItem: (item: T) => string, limit: number): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyForItem(item).trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function firstDefined(values: readonly string[], fallback: string): string {
  return values.find((value) => value.trim() && value.trim() !== "未明确")?.trim() ?? fallback;
}

function chunkKeyEvents(chunk: ChapterAiSummaryChunkRecord) {
  return (chunk.structured.关键事件 as readonly Record<string, unknown>[]).map((item) => ({
    事件: String(item.事件 ?? "片段关键事件"),
    涉及人物: Array.isArray(item.涉及人物) ? item.涉及人物.map((value) => String(value)) : [],
    时间地点: String(item.时间地点 ?? "未明确"),
    结果: String(item.结果 ?? item.事件结果 ?? "未明确"),
    后续影响: String(item.后续影响 ?? "未明确"),
    证据短句: Array.isArray(item.证据短句) ? item.证据短句.map((value) => String(value)).slice(0, 1) : []
  }));
}

function chunkCharacterStates(chunk: ChapterAiSummaryChunkRecord) {
  return (chunk.structured.人物状态 as readonly Record<string, unknown>[]).map((item) => ({
    人物: String(item.人物 ?? "未明确"),
    本章变化: String(item.本章变化 ?? item.本章结束状态 ?? item.情绪状态 ?? "未明确"),
    行动: Array.isArray(item.行动) ? item.行动.map((value) => String(value)) : [],
    目标或动机: String(item.目标或动机 ?? item.动机 ?? item.目标 ?? "未明确"),
    新获得信息: Array.isArray(item.新获得信息) ? item.新获得信息.map((value) => String(value)) : [],
    仍不知道的信息: Array.isArray(item.仍不知道的信息) ? item.仍不知道的信息.map((value) => String(value)) : [],
    关系变化: Array.isArray(item.关系变化)
      ? item.关系变化.map((value) => String(value))
      : Array.isArray(item.与他人关系变化)
        ? item.与他人关系变化.map((value) => String(value))
        : [],
    证据短句: Array.isArray(item.证据短句) ? item.证据短句.map((value) => String(value)).slice(0, 1) : []
  }));
}

function chunkCharacterKnowledge(chunk: ChapterAiSummaryChunkRecord) {
  return (chunk.structured.人物认知边界 as readonly Record<string, unknown>[]).map((item) => ({
    人物: String(item.人物 ?? "未明确"),
    认知变化: String(item.认知变化 ?? item.新得知 ?? item.已经知道 ?? "未明确"),
    仍不知道: Array.isArray(item.仍不知道)
      ? item.仍不知道.map((value) => String(value))
      : Array.isArray(item.尚不知道)
        ? item.尚不知道.map((value) => String(value))
        : [],
    误解或风险: Array.isArray(item.误解或风险)
      ? item.误解或风险.map((value) => String(value))
      : Array.isArray(item.误以为)
        ? item.误以为.map((value) => String(value))
        : [],
    证据短句: Array.isArray(item.证据短句) ? item.证据短句.map((value) => String(value)).slice(0, 1) : []
  }));
}

function chunkTimePlace(chunk: ChapterAiSummaryChunkRecord): {
  readonly time: string;
  readonly places: readonly string[];
  readonly timeClues: readonly string[];
  readonly moves: readonly string[];
  readonly risks: readonly string[];
} {
  const structured = chunk.structured as unknown as Record<string, unknown>;
  const liteTime = structured.时间地点 as Record<string, unknown> | undefined;
  if (liteTime) {
    return {
      time: String(liteTime.本章时间 ?? "未明确"),
      places: Array.isArray(liteTime.主要地点) ? liteTime.主要地点.map((value) => String(value)) : [],
      timeClues: Array.isArray(liteTime.时间线索) ? liteTime.时间线索.map((value) => String(value)) : [],
      moves: Array.isArray(liteTime.地点移动) ? liteTime.地点移动.map((value) => String(value)) : [],
      risks: Array.isArray(liteTime.可能风险) ? liteTime.可能风险.map((value) => String(value)) : []
    };
  }

  const legacyTime = structured.时间与地点 as Record<string, unknown> | undefined;
  return {
    time: String(legacyTime?.本章时间 ?? "未明确"),
    places: Array.isArray(legacyTime?.主要地点) ? legacyTime.主要地点.map((value) => String(value)) : [],
    timeClues: [
      ...(Array.isArray(legacyTime?.明确时间锚点) ? legacyTime.明确时间锚点.map((value) => String(value)) : []),
      ...(Array.isArray(legacyTime?.相对时间锚点) ? legacyTime.相对时间锚点.map((value) => String(value)) : [])
    ],
    moves: Array.isArray(legacyTime?.地点移动) ? legacyTime.地点移动.map((value) => String(value)) : [],
    risks: Array.isArray(legacyTime?.可能的时间线风险) ? legacyTime.可能的时间线风险.map((value) => String(value)) : []
  };
}

function chunkPropsAndRules(chunk: ChapterAiSummaryChunkRecord): string[] {
  const structured = chunk.structured as unknown as Record<string, unknown>;
  const lite = structured.道具设定变化;
  const values: unknown[] = Array.isArray(lite) ? [...lite] : [];
  for (const key of ["道具状态", "设定与规则", "限制与否定事实", "空间与行动逻辑", "因果链"] as const) {
    const items = structured[key];
    if (Array.isArray(items)) {
      values.push(...items);
    }
  }
  return uniqueStrings(values.map((item) => stringifyForSummary(item)), 12);
}

function chunkForeshadowing(chunk: ChapterAiSummaryChunkRecord) {
  return (chunk.structured.伏笔与线索 as readonly Record<string, unknown>[]).map((item) => ({
    线索: String(item.线索 ?? "线索"),
    类型: String(item.类型 ?? "普通线索"),
    状态: String(item.状态 ?? item.本章状态 ?? "待判断"),
    指向或意义: String(item.指向或意义 ?? item.可能指向 ?? "未明确"),
    证据短句: Array.isArray(item.证据短句) ? item.证据短句.map((value) => String(value)).slice(0, 1) : []
  }));
}

function chunkFacts(chunk: ChapterAiSummaryChunkRecord): string[] {
  return uniqueStrings((chunk.structured.可核对事实 as readonly unknown[]).map((item) => stringifyForSummary(item)), 12);
}

function chunkRisks(chunk: ChapterAiSummaryChunkRecord): string[] {
  return uniqueStrings((chunk.structured.连续性风险 as readonly unknown[]).map((item) => stringifyForSummary(item)), 8);
}

function chunkUnresolvedQuestions(chunk: ChapterAiSummaryChunkRecord): string[] {
  return uniqueStrings((chunk.structured.未解决问题 as readonly unknown[]).map((item) => stringifyForSummary(item)), 8);
}

function stringifyForSummary(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyForSummary(item)).filter(Boolean).join("、");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => {
        const text = stringifyForSummary(item);
        return text ? `${key}：${text}` : "";
      })
      .filter(Boolean)
      .join("；");
  }
  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type RawIndexMaterialPayload = {
  readonly 场景节点: readonly Record<string, unknown>[];
  readonly 时间线事件: readonly Record<string, unknown>[];
  readonly 通用实体: readonly Record<string, unknown>[];
  readonly 原子事实: readonly Record<string, unknown>[];
  readonly 结构标记?: Record<string, unknown>;
};

function indexMaterialFromSummaryPayload(structured: ChapterAiSummaryPayload | ChapterAiSummaryChunkPayload): RawIndexMaterialPayload | null {
  const indexMaterial = (structured as { readonly 索引原料?: unknown }).索引原料;
  if (!isPlainObject(indexMaterial)) {
    return null;
  }
  return {
    场景节点: Array.isArray(indexMaterial.场景节点) ? indexMaterial.场景节点.filter(isPlainObject) : [],
    时间线事件: Array.isArray(indexMaterial.时间线事件) ? indexMaterial.时间线事件.filter(isPlainObject) : [],
    通用实体: Array.isArray(indexMaterial.通用实体) ? indexMaterial.通用实体.filter(isPlainObject) : [],
    原子事实: Array.isArray(indexMaterial.原子事实) ? indexMaterial.原子事实.filter(isPlainObject) : [],
    结构标记: isPlainObject(indexMaterial.结构标记) ? indexMaterial.结构标记 : undefined
  };
}

function indexMaterialRecordKey(item: Record<string, unknown>, keys: readonly string[]): string {
  return keys.map((key) => stringifyForSummary(item[key])).join("|").trim() || stringifyForSummary(item).trim();
}

function indexMaterialStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const text = stringifyForSummary(value).trim();
    return text ? [text] : [];
  }
  return value.map((item) => stringifyForSummary(item).trim()).filter(Boolean);
}

function mergeIndexMaterialStructureMarkers(materials: readonly RawIndexMaterialPayload[]): Record<string, unknown> | undefined {
  const markers = materials.map((material) => material.结构标记).filter(isPlainObject);
  if (markers.length === 0) {
    return undefined;
  }
  const result: Record<string, unknown> = {};
  for (const key of ["章节位置", "节奏", "情绪走向", "视角", "备注"] as const) {
    const value = firstDefined(markers.map((marker) => stringifyForSummary(marker[key])), "");
    if (value) {
      result[key] = value;
    }
  }
  const functions = uniqueStrings(markers.flatMap((marker) => indexMaterialStringList(marker.叙事功能)), 8);
  if (functions.length > 0) {
    result.叙事功能 = functions;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function firstNonEmptyRecordList(existing: unknown, fallback: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return Array.isArray(existing) && existing.some(isPlainObject) ? existing.filter(isPlainObject) : [...fallback];
}

function firstNonEmptyRecord(existing: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  return isPlainObject(existing) && Object.keys(existing).length > 0 ? existing : fallback;
}

function deriveIndexMaterialFromV3Summary(payload: ChapterAiSummaryPayloadV3Lite): RawIndexMaterialPayload {
  const timePlace = payload.时间地点;
  const primaryPlace = firstDefined(timePlace.主要地点, "未明确");
  const chapterFunction = payload.章节作用;
  const narrativeFunctions = uniqueStrings([chapterFunction.剧情作用, chapterFunction.人物作用, chapterFunction.后文作用], 6);
  const sceneNodes = payload.场景推进.slice(0, 5).map((scene, index) => ({
    序号: index + 1,
    标题: limitText(scene, 42),
    类型: "场景推进",
    出场人物: uniqueStrings(payload.人物状态.map((item) => item.人物), 8),
    地点: primaryPlace,
    场景目标: "未明确",
    核心冲突: "未明确",
    结果: scene,
    情绪变化: firstDefined(payload.文风要点, "未明确"),
    功能: firstDefined(narrativeFunctions, "未明确"),
    证据短句: []
  }));
  const timelineEvents = payload.关键事件.slice(0, 8).map((event, index) => ({
    事件: event.事件,
    叙事顺序: index + 1,
    故事内时间: timePlace.本章时间,
    相对时间锚点: firstDefined([event.时间地点, ...timePlace.时间线索], "未明确"),
    参与人物: event.涉及人物,
    地点: firstDefined([event.时间地点, primaryPlace], "未明确"),
    因果前置: [],
    结果影响: uniqueStrings([event.结果, event.后续影响], 4),
    置信度: 0.75,
    证据短句: event.证据短句
  }));
  const characterEntities = payload.人物状态.slice(0, 10).map((character) => ({
    名称: character.人物,
    别名: [],
    类型: "人物",
    本章状态: character.本章变化,
    新增信息: uniqueStrings([...character.新获得信息, ...character.关系变化], 8),
    关联人物: [],
    证据短句: character.证据短句
  }));
  const placeEntities = timePlace.主要地点.slice(0, Math.max(0, 10 - characterEntities.length)).map((place) => ({
    名称: place,
    别名: [],
    类型: "地点",
    本章状态: "本章出现地点",
    新增信息: uniqueStrings([...timePlace.时间线索, ...timePlace.地点移动], 6),
    关联人物: uniqueStrings(payload.人物状态.map((item) => item.人物), 8),
    证据短句: []
  }));
  const entities = uniqueRecords([...characterEntities, ...placeEntities], (item) => indexMaterialRecordKey(item, ["名称", "类型"]), 10);
  const facts = payload.可核对事实.slice(0, 12).map((fact) => ({
    主体: "未明确",
    类型: "可核对事实",
    属性: "事实",
    值: fact,
    生效范围: payload.章节信息.章节标题,
    确定性: "确定",
    证据短句: []
  }));
  return {
    场景节点: sceneNodes,
    时间线事件: timelineEvents,
    通用实体: entities,
    原子事实: facts,
    结构标记: {
      章节位置: "未明确",
      叙事功能: narrativeFunctions,
      节奏: firstDefined(payload.文风要点, "未明确"),
      情绪走向: firstDefined(payload.文风要点, "未明确"),
      视角: firstDefined(payload.文风要点, "未明确"),
      备注: "由章节缓存字段本地派生"
    }
  };
}

function ensureChapterIndexMaterial(structured: ChapterAiSummaryPayload): ChapterAiSummaryPayload {
  if (!isChapterAiSummaryPayloadV3Lite(structured)) {
    return structured;
  }
  const existing = structured.索引原料 as RawIndexMaterialPayload | undefined;
  const derived = deriveIndexMaterialFromV3Summary(structured);
  return {
    ...structured,
    索引原料: {
      场景节点: firstNonEmptyRecordList(existing?.场景节点, derived.场景节点),
      时间线事件: firstNonEmptyRecordList(existing?.时间线事件, derived.时间线事件),
      通用实体: firstNonEmptyRecordList(existing?.通用实体, derived.通用实体),
      原子事实: firstNonEmptyRecordList(existing?.原子事实, derived.原子事实),
      结构标记: firstNonEmptyRecord(existing?.结构标记, derived.结构标记 ?? {})
    }
  };
}

function mergeLongChapterChunks(content: ChapterContent, chunks: readonly ChapterAiSummaryChunkRecord[]): ChapterAiSummaryPayload {
  const orderedChunks = [...chunks].sort((left, right) => left.chunkIndex - right.chunkIndex);
  const chunkSummaries = orderedChunks
    .map((chunk) => `片段${chunk.chunkIndex + 1}：${chunk.structured.片段摘要.trim()}`)
    .filter((summary) => summary.trim().length > 0);
  const detailText = chunkSummaries.join("\n");
  const shortText = limitText(chunkSummaries.join("；"), 360) || `${content.title}已完成片段事实索引聚合。`;
  const oneLine = limitText(chunkSummaries.join("；"), 120) || `${content.title}已完成长章节缓存。`;
  const keyEvents = uniqueRecords(
    orderedChunks.flatMap((chunk) => chunkKeyEvents(chunk)),
    (item) => `${item.事件}|${item.时间地点}|${item.结果}`,
    10
  );
  const characterStates = uniqueRecords(
    orderedChunks.flatMap((chunk) => chunkCharacterStates(chunk)),
    (item) => `${item.人物}|${item.本章变化}`,
    10
  );
  const characterKnowledge = uniqueRecords(
    orderedChunks.flatMap((chunk) => chunkCharacterKnowledge(chunk)),
    (item) => `${item.人物}|${item.认知变化}`,
    10
  );
  const facts = uniqueStrings(orderedChunks.flatMap((chunk) => chunkFacts(chunk)), 12);
  const timePlaces = orderedChunks.map((chunk) => chunkTimePlace(chunk));
  const lostInfo = uniqueStrings(
    orderedChunks.flatMap((chunk) => chunk.structured.不可丢失信息),
    10
  );
  const places = uniqueStrings(
    timePlaces.flatMap((item) => item.places),
    8
  );
  const timeClues = uniqueStrings(timePlaces.flatMap((item) => item.timeClues), 8);
  const propsAndRules = uniqueStrings(orderedChunks.flatMap((chunk) => chunkPropsAndRules(chunk)), 10);
  const foreshadowing = uniqueRecords(
    orderedChunks.flatMap((chunk) => chunkForeshadowing(chunk)),
    (item) => `${item.线索}|${item.状态}|${item.指向或意义}`,
    8
  );
  const risks = uniqueStrings(orderedChunks.flatMap((chunk) => chunkRisks(chunk)), 8);
  const unresolvedQuestions = uniqueStrings(orderedChunks.flatMap((chunk) => chunkUnresolvedQuestions(chunk)), 8);
  const indexMaterials = orderedChunks.map((chunk) => indexMaterialFromSummaryPayload(chunk.structured)).filter((material): material is RawIndexMaterialPayload => Boolean(material));
  const indexMaterialScenes = uniqueRecords(
    indexMaterials.flatMap((material) => material.场景节点),
    (item) => indexMaterialRecordKey(item, ["标题", "地点", "结果", "证据短句"]),
    12
  );
  const indexMaterialTimelineEvents = uniqueRecords(
    indexMaterials.flatMap((material) => material.时间线事件),
    (item) => indexMaterialRecordKey(item, ["事件", "叙事顺序", "故事内时间", "相对时间锚点", "证据短句"]),
    16
  );
  const indexMaterialEntities = uniqueRecords(
    indexMaterials.flatMap((material) => material.通用实体),
    (item) => indexMaterialRecordKey(item, ["名称", "类型", "本章状态"]),
    20
  );
  const indexMaterialFacts = uniqueRecords(
    indexMaterials.flatMap((material) => material.原子事实),
    (item) => indexMaterialRecordKey(item, ["主体", "类型", "属性", "值", "生效范围"]),
    24
  );
  const fallbackSceneNodes = chunkSummaries.slice(0, 6).map((summary, index) => ({
    序号: index + 1,
    标题: limitText(summary, 42),
    类型: "片段场景",
    出场人物: [],
    地点: "未明确",
    场景目标: "未明确",
    核心冲突: "未明确",
    结果: summary,
    情绪变化: "未明确",
    功能: "长章节片段推进",
    证据短句: []
  }));
  const fallbackTimelineEvents = keyEvents.slice(0, 12).map((event, index) => ({
    事件: event.事件,
    叙事顺序: index + 1,
    故事内时间: "未明确",
    相对时间锚点: event.时间地点,
    参与人物: event.涉及人物,
    地点: event.时间地点,
    因果前置: [],
    结果影响: [event.结果, event.后续影响].filter((value) => value && value !== "未明确"),
    置信度: 0.7,
    证据短句: event.证据短句
  }));
  const fallbackEntities = uniqueRecords(
    [
      ...characterStates.map((character) => ({
        名称: character.人物,
        别名: [],
        类型: "人物",
        本章状态: character.本章变化,
        新增信息: [],
        关联人物: [],
        证据短句: character.证据短句
      })),
      ...places.map((place) => ({
        名称: place,
        别名: [],
        类型: "地点",
        本章状态: "本章出现地点",
        新增信息: [],
        关联人物: [],
        证据短句: []
      }))
    ],
    (item) => indexMaterialRecordKey(item, ["名称", "类型"]),
    20
  );
  const fallbackAtomicFacts = facts.slice(0, 16).map((fact) => ({
    主体: "未明确",
    类型: "可核对事实",
    属性: "事实",
    值: fact,
    生效范围: `第${content.sortOrder + 1}章`,
    确定性: "确定",
    证据短句: []
  }));
  const indexMaterialStructureMarker = mergeIndexMaterialStructureMarkers(indexMaterials) ?? {
    章节位置: "未明确",
    叙事功能: ["长章节片段聚合"],
    节奏: "未明确",
    情绪走向: "未明确",
    视角: "未明确",
    备注: "由片段缓存本地合并生成"
  };

  return {
    章节信息: {
      章节序号: content.sortOrder + 1,
      章节标题: content.title,
      正文覆盖: "完整章节",
      缓存类型: "章节缓存",
      缓存版本: "三-Lite",
      语言: "简体中文"
    },
    缓存质量: {
      覆盖完整度: "完整",
      信息密度: "高",
      需要回读原文: "否",
      缺失说明: []
    },
    一句话摘要: oneLine,
    短摘要: shortText,
    详细梗概:
      detailText.length >= 60
        ? detailText
        : `${detailText || content.title}。本章已完成长章节片段缓存聚合，当前缓存保留片段摘要、关键事件、人物状态、伏笔线索、可核对事实和不可丢失信息，供后续总结、查询与校对使用。`,
    章节作用: {
      剧情作用: "由多个片段缓存聚合，保留本章连续剧情推进。",
      人物作用: "合并片段内主要人物状态和认知变化。",
      后文作用: "为后续全文总结、人物查询、伏笔查询和连续性检查提供章节级索引。"
    },
    场景推进: uniqueStrings(chunkSummaries, 6),
    关键事件:
      keyEvents.length > 0
        ? keyEvents
        : [
            {
              事件: "长章节片段缓存已建立",
              涉及人物: [],
              时间地点: "未明确",
              结果: "系统按片段保留章节事实",
              后续影响: "后续查询可使用片段事实索引",
              证据短句: []
            }
          ],
    人物状态:
      characterStates.length > 0
        ? characterStates
        : [
            {
              人物: "未明确",
              本章变化: "未明确",
              行动: [],
              目标或动机: "未明确",
              新获得信息: [],
              仍不知道的信息: [],
              关系变化: [],
              证据短句: []
            }
          ],
    人物认知边界: characterKnowledge,
    关系变化: uniqueStrings(characterStates.flatMap((item) => item.关系变化), 10),
    索引原料: {
      场景节点: indexMaterialScenes.length > 0 ? indexMaterialScenes : fallbackSceneNodes,
      时间线事件: indexMaterialTimelineEvents.length > 0 ? indexMaterialTimelineEvents : fallbackTimelineEvents,
      通用实体: indexMaterialEntities.length > 0 ? indexMaterialEntities : fallbackEntities,
      原子事实: indexMaterialFacts.length > 0 ? indexMaterialFacts : fallbackAtomicFacts,
      结构标记: indexMaterialStructureMarker
    },
    时间地点: {
      本章时间: firstDefined(timePlaces.map((item) => item.time), "未明确"),
      主要地点: places,
      时间线索: timeClues,
      地点移动: uniqueStrings(timePlaces.flatMap((item) => item.moves), 8),
      可能风险: uniqueStrings(timePlaces.flatMap((item) => item.risks), 8)
    },
    道具设定变化: propsAndRules,
    伏笔与线索: foreshadowing,
    可核对事实:
      facts.length > 0
        ? facts
        : ["长章节由片段缓存聚合而成，后续查询应参考片段缓存事实条目"],
    连续性风险: risks,
    未解决问题: unresolvedQuestions,
    文风要点: ["长章节由多个连续片段构成", "续写时需承接已建立的人物状态和片段关键事件"],
    不可丢失信息:
      lostInfo.length > 0
        ? lostInfo
        : ["长章节已按片段建立事实索引，后续回答需要参考片段缓存"],
    不确定项: []
  };
}

function trimBounds(text: string, start: number, end: number): { readonly start: number; readonly end: number } | null {
  let trimmedStart = start;
  let trimmedEnd = end;
  while (trimmedStart < trimmedEnd && /\s/u.test(text[trimmedStart] ?? "")) {
    trimmedStart += 1;
  }
  while (trimmedEnd > trimmedStart && /\s/u.test(text[trimmedEnd - 1] ?? "")) {
    trimmedEnd -= 1;
  }
  return trimmedStart < trimmedEnd ? { start: trimmedStart, end: trimmedEnd } : null;
}

function findForwardWritingUnitOffset(text: string, start: number, end: number, targetUnits: number): number {
  let offset = start;
  let units = 0;
  for (const char of text.slice(start, end)) {
    const nextOffset = offset + char.length;
    const nextUnits = units + countWritingUnits(char);
    if (nextUnits > targetUnits && offset > start) {
      break;
    }
    units = nextUnits;
    offset = nextOffset;
  }
  return offset > start ? offset : end;
}

function findBackwardWritingUnitOffset(text: string, start: number, end: number, targetUnits: number): number {
  let offset = end;
  let units = 0;
  while (offset > start && units < targetUnits) {
    const previous = offset - 1;
    const char = text.slice(previous, offset);
    units += countWritingUnits(char);
    offset = previous;
  }
  return offset;
}

function splitParagraphPieces(plainText: string, targetUnits: number): Array<{ readonly start: number; readonly end: number; readonly units: number }> {
  const pieces: Array<{ readonly start: number; readonly end: number; readonly units: number }> = [];
  const paragraphBreakPattern = /\n{2,}/g;
  let start = 0;
  let match: RegExpExecArray | null;
  const addSegment = (rawStart: number, rawEnd: number) => {
    const bounds = trimBounds(plainText, rawStart, rawEnd);
    if (!bounds) {
      return;
    }
    const units = countWritingUnits(plainText.slice(bounds.start, bounds.end));
    if (units <= targetUnits) {
      pieces.push({ ...bounds, units });
      return;
    }
    let splitStart = bounds.start;
    while (splitStart < bounds.end) {
      const splitEnd = findForwardWritingUnitOffset(plainText, splitStart, bounds.end, targetUnits);
      const splitBounds = trimBounds(plainText, splitStart, splitEnd);
      if (splitBounds) {
        pieces.push({
          ...splitBounds,
          units: countWritingUnits(plainText.slice(splitBounds.start, splitBounds.end))
        });
      }
      if (splitEnd <= splitStart) {
        break;
      }
      splitStart = splitEnd;
    }
  };

  while ((match = paragraphBreakPattern.exec(plainText))) {
    addSegment(start, match.index);
    start = match.index + match[0].length;
  }
  addSegment(start, plainText.length);
  return pieces;
}

export function splitChapterForSummaryIndex(
  plainText: string,
  options: { readonly targetUnits?: number; readonly overlapUnits?: number } = {}
): ChapterSummaryIndexChunk[] {
  const targetUnits = Math.max(1, options.targetUnits ?? CHAPTER_INDEX_CHUNK_TARGET_UNITS);
  const overlapUnits = Math.max(0, options.overlapUnits ?? CHAPTER_INDEX_CHUNK_OVERLAP_UNITS);
  const pieces = splitParagraphPieces(plainText, targetUnits);
  if (pieces.length === 0) {
    return [];
  }

  const ranges: Array<{ readonly start: number; readonly end: number; readonly units: number }> = [];
  let currentStart = pieces[0].start;
  let currentEnd = pieces[0].end;
  let currentUnits = 0;

  for (const piece of pieces) {
    if (currentUnits > 0 && currentUnits + piece.units > targetUnits) {
      ranges.push({ start: currentStart, end: currentEnd, units: currentUnits });
      currentStart = piece.start;
      currentEnd = piece.end;
      currentUnits = piece.units;
      continue;
    }
    currentEnd = piece.end;
    currentUnits += piece.units;
  }
  ranges.push({ start: currentStart, end: currentEnd, units: currentUnits });

  return ranges.map((range, index) => {
    const textStart =
      index === 0 ? range.start : findBackwardWritingUnitOffset(plainText, ranges[index - 1]?.start ?? 0, range.start, overlapUnits);
    const bounds = trimBounds(plainText, textStart, range.end) ?? { start: textStart, end: range.end };
    return {
      chunkIndex: index,
      chunkCount: ranges.length,
      text: plainText.slice(bounds.start, bounds.end),
      textStart: bounds.start,
      textEnd: bounds.end
    };
  });
}

type BookRelationshipGraphPayload = NonNullable<BookAiSummaryPayload["人物关系图谱"]>;
type BookGraphCharacterPayload = BookRelationshipGraphPayload["人物"][number];
type BookGraphRelationPayload = BookRelationshipGraphPayload["关系"][number];
type BookGraphLabelPayload = BookGraphRelationPayload["labels"][number];
type BookGraphEvidencePayload = BookGraphRelationPayload["evidence"][number];
type ArcCharacterGraphPayload = NonNullable<ArcAiSummaryPayload["人物图谱"]>;
type ArcGraphCharacterPayload = ArcCharacterGraphPayload["人物归一"][number];
type ArcGraphRelationPayload = ArcCharacterGraphPayload["基础关系"][number];
type ArcGraphAmbiguousReferencePayload = ArcCharacterGraphPayload["称谓待确认"][number];
type ArcGraphQualityIssuePayload = ArcCharacterGraphPayload["质量提示"][number];

type BookGraphStageIndexAccumulator = {
  readonly arcKey: string;
  readonly startChapter: number;
  readonly endChapter: number;
  readonly characterIds: Set<string>;
  readonly relationIds: Set<string>;
};

type BookGraphCharacterAccumulator = {
  readonly id: string;
  name: string;
  readonly aliases: Set<string>;
  readonly mentionForms: Set<string>;
  readonly roleHints: Set<string>;
  importance: BookGraphCharacterPayload["importance"];
  firstSeenChapter: number;
  lastSeenChapter: number;
  readonly confidenceValues: number[];
  readonly chapterActivity: Map<number, { weight: number; relationEventCount: number }>;
  readonly sourceArcRanges: Map<string, { start: number; end: number }>;
};

type BookGraphRelationAccumulator = {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  primaryLabel: string;
  category: BookGraphRelationPayload["category"];
  polarity: BookGraphRelationPayload["polarity"];
  directed: boolean;
  stable: boolean;
  readonly labels: Map<string, BookGraphLabelPayload & { confidenceValues: number[] }>;
  readonly evidence: BookGraphEvidencePayload[];
};

const GRAPH_IMPORTANCE_RANK: Record<BookGraphCharacterPayload["importance"], number> = {
  major: 4,
  supporting: 3,
  minor: 2,
  unknown: 1
};

function normalizeGraphLookupKey(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/gu, "");
}

function isUsefulGraphText(value: string | null | undefined): value is string {
  const text = value?.trim();
  return Boolean(text && text !== "未明确" && text !== "无" && text !== "暂无" && text !== "未知");
}

function addUniqueGraphText(target: Set<string>, value: string | null | undefined): void {
  const text = value?.trim();
  if (isUsefulGraphText(text)) {
    target.add(text);
  }
}

function sortedGraphTexts(values: ReadonlySet<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function roundGraphNumber(value: number): number {
  return Number(value.toFixed(2));
}

function averageGraphConfidence(values: readonly number[]): number {
  if (values.length === 0) {
    return 0.6;
  }
  return roundGraphNumber(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function strongerGraphImportance(
  current: BookGraphCharacterPayload["importance"],
  next: BookGraphCharacterPayload["importance"]
): BookGraphCharacterPayload["importance"] {
  return GRAPH_IMPORTANCE_RANK[next] > GRAPH_IMPORTANCE_RANK[current] ? next : current;
}

function graphId(prefix: string, parts: readonly string[]): string {
  return `${prefix}-${computeSourceHash(parts).slice(0, 12)}`;
}

function arcRangeKey(arc: ArcAiSummaryRecord): string {
  return `${arc.chapterFrom}-${arc.chapterTo}`;
}

function arcRangeLabel(arc: ArcAiSummaryRecord): string {
  return `第${arc.chapterFrom}-${arc.chapterTo}章`;
}

function recordGraphCharacterActivity(
  character: BookGraphCharacterAccumulator,
  chapterNumber: number,
  weight: number,
  relationEventCount = 0
): void {
  if (!Number.isFinite(chapterNumber) || chapterNumber <= 0) {
    return;
  }
  const current = character.chapterActivity.get(chapterNumber) ?? { weight: 0, relationEventCount: 0 };
  character.chapterActivity.set(chapterNumber, {
    weight: roundGraphNumber(current.weight + weight),
    relationEventCount: current.relationEventCount + relationEventCount
  });
}

function collectArcCharacterLookupNames(character: ArcGraphCharacterPayload): string[] {
  return [
    character.canonicalName,
    character.displayName,
    ...character.aliases,
    ...character.mentionForms
  ].filter(isUsefulGraphText);
}

function mergeArcCharacterIntoAccumulator(
  accumulator: BookGraphCharacterAccumulator,
  character: ArcGraphCharacterPayload,
  arc: ArcAiSummaryRecord
): void {
  if (isUsefulGraphText(character.displayName) && !accumulator.name) {
    accumulator.name = character.displayName;
  }
  addUniqueGraphText(accumulator.aliases, character.canonicalName === accumulator.name ? null : character.canonicalName);
  for (const alias of character.aliases) {
    addUniqueGraphText(accumulator.aliases, alias);
  }
  for (const mentionForm of character.mentionForms) {
    addUniqueGraphText(accumulator.mentionForms, mentionForm);
  }
  for (const roleHint of character.roleHints) {
    addUniqueGraphText(accumulator.roleHints, roleHint);
  }
  accumulator.importance = strongerGraphImportance(accumulator.importance, character.importance);
  accumulator.firstSeenChapter = Math.min(accumulator.firstSeenChapter, character.firstSeenChapter);
  accumulator.lastSeenChapter = Math.max(accumulator.lastSeenChapter, character.lastSeenChapter);
  accumulator.confidenceValues.push(character.confidence);
  accumulator.sourceArcRanges.set(arcRangeKey(arc), { start: arc.chapterFrom, end: arc.chapterTo });
  for (const evidence of character.evidence) {
    recordGraphCharacterActivity(accumulator, evidence.chapterNumber, 1, 0);
  }
  if (character.evidence.length === 0) {
    recordGraphCharacterActivity(accumulator, character.firstSeenChapter, 1, 0);
  }
}

function buildBookRelationshipGraphFromArcs(arcs: readonly ArcAiSummaryRecord[], coverage: BookSummaryCoverage): BookRelationshipGraphPayload {
  const characters = new Map<string, BookGraphCharacterAccumulator>();
  const nameLookup = new Map<string, string>();
  const relations = new Map<string, BookGraphRelationAccumulator>();
  const stageIndex = new Map<string, BookGraphStageIndexAccumulator>();
  const ambiguousReferences: ArcGraphAmbiguousReferencePayload[] = [];
  const qualityIssues: ArcGraphQualityIssuePayload[] = [];

  function getStage(arc: ArcAiSummaryRecord): BookGraphStageIndexAccumulator {
    let current = stageIndex.get(arc.arcKey);
    if (!current) {
      current = {
        arcKey: arc.arcKey,
        startChapter: arc.chapterFrom,
        endChapter: arc.chapterTo,
        characterIds: new Set<string>(),
        relationIds: new Set<string>()
      };
      stageIndex.set(arc.arcKey, current);
    }
    return current;
  }

  function registerCharacterNames(characterId: string, names: readonly string[]): void {
    for (const name of names) {
      const key = normalizeGraphLookupKey(name);
      if (key && !nameLookup.has(key)) {
        nameLookup.set(key, characterId);
      }
    }
  }

  function getOrCreateCharacterByName(name: string, arc: ArcAiSummaryRecord): BookGraphCharacterAccumulator {
    const normalizedName = normalizeGraphLookupKey(name);
    const existingId = normalizedName ? nameLookup.get(normalizedName) : undefined;
    if (existingId) {
      const existing = characters.get(existingId);
      if (existing) {
        getStage(arc).characterIds.add(existing.id);
        return existing;
      }
    }
    const displayName = isUsefulGraphText(name) ? name.trim() : "未命名人物";
    const id = graphId("character", [displayName]);
    const created: BookGraphCharacterAccumulator = {
      id,
      name: displayName,
      aliases: new Set<string>(),
      mentionForms: new Set<string>(),
      roleHints: new Set<string>(),
      importance: "unknown",
      firstSeenChapter: arc.chapterFrom,
      lastSeenChapter: arc.chapterTo,
      confidenceValues: [0.55],
      chapterActivity: new Map<number, { weight: number; relationEventCount: number }>(),
      sourceArcRanges: new Map<string, { start: number; end: number }>([[arcRangeKey(arc), { start: arc.chapterFrom, end: arc.chapterTo }]])
    };
    recordGraphCharacterActivity(created, arc.chapterFrom, 1, 0);
    characters.set(id, created);
    registerCharacterNames(id, [displayName]);
    getStage(arc).characterIds.add(id);
    return created;
  }

  function mergeCharacter(character: ArcGraphCharacterPayload, arc: ArcAiSummaryRecord): BookGraphCharacterAccumulator {
    const names = collectArcCharacterLookupNames(character);
    const existingId = names.map((name) => nameLookup.get(normalizeGraphLookupKey(name))).find(Boolean);
    const target = existingId && characters.has(existingId)
      ? characters.get(existingId)!
      : getOrCreateCharacterByName(character.displayName || character.canonicalName, arc);
    mergeArcCharacterIntoAccumulator(target, character, arc);
    registerCharacterNames(target.id, names);
    getStage(arc).characterIds.add(target.id);
    return target;
  }

  function addRelation(relation: ArcGraphRelationPayload, arc: ArcAiSummaryRecord): void {
    const source = getOrCreateCharacterByName(relation.source, arc);
    const target = getOrCreateCharacterByName(relation.target, arc);
    const orderedIds = relation.directed || source.id <= target.id ? [source.id, target.id] : [target.id, source.id];
    const key = [
      relation.directed ? "directed" : "undirected",
      orderedIds[0],
      orderedIds[1],
      relation.category,
      relation.stable ? "stable" : "dynamic"
    ].join("|");
    let current = relations.get(key);
    if (!current) {
      current = {
        id: graphId("relation", [key]),
        sourceId: orderedIds[0],
        targetId: orderedIds[1],
        primaryLabel: relation.label,
        category: relation.category,
        polarity: relation.polarity,
        directed: relation.directed,
        stable: relation.stable,
        labels: new Map<string, BookGraphLabelPayload & { confidenceValues: number[] }>(),
        evidence: []
      };
      relations.set(key, current);
    }
    if (current.polarity !== relation.polarity) {
      current.polarity = "mixed";
    }
    current.directed = current.directed || relation.directed;
    current.stable = current.stable && relation.stable;
    const existingLabel = current.labels.get(relation.label);
    if (existingLabel) {
      existingLabel.firstSeenChapter = Math.min(existingLabel.firstSeenChapter, relation.firstSeenChapter);
      existingLabel.lastSeenChapter = Math.max(existingLabel.lastSeenChapter, relation.lastSeenChapter);
      existingLabel.confidenceValues.push(relation.confidence);
      existingLabel.confidence = averageGraphConfidence(existingLabel.confidenceValues);
    } else {
      current.labels.set(relation.label, {
        label: relation.label,
        firstSeenChapter: relation.firstSeenChapter,
        lastSeenChapter: relation.lastSeenChapter,
        confidence: relation.confidence,
        confidenceValues: [relation.confidence]
      });
    }
    if (!current.primaryLabel || relation.confidence > (current.labels.get(current.primaryLabel)?.confidence ?? 0)) {
      current.primaryLabel = relation.label;
    }
    const relationEvidence = relation.evidence.length > 0
      ? relation.evidence
      : [{ chapterNumber: relation.firstSeenChapter, text: "", reason: relation.label }];
    for (const evidence of relationEvidence) {
      current.evidence.push({
        chapterNumber: evidence.chapterNumber,
        arcRange: arcRangeLabel(arc),
        text: evidence.text,
        reason: evidence.reason
      });
      recordGraphCharacterActivity(source, evidence.chapterNumber, 0.5, 1);
      recordGraphCharacterActivity(target, evidence.chapterNumber, 0.5, 1);
    }
    getStage(arc).characterIds.add(source.id);
    getStage(arc).characterIds.add(target.id);
    getStage(arc).relationIds.add(current.id);
  }

  for (const arc of arcs) {
    const graph = arc.structured.人物图谱;
    getStage(arc);
    if (!graph) {
      qualityIssues.push({
        level: "warning",
        message: `阶段 ${arcRangeLabel(arc)} 缺少人物图谱，未参与全书关系图合成。`,
        chapterNumber: arc.chapterFrom
      });
      continue;
    }
    for (const character of graph.人物归一) {
      mergeCharacter(character, arc);
    }
    ambiguousReferences.push(...graph.称谓待确认);
    qualityIssues.push(...graph.质量提示);
  }

  for (const arc of arcs) {
    const graph = arc.structured.人物图谱;
    if (!graph) {
      continue;
    }
    for (const relation of [...graph.基础关系, ...graph.剧情关系]) {
      addRelation(relation, arc);
    }
  }

  const sortedCharacters = [...characters.values()].sort((a, b) => {
    const importanceDelta = GRAPH_IMPORTANCE_RANK[b.importance] - GRAPH_IMPORTANCE_RANK[a.importance];
    if (importanceDelta !== 0) {
      return importanceDelta;
    }
    if (a.firstSeenChapter !== b.firstSeenChapter) {
      return a.firstSeenChapter - b.firstSeenChapter;
    }
    return a.name.localeCompare(b.name, "zh-CN");
  });
  const sortedRelations = [...relations.values()].sort((a, b) => {
    const categoryDelta = a.category.localeCompare(b.category, "zh-CN");
    if (categoryDelta !== 0) {
      return categoryDelta;
    }
    return a.primaryLabel.localeCompare(b.primaryLabel, "zh-CN");
  });
  const chapterStart = arcs.length > 0 ? Math.min(...arcs.map((arc) => arc.chapterFrom)) : 1;
  const chapterEnd = arcs.length > 0 ? Math.max(...arcs.map((arc) => arc.chapterTo)) : Math.max(1, coverage.totalChapterCount);

  return {
    版本: "summary-relationship-v1",
    生成来源: {
      arcSummaryIds: arcs.map((arc) => arc.arcKey),
      chapterRange: {
        start: chapterStart,
        end: chapterEnd
      }
    },
    人物: sortedCharacters.map((character): BookGraphCharacterPayload => ({
      id: character.id,
      name: character.name,
      aliases: sortedGraphTexts(character.aliases).filter((alias) => alias !== character.name),
      mentionForms: sortedGraphTexts(character.mentionForms),
      roleHints: sortedGraphTexts(character.roleHints),
      importance: character.importance,
      firstSeenChapter: character.firstSeenChapter,
      lastSeenChapter: character.lastSeenChapter,
      chapterActivity: [...character.chapterActivity.entries()]
        .sort(([left], [right]) => left - right)
        .map(([chapterNumber, activity]) => ({
          chapterNumber,
          weight: roundGraphNumber(activity.weight),
          relationEventCount: activity.relationEventCount
        })),
      confidence: averageGraphConfidence(character.confidenceValues),
      sourceArcRanges: [...character.sourceArcRanges.values()].sort((a, b) => a.start - b.start || a.end - b.end)
    })),
    关系: sortedRelations.map((relation): BookGraphRelationPayload => ({
      id: relation.id,
      sourceId: relation.sourceId,
      targetId: relation.targetId,
      primaryLabel: relation.primaryLabel,
      category: relation.category,
      polarity: relation.polarity,
      directed: relation.directed,
      stable: relation.stable,
      labels: [...relation.labels.values()]
        .sort((a, b) => a.firstSeenChapter - b.firstSeenChapter || b.confidence - a.confidence)
        .map(({ confidenceValues: _confidenceValues, ...label }) => label),
      evidence: relation.evidence.sort((a, b) => a.chapterNumber - b.chapterNumber)
    })),
    阶段索引: [...stageIndex.values()]
      .sort((a, b) => a.startChapter - b.startChapter)
      .map((stage) => ({
        arcKey: stage.arcKey,
        startChapter: stage.startChapter,
        endChapter: stage.endChapter,
        characterIds: [...stage.characterIds].sort(),
        relationIds: [...stage.relationIds].sort()
      })),
    未确认称谓: ambiguousReferences,
    图谱摘要: `由 ${arcs.length} 个阶段人物图谱合成：${sortedCharacters.length} 个人物，${sortedRelations.length} 条关系。`,
    质量提示: qualityIssues
  };
}

export class SummaryService implements SummaryIndexInvalidator {
  private readonly activeChapterEditTimes = new Map<string, string>();
  private readonly changedWritingUnits = new Map<string, number>();
  private readonly immediateCacheMilestoneChapterHashes = new Map<string, string>();

  constructor(
    private readonly summaryRepo: SummaryRepository,
    private readonly chapterRepo: ChapterRepository,
    private readonly options: SummaryServiceOptions = {}
  ) {}

  markChapterContentChanged(input: SummaryIndexInvalidationInput): void {
    const previousHash = computeChapterContentHash(input.previousPlainText);
    const nextHash = computeChapterContentHash(input.nextPlainText);
    if (previousHash === nextHash) {
      return;
    }

    this.summaryRepo.markChapterStale(input.projectId, input.chapterId, nextHash, input.updatedAt);
    this.recordActiveChapterEdit(input.projectId, input.chapterId, input.updatedAt);
    this.changedWritingUnits.set(keyFor(input.projectId, input.chapterId), Math.abs(input.nextWordCount - input.previousWordCount));
    const chapterKey = keyFor(input.projectId, input.chapterId);
    const content = this.chapterRepo.getContent(input.chapterId);
    if (content && this.isLatestChapter(input.projectId, content) && crossesImmediateLatestChapterCacheMilestone(input.previousWordCount, input.nextWordCount)) {
      this.immediateCacheMilestoneChapterHashes.set(chapterKey, nextHash);
      this.maybeEnqueueChapterSummary({
        projectId: input.projectId,
        chapterId: input.chapterId,
        trigger: "auto_idle",
        now: input.updatedAt
      });
    } else {
      this.immediateCacheMilestoneChapterHashes.delete(chapterKey);
    }
  }

  recordActiveChapterEdit(projectId: string, chapterId: string, editedAt: string): void {
    this.activeChapterEditTimes.set(keyFor(projectId, chapterId), editedAt);
  }

  onChapterBecameInactive(projectId: string, chapterId: string, now: string): SummaryJobRecord | null {
    const job = this.maybeEnqueueChapterSummary({
      projectId,
      chapterId,
      trigger: "chapter_inactive",
      now
    });
    if (job || this.isIdle(projectId, chapterId, now)) {
      this.activeChapterEditTimes.delete(keyFor(projectId, chapterId));
    }
    return job;
  }

  maybeEnqueueChapterSummary(input: MaybeEnqueueChapterSummaryInput): SummaryJobRecord | null {
    const content = this.chapterRepo.getContent(input.chapterId);
    if (!content || content.projectId !== input.projectId) {
      throw new Error("找不到需要建立摘要的章节。");
    }
    if ((input.trigger === "auto_idle" || input.trigger === "chapter_inactive") && !this.summaryRepo.getBackgroundIndexEnabled(input.projectId)) {
      return null;
    }

    const writingUnits = countWritingUnits(content.plainText);
    const sourceHash = computeChapterContentHash(content.plainText);
    if (isManualSummaryTrigger(input.trigger) && writingUnits < MIN_MANUAL_SUMMARY_UNITS) {
      this.markSkippedTooShort(content, sourceHash, input.now);
      return null;
    }
    if (!isManualSummaryTrigger(input.trigger) && writingUnits < MIN_AUTO_SUMMARY_UNITS) {
      return null;
    }
    const existingSummary = this.summaryRepo.getChapterSummary(input.projectId, input.chapterId);
    if (input.trigger !== "manual_rebuild" && existingSummary && isReadyChapterSummary(existingSummary, sourceHash)) {
      return null;
    }
    const isLatestChapter = this.isLatestChapter(input.projectId, content);
    const canBypassIdle = this.canBypassIdleForImmediateLatestChapterSummary(
      input.projectId,
      input.chapterId,
      sourceHash,
      existingSummary,
      isLatestChapter
    );
    if ((input.trigger === "auto_idle" || input.trigger === "chapter_inactive") && !canBypassIdle && !this.isIdle(input.projectId, input.chapterId, input.now)) {
      return null;
    }

    const job = this.summaryRepo.enqueueSummaryJob({
      projectId: input.projectId,
      jobType: "chapter_summary" satisfies SummaryJobType,
      targetId: input.chapterId,
      sourceHash,
      priority: priorityFor(input.trigger, this.changedWritingUnits.get(keyFor(input.projectId, input.chapterId)) ?? null, isLatestChapter),
      now: input.now
    });
    if (canBypassIdle) {
      this.immediateCacheMilestoneChapterHashes.delete(keyFor(input.projectId, input.chapterId));
    }
    return job;
  }

  enqueueEligibleStaleChapterSummaries(projectId: string, now: string): SummaryJobRecord[] {
    if (!this.summaryRepo.getBackgroundIndexEnabled(projectId)) {
      return [];
    }
    const jobs: SummaryJobRecord[] = [];
    const summaries = this.summaryRepo.listChapterSummaries(projectId);
    const summaryChapterIds = new Set(summaries.map((summary) => summary.chapterId));
    for (const summary of summaries) {
      if (summary.status !== "stale") {
        continue;
      }
      const job = this.maybeEnqueueChapterSummary({
        projectId,
        chapterId: summary.chapterId,
        trigger: "auto_idle",
        now
      });
      if (job) {
        jobs.push(job);
      }
    }
    for (const chapter of this.chapterRepo.listByProject(projectId)) {
      if (summaryChapterIds.has(chapter.id)) {
        continue;
      }
      const job = this.maybeEnqueueChapterSummary({
        projectId,
        chapterId: chapter.id,
        trigger: "auto_idle",
        now
      });
      if (job) {
        jobs.push(job);
      }
    }
    return jobs;
  }

  getIndexStatus(projectId: string, now: string, options: SummaryIndexStatusOptions = {}): SummaryIndexStatus {
    const backgroundEnabled = this.summaryRepo.getBackgroundIndexEnabled(projectId);
    const chapters = this.chapterRepo.listByProject(projectId);
    const summaries = new Map(this.summaryRepo.listChapterSummaries(projectId).map((summary) => [summary.chapterId, summary]));
    let readyChapterCount = 0;
    let staleChapterCount = 0;
    let skippedTooShortChapterCount = 0;
    let missingChapterCount = 0;

    for (const chapter of chapters) {
      const summary = summaries.get(chapter.id);
      if (!summary) {
        missingChapterCount += 1;
        continue;
      }
      const cacheState = getChapterSummaryCacheState(summary, chapter);
      if (cacheState === "ready") {
        readyChapterCount += 1;
        continue;
      }
      if (cacheState === "skipped_too_short") {
        skippedTooShortChapterCount += 1;
        continue;
      }
      staleChapterCount += 1;
    }

    const jobResolutionCache = {
      chapters,
      chapterById: new Map(chapters.map((chapter) => [chapter.id, chapter])),
      chapterIds: new Set(chapters.map((chapter) => chapter.id)),
      chapterSummaries: summaries,
      arcSummaries: new Map(this.summaryRepo.listArcSummaries(projectId).map((summary) => [summary.arcKey, summary])),
      bookSummary: this.summaryRepo.getLatestBookSummary(projectId)
    };
    const rawJobs = this.summaryRepo.listSummaryJobs(projectId);
    const queuedRetryKeys = new Set(
      rawJobs.filter((job) => job.status === "queued" && job.nextRunAt).map((job) => this.summaryJobResolutionKey(job))
    );
    const jobs = rawJobs.filter(
      (job) =>
        (job.status !== "failed" || (hasSummaryJobError(job) && !isLegacyInternalDerivedSummaryFailure(job))) &&
        this.isSummaryJobRelevantToCurrentIndex(projectId, job, jobResolutionCache) &&
        !this.isJobResolvedByCurrentSummaryIndex(job, jobResolutionCache, queuedRetryKeys)
    );
    const runningJob = jobs.find((job) => job.status === "running") ?? null;
    const failedJobs = jobs.filter((job) => job.status === "failed");
    const retryingJobs = jobs
      .filter((job) => job.status === "queued" && job.nextRunAt && job.nextRunAt > now)
      .sort((left, right) => String(left.nextRunAt).localeCompare(String(right.nextRunAt)));
    const nextRetryJob = retryingJobs[0] ?? null;

    return {
      projectId,
      totalChapterCount: chapters.length,
      readyChapterCount,
      staleChapterCount,
      missingChapterCount,
      skippedTooShortChapterCount,
      failedJobCount: failedJobs.length,
      cancelledJobCount: jobs.filter((job) => job.status === "cancelled").length,
      queuedJobCount: jobs.filter((job) => job.status === "queued").length,
      runningJobLabel: runningJob ? this.formatRunningJobLabel(projectId, runningJob) : null,
      nextRetryAt: nextRetryJob?.nextRunAt ?? null,
      nextRetryJobLabel: nextRetryJob ? this.formatPendingRetryJobLabel(projectId, nextRetryJob) : null,
      backgroundEnabled,
      retryingJobs: retryingJobs.slice(0, 5).map((job) => this.formatSummaryJobDetail(projectId, job)),
      recentFailedJobs: failedJobs
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 5)
        .map((job) => this.formatSummaryJobDetail(projectId, job)),
      pausedReason: backgroundEnabled ? (options.pausedReason ?? null) : "background_disabled",
      updatedAt: now
    };
  }

  listChapterCacheEntries(projectId: string, now: string): SummaryChapterCacheEntry[] {
    const summaries = new Map(this.summaryRepo.listChapterSummaries(projectId).map((summary) => [summary.chapterId, summary]));
    const jobs = this.currentChapterJobs(projectId);
    return this.chapterRepo.listByProject(projectId).map((chapter) => {
      const summary = summaries.get(chapter.id) ?? null;
      const rawJob = jobs.get(chapter.id) ?? null;
      const job = this.isChapterJobResolvedByReadySummary(summary, rawJob, chapter) ? null : rawJob;
      const failure = classifySummaryJobError(job?.error ?? null, job?.jobType);
      return {
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterOrder: chapter.sortOrder + 1,
        wordCount: chapter.wordCount,
        cacheState: this.deriveChapterCacheState(summary, job, chapter),
        summaryShort: summary?.summaryShort ?? null,
        summaryUpdatedAt: summary?.updatedAt ?? null,
        contentHash: summary?.contentHash ?? null,
        jobStatus: job?.status ?? null,
        jobError: job?.error?.trim() || null,
        jobFailureCategory: failure.failureCategory,
        jobActionHint: failure.actionHint,
        nextRunAt: job?.nextRunAt ?? null
      } satisfies SummaryChapterCacheEntry;
    });
  }

  getChapterCacheDetail(projectId: string, chapterId: string): SummaryChapterCacheDetail {
    const entry = this.listChapterCacheEntries(projectId, new Date().toISOString()).find((item) => item.chapterId === chapterId);
    if (!entry) {
      throw new Error("找不到章节索引缓存。");
    }
    const summary = this.summaryRepo.getChapterSummary(projectId, chapterId);
    const chunks = summary ? this.summaryRepo.listChapterSummaryChunks(projectId, chapterId, summary.contentHash) : [];
    return {
      ...entry,
      summary: summary
        ? {
            summaryShort: summary.summaryShort,
            summaryLong: summary.summaryLong,
            structured: summary.structured,
            tokenCount: summary.tokenCount,
            status: summary.status,
            error: summary.error,
            updatedAt: summary.updatedAt
          }
        : null,
      chunks: chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        chunkCount: chunk.chunkCount,
        textStart: chunk.textStart,
        textEnd: chunk.textEnd,
        summaryShort: chunk.summaryShort,
        structured: chunk.structured,
        tokenCount: chunk.tokenCount,
        status: chunk.status,
        error: chunk.error,
        updatedAt: chunk.updatedAt
      }))
    };
  }

  listArcCacheEntries(projectId: string, now: string = new Date().toISOString()): SummaryArcCacheEntry[] {
    const summaries = new Map(this.summaryRepo.listArcSummaries(projectId).map((summary) => [summary.arcKey, summary]));
    const jobs = this.currentArcJobs(projectId);
    return this.listExpectedArcRanges(projectId).map((range) => {
      const summary = summaries.get(range.arcKey) ?? null;
      const rawJob = jobs.get(range.arcKey) ?? null;
      const source = this.getArcSourceStatus(projectId, range.chapterFrom, range.chapterTo);
      const job = this.isArcJobResolvedByReadySummary(summary, rawJob, source.sourceHash) ? null : rawJob;
      const failure = classifySummaryJobError(job?.error ?? null, job?.jobType);
      return {
        arcKey: range.arcKey,
        label: formatArcCoverageLabel(range.chapterFrom, range.chapterTo),
        chapterFrom: range.chapterFrom,
        chapterTo: range.chapterTo,
        chapterCount: range.chapterCount,
        readyChapterCount: source.readyChapterCount,
        cacheState: this.deriveArcCacheState(summary, job, source.sourceHash),
        summary: summary?.summary ?? null,
        summaryUpdatedAt: summary?.updatedAt ?? null,
        sourceHash: summary?.sourceHash ?? null,
        jobStatus: job?.status ?? null,
        jobError: job?.error?.trim() || null,
        jobFailureCategory: failure.failureCategory,
        jobActionHint: failure.actionHint,
        nextRunAt: job?.nextRunAt ?? null
      } satisfies SummaryArcCacheEntry;
    });
  }

  getArcCacheDetail(projectId: string, arcKey: string): SummaryArcCacheDetail {
    const entry = this.listArcCacheEntries(projectId).find((item) => item.arcKey === arcKey);
    if (!entry) {
      throw new Error("找不到阶段摘要缓存。");
    }
    const summary = this.summaryRepo.getArcSummary(projectId, arcKey);
    return {
      ...entry,
      summary: summary
        ? {
            summary: summary.summary,
            structured: summary.structured,
            status: summary.status,
            error: summary.error,
            updatedAt: summary.updatedAt
          }
        : null
    };
  }

  getBookCacheDetail(projectId: string): SummaryBookCacheDetail {
    const summary = this.summaryRepo.getLatestBookSummary(projectId);
    const rawJob = this.currentBookJob(projectId);
    const source = this.getReadyBookSummarySource(projectId);
    const job = this.isBookJobResolvedByReadySummary(summary, rawJob, source.sourceHash) ? null : rawJob;
    const failure = classifySummaryJobError(job?.error ?? null, job?.jobType);
    return {
      cacheState: this.deriveBookCacheState(summary, job, source.sourceHash),
      summaryShort: summary?.summaryShort ?? null,
      summaryLong: summary?.summaryLong ?? null,
      summaryUpdatedAt: summary?.updatedAt ?? null,
      sourceHash: summary?.sourceHash ?? null,
      jobStatus: job?.status ?? null,
      jobError: job?.error?.trim() || null,
      jobFailureCategory: failure.failureCategory,
      jobActionHint: failure.actionHint,
      nextRunAt: job?.nextRunAt ?? null,
      summary: summary
        ? {
            summaryShort: summary.summaryShort,
            summaryLong: summary.summaryLong,
            structured: summary.structured,
            status: summary.status,
            error: summary.error,
            updatedAt: summary.updatedAt
          }
        : null
    };
  }

  clearAndRetryChapterCache(projectId: string, chapterId: string, now: string, options: SummaryIndexStatusOptions = {}): SummaryIndexStatus {
    const content = this.chapterRepo.getContent(chapterId);
    if (!content || content.projectId !== projectId) {
      throw new Error("找不到需要重试缓存的章节。");
    }
    this.assertCanClearAndRetryChapterCache(projectId, chapterId);

    this.summaryRepo.setBackgroundIndexEnabled(projectId, true, now);
    this.summaryRepo.deleteChapterSummary(projectId, chapterId);
    this.summaryRepo.deleteDerivedSummaries(projectId);
    this.maybeEnqueueChapterSummary({
      projectId,
      chapterId,
      trigger: "manual_continue",
      now
    });
    return this.getIndexStatus(projectId, now, options);
  }

  clearAndRetryArcCache(projectId: string, arcKey: string, now: string, options: SummaryIndexStatusOptions = {}): SummaryIndexStatus {
    const range = parseAutoArcKey(arcKey);
    if (!range || !this.listExpectedArcRanges(projectId).some((item) => item.arcKey === arcKey)) {
      throw new Error("找不到需要重试的阶段摘要。");
    }
    this.assertCanClearAndRetryArcCache(projectId, arcKey, range.from, range.to);
    const readySummaries = this.collectReadyChapterSummariesForArc(projectId, range.from, range.to);
    const sourceHash = this.computeArcSourceHash(projectId, range.from, readySummaries);

    this.summaryRepo.setBackgroundIndexEnabled(projectId, true, now);
    this.summaryRepo.deleteArcSummaryAndBookCache(projectId, arcKey);
    this.summaryRepo.enqueueSummaryJob({
      projectId,
      jobType: "arc_summary",
      targetId: arcKey,
      sourceHash,
      priority: 6,
      now
    });
    return this.getIndexStatus(projectId, now, options);
  }

  clearAndRetryBookCache(projectId: string, now: string, options: SummaryIndexStatusOptions = {}): SummaryIndexStatus {
    const source = this.getReadyBookSummarySource(projectId);
    if (!source.sourceHash || source.readyArcs.length === 0) {
      throw new SummaryDependencyPendingError("全书摘要等待阶段摘要完成。");
    }
    this.assertCanClearAndRetryBookCache(projectId);

    this.summaryRepo.setBackgroundIndexEnabled(projectId, true, now);
    this.summaryRepo.deleteBookSummaryCache(projectId);
    this.summaryRepo.enqueueSummaryJob({
      projectId,
      jobType: "book_summary",
      targetId: null,
      sourceHash: source.sourceHash,
      priority: 4,
      now
    });
    return this.getIndexStatus(projectId, now, options);
  }

  rebuildProjectIndex(projectId: string, now: string, options: SummaryRebuildProjectIndexOptions = {}): SummaryIndexStatus {
    this.summaryRepo.setBackgroundIndexEnabled(projectId, true, now);
    const trigger: ChapterSummaryQueueTrigger = options.force ? "manual_rebuild" : "manual_continue";
    const chapters = this.chapterRepo.listByProject(projectId);
    if (options.force) {
      this.summaryRepo.clearProjectIndexCache(projectId);
    }
    for (const chapter of chapters) {
      this.maybeEnqueueChapterSummary({
        projectId,
        chapterId: chapter.id,
        trigger,
        now
      });
    }
    if (!options.force) {
      this.enqueueDerivedSummariesIfReady(projectId, now);
    }
    return this.getIndexStatus(projectId, now, options);
  }

  setBackgroundIndexEnabled(projectId: string, enabled: boolean, now: string, options: SummarySetBackgroundIndexOptions = {}): SummaryIndexStatus {
    this.summaryRepo.setBackgroundIndexEnabled(projectId, enabled, now);
    if (!enabled && options.cancelQueuedAndRunning) {
      this.summaryRepo.cancelQueuedAndRunningJobs(projectId, "用户停止后台索引任务。", now);
    }
    return this.getIndexStatus(projectId, now, options);
  }

  private currentChapterJobs(projectId: string): Map<string, SummaryJobRecord> {
    const jobs = new Map<string, SummaryJobRecord>();
    for (const job of this.summaryRepo.listSummaryJobs(projectId)) {
      if (job.jobType !== "chapter_summary" || !job.targetId || jobs.has(job.targetId)) {
        continue;
      }
      if (job.status === "failed" && !hasSummaryJobError(job)) {
        continue;
      }
      if (job.status === "completed" || job.status === "skipped") {
        continue;
      }
      jobs.set(job.targetId, job);
    }
    return jobs;
  }

  private currentArcJobs(projectId: string): Map<string, SummaryJobRecord> {
    const jobs = new Map<string, SummaryJobRecord>();
    for (const job of this.summaryRepo.listSummaryJobs(projectId)) {
      if (job.jobType !== "arc_summary" || !job.targetId || jobs.has(job.targetId)) {
        continue;
      }
      if (job.status === "failed" && !hasSummaryJobError(job)) {
        continue;
      }
      if (job.status === "completed" || job.status === "skipped") {
        continue;
      }
      jobs.set(job.targetId, job);
    }
    return jobs;
  }

  private currentBookJob(projectId: string): SummaryJobRecord | null {
    return (
      this.summaryRepo.listSummaryJobs(projectId).find((job) => {
        if (job.jobType !== "book_summary") {
          return false;
        }
        if (job.status === "failed" && !hasSummaryJobError(job)) {
          return false;
        }
        return job.status !== "completed" && job.status !== "skipped";
      }) ?? null
    );
  }

  private listExpectedArcRanges(projectId: string): Array<{
    readonly arcKey: string;
    readonly chapterFrom: number;
    readonly chapterTo: number;
    readonly chapterCount: number;
  }> {
    const chapters = this.chapterRepo.listByProject(projectId);
    if (chapters.length === 0) {
      return [];
    }
    const ranges: Array<{ readonly arcKey: string; readonly chapterFrom: number; readonly chapterTo: number; readonly chapterCount: number }> = [];
    for (let chapterFrom = 1; chapterFrom <= chapters.length; chapterFrom += AUTO_ARC_CHAPTER_COUNT) {
      const chapterTo = Math.min(chapterFrom + AUTO_ARC_CHAPTER_COUNT - 1, chapters.length);
      ranges.push({
        arcKey: formatAutoArcKey(chapterFrom, chapterTo),
        chapterFrom,
        chapterTo,
        chapterCount: chapterTo - chapterFrom + 1
      });
    }
    return ranges;
  }

  private getArcSourceStatus(
    projectId: string,
    chapterFrom: number,
    chapterTo: number
  ): { readonly sourceHash: string | null; readonly readyChapterCount: number } {
    const chapters = this.chapterRepo.listByProject(projectId).filter((chapter) => {
      const ordinal = chapter.sortOrder + 1;
      return ordinal >= chapterFrom && ordinal <= chapterTo;
    });
    const summaries = new Map(this.summaryRepo.listChapterSummaries(projectId).map((summary) => [summary.chapterId, summary]));
    const readySummaries: ChapterAiSummaryRecord[] = [];
    for (const chapter of chapters) {
      const summary = summaries.get(chapter.id);
      if (!summary || (!isFreshReadyChapterSummary(summary, chapter) && !isFreshSkippedTooShortChapterSummary(summary, chapter))) {
        return { sourceHash: null, readyChapterCount: readySummaries.length };
      }
      if (isFreshReadyChapterSummary(summary, chapter)) {
        readySummaries.push(summary);
      }
    }
    if (!this.arePriorArcGraphsReady(projectId, chapterFrom)) {
      return { sourceHash: null, readyChapterCount: readySummaries.length };
    }
    return {
      sourceHash: readySummaries.length > 0 ? this.computeArcSourceHash(projectId, chapterFrom, readySummaries) : null,
      readyChapterCount: readySummaries.length
    };
  }

  private arePriorArcGraphsReady(projectId: string, chapterFrom: number): boolean {
    if (chapterFrom <= 1) {
      return true;
    }
    const summaries = new Map(this.summaryRepo.listArcSummaries(projectId).map((summary) => [summary.arcKey, summary]));
    return this.listExpectedArcRanges(projectId)
      .filter((range) => range.chapterTo < chapterFrom)
      .every((range) => {
        const summary = summaries.get(range.arcKey);
        return summary?.status === "ready" && Boolean(summary.structured.人物图谱);
      });
  }

  private buildPriorCharacterLedger(projectId: string, chapterFrom: number): ArcPriorCharacterLedgerEntry[] {
    const byName = new Map<string, ArcPriorCharacterLedgerEntry>();
    const priorArcs = this.summaryRepo
      .listArcSummaries(projectId)
      .filter((summary) => summary.status === "ready" && summary.chapterTo < chapterFrom && summary.structured.人物图谱)
      .sort((left, right) => left.chapterFrom - right.chapterFrom);
    for (const arc of priorArcs) {
      const graph = arc.structured.人物图谱;
      if (!graph) {
        continue;
      }
      for (const character of graph.人物归一) {
        const existing = byName.get(character.canonicalName);
        byName.set(character.canonicalName, {
          canonicalName: character.canonicalName,
          aliases: uniqueStrings([...(existing?.aliases ?? []), ...character.aliases], 10),
          mentionForms: uniqueStrings([...(existing?.mentionForms ?? []), ...character.mentionForms], 12),
          roleHints: uniqueStrings([...(existing?.roleHints ?? []), ...character.roleHints], 8),
          firstSeenChapter: existing ? Math.min(existing.firstSeenChapter, character.firstSeenChapter) : character.firstSeenChapter,
          lastSeenChapter: existing ? Math.max(existing.lastSeenChapter, character.lastSeenChapter) : character.lastSeenChapter,
          importance: existing ? strongerArcImportance(existing.importance, character.importance) : character.importance
        });
      }
    }
    return [...byName.values()]
      .sort((left, right) => left.firstSeenChapter - right.firstSeenChapter || left.canonicalName.localeCompare(right.canonicalName, "zh-CN"))
      .slice(0, 80);
  }

  private computeArcSourceHash(projectId: string, chapterFrom: number, readySummaries: readonly ChapterAiSummaryRecord[]): string {
    const priorCharacterLedger = this.buildPriorCharacterLedger(projectId, chapterFrom);
    const sources = readySummaries.map((summary) => summary.contentHash);
    if (priorCharacterLedger.length > 0) {
      sources.push(computeSourceHash([JSON.stringify(priorCharacterLedger)]));
    }
    return computeSourceHash(sources);
  }

  private deriveChapterCacheState(
    summary: ChapterAiSummaryRecord | null,
    job: SummaryJobRecord | null,
    chapter: ChapterSummary
  ): SummaryChapterCacheEntry["cacheState"] {
    const cacheState = getChapterSummaryCacheState(summary, chapter);
    if (job?.status === "running" || job?.status === "queued") {
      return job.status;
    }
    if (job?.status === "failed" && cacheState !== "ready") {
      return "failed";
    }
    if (job?.status === "cancelled" && cacheState === "missing") {
      return "cancelled";
    }
    return cacheState;
  }

  private deriveArcCacheState(
    summary: ArcAiSummaryRecord | null,
    job: SummaryJobRecord | null,
    currentSourceHash: string | null
  ): SummaryArcCacheEntry["cacheState"] {
    if (job?.status === "running" || job?.status === "queued") {
      return job.status;
    }
    if (job?.status === "failed" && summary?.status !== "ready") {
      return "failed";
    }
    if (job?.status === "cancelled" && !summary) {
      return "cancelled";
    }
    if (!summary) {
      return "missing";
    }
    if (summary.status === "ready" && currentSourceHash && summary.sourceHash !== currentSourceHash) {
      return "stale";
    }
    return summary.status;
  }

  private deriveBookCacheState(
    summary: BookAiSummaryRecord | null,
    job: SummaryJobRecord | null,
    currentSourceHash: string | null
  ): SummaryBookCacheDetail["cacheState"] {
    if (job?.status === "running" || job?.status === "queued") {
      return job.status;
    }
    if (job?.status === "failed" && summary?.status !== "ready") {
      return "failed";
    }
    if (job?.status === "cancelled" && !summary) {
      return "cancelled";
    }
    if (!summary) {
      return "missing";
    }
    if (summary.status === "ready" && currentSourceHash && summary.sourceHash !== currentSourceHash) {
      return "stale";
    }
    return summary.status;
  }

  private assertCanClearAndRetryChapterCache(projectId: string, chapterId: string): void {
    const blockingJob =
      this.summaryRepo.listSummaryJobs(projectId).find((job) => job.status === "running" && (job.jobType !== "chapter_summary" || job.targetId === chapterId)) ?? null;
    if (!blockingJob) {
      return;
    }
    if (blockingJob.jobType === "chapter_summary") {
      throw new Error("本章缓存正在运行。请等待完成，或先停止后台索引。");
    }
    throw new Error("阶段或全书索引正在整理。请等待完成，或先停止后台索引后再重试章节缓存。");
  }

  private assertCanClearAndRetryArcCache(projectId: string, arcKey: string, chapterFrom: number, chapterTo: number): void {
    const blockingJob =
      this.summaryRepo.listSummaryJobs(projectId).find((job) => {
        if (job.status !== "running") {
          return false;
        }
        if (job.jobType === "arc_summary") {
          return job.targetId === arcKey;
        }
        if (job.jobType === "book_summary") {
          return true;
        }
        if (job.jobType === "chapter_summary" && job.targetId) {
          const chapter = this.chapterRepo.listByProject(projectId).find((item) => item.id === job.targetId);
          if (!chapter) {
            return false;
          }
          const ordinal = chapter.sortOrder + 1;
          return ordinal >= chapterFrom && ordinal <= chapterTo;
        }
        return false;
      }) ?? null;
    if (!blockingJob) {
      return;
    }
    if (blockingJob.jobType === "chapter_summary") {
      throw new Error("该阶段内仍有章节缓存正在运行。请等待完成，或先停止后台索引。");
    }
    if (blockingJob.jobType === "book_summary") {
      throw new Error("全书摘要正在整理。请等待完成，或先停止后台索引后再重试阶段摘要。");
    }
    throw new Error("该阶段摘要正在运行。请等待完成，或先停止后台索引。");
  }

  private assertCanClearAndRetryBookCache(projectId: string): void {
    const blockingJob = this.summaryRepo.listSummaryJobs(projectId).find((job) => job.status === "running" && job.jobType === "book_summary") ?? null;
    if (blockingJob) {
      throw new Error("全书摘要正在整理。请等待完成，或先停止后台索引后再重试全书摘要。");
    }
  }

  private isChapterJobResolvedByReadySummary(
    summary: ChapterAiSummaryRecord | null,
    job: SummaryJobRecord | null,
    chapter?: ChapterSummary
  ): boolean {
    if (!summary || !job || job.jobType !== "chapter_summary" || job.status !== "failed" || job.targetId !== summary.chapterId) {
      return false;
    }
    if (chapter && !isFreshReadyChapterSummary(summary, chapter)) {
      return false;
    }
    return summary.status === "ready" && (summary.contentHash === job.sourceHash || summary.updatedAt >= job.updatedAt);
  }

  private isArcJobResolvedByReadySummary(summary: ArcAiSummaryRecord | null, job: SummaryJobRecord | null, currentSourceHash: string | null): boolean {
    if (!summary || !job || job.jobType !== "arc_summary" || job.status !== "failed" || job.targetId !== summary.arcKey) {
      return false;
    }
    return summary.status === "ready" && ((currentSourceHash && summary.sourceHash === currentSourceHash) || summary.updatedAt >= job.updatedAt);
  }

  private isBookJobResolvedByReadySummary(summary: BookAiSummaryRecord | null, job: SummaryJobRecord | null, currentSourceHash: string | null): boolean {
    if (!summary || !job || job.jobType !== "book_summary" || job.status !== "failed") {
      return false;
    }
    return summary.status === "ready" && ((currentSourceHash && summary.sourceHash === currentSourceHash) || summary.updatedAt >= job.updatedAt);
  }

  private isJobResolvedByCurrentSummaryIndex(
    job: SummaryJobRecord,
    cache: SummaryJobRelevanceCache,
    queuedRetryKeys: ReadonlySet<string>
  ): boolean {
    if (job.status !== "failed") {
      return false;
    }
    if (job.nextRunAt && queuedRetryKeys.has(this.summaryJobResolutionKey(job))) {
      return true;
    }
    if (job.jobType === "chapter_summary") {
      return this.isChapterJobResolvedByReadySummary(
        cache.chapterSummaries.get(job.targetId ?? "") ?? null,
        job,
        cache.chapterById.get(job.targetId ?? "")
      );
    }
    if (job.jobType === "arc_summary" && job.targetId) {
      const summary = cache.arcSummaries.get(job.targetId);
      return summary?.status === "ready" && (summary.sourceHash === job.sourceHash || summary.updatedAt >= job.updatedAt);
    }
    if (job.jobType === "book_summary") {
      return cache.bookSummary?.status === "ready" && (cache.bookSummary.sourceHash === job.sourceHash || cache.bookSummary.updatedAt >= job.updatedAt);
    }
    return false;
  }

  private isSummaryJobRelevantToCurrentIndex(projectId: string, job: SummaryJobRecord, cache: SummaryJobRelevanceCache): boolean {
    if (job.jobType === "chapter_summary") {
      return Boolean(job.targetId && cache.chapterIds.has(job.targetId));
    }
    if (job.jobType === "arc_summary") {
      return this.isArcSummaryJobRelevantToCurrentIndex(projectId, job, cache);
    }
    if (job.jobType === "book_summary") {
      return this.isBookSummaryJobRelevantToCurrentIndex(projectId, job, cache);
    }
    return true;
  }

  private isArcSummaryJobRelevantToCurrentIndex(projectId: string, job: SummaryJobRecord, cache: SummaryJobRelevanceCache): boolean {
    if (!job.targetId) {
      return false;
    }
    const range = parseAutoArcKey(job.targetId);
    if (!range) {
      return false;
    }
    const chapters = cache.chapters.filter((chapter) => {
      const ordinal = chapter.sortOrder + 1;
      return ordinal >= range.from && ordinal <= range.to;
    });
    if (chapters.length === 0) {
      return false;
    }

    const readySummaries: ChapterAiSummaryRecord[] = [];
    for (const chapter of chapters) {
      const summary = cache.chapterSummaries.get(chapter.id);
      if (!summary || (!isFreshReadyChapterSummary(summary, chapter) && !isFreshSkippedTooShortChapterSummary(summary, chapter))) {
        return false;
      }
      if (isFreshReadyChapterSummary(summary, chapter)) {
        readySummaries.push(summary);
      }
    }
    if (readySummaries.length === 0) {
      return false;
    }

    return this.computeArcSourceHash(projectId, range.from, readySummaries) === job.sourceHash;
  }

  private isBookSummaryJobRelevantToCurrentIndex(projectId: string, job: SummaryJobRecord, cache: SummaryJobRelevanceCache): boolean {
    const source = this.getReadyBookSummarySource(projectId);
    if (!source.sourceHash) {
      return false;
    }
    return source.sourceHash === job.sourceHash || Boolean(cache.bookSummary?.updatedAt && cache.bookSummary.updatedAt >= job.updatedAt);
  }

  private summaryJobResolutionKey(job: SummaryJobRecord): string {
    return `${job.jobType}:${job.targetId ?? ""}:${job.sourceHash}`;
  }

  async summarizeChapter(projectId: string, chapterId: string, sourceHash: string, now: string, options: { readonly signal?: AbortSignal } = {}): Promise<ChapterAiSummaryRecord> {
    const generator = this.options.generator;
    if (!generator) {
      throw new Error("AI 摘要生成器未配置。");
    }

    const content = this.requireChapterContent(projectId, chapterId);
    const currentHash = computeChapterContentHash(content.plainText);
    if (currentHash !== sourceHash) {
      this.requeueChapterSummary(projectId, chapterId, currentHash, now);
      throw new SummarySourceChangedError("章节内容已变化，已重新排队最新摘要任务。");
    }

    const writingUnits = countWritingUnits(content.plainText);
    const budget = writingUnits > CHAPTER_INDEX_DIRECT_MAX_UNITS && generator.getSummaryIndexBudget ? await generator.getSummaryIndexBudget() : null;
    const sizing = getChapterIndexSizing(budget);
    if (writingUnits > sizing.directMaxUnits) {
      return this.summarizeLongChapterWithChunks(projectId, chapterId, sourceHash, now, content, generator, sizing, options);
    }

    const structured = await generator.summarizeChapterForIndex(
      {
        projectId,
        chapterId,
        title: content.title,
        ordinal: content.sortOrder + 1,
        plainText: content.plainText
      },
      options
    );
    const latestContent = this.requireChapterContent(projectId, chapterId);
    const latestHash = computeChapterContentHash(latestContent.plainText);
    if (latestHash !== sourceHash) {
      this.requeueChapterSummary(projectId, chapterId, latestHash, now);
      throw new SummarySourceChangedError("章节内容已变化，已重新排队最新摘要任务。");
    }

    const structuredForStorage = ensureChapterIndexMaterial(structured);
    const summary = this.summaryRepo.upsertChapterSummary({
      id: createId("summary"),
      projectId,
      chapterId,
      chapterTitle: latestContent.title,
      chapterOrder: latestContent.sortOrder + 1,
      contentHash: sourceHash,
      summaryShort: getChapterSummaryShortText(structuredForStorage),
      summaryLong: getChapterSummaryLongText(structuredForStorage),
      structured: structuredForStorage,
      tokenCount: estimateTextTokens(JSON.stringify(structuredForStorage)),
      status: "ready",
      error: null,
      createdAt: now,
      updatedAt: now
    });
    this.enqueueArcForChapterIfReady(projectId, summary.chapterOrder, now);
    return summary;
  }

  private async summarizeLongChapterWithChunks(
    projectId: string,
    chapterId: string,
    sourceHash: string,
    now: string,
    content: ChapterContent,
    generator: SummaryIndexGenerator,
    sizing: ChapterIndexSizing,
    options: { readonly signal?: AbortSignal }
  ): Promise<ChapterAiSummaryRecord> {
    if (!generator.summarizeChapterChunkForIndex) {
      throw new Error("AI 章节片段摘要生成器未配置。");
    }

    const chunks = splitChapterForSummaryIndex(content.plainText, { targetUnits: sizing.chunkTargetUnits });
    if (chunks.length <= 1) {
      const structured = await generator.summarizeChapterForIndex(
        {
          projectId,
          chapterId,
          title: content.title,
          ordinal: content.sortOrder + 1,
          plainText: content.plainText
        },
        options
      );
      return this.persistChapterSummary(projectId, chapterId, sourceHash, now, structured);
    }

    const existingReadyChunks = new Map(
      this.summaryRepo
        .listChapterSummaryChunks(projectId, chapterId, sourceHash)
        .filter((chunk) => chunk.status === "ready" && chunk.chunkCount === chunks.length)
        .map((chunk) => [chunk.chunkIndex, chunk])
    );

    for (const chunk of chunks) {
      if (existingReadyChunks.has(chunk.chunkIndex)) {
        continue;
      }

      const structured = await generator.summarizeChapterChunkForIndex(
        {
          projectId,
          chapterId,
          title: content.title,
          ordinal: content.sortOrder + 1,
          chunkIndex: chunk.chunkIndex,
          chunkCount: chunk.chunkCount,
          textStart: chunk.textStart,
          textEnd: chunk.textEnd,
          plainText: chunk.text
        },
        options
      );
      this.assertChapterSourceUnchanged(projectId, chapterId, sourceHash, now);
      const savedChunk = this.summaryRepo.upsertChapterSummaryChunk({
        id: createId("summary_chunk"),
        projectId,
        chapterId,
        chunkIndex: chunk.chunkIndex,
        chunkCount: chunk.chunkCount,
        contentHash: sourceHash,
        textStart: chunk.textStart,
        textEnd: chunk.textEnd,
        summaryShort: structured.片段摘要,
        structured,
        tokenCount: estimateTextTokens(JSON.stringify(structured)),
        status: "ready",
        error: null,
        createdAt: now,
        updatedAt: now
      });
      existingReadyChunks.set(savedChunk.chunkIndex, savedChunk);
    }

    const readyChunks = this.summaryRepo.listChapterSummaryChunks(projectId, chapterId, sourceHash).filter((chunk) => chunk.status === "ready");
    if (readyChunks.length !== chunks.length || readyChunks.some((chunk) => chunk.chunkCount !== chunks.length)) {
      throw new Error("章节片段摘要尚未全部完成，不能合并为章节缓存。");
    }

    const structured = mergeLongChapterChunks(content, readyChunks);
    this.assertChapterSourceUnchanged(projectId, chapterId, sourceHash, now);
    return this.persistChapterSummary(projectId, chapterId, sourceHash, now, structured);
  }

  private persistChapterSummary(
    projectId: string,
    chapterId: string,
    sourceHash: string,
    now: string,
    structured: ChapterAiSummaryPayload
  ): ChapterAiSummaryRecord {
    const latestContent = this.requireChapterContent(projectId, chapterId);
    const latestHash = computeChapterContentHash(latestContent.plainText);
    if (latestHash !== sourceHash) {
      this.requeueChapterSummary(projectId, chapterId, latestHash, now);
      throw new SummarySourceChangedError("章节内容已变化，已重新排队最新摘要任务。");
    }

    const structuredForStorage = ensureChapterIndexMaterial(structured);
    const summary = this.summaryRepo.upsertChapterSummary({
      id: createId("summary"),
      projectId,
      chapterId,
      chapterTitle: latestContent.title,
      chapterOrder: latestContent.sortOrder + 1,
      contentHash: sourceHash,
      summaryShort: getChapterSummaryShortText(structuredForStorage),
      summaryLong: getChapterSummaryLongText(structuredForStorage),
      structured: structuredForStorage,
      tokenCount: estimateTextTokens(JSON.stringify(structuredForStorage)),
      status: "ready",
      error: null,
      createdAt: now,
      updatedAt: now
    });
    this.enqueueArcForChapterIfReady(projectId, summary.chapterOrder, now);
    return summary;
  }

  async summarizeArc(
    projectId: string,
    arcKey: string,
    chapterFrom: number,
    chapterTo: number,
    sourceHash: string,
    now: string,
    options: { readonly signal?: AbortSignal } = {}
  ): Promise<ArcAiSummaryRecord> {
    const generator = this.options.generator;
    if (!generator?.summarizeArcForIndex) {
      throw new Error("AI 阶段摘要生成器未配置。");
    }
    if (!this.arePriorArcGraphsReady(projectId, chapterFrom)) {
      throw new SummaryDependencyPendingError("阶段摘要等待前序阶段人物图谱完成。");
    }
    const readySummaries = this.collectReadyChapterSummariesForArc(projectId, chapterFrom, chapterTo);
    const currentSourceHash = this.computeArcSourceHash(projectId, chapterFrom, readySummaries);
    if (currentSourceHash !== sourceHash) {
      this.requeueArcSummary(projectId, arcKey, currentSourceHash, now);
      throw new SummarySourceChangedError("阶段摘要来源已变化，已重新排队最新摘要任务。");
    }
    const priorCharacterLedger = this.buildPriorCharacterLedger(projectId, chapterFrom);

    const structured = await generator.summarizeArcForIndex(
      {
        arcKey,
        chapterFrom,
        chapterTo,
        priorCharacterLedger,
        priorCharacterLedgerHash: computeSourceHash([JSON.stringify(priorCharacterLedger)]),
        chapters: readySummaries.map((summary) => ({
          chapterId: summary.chapterId,
          title: summary.chapterTitle,
          ordinal: summary.chapterOrder,
          summaryShort: summary.summaryShort,
          summaryLong: summary.summaryLong,
          structured: summary.structured
        }))
      },
      options
    );
    const latestReadySummaries = this.collectReadyChapterSummariesForArc(projectId, chapterFrom, chapterTo);
    const latestSourceHash = this.computeArcSourceHash(projectId, chapterFrom, latestReadySummaries);
    if (latestSourceHash !== sourceHash) {
      this.requeueArcSummary(projectId, arcKey, latestSourceHash, now);
      throw new SummarySourceChangedError("阶段摘要来源已变化，已重新排队最新摘要任务。");
    }

    const summary = this.summaryRepo.upsertArcSummary({
      id: createId("arc_summary"),
      projectId,
      arcKey,
      chapterFrom,
      chapterTo,
      sourceHash,
      summary: getArcSummaryText(structured),
      structured,
      status: "ready",
      error: null,
      createdAt: now,
      updatedAt: now
    });
    this.enqueueDerivedSummariesIfReady(projectId, now);
    return summary;
  }

  async summarizeBook(projectId: string, sourceHash: string, now: string, options: { readonly signal?: AbortSignal } = {}): Promise<BookAiSummaryRecord> {
    const generator = this.options.generator;
    if (!generator?.summarizeBookForIndex) {
      throw new Error("AI 全书摘要生成器未配置。");
    }
    const source = this.getReadyBookSummarySource(projectId);
    if (!source.sourceHash || source.readyArcs.length === 0) {
      throw new SummaryDependencyPendingError("全书摘要等待阶段摘要完成。");
    }
    if (source.sourceHash !== sourceHash) {
      this.requeueBookSummary(projectId, source.sourceHash, now);
      throw new SummarySourceChangedError("全书摘要来源已变化，已重新排队最新摘要任务。");
    }

    const generated = await generator.summarizeBookForIndex(
      {
        arcs: source.readyArcs.map((summary) => ({
          arcKey: summary.arcKey,
          chapterFrom: summary.chapterFrom,
          chapterTo: summary.chapterTo,
          summary: summary.summary,
          structured: summary.structured
        })),
        coverage: source.coverage
      },
      options
    );
    const latestSource = this.getReadyBookSummarySource(projectId);
    if (!latestSource.sourceHash) {
      throw new SummaryDependencyPendingError("全书摘要等待阶段摘要完成。");
    }
    if (latestSource.sourceHash !== sourceHash) {
      this.requeueBookSummary(projectId, latestSource.sourceHash, now);
      throw new SummarySourceChangedError("全书摘要来源已变化，已重新排队最新摘要任务。");
    }
    const structured: BookAiSummaryPayload = {
      ...generated,
      全书信息: {
        ...generated.全书信息,
        覆盖阶段: latestSource.readyArcs.map((summary) => formatArcCoverageLabel(summary.chapterFrom, summary.chapterTo)),
        覆盖章节范围: latestSource.coverage.totalChapterCount > 0 ? `第1-${latestSource.coverage.totalChapterCount}章` : "无章节",
        总章节数: latestSource.coverage.totalChapterCount,
        已索引章节数: latestSource.coverage.indexedChapterCount,
        过期章节: [...latestSource.coverage.staleChapterIds],
        缺失章节: [...latestSource.coverage.missingChapterIds],
        过短跳过章节: [...latestSource.coverage.skippedTooShortChapterIds],
        覆盖限制: [...generated.全书信息.覆盖限制]
      },
      人物关系图谱: buildBookRelationshipGraphFromArcs(latestSource.readyArcs, latestSource.coverage)
    };

    return this.summaryRepo.upsertBookSummary({
      id: createId("book_summary"),
      projectId,
      sourceHash,
      summaryShort: getBookSummaryShortText(structured),
      summaryLong: getBookSummaryLongText(structured),
      structured,
      status: "ready",
      error: null,
      createdAt: now,
      updatedAt: now
    });
  }

  private isIdle(projectId: string, chapterId: string, now: string): boolean {
    const editedAt = this.activeChapterEditTimes.get(keyFor(projectId, chapterId)) ?? this.chapterRepo.getContent(chapterId)?.updatedAt;
    if (!editedAt) {
      return true;
    }
    return parseTime(now) - parseTime(editedAt) >= ACTIVE_CHAPTER_IDLE_MS;
  }

  private isLatestChapter(projectId: string, content: ChapterContent): boolean {
    return content.projectId === projectId && content.sortOrder === this.chapterRepo.nextSortOrder(projectId) - 1;
  }

  private canBypassIdleForImmediateLatestChapterSummary(
    projectId: string,
    chapterId: string,
    sourceHash: string,
    existingSummary: ChapterAiSummaryRecord | null,
    isLatestChapter: boolean
  ): boolean {
    if (!isLatestChapter) {
      return false;
    }
    if (existingSummary?.status === "ready") {
      return false;
    }
    return this.immediateCacheMilestoneChapterHashes.get(keyFor(projectId, chapterId)) === sourceHash;
  }

  private requireChapterContent(projectId: string, chapterId: string): ChapterContent {
    const content = this.chapterRepo.getContent(chapterId);
    if (!content || content.projectId !== projectId) {
      throw new Error("找不到需要建立摘要的章节。");
    }
    return content;
  }

  private assertChapterSourceUnchanged(projectId: string, chapterId: string, expectedHash: string, now: string): void {
    const latestContent = this.requireChapterContent(projectId, chapterId);
    const latestHash = computeChapterContentHash(latestContent.plainText);
    if (latestHash !== expectedHash) {
      this.requeueChapterSummary(projectId, chapterId, latestHash, now);
      throw new SummarySourceChangedError("章节内容已变化，已重新排队最新摘要任务。");
    }
  }

  private requeueChapterSummary(projectId: string, chapterId: string, sourceHash: string, now: string): SummaryJobRecord {
    const content = this.requireChapterContent(projectId, chapterId);
    return this.summaryRepo.enqueueSummaryJob({
      projectId,
      jobType: "chapter_summary",
      targetId: chapterId,
      sourceHash,
      priority: priorityFor("auto_idle", this.changedWritingUnits.get(keyFor(projectId, chapterId)) ?? null, this.isLatestChapter(projectId, content)),
      now
    });
  }

  private collectReadyChapterSummariesForArc(projectId: string, chapterFrom: number, chapterTo: number): ChapterAiSummaryRecord[] {
    const chapters = this.chapterRepo.listByProject(projectId).filter((chapter) => {
      const ordinal = chapter.sortOrder + 1;
      return ordinal >= chapterFrom && ordinal <= chapterTo;
    });
    if (chapters.length === 0) {
      throw new Error("阶段摘要缺少章节范围。");
    }
    const summaries = new Map(this.summaryRepo.listChapterSummaries(projectId).map((summary) => [summary.chapterId, summary]));
    const blocking = chapters.filter((chapter) => {
      const summary = summaries.get(chapter.id);
      return !summary || (!isFreshSkippedTooShortChapterSummary(summary, chapter) && !isFreshReadyChapterSummary(summary, chapter));
    });
    if (blocking.length > 0) {
      throw new SummaryDependencyPendingError("阶段摘要等待章节摘要完成。");
    }
    const readySummaries = chapters
      .map((chapter) => summaries.get(chapter.id))
      .filter((summary, index): summary is ChapterAiSummaryRecord => summary !== undefined && isFreshReadyChapterSummary(summary, chapters[index]));
    if (readySummaries.length === 0) {
      throw new Error("阶段摘要缺少可用章节摘要。");
    }
    return readySummaries;
  }

  private requeueArcSummary(projectId: string, arcKey: string, sourceHash: string, now: string): SummaryJobRecord {
    return this.summaryRepo.enqueueSummaryJob({
      projectId,
      jobType: "arc_summary",
      targetId: arcKey,
      sourceHash,
      priority: 6,
      now
    });
  }

  private enqueueArcForChapterIfReady(projectId: string, chapterOrder: number, now: string): SummaryJobRecord | null {
    const chapters = this.chapterRepo.listByProject(projectId);
    const totalChapters = chapters.length;
    if (totalChapters === 0) {
      return null;
    }
    const chapterFrom = Math.floor((chapterOrder - 1) / AUTO_ARC_CHAPTER_COUNT) * AUTO_ARC_CHAPTER_COUNT + 1;
    const chapterTo = Math.min(chapterFrom + AUTO_ARC_CHAPTER_COUNT - 1, totalChapters);
    const arcKey = formatAutoArcKey(chapterFrom, chapterTo);
    let readySummaries: ChapterAiSummaryRecord[];
    try {
      readySummaries = this.collectReadyChapterSummariesForArc(projectId, chapterFrom, chapterTo);
    } catch {
      return null;
    }
    if (!this.arePriorArcGraphsReady(projectId, chapterFrom)) {
      return null;
    }
    const sourceHash = this.computeArcSourceHash(projectId, chapterFrom, readySummaries);
    const existing = this.summaryRepo.listArcSummaries(projectId).find((summary) => summary.arcKey === arcKey);
    if (existing?.status === "ready" && existing.sourceHash === sourceHash) {
      return null;
    }
    return this.summaryRepo.enqueueSummaryJob({
      projectId,
      jobType: "arc_summary",
      targetId: arcKey,
      sourceHash,
      priority: 6,
      now
    });
  }

  private enqueueDerivedSummariesIfReady(projectId: string, now: string): SummaryJobRecord[] {
    const jobs: SummaryJobRecord[] = [];
    const chapters = this.chapterRepo.listByProject(projectId);
    const totalChapters = chapters.length;
    const seenArcKeys = new Set<string>();
    for (const chapter of chapters) {
      const chapterOrder = chapter.sortOrder + 1;
      const chapterFrom = Math.floor((chapterOrder - 1) / AUTO_ARC_CHAPTER_COUNT) * AUTO_ARC_CHAPTER_COUNT + 1;
      const chapterTo = Math.min(chapterFrom + AUTO_ARC_CHAPTER_COUNT - 1, totalChapters);
      const arcKey = formatAutoArcKey(chapterFrom, chapterTo);
      if (seenArcKeys.has(arcKey)) {
        continue;
      }
      seenArcKeys.add(arcKey);
      const job = this.enqueueArcForChapterIfReady(projectId, chapterOrder, now);
      if (job) {
        jobs.push(job);
      }
    }
    const bookJob = this.enqueueBookIfReady(projectId, now);
    if (bookJob) {
      jobs.push(bookJob);
    }
    return jobs;
  }

  private buildBookCoverage(projectId: string): BookSummaryCoverage {
    const chapters = this.chapterRepo.listByProject(projectId);
    const summaries = new Map(this.summaryRepo.listChapterSummaries(projectId).map((summary) => [summary.chapterId, summary]));
    const staleChapterIds: string[] = [];
    const missingChapterIds: string[] = [];
    const skippedTooShortChapterIds: string[] = [];
    let indexedChapterCount = 0;

    for (const chapter of chapters) {
      const summary = summaries.get(chapter.id);
      if (!summary) {
        missingChapterIds.push(formatChapterCoverageLabel(chapter.sortOrder + 1, chapter.title));
        continue;
      }
      if (isFreshReadyChapterSummary(summary, chapter)) {
        indexedChapterCount += 1;
        continue;
      }
      if (isFreshSkippedTooShortChapterSummary(summary, chapter)) {
        skippedTooShortChapterIds.push(formatChapterCoverageLabel(chapter.sortOrder + 1, chapter.title));
        continue;
      }
      staleChapterIds.push(formatChapterCoverageLabel(chapter.sortOrder + 1, chapter.title));
    }

    return {
      totalChapterCount: chapters.length,
      indexedChapterCount,
      staleChapterIds,
      missingChapterIds,
      skippedTooShortChapterIds
    };
  }

  private computeBookSourceHash(arcSourceHashes: readonly string[], coverage: BookSummaryCoverage): string {
    return computeSourceHash([
      ...arcSourceHashes,
      JSON.stringify({
        indexed: coverage.indexedChapterCount,
        total: coverage.totalChapterCount,
        stale: coverage.staleChapterIds,
        missing: coverage.missingChapterIds,
        skipped: coverage.skippedTooShortChapterIds
      })
    ]);
  }

  private getReadyBookSummarySource(projectId: string): {
    readonly coverage: BookSummaryCoverage;
    readonly readyArcs: readonly ArcAiSummaryRecord[];
    readonly sourceHash: string | null;
  } {
    const coverage = this.buildBookCoverage(projectId);
    const readyArcs = this.summaryRepo
      .listArcSummaries(projectId)
      .filter((summary) => summary.status === "ready")
      .sort((left, right) => left.chapterFrom - right.chapterFrom || left.chapterTo - right.chapterTo);
    return {
      coverage,
      readyArcs,
      sourceHash: readyArcs.length > 0 ? this.computeBookSourceHash(readyArcs.map((summary) => summary.sourceHash), coverage) : null
    };
  }

  private enqueueBookIfReady(projectId: string, now: string): SummaryJobRecord | null {
    const source = this.getReadyBookSummarySource(projectId);
    if (!source.sourceHash) {
      return null;
    }
    const existing = this.summaryRepo.getLatestBookSummary(projectId);
    if (existing?.status === "ready" && existing.sourceHash === source.sourceHash) {
      return null;
    }
    return this.summaryRepo.enqueueSummaryJob({
      projectId,
      jobType: "book_summary",
      targetId: null,
      sourceHash: source.sourceHash,
      priority: 4,
      now
    });
  }

  private requeueBookSummary(projectId: string, sourceHash: string, now: string): SummaryJobRecord {
    return this.summaryRepo.enqueueSummaryJob({
      projectId,
      jobType: "book_summary",
      targetId: null,
      sourceHash,
      priority: 4,
      now
    });
  }

  private formatRunningJobLabel(projectId: string, job: SummaryJobRecord): string {
    if (job.jobType === "chapter_summary" && job.targetId) {
      const content = this.chapterRepo.getContent(job.targetId);
      if (content?.projectId === projectId) {
        return `正在摘要：${formatChapterCoverageLabel(content.sortOrder + 1, content.title)}`;
      }
      return `正在摘要：缺失章节 ${job.targetId}`;
    }
    if (job.jobType === "arc_summary") {
      return `正在整理${this.formatArcSummaryJobLabel(job)}`;
    }
    if (job.jobType === "book_summary") {
      return "正在整理全书摘要";
    }
    return "正在建立全书索引";
  }

  private formatPendingRetryJobLabel(projectId: string, job: SummaryJobRecord): string {
    if (job.jobType === "chapter_summary" && job.targetId) {
      const content = this.chapterRepo.getContent(job.targetId);
      if (content?.projectId === projectId) {
        return formatChapterCoverageLabel(content.sortOrder + 1, content.title);
      }
      return `章节摘要（缺失章节 ID：${job.targetId}）`;
    }
    if (job.jobType === "arc_summary") {
      return this.formatArcSummaryJobLabel(job);
    }
    if (job.jobType === "book_summary") {
      return "全书摘要";
    }
    return "全书索引";
  }

  private formatArcSummaryJobLabel(job: SummaryJobRecord): string {
    if (!job.targetId) {
      return "阶段摘要";
    }
    const range = parseAutoArcKey(job.targetId);
    return range ? `阶段摘要（${formatArcCoverageLabel(range.from, range.to)}）` : `阶段摘要（${job.targetId}）`;
  }

  private formatSummaryJobDetail(projectId: string, job: SummaryJobRecord): SummaryIndexJobDetail {
    const failure = classifySummaryJobError(job.error, job.jobType);
    return {
      jobId: job.id,
      jobType: job.jobType,
      targetId: job.targetId,
      label: this.formatPendingRetryJobLabel(projectId, job),
      error: job.error?.trim() || null,
      failureCategory: failure.failureCategory,
      actionHint: failure.actionHint,
      attemptCount: job.attemptCount,
      nextRunAt: job.nextRunAt
    };
  }

  private markSkippedTooShort(content: ChapterContent, contentHash: string, now: string): void {
    this.summaryRepo.upsertChapterSummary({
      id: createId("summary"),
      projectId: content.projectId,
      chapterId: content.id,
      chapterTitle: content.title,
      chapterOrder: content.sortOrder + 1,
      contentHash,
      summaryShort: "章节内容过短，未建立摘要。",
      summaryLong: "章节内容过短，未建立摘要。",
      structured: skippedTooShortPayload(content),
      tokenCount: 0,
      status: "skipped_too_short",
      error: null,
      createdAt: now,
      updatedAt: now
    });
  }
}
