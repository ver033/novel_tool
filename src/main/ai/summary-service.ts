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
  type ArcAiSummaryPayload,
  type BookAiSummaryPayload,
  type BookSummaryCoverage,
  type ChapterAiSummaryChunkPayload,
  type ChapterAiSummaryPayload,
  type SummaryJobType
} from "../shared/summary-index";
import { countWritingUnits } from "../shared/text";
import type { ChapterContent, SummaryChapterCacheDetail, SummaryChapterCacheEntry, SummaryIndexPausedReason, SummaryIndexStatus } from "../shared/types";
import { estimateTextTokens } from "./token-estimator";
import type { ArcIndexSummaryInput, BookIndexSummaryInput, ChapterChunkIndexSummaryInput, ChapterChunkMergeSummaryInput, ChapterIndexSummaryInput } from "./summary-prompts";

export const MIN_AUTO_SUMMARY_UNITS = 500;
export const MIN_MANUAL_SUMMARY_UNITS = 80;
export const ACTIVE_CHAPTER_IDLE_MS = 5 * 60 * 1000;
export const MIN_HIGH_PRIORITY_DELTA_UNITS = 500;
export const MIN_NORMAL_PRIORITY_DELTA_UNITS = 100;
export const AUTO_ARC_CHAPTER_COUNT = 20;
export const CHAPTER_INDEX_DIRECT_MAX_UNITS = 6000;
export const CHAPTER_INDEX_CHUNK_TARGET_UNITS = 3500;
export const CHAPTER_INDEX_CHUNK_OVERLAP_UNITS = 120;

export class SummarySourceChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SummarySourceChangedError";
  }
}

export type ChapterSummaryQueueTrigger = "auto_idle" | "chapter_inactive" | "import" | "manual_continue" | "manual_rebuild";

export type SummaryIndexGenerator = {
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

function skippedTooShortPayload(content: ChapterContent): ChapterAiSummaryPayload {
  return {
    章节信息: {
      章节序号: content.sortOrder + 1,
      章节标题: content.title,
      正文覆盖: "不完整",
      缓存类型: "章节缓存",
      缓存版本: "二",
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
    本章功能: {
      章节类型: "未明确",
      剧情功能: "未明确",
      情绪功能: "未明确",
      结构作用: "未明确",
      对后文的作用: "未明确"
    },
    场景列表: [
      {
        场景序号: 1,
        场景标题: "内容过短",
        时间: "未明确",
        地点: "未明确",
        出场人物: [],
        场景目标: "未明确",
        冲突或阻力: "未明确",
        关键事件: ["章节内容过短，暂未提取事件"],
        场景结果: "未明确",
        情绪变化: "未明确",
        承接关系: "未明确",
        证据短句: []
      }
    ],
    关键事件: [
      {
        事件: "章节内容过短，暂未建立关键事件索引",
        涉及人物: [],
        时间地点: "未明确",
        事件原因: "未明确",
        事件结果: "未明确",
        后续影响: "需要正文成形后重新分析",
        证据短句: []
      }
    ],
    人物状态: [
      {
        人物: "未明确",
        本章出场状态: "未明确",
        本章结束状态: "未明确",
        身体状态: "未明确",
        情绪状态: "未明确",
        行动: [],
        动机: "未明确",
        目标: "未明确",
        阻力: "未明确",
        位置变化: "未明确",
        新获得信息: [],
        仍不知道的信息: [],
        误解或错误判断: [],
        与他人关系变化: [],
        需要后文承接: "否",
        证据短句: []
      }
    ],
    人物认知边界: [],
    关系动态: [],
    时间与地点: {
      本章时间: "未明确",
      时间跨度: "未明确",
      主要地点: [],
      地点移动: [],
      明确时间锚点: [],
      相对时间锚点: [],
      可能的时间线风险: [],
      证据短句: []
    },
    空间与行动逻辑: [],
    道具状态: [],
    设定与规则: [],
    限制与否定事实: [],
    伏笔与线索: [],
    因果链: [],
    可核对事实: [
      {
        事实编号: "事实-跳过-1",
        事实类型: "限制事实",
        主体: "章节缓存",
        属性: "建立状态",
        取值: "内容过短，暂未建立完整索引",
        时间范围: "当前版本",
        地点: "未明确",
        确定性: "确定",
        后文核对意义: "正文成形后需要重新建立章节缓存",
        证据短句: []
      }
    ],
    连续性风险: [],
    未解决问题: [],
    文风与叙事: {
      叙事视角: "未明确",
      主要语气: "未明确",
      节奏特点: "未明确",
      对白特点: "未明确",
      描写侧重: "未明确",
      续写时应保持: []
    },
    不可丢失信息: ["章节内容过短，等待正文成形后重新建立事实索引"],
    适合回答的问题: ["这个章节为什么没有建立摘要缓存"],
    不确定项: ["正文信息不足"]
  };
}

function priorityFor(trigger: ChapterSummaryQueueTrigger, changedWritingUnits: number | null): number {
  if (trigger === "manual_rebuild" || trigger === "manual_continue") {
    return 10;
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

function isManualSummaryTrigger(trigger: ChapterSummaryQueueTrigger): boolean {
  return trigger === "manual_rebuild" || trigger === "manual_continue";
}

function formatAutoArcKey(chapterFrom: number, chapterTo: number): string {
  return `auto:${String(chapterFrom).padStart(3, "0")}-${String(chapterTo).padStart(3, "0")}`;
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

function mergeLongChapterChunks(content: ChapterContent, chunks: readonly ChapterAiSummaryChunkRecord[]): ChapterAiSummaryPayload {
  const orderedChunks = [...chunks].sort((left, right) => left.chunkIndex - right.chunkIndex);
  const chunkSummaries = orderedChunks
    .map((chunk) => `片段${chunk.chunkIndex + 1}：${chunk.structured.片段摘要.trim()}`)
    .filter((summary) => summary.trim().length > 0);
  const detailText = chunkSummaries.join("\n");
  const shortText = limitText(chunkSummaries.join("；"), 360) || `${content.title}已完成片段事实索引聚合。`;
  const oneLine = limitText(chunkSummaries.join("；"), 120) || `${content.title}已完成长章节缓存。`;
  const keyEvents = uniqueRecords(
    orderedChunks.flatMap((chunk) => chunk.structured.关键事件),
    (item) => `${item.事件}|${item.时间地点}|${item.事件结果}`,
    32
  );
  const characterStates = uniqueRecords(
    orderedChunks.flatMap((chunk) => chunk.structured.人物状态),
    (item) => `${item.人物}|${item.本章结束状态}|${item.位置变化}`,
    32
  );
  const facts = uniqueRecords(
    orderedChunks.flatMap((chunk) => chunk.structured.可核对事实),
    (item) => `${item.主体}|${item.属性}|${item.取值}|${item.时间范围}`,
    48
  );
  const spatialActions = uniqueRecords(
    orderedChunks.flatMap((chunk) => chunk.structured.空间与行动逻辑),
    (item) => `${item.人物}|${item.移动或行动}|${item.起点}|${item.终点}`,
    32
  );
  const negativeFacts = uniqueRecords(
    orderedChunks.flatMap((chunk) => chunk.structured.限制与否定事实),
    (item) => `${item.对象}|${item.限制或否定}|${item.影响范围}`,
    32
  );
  const timePlaces = orderedChunks.map((chunk) => chunk.structured.时间与地点);
  const lostInfo = uniqueStrings(
    orderedChunks.flatMap((chunk) => chunk.structured.不可丢失信息),
    48
  );
  const places = uniqueStrings(
    timePlaces.flatMap((item) => item.主要地点),
    24
  );
  const relativeTimes = uniqueStrings(
    timePlaces.flatMap((item) => item.相对时间锚点),
    24
  );

  return {
    章节信息: {
      章节序号: content.sortOrder + 1,
      章节标题: content.title,
      正文覆盖: "完整章节",
      缓存类型: "章节缓存",
      缓存版本: "二",
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
    本章功能: {
      章节类型: "长章节",
      剧情功能: "由多个片段缓存聚合，保留本章连续剧情推进。",
      情绪功能: "以片段缓存中的人物情绪和事件压力为准。",
      结构作用: "连接多个连续场景并保存跨片段事实线索。",
      对后文的作用: "为后续全文总结、人物查询、伏笔查询和连续性检查提供章节级索引。"
    },
    场景列表: orderedChunks.slice(0, 24).map((chunk) => ({
      场景序号: chunk.chunkIndex + 1,
      场景标题: `片段${chunk.chunkIndex + 1}`,
      时间: chunk.structured.时间与地点.本章时间,
      地点: firstDefined(chunk.structured.时间与地点.主要地点, "未明确"),
      出场人物: uniqueStrings(chunk.structured.人物状态.map((item) => item.人物), 12),
      场景目标: "保留片段内主要事件与人物状态。",
      冲突或阻力: firstDefined(chunk.structured.关键事件.map((item) => item.事件原因), "未明确"),
      关键事件:
        uniqueStrings(
          chunk.structured.关键事件.map((item) => item.事件),
          8
        ).length > 0
          ? uniqueStrings(
              chunk.structured.关键事件.map((item) => item.事件),
              8
            )
          : [chunk.structured.片段摘要],
      场景结果: firstDefined(chunk.structured.关键事件.map((item) => item.事件结果), chunk.structured.片段摘要),
      情绪变化: firstDefined(chunk.structured.人物状态.map((item) => item.情绪状态), "未明确"),
      承接关系: "承接上一片段并进入下一片段。",
      证据短句: uniqueStrings(
        [
          ...chunk.structured.关键事件.flatMap((item) => item.证据短句),
          ...chunk.structured.人物状态.flatMap((item) => item.证据短句)
        ],
        6
      )
    })),
    关键事件:
      keyEvents.length > 0
        ? keyEvents
        : [
            {
              事件: "长章节片段缓存已建立",
              涉及人物: [],
              时间地点: "未明确",
              事件原因: "章节正文超过直接索引长度",
              事件结果: "系统按片段保留章节事实",
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
              本章出场状态: "未明确",
              本章结束状态: "未明确",
              身体状态: "未明确",
              情绪状态: "未明确",
              行动: [],
              动机: "未明确",
              目标: "未明确",
              阻力: "未明确",
              位置变化: "未明确",
              新获得信息: [],
              仍不知道的信息: [],
              误解或错误判断: [],
              与他人关系变化: [],
              需要后文承接: "否",
              证据短句: []
            }
          ],
    人物认知边界: uniqueRecords(
      orderedChunks.flatMap((chunk) => chunk.structured.人物认知边界),
      (item) => `${item.人物}|${item.已经知道.join("、")}|${item.新得知.join("、")}`,
      32
    ),
    关系动态: uniqueRecords(
      orderedChunks.flatMap((chunk) => chunk.structured.关系动态),
      (item) => `${item.关系双方.join("、")}|${item.关系类型}|${item.本章结束状态}`,
      24
    ),
    时间与地点: {
      本章时间: firstDefined(timePlaces.map((item) => item.本章时间), "未明确"),
      时间跨度: firstDefined(timePlaces.map((item) => item.时间跨度), "未明确"),
      主要地点: places,
      地点移动: uniqueStrings(
        timePlaces.flatMap((item) => item.地点移动),
        24
      ),
      明确时间锚点: uniqueStrings(
        timePlaces.flatMap((item) => item.明确时间锚点),
        24
      ),
      相对时间锚点: relativeTimes,
      可能的时间线风险: uniqueStrings(
        timePlaces.flatMap((item) => item.可能的时间线风险),
        24
      ),
      证据短句: uniqueStrings(
        timePlaces.flatMap((item) => item.证据短句),
        12
      )
    },
    空间与行动逻辑: spatialActions,
    道具状态: uniqueRecords(
      orderedChunks.flatMap((chunk) => chunk.structured.道具状态),
      (item) => `${item.道具}|${item.当前持有者}|${item.本章结束状态}`,
      24
    ),
    设定与规则: uniqueRecords(
      orderedChunks.flatMap((chunk) => chunk.structured.设定与规则),
      (item) => `${item.设定项}|${item.本章信息}`,
      24
    ),
    限制与否定事实: negativeFacts,
    伏笔与线索: uniqueRecords(
      orderedChunks.flatMap((chunk) => chunk.structured.伏笔与线索),
      (item) => `${item.线索}|${item.本章状态}|${item.可能指向}`,
      32
    ),
    因果链: uniqueRecords(
      orderedChunks.flatMap((chunk) => chunk.structured.因果链),
      (item) => `${item.原因}|${item.结果}`,
      32
    ),
    可核对事实:
      facts.length > 0
        ? facts
        : [
            {
              事实编号: "事实-长章节-1",
              事实类型: "限制事实",
              主体: "章节缓存",
              属性: "聚合方式",
              取值: "长章节由片段缓存聚合而成",
              时间范围: "当前章节",
              地点: "未明确",
              确定性: "确定",
              后文核对意义: "后续查询应优先参考片段缓存中的事实条目",
              证据短句: []
            }
          ],
    连续性风险: uniqueRecords(
      orderedChunks.flatMap((chunk) => chunk.structured.连续性风险),
      (item) => `${item.风险}|${item.风险类型}|${item.原因}`,
      32
    ),
    未解决问题: uniqueRecords(
      orderedChunks.flatMap((chunk) => chunk.structured.未解决问题),
      (item) => `${item.问题}|${item.涉及人物或事件.join("、")}`,
      24
    ),
    文风与叙事: {
      叙事视角: "见片段缓存",
      主要语气: "见片段缓存",
      节奏特点: "长章节由多个连续片段构成，节奏以片段缓存记录为准。",
      对白特点: "见片段缓存",
      描写侧重: "保留片段中的人物行动、情绪、设定和伏笔线索。",
      续写时应保持: ["保持已建立的人物状态", "承接片段内关键事件", "避免丢失可核对事实"]
    },
    不可丢失信息:
      lostInfo.length > 0
        ? lostInfo
        : ["长章节已按片段建立事实索引，后续回答需要参考片段缓存"],
    适合回答的问题: ["本章讲了什么", "本章人物状态如何", "本章有哪些伏笔或线索", "本章有哪些可核对事实", "本章是否存在连续性风险"],
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

function splitParagraphPieces(plainText: string): Array<{ readonly start: number; readonly end: number; readonly units: number }> {
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
    if (units <= CHAPTER_INDEX_CHUNK_TARGET_UNITS) {
      pieces.push({ ...bounds, units });
      return;
    }
    let splitStart = bounds.start;
    while (splitStart < bounds.end) {
      const splitEnd = findForwardWritingUnitOffset(plainText, splitStart, bounds.end, CHAPTER_INDEX_CHUNK_TARGET_UNITS);
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

export function splitChapterForSummaryIndex(plainText: string): ChapterSummaryIndexChunk[] {
  const pieces = splitParagraphPieces(plainText);
  if (pieces.length === 0) {
    return [];
  }

  const ranges: Array<{ readonly start: number; readonly end: number; readonly units: number }> = [];
  let currentStart = pieces[0].start;
  let currentEnd = pieces[0].end;
  let currentUnits = 0;

  for (const piece of pieces) {
    if (currentUnits > 0 && currentUnits + piece.units > CHAPTER_INDEX_CHUNK_TARGET_UNITS) {
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
      index === 0 ? range.start : findBackwardWritingUnitOffset(plainText, ranges[index - 1]?.start ?? 0, range.start, CHAPTER_INDEX_CHUNK_OVERLAP_UNITS);
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

export class SummaryService implements SummaryIndexInvalidator {
  private readonly activeChapterEditTimes = new Map<string, string>();
  private readonly changedWritingUnits = new Map<string, number>();

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
  }

  recordActiveChapterEdit(projectId: string, chapterId: string, editedAt: string): void {
    this.activeChapterEditTimes.set(keyFor(projectId, chapterId), editedAt);
  }

  onChapterBecameInactive(projectId: string, chapterId: string, now: string): SummaryJobRecord | null {
    this.activeChapterEditTimes.delete(keyFor(projectId, chapterId));
    return this.maybeEnqueueChapterSummary({
      projectId,
      chapterId,
      trigger: "chapter_inactive",
      now
    });
  }

  maybeEnqueueChapterSummary(input: MaybeEnqueueChapterSummaryInput): SummaryJobRecord | null {
    const content = this.chapterRepo.getContent(input.chapterId);
    if (!content || content.projectId !== input.projectId) {
      throw new Error("找不到需要建立摘要的章节。");
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
    if (input.trigger === "auto_idle" && !this.isIdle(input.projectId, input.chapterId, input.now)) {
      return null;
    }
    const existingSummary = this.summaryRepo.getChapterSummary(input.projectId, input.chapterId);
    if (input.trigger !== "manual_rebuild" && existingSummary && isReadyChapterSummary(existingSummary, sourceHash)) {
      return null;
    }

    return this.summaryRepo.enqueueSummaryJob({
      projectId: input.projectId,
      jobType: "chapter_summary" satisfies SummaryJobType,
      targetId: input.chapterId,
      sourceHash,
      priority: priorityFor(input.trigger, this.changedWritingUnits.get(keyFor(input.projectId, input.chapterId)) ?? null),
      now: input.now
    });
  }

  enqueueEligibleStaleChapterSummaries(projectId: string, now: string): SummaryJobRecord[] {
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
      if (summaryChapterIds.has(chapter.id) || !this.activeChapterEditTimes.has(keyFor(projectId, chapter.id))) {
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
      if (summary.status === "ready") {
        readyChapterCount += 1;
        continue;
      }
      if (summary.status === "skipped_too_short") {
        skippedTooShortChapterCount += 1;
        continue;
      }
      staleChapterCount += 1;
    }

    const jobs = this.summaryRepo.listSummaryJobs(projectId);
    const runningJob = jobs.find((job) => job.status === "running") ?? null;
    const nextRetryJob =
      jobs
        .filter((job) => job.status === "queued" && job.nextRunAt && job.nextRunAt > now)
        .sort((left, right) => String(left.nextRunAt).localeCompare(String(right.nextRunAt)))[0] ?? null;

    return {
      projectId,
      totalChapterCount: chapters.length,
      readyChapterCount,
      staleChapterCount,
      missingChapterCount,
      skippedTooShortChapterCount,
      failedJobCount: jobs.filter((job) => job.status === "failed").length,
      cancelledJobCount: jobs.filter((job) => job.status === "cancelled").length,
      queuedJobCount: jobs.filter((job) => job.status === "queued").length,
      runningJobLabel: runningJob ? this.formatRunningJobLabel(projectId, runningJob) : null,
      nextRetryAt: nextRetryJob?.nextRunAt ?? null,
      nextRetryJobLabel: nextRetryJob ? this.formatPendingRetryJobLabel(projectId, nextRetryJob) : null,
      pausedReason: options.pausedReason ?? null,
      updatedAt: now
    };
  }

  listChapterCacheEntries(projectId: string, now: string): SummaryChapterCacheEntry[] {
    const summaries = new Map(this.summaryRepo.listChapterSummaries(projectId).map((summary) => [summary.chapterId, summary]));
    const jobs = this.currentChapterJobs(projectId);
    return this.chapterRepo.listByProject(projectId).map((chapter) => {
      const summary = summaries.get(chapter.id) ?? null;
      const job = jobs.get(chapter.id) ?? null;
      return {
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterOrder: chapter.sortOrder + 1,
        wordCount: chapter.wordCount,
        cacheState: this.deriveChapterCacheState(summary, job),
        summaryShort: summary?.summaryShort ?? null,
        summaryUpdatedAt: summary?.updatedAt ?? null,
        contentHash: summary?.contentHash ?? null,
        jobStatus: job?.status ?? null,
        jobError: job?.error ?? null,
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

  clearAndRetryChapterCache(projectId: string, chapterId: string, now: string, options: SummaryIndexStatusOptions = {}): SummaryIndexStatus {
    if (this.summaryRepo.hasRunningSummaryJob(projectId)) {
      throw new Error("后台索引正在运行。请先停止后台索引，再清除并重试章节缓存。");
    }
    const content = this.chapterRepo.getContent(chapterId);
    if (!content || content.projectId !== projectId) {
      throw new Error("找不到需要重试缓存的章节。");
    }

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

  rebuildProjectIndex(projectId: string, now: string, options: SummaryRebuildProjectIndexOptions = {}): SummaryIndexStatus {
    const trigger: ChapterSummaryQueueTrigger = options.force ? "manual_rebuild" : "manual_continue";
    for (const chapter of this.chapterRepo.listByProject(projectId)) {
      this.maybeEnqueueChapterSummary({
        projectId,
        chapterId: chapter.id,
        trigger,
        now
      });
    }
    return this.getIndexStatus(projectId, now, options);
  }

  private currentChapterJobs(projectId: string): Map<string, SummaryJobRecord> {
    const jobs = new Map<string, SummaryJobRecord>();
    for (const job of this.summaryRepo.listSummaryJobs(projectId)) {
      if (job.jobType !== "chapter_summary" || !job.targetId || jobs.has(job.targetId)) {
        continue;
      }
      if (job.status === "completed" || job.status === "skipped") {
        continue;
      }
      jobs.set(job.targetId, job);
    }
    return jobs;
  }

  private deriveChapterCacheState(summary: ChapterAiSummaryRecord | null, job: SummaryJobRecord | null): SummaryChapterCacheEntry["cacheState"] {
    if (job?.status === "running" || job?.status === "queued") {
      return job.status;
    }
    if (job?.status === "failed" && summary?.status !== "ready") {
      return "failed";
    }
    if (job?.status === "cancelled" && !summary) {
      return "cancelled";
    }
    return summary?.status ?? "missing";
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

    if (countWritingUnits(content.plainText) > CHAPTER_INDEX_DIRECT_MAX_UNITS) {
      return this.summarizeLongChapterWithChunks(projectId, chapterId, sourceHash, now, content, generator, options);
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

    const summary = this.summaryRepo.upsertChapterSummary({
      id: createId("summary"),
      projectId,
      chapterId,
      chapterTitle: latestContent.title,
      chapterOrder: latestContent.sortOrder + 1,
      contentHash: sourceHash,
      summaryShort: getChapterSummaryShortText(structured),
      summaryLong: getChapterSummaryLongText(structured),
      structured,
      tokenCount: estimateTextTokens(JSON.stringify(structured)),
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
    options: { readonly signal?: AbortSignal }
  ): Promise<ChapterAiSummaryRecord> {
    if (!generator.summarizeChapterChunkForIndex) {
      throw new Error("AI 章节片段摘要生成器未配置。");
    }

    const chunks = splitChapterForSummaryIndex(content.plainText);
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

    const summary = this.summaryRepo.upsertChapterSummary({
      id: createId("summary"),
      projectId,
      chapterId,
      chapterTitle: latestContent.title,
      chapterOrder: latestContent.sortOrder + 1,
      contentHash: sourceHash,
      summaryShort: getChapterSummaryShortText(structured),
      summaryLong: getChapterSummaryLongText(structured),
      structured,
      tokenCount: estimateTextTokens(JSON.stringify(structured)),
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
    const generator = this.options.generator?.summarizeArcForIndex;
    if (!generator) {
      throw new Error("AI 阶段摘要生成器未配置。");
    }
    const readySummaries = this.collectReadyChapterSummariesForArc(projectId, chapterFrom, chapterTo);
    const currentSourceHash = computeSourceHash(readySummaries.map((summary) => summary.contentHash));
    if (currentSourceHash !== sourceHash) {
      this.requeueArcSummary(projectId, arcKey, currentSourceHash, now);
      throw new SummarySourceChangedError("阶段摘要来源已变化，已重新排队最新摘要任务。");
    }

    const structured = await generator(
      {
        arcKey,
        chapterFrom,
        chapterTo,
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
    const latestSourceHash = computeSourceHash(latestReadySummaries.map((summary) => summary.contentHash));
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
    this.enqueueBookIfReady(projectId, now);
    return summary;
  }

  async summarizeBook(projectId: string, sourceHash: string, now: string, options: { readonly signal?: AbortSignal } = {}): Promise<BookAiSummaryRecord> {
    const generator = this.options.generator?.summarizeBookForIndex;
    if (!generator) {
      throw new Error("AI 全书摘要生成器未配置。");
    }
    const coverage = this.buildBookCoverage(projectId);
    const readyArcs = this.summaryRepo.listArcSummaries(projectId).filter((summary) => summary.status === "ready");
    if (readyArcs.length === 0) {
      throw new Error("全书摘要等待阶段摘要完成。");
    }
    const currentSourceHash = this.computeBookSourceHash(readyArcs.map((summary) => summary.sourceHash), coverage);
    if (currentSourceHash !== sourceHash) {
      this.requeueBookSummary(projectId, currentSourceHash, now);
      throw new SummarySourceChangedError("全书摘要来源已变化，已重新排队最新摘要任务。");
    }

    const generated = await generator(
      {
        arcs: readyArcs.map((summary) => ({
          arcKey: summary.arcKey,
          chapterFrom: summary.chapterFrom,
          chapterTo: summary.chapterTo,
          summary: summary.summary,
          structured: summary.structured
        })),
        coverage
      },
      options
    );
    const latestCoverage = this.buildBookCoverage(projectId);
    const latestReadyArcs = this.summaryRepo.listArcSummaries(projectId).filter((summary) => summary.status === "ready");
    const latestSourceHash = this.computeBookSourceHash(latestReadyArcs.map((summary) => summary.sourceHash), latestCoverage);
    if (latestSourceHash !== sourceHash) {
      this.requeueBookSummary(projectId, latestSourceHash, now);
      throw new SummarySourceChangedError("全书摘要来源已变化，已重新排队最新摘要任务。");
    }
    const structured: BookAiSummaryPayload = {
      ...generated,
      全书信息: {
        ...generated.全书信息,
        覆盖阶段: latestReadyArcs.map((summary) => formatArcCoverageLabel(summary.chapterFrom, summary.chapterTo)),
        覆盖章节范围: latestCoverage.totalChapterCount > 0 ? `第1-${latestCoverage.totalChapterCount}章` : "无章节",
        总章节数: latestCoverage.totalChapterCount,
        已索引章节数: latestCoverage.indexedChapterCount,
        过期章节: [...latestCoverage.staleChapterIds],
        缺失章节: [...latestCoverage.missingChapterIds],
        过短跳过章节: [...latestCoverage.skippedTooShortChapterIds],
        覆盖限制: [...generated.全书信息.覆盖限制]
      }
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
    const editedAt = this.activeChapterEditTimes.get(keyFor(projectId, chapterId));
    if (!editedAt) {
      return true;
    }
    return parseTime(now) - parseTime(editedAt) >= ACTIVE_CHAPTER_IDLE_MS;
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
    return this.summaryRepo.enqueueSummaryJob({
      projectId,
      jobType: "chapter_summary",
      targetId: chapterId,
      sourceHash,
      priority: 8,
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
      return !summary || (summary.status !== "skipped_too_short" && summary.status !== "ready");
    });
    if (blocking.length > 0) {
      throw new Error("阶段摘要等待章节摘要完成。");
    }
    const readySummaries = chapters
      .map((chapter) => summaries.get(chapter.id))
      .filter((summary): summary is ChapterAiSummaryRecord => summary !== undefined && summary.status === "ready");
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
    const sourceHash = computeSourceHash(readySummaries.map((summary) => summary.contentHash));
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
      if (summary.status === "ready") {
        indexedChapterCount += 1;
        continue;
      }
      if (summary.status === "skipped_too_short") {
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

  private enqueueBookIfReady(projectId: string, now: string): SummaryJobRecord | null {
    const coverage = this.buildBookCoverage(projectId);
    const readyArcs = this.summaryRepo.listArcSummaries(projectId).filter((summary) => summary.status === "ready");
    if (readyArcs.length === 0) {
      return null;
    }
    const sourceHash = this.computeBookSourceHash(readyArcs.map((summary) => summary.sourceHash), coverage);
    const existing = this.summaryRepo.getLatestBookSummary(projectId);
    if (existing?.status === "ready" && existing.sourceHash === sourceHash) {
      return null;
    }
    return this.summaryRepo.enqueueSummaryJob({
      projectId,
      jobType: "book_summary",
      targetId: null,
      sourceHash,
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
        return `正在摘要：${content.title}`;
      }
      return "正在摘要章节";
    }
    if (job.jobType === "arc_summary") {
      return "正在整理阶段摘要";
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
        return content.title;
      }
      return "章节摘要";
    }
    if (job.jobType === "arc_summary") {
      return "阶段摘要";
    }
    if (job.jobType === "book_summary") {
      return "全书摘要";
    }
    return "全书索引";
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
