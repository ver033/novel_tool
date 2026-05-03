import type { ArcAiSummaryPayload, BookSummaryCoverage, ChapterAiSummaryChunkPayload, ChapterAiSummaryPayload } from "../shared/summary-index";
import type { OpenRouterMessage } from "./openrouter-client";

export type ChapterIndexSummaryInput = {
  readonly projectId: string;
  readonly chapterId: string;
  readonly title: string;
  readonly ordinal: number;
  readonly plainText: string;
};

export type ChapterChunkIndexSummaryInput = {
  readonly projectId: string;
  readonly chapterId: string;
  readonly title: string;
  readonly ordinal: number;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly textStart: number;
  readonly textEnd: number;
  readonly plainText: string;
};

export type ChapterChunkMergeSummaryInput = {
  readonly projectId: string;
  readonly chapterId: string;
  readonly title: string;
  readonly ordinal: number;
  readonly chunks: readonly {
    readonly chunkIndex: number;
    readonly textStart: number;
    readonly textEnd: number;
    readonly summaryShort: string;
    readonly structured: ChapterAiSummaryChunkPayload;
  }[];
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
  readonly coverage: BookSummaryCoverage;
};

export type ContinuityCheckInput = {
  readonly question: string;
  readonly chapters: readonly {
    readonly chapterId: string;
    readonly title: string;
    readonly ordinal: number;
    readonly summaryShort: string;
    readonly summaryLong: string;
    readonly structured: ChapterAiSummaryPayload;
  }[];
};

const CHAPTER_JSON_CONTRACT = [
  "{",
  '  "章节信息": {"章节序号": 1, "章节标题": "标题", "正文覆盖": "完整章节", "缓存类型": "章节缓存", "缓存版本": "三-Lite", "语言": "简体中文"},',
  '  "缓存质量": {"覆盖完整度": "完整", "信息密度": "中", "需要回读原文": "否", "缺失说明": []},',
  '  "一句话摘要": "一句话概括本章不可丢失的核心变化",',
  '  "短摘要": "较短剧情摘要",',
  '  "详细梗概": "完整但精炼的剧情梗概，保留关键转折、人物状态变化、因果和后续影响",',
  '  "章节作用": {"剧情作用": "未明确", "人物作用": "未明确", "后文作用": "未明确"},',
  '  "场景推进": ["按正文顺序记录本章主要场景或剧情推进"],',
  '  "关键事件": [{"事件": "事件", "涉及人物": [], "时间地点": "未明确", "结果": "未明确", "后续影响": "未明确", "证据短句": []}],',
  '  "人物状态": [{"人物": "人物名", "本章变化": "未明确", "行动": [], "目标或动机": "未明确", "新获得信息": [], "仍不知道的信息": [], "关系变化": [], "证据短句": []}],',
  '  "人物认知边界": [{"人物": "人物名", "认知变化": "未明确", "仍不知道": [], "误解或风险": [], "证据短句": []}],',
  '  "关系变化": ["关系变化或称呼/立场变化"],',
  '  "时间地点": {"本章时间": "未明确", "主要地点": [], "时间线索": [], "地点移动": [], "可能风险": []},',
  '  "道具设定变化": ["道具状态、新设定、规则限制或否定事实的高价值变化"],',
  '  "伏笔与线索": [{"线索": "线索", "类型": "普通线索", "状态": "待判断", "指向或意义": "未明确", "证据短句": []}],',
  '  "可核对事实": ["用于后文检查的人物、认知、道具、设定、时间、因果事实"],',
  '  "连续性风险": ["需要后文注意的时间线、人物认知、道具状态、设定或因果风险"],',
  '  "未解决问题": ["后文需要回答的问题"],',
  '  "文风要点": ["叙事视角、主要语气、节奏或对白特点"],',
  '  "不可丢失信息": ["本章后续必须保留的信息"],',
  '  "不确定项": []',
  "}"
].join("\n");

const CHAPTER_CHUNK_JSON_CONTRACT = [
  "{",
  '  "片段信息": {"章节序号": 1, "章节标题": "标题", "片段序号": 1, "片段总数": 2, "正文覆盖": "片段", "缓存类型": "章节片段缓存", "缓存版本": "二-Lite", "语言": "简体中文"},',
  '  "片段摘要": "只概括当前片段发生的事实",',
  '  "关键事件": [{"事件": "事件", "涉及人物": [], "时间地点": "未明确", "结果": "未明确", "后续影响": "未明确", "证据短句": []}],',
  '  "人物状态": [{"人物": "人物名", "本章变化": "未明确", "行动": [], "目标或动机": "未明确", "新获得信息": [], "仍不知道的信息": [], "关系变化": [], "证据短句": []}],',
  '  "人物认知边界": [{"人物": "人物名", "认知变化": "未明确", "仍不知道": [], "误解或风险": [], "证据短句": []}],',
  '  "关系变化": ["关系变化或称呼/立场变化"],',
  '  "时间地点": {"本章时间": "未明确", "主要地点": [], "时间线索": [], "地点移动": [], "可能风险": []},',
  '  "道具设定变化": ["道具状态、新设定、规则限制或否定事实的高价值变化"],',
  '  "伏笔与线索": [{"线索": "线索", "类型": "普通线索", "状态": "待判断", "指向或意义": "未明确", "证据短句": []}],',
  '  "可核对事实": ["用于后文检查的人物、认知、道具、设定、时间、因果事实"],',
  '  "连续性风险": ["需要后文注意的时间线、人物认知、道具状态、设定或因果风险"],',
  '  "未解决问题": ["后文需要回答的问题"],',
  '  "不可丢失信息": ["本片段后续必须保留的信息"]',
  "}"
].join("\n");

const ARC_JSON_CONTRACT = [
  "{",
  '  "阶段信息": {"起始章节": 1, "结束章节": 10, "覆盖章节": [1, 2], "覆盖限制": []},',
  '  "阶段一句话摘要": "阶段一句话摘要",',
  '  "阶段详细梗概": "阶段详细梗概，保留剧情主线、人物状态、认知变化、关系变化、伏笔线、道具线、设定变化和未解决问题",',
  '  "主线推进": ["阶段主线推进"],',
  '  "人物线变化": ["人物状态变化"],',
  '  "人物认知变化": ["人物认知变化"],',
  '  "关系线变化": ["关系变化"],',
  '  "伏笔线变化": ["伏笔推进"],',
  '  "道具线变化": ["道具状态变化"],',
  '  "设定变化": ["设定变化"],',
  '  "时间地点推进": ["时间地点推进"],',
  '  "重要因果链": ["重要因果链"],',
  '  "未解决问题": ["未解决问题"],',
  '  "连续性风险": ["连续性风险"],',
  '  "可核对事实": ["可核对事实"],',
  '  "不可丢失信息": ["不可丢失信息"],',
  '  "适合回答的问题": ["适合回答的问题"]',
  "}"
].join("\n");

const BOOK_JSON_CONTRACT = [
  "{",
  '  "全书信息": {"覆盖阶段": ["第1-10章"], "覆盖章节范围": "第1-10章", "总章节数": 10, "已索引章节数": 10, "过期章节": [], "缺失章节": [], "过短跳过章节": [], "覆盖限制": []},',
  '  "全文一句话摘要": "全文一句话摘要",',
  '  "全文短摘要": "全文短摘要",',
  '  "全文详细梗概": "全文详细梗概，保留主线剧情、主要人物线、重要关系线、人物认知线、伏笔线、道具线、世界规则、时间地点结构和未解决问题",',
  '  "主线剧情": ["主线剧情"],',
  '  "主要人物线": ["主要人物线"],',
  '  "重要关系线": ["重要关系线"],',
  '  "人物认知线": ["人物认知线"],',
  '  "伏笔线": ["伏笔线"],',
  '  "道具线": ["道具线"],',
  '  "世界规则与设定": ["世界规则与设定"],',
  '  "时间地点结构": ["时间地点结构"],',
  '  "核心冲突": ["核心冲突"],',
  '  "主题与情绪基调": "主题与情绪基调",',
  '  "未解决问题": ["未解决问题"],',
  '  "连续性风险": ["连续性风险"],',
  '  "可核对事实": ["可核对事实"],',
  '  "不可丢失信息": ["不可丢失信息"],',
  '  "适合回答的问题": ["适合回答的问题"]',
  "}"
].join("\n");

const CONTINUITY_JSON_CONTRACT = [
  "{",
  '  "结论": "确定冲突/疑似冲突/需要回读原文确认/无明显冲突",',
  '  "问题列表": [{"问题类型": "人物认知", "严重程度": "中", "涉及章节": ["第3章", "第20章"], "冲突说明": "冲突说明", "证据一": {"章节": "第3章", "字段": "人物认知边界", "证据短句": "证据"}, "证据二": {"章节": "第20章", "字段": "人物状态", "证据短句": "证据"}, "为什么可能冲突": "原因", "是否可能是伏笔或误导": "待判断", "是否需要回读原文": "是", "建议处理": "建议"}],',
  '  "需要回读的章节": [],',
  '  "给作者的简短说明": "给作者的简短说明"',
  "}"
].join("\n");

export function buildChapterIndexSummaryMessages(input: ChapterIndexSummaryInput): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文长篇小说的章节索引助手。",
        "任务是生成长期可复用的章节事实索引，用于后续全书总结、人物状态查询、人物认知边界查询、伏笔查询、道具状态查询、设定规则查询、连续性检查和剧情问答。",
        "忠实原文，不添加原文没有的信息；不要评价文笔，不要改写正文。",
        "所有 JSON 键名必须使用简体中文；除证据短句忠实保留原文外，所有字符串值必须使用简体中文。",
        "不确定内容写“未明确”“疑似”或“待判断”，不要把推测写成事实。",
        "每个重要判断尽量给出简短证据短句，证据短句必须来自原文，不要整段复制。",
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
        "版本要求：完整章节缓存的“章节信息.缓存版本”必须是“三-Lite”。“二-Lite”只允许用于章节片段缓存，禁止用于完整章节缓存。",
        "质量要求：",
        "1. 必须记录关键事件、人物状态、可核对事实和不可丢失信息。",
        "2. 必须记录人物认知边界：谁知道什么、谁不知道什么、谁新得知什么、谁可能误解。",
        "3. 必须把道具状态、设定规则、限制条件、否定事实合并到“道具设定变化”，只保留会影响后文的高价值信息。",
        "4. 如果某类数组没有原文依据，必须输出空数组，不要照抄示例占位。",
        "5. 非证据字段不得出现英文。",
        "6. 控制输出规模：场景推进最多 5 项；关键事件、人物状态、人物认知边界、伏笔与线索、可核对事实、不可丢失信息各最多 8 项；连续性风险最多 6 项；每项证据短句最多 1 条。",
        "7. 8000 字章节的 JSON 总长度应尽量控制在 15000 个中文字符以内；不要输出完整场景表，不要机械重复同一事实。",
        "8. 优先保留影响后文连续性、人物状态、人物认知、伏笔、道具状态、设定规则和因果链的高价值信息。",
        "章节正文：",
        input.plainText.trim() || "（本章暂无正文）"
      ].join("\n")
    }
  ];
}

export function buildChapterChunkIndexSummaryMessages(input: ChapterChunkIndexSummaryInput): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文长篇小说的章节片段缓存助手。",
        "你的任务是为一个章节片段生成结构化片段缓存，片段缓存稍后会与同章其他片段缓存合并为完整章节缓存。",
        "只能记录当前片段中出现的信息。",
        "不得根据其他片段、常识或猜测补全。",
        "不得把推测写成事实；疑似内容必须标注“疑似”或“待判断”。",
        "证据短句必须来自当前片段原文。",
        "所有 JSON 键名必须使用简体中文；除证据短句忠实保留原文外，所有字符串值必须使用简体中文。",
        "输出 JSON，且只能输出 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `章节序号：${input.ordinal}`,
        `章节标题：${input.title}`,
        `片段序号：${input.chunkIndex + 1}`,
        `片段总数：${input.chunkCount}`,
        `原文偏移：${input.textStart}-${input.textEnd}`,
        "JSON 字段格式：",
        CHAPTER_CHUNK_JSON_CONTRACT,
        "控制输出规模：片段关键事件、人物状态、人物认知边界、可核对事实、不可丢失信息各最多 5 项；伏笔与线索、连续性风险各最多 4 项；每项证据短句最多 1 条。不要为了填字段重复同一事实。",
        "必须把当前片段内明确出现的空间移动、行动起止、限制条件、否定事实和不能成立的信息压缩进“道具设定变化”“可核对事实”或“连续性风险”；没有原文依据时用空数组，不要照抄示例占位。",
        "片段正文：",
        input.plainText.trim() || "（本片段暂无正文）"
      ].join("\n")
    }
  ];
}

export function buildChapterChunkMergeSummaryMessages(input: ChapterChunkMergeSummaryInput): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文长篇小说的章节缓存合并助手。",
        "你的任务是把同一章节的多个片段缓存合并成完整章节缓存。",
        "只能使用片段缓存中的信息，不得编造，不得回读或推测原文。",
        "如果多个片段出现同一人物、道具、伏笔或关系，必须合并为连续变化，而不是重复罗列。",
        "不得遗漏片段缓存中明确出现的重要内容。",
        "必须保留场景顺序、人物状态变化、人物认知边界、伏笔、道具设定变化、可核对事实、连续性风险和未解决问题。",
        "合并时要提炼，不要机械拼接全部片段缓存；同一人物、道具、伏笔、关系和事实必须合并去重。",
        "控制输出规模：场景推进最多 6 项；关键事件、人物状态、人物认知边界、伏笔与线索、可核对事实、不可丢失信息各最多 10 项；连续性风险最多 8 项；每项证据短句最多 1 条。",
        "合并输出是完整章节缓存，不是片段缓存；“章节信息.缓存版本”必须是“三-Lite”，不得沿用片段缓存的“二-Lite”。",
        "如果信息很多，优先保留影响后文连续性、人物状态、人物认知、伏笔、设定规则、道具状态和因果链的高价值信息。",
        "所有 JSON 键名必须使用简体中文；除证据短句忠实保留片段缓存外，所有字符串值必须使用简体中文。",
        "输出完整章节缓存 JSON，且只能输出 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `章节序号：${input.ordinal}`,
        `章节标题：${input.title}`,
        "完整章节 JSON 字段格式：",
        CHAPTER_JSON_CONTRACT,
        "片段缓存列表：",
        input.chunks
          .map((chunk) =>
            [
              `[片段 ${chunk.chunkIndex + 1} | 原文偏移 ${chunk.textStart}-${chunk.textEnd}]`,
              `片段短摘要：${chunk.summaryShort}`,
              `结构化片段缓存：${JSON.stringify(chunk.structured)}`
            ].join("\n")
          )
          .join("\n\n")
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
        "任务是把连续章节的长期索引缓存聚合成中文阶段缓存。",
        "按时间和因果顺序整理；不加入原缓存没有的信息。",
        "必须保留主线推进、人物线变化、人物认知变化、关系线变化、伏笔线变化、道具线变化、设定变化、可核对事实、连续性风险和未解决问题。",
        "所有 JSON 键名必须使用简体中文；非证据字符串不得出现英文。",
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
        "任务是根据阶段缓存生成中文全书缓存。",
        "概括主线剧情、主要人物线、关系变化、人物认知线、关键冲突、伏笔线、道具线、世界规则、时间地点结构和未解决问题；不编造没有出现的内容。",
        "如果阶段缓存存在缺失或过期信息，必须记录在“全书信息.覆盖限制”中。",
        "所有 JSON 键名必须使用简体中文；非证据字符串不得出现英文。",
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

export function buildContinuityCheckMessages(input: ContinuityCheckInput): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文长篇小说的跨章节连续性检查助手。",
        "你只能根据提供的章节缓存判断，不得编造未提供的信息。",
        "必须区分“确定冲突”“疑似冲突”“需要回读原文确认”“无明显冲突”。",
        "不得把疑似伏笔、误导线索、角色撒谎、不可靠叙述直接判为错误。",
        "每条问题必须引用两个或多个章节缓存中的证据；证据不足时写“需要回读原文确认”。",
        "回复必须使用简体中文，不得输出英文。",
        "只输出 JSON，不要输出 Markdown、代码块、前言或结尾。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `用户问题：${input.question}`,
        "JSON 字段格式：",
        CONTINUITY_JSON_CONTRACT,
        "待比对章节缓存：",
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
