import type { ArcAiSummaryPayload, BookAiSummaryPayload, ChapterAiSummaryPayload } from "../shared/summary-index";
import type { OpenRouterMessage } from "./openrouter-client";

export type ChapterIndexSummaryInput = {
  readonly projectId: string;
  readonly chapterId: string;
  readonly title: string;
  readonly ordinal: number;
  readonly plainText: string;
};

export type ArcIndexSummaryChapter = {
  readonly chapterId: string;
  readonly title: string;
  readonly ordinal: number;
  readonly summaryShort: string;
  readonly summaryLong: string;
  readonly structured: ChapterAiSummaryPayload;
};

export type ArcIndexSummaryInput = {
  readonly arcKey: string;
  readonly chapterFrom: number;
  readonly chapterTo: number;
  readonly chapters: readonly ArcIndexSummaryChapter[];
};

export type BookIndexSummaryArc = {
  readonly arcKey: string;
  readonly chapterFrom: number;
  readonly chapterTo: number;
  readonly summary: string;
  readonly structured: ArcAiSummaryPayload;
};

export type BookIndexSummaryInput = {
  readonly arcs: readonly BookIndexSummaryArc[];
  readonly coverage: BookAiSummaryPayload["coverage"];
};

const CHAPTER_JSON_CONTRACT = [
  "{",
  '  "oneLine": "一句话概括本章",',
  '  "synopsis": "较完整的本章剧情摘要",',
  '  "keyEvents": ["关键事件"],',
  '  "characterMentions": [{"name":"人物名","roleInChapter":"本章作用","stateOrChange":"状态变化，可省略"}],',
  '  "relationshipHints": ["关系变化或关系线索"],',
  '  "timeAndPlace": ["时间地点线索"],',
  '  "foreshadowingHints": ["可能伏笔或待回收线索"],',
  '  "unresolvedQuestions": ["未解决问题"],',
  '  "emotionalArc": "本章情绪走向",',
  '  "importantQuotes": ["可回溯原文的短引句"]',
  "}"
].join("\n");

const ARC_JSON_CONTRACT = [
  "{",
  '  "chapterFrom": 1,',
  '  "chapterTo": 10,',
  '  "synopsis": "阶段剧情摘要",',
  '  "keyEvents": ["阶段关键事件"],',
  '  "characterChanges": ["人物状态变化"],',
  '  "relationshipChanges": ["关系变化"],',
  '  "foreshadowingHints": ["可能伏笔"],',
  '  "unresolvedQuestions": ["未解决问题"]',
  "}"
].join("\n");

const BOOK_JSON_CONTRACT = [
  "{",
  '  "coverage": {"totalChapterCount": 0, "indexedChapterCount": 0, "staleChapterIds": [], "missingChapterIds": [], "skippedTooShortChapterIds": []},',
  '  "synopsis": "全书级剧情摘要",',
  '  "mainPlot": ["主线推进"],',
  '  "majorCharacters": [{"name":"人物名","summary":"人物当前状态和变化"}],',
  '  "majorConflicts": ["主要冲突"],',
  '  "relationshipChanges": ["主要关系变化"],',
  '  "foreshadowingHints": ["重要伏笔"],',
  '  "unresolvedQuestions": ["未解决问题"]',
  "}"
].join("\n");

export function buildChapterIndexSummaryMessages(input: ChapterIndexSummaryInput): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文长篇小说的章节索引助手。",
        "任务是生成长期可复用的章节摘要索引，用于后续全书总结、人物线索、连续性检查和剧情问答。",
        "忠实原文，不添加原文没有的信息；不要评价文笔，不要改写正文。",
        "输出 JSON，且只能输出 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `章节序号：${input.ordinal}`,
        `章节标题：${input.title}`,
        "JSON 字段格式：",
        CHAPTER_JSON_CONTRACT,
        "章节正文：",
        input.plainText.trim() || "（本章暂无正文）"
      ].join("\n")
    }
  ];
}

export function buildArcIndexSummaryMessages(input: ArcIndexSummaryInput): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文长篇小说的剧情阶段摘要助手。",
        "任务是把连续章节的长期索引摘要聚合成阶段摘要索引。",
        "按时间和因果顺序整理；不加入原摘要没有的信息。",
        "输出 JSON，且只能输出 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `阶段键：${input.arcKey}`,
        `章节范围：第${input.chapterFrom}-${input.chapterTo}章`,
        "JSON 字段格式：",
        ARC_JSON_CONTRACT,
        "章节摘要：",
        input.chapters
          .map((chapter) =>
            [
              `[第${chapter.ordinal}章 ${chapter.title}]`,
              `短摘要：${chapter.summaryShort}`,
              `长摘要：${chapter.summaryLong}`,
              `结构化索引：${JSON.stringify(chapter.structured)}`
            ].join("\n")
          )
          .join("\n\n")
      ].join("\n")
    }
  ];
}

export function buildBookIndexSummaryMessages(input: BookIndexSummaryInput): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文长篇小说的全书摘要助手。",
        "任务是根据阶段摘要生成全书级长期摘要索引。",
        "概括主线剧情、主要人物、关系变化、关键冲突、伏笔和未解决问题；不编造没有出现的内容。",
        "输出 JSON，且只能输出 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `覆盖信息：${JSON.stringify(input.coverage)}`,
        "JSON 字段格式：",
        BOOK_JSON_CONTRACT,
        "阶段摘要：",
        input.arcs
          .map((arc) =>
            [
              `[${arc.arcKey} 第${arc.chapterFrom}-${arc.chapterTo}章]`,
              arc.summary,
              `结构化索引：${JSON.stringify(arc.structured)}`
            ].join("\n")
          )
          .join("\n\n")
      ].join("\n")
    }
  ];
}
