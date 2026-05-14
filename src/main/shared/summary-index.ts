import { createHash } from "node:crypto";
import { z } from "zod";

export const summaryStatusSchema = z.enum(["ready", "stale", "building", "failed", "skipped_too_short"]);
export const summaryJobStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled", "skipped"]);
export const summaryJobTypeSchema = z.enum([
  "chapter_summary",
  "arc_summary",
  "book_summary",
  "rebuild_project_index",
  "relationship_original_text_upgrade"
]);

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

const missingTextValues = new Set(["", "未明确", "无", "没有", "无新增", "暂无", "不详", "未知", "null", "undefined"]);

function normalizeTextValue(value: unknown): string {
  return stringifyStructuredValue(value).trim();
}

const textSchema = z.preprocess((value) => stringifyStructuredValue(value), z.string());
const requiredStringSchema = z.preprocess((value) => normalizeTextValue(value), z.string().trim().min(1));
const nonEmptyStringSchema = z.preprocess((value) => {
  const text = normalizeTextValue(value);
  return missingTextValues.has(text) ? "未明确" : text;
}, z.string().trim().min(1));

const chineseDigitValues: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};

function normalizeFullWidthDigits(text: string): string {
  return text.replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10));
}

function parseChineseInteger(text: string): number | null {
  const normalized = text.replace(/[第章节回卷部\s]/g, "");
  if (!normalized || !/[零〇一二两三四五六七八九十百千]/u.test(normalized)) {
    return null;
  }

  let total = 0;
  let current = 0;
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  for (const char of normalized) {
    const digit = chineseDigitValues[char];
    if (digit !== undefined) {
      current = digit;
      continue;
    }
    const unit = units[char];
    if (unit !== undefined) {
      total += (current || 1) * unit;
      current = 0;
    }
  }
  return total + current || null;
}

function parseLooseInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const text = normalizeFullWidthDigits(normalizeTextValue(value));
  const digitMatch = text.match(/\d+/u);
  if (digitMatch) {
    return Number.parseInt(digitMatch[0], 10);
  }
  return parseChineseInteger(text);
}

const positiveIntegerSchema = z.preprocess((value) => {
  const parsed = parseLooseInteger(value);
  return parsed ?? value;
}, z.number().int().positive());

const nonnegativeIntegerSchema = z.preprocess((value) => {
  const parsed = parseLooseInteger(value);
  return parsed ?? value;
}, z.number().int().nonnegative());

function normalizeArrayInput(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return [];
  }
  const text = stringifyStructuredValue(value).trim();
  if (!text || text === "未明确" || text === "无" || text === "没有" || text === "无新增" || text === "暂无") {
    return [];
  }
  return [value];
}

function arrayOf<T extends z.ZodType>(itemSchema: T) {
  return z.preprocess(normalizeArrayInput, z.array(itemSchema));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstValue(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && normalizeTextValue(value)) {
      return value;
    }
  }
  return undefined;
}

function normalizeStringList(value: unknown): string[] {
  const normalized = normalizeArrayInput(value);
  const items = Array.isArray(normalized) ? normalized : [normalized];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const text = normalizeTextValue(item);
    if (!text || missingTextValues.has(text) || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
  }
  return result;
}

function mergeStringLists(...values: readonly unknown[]): string[] {
  return normalizeStringList(values.flatMap((value) => normalizeStringList(value)));
}

function normalizeKeyEventLiteInput(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  return {
    ...value,
    结果: firstValue(value, ["结果", "事件结果", "场景结果"]) ?? "未明确"
  };
}

function normalizeCharacterStateLiteInput(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  return {
    ...value,
    本章变化:
      firstValue(value, ["本章变化", "状态变化"]) ??
      mergeStringLists(value.本章出场状态, value.本章结束状态, value.身体状态, value.情绪状态).join("；") ??
      "未明确",
    目标或动机: firstValue(value, ["目标或动机"]) ?? mergeStringLists(value.动机, value.目标).join("；") ?? "未明确",
    关系变化: firstValue(value, ["关系变化", "与他人关系变化"]) ?? []
  };
}

function normalizeCharacterKnowledgeLiteInput(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  return {
    ...value,
    认知变化: firstValue(value, ["认知变化"]) ?? mergeStringLists(value.新得知, value.已经知道).join("；") ?? "未明确",
    仍不知道: firstValue(value, ["仍不知道", "尚不知道", "仍不知道的信息"]) ?? [],
    误解或风险: firstValue(value, ["误解或风险", "误以为", "误解或错误判断"]) ?? []
  };
}

function normalizeForeshadowingLiteInput(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  return {
    ...value,
    状态: firstValue(value, ["状态", "本章状态"]) ?? "待判断",
    指向或意义: firstValue(value, ["指向或意义", "可能指向", "指向", "意义"]) ?? "未明确"
  };
}

function normalizeTimePlaceLiteInput(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  return {
    本章时间: firstValue(value, ["本章时间", "时间跨度"]) ?? "未明确",
    主要地点: firstValue(value, ["主要地点"]) ?? [],
    时间线索: firstValue(value, ["时间线索", "明确时间锚点", "相对时间锚点"]) ?? [],
    地点移动: firstValue(value, ["地点移动"]) ?? [],
    可能风险: firstValue(value, ["可能风险", "可能的时间线风险"]) ?? []
  };
}

function normalizeChapterSummaryShapeDrift(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const chapterFunction = isRecord(value.章节作用) ? value.章节作用 : isRecord(value.本章功能) ? value.本章功能 : undefined;
  const timePlace = isRecord(value.时间地点) ? value.时间地点 : isRecord(value.时间与地点) ? value.时间与地点 : undefined;

  return {
    ...value,
    章节作用: chapterFunction
      ? {
          ...chapterFunction,
          剧情作用: firstValue(chapterFunction, ["剧情作用", "剧情功能", "结构作用"]) ?? "未明确",
          人物作用: firstValue(chapterFunction, ["人物作用", "情绪功能", "章节类型"]) ?? "未明确",
          后文作用: firstValue(chapterFunction, ["后文作用", "对后文的作用"]) ?? "未明确"
        }
      : value.章节作用,
    场景推进: firstValue(value, ["场景推进"]) ?? normalizeStringList(value.场景列表),
    关系变化: firstValue(value, ["关系变化"]) ?? normalizeStringList(value.关系动态),
    时间地点: timePlace ? normalizeTimePlaceLiteInput(timePlace) : value.时间地点,
    道具设定变化: mergeStringLists(value.道具设定变化, value.道具状态, value.设定与规则, value.限制与否定事实),
    可核对事实: normalizeStringList(value.可核对事实),
    连续性风险: normalizeStringList(value.连续性风险),
    未解决问题: normalizeStringList(value.未解决问题),
    文风要点: firstValue(value, ["文风要点"]) ?? normalizeStringList(value.文风与叙事),
    关键事件: Array.isArray(value.关键事件) ? value.关键事件.map(normalizeKeyEventLiteInput) : value.关键事件,
    人物状态: Array.isArray(value.人物状态) ? value.人物状态.map(normalizeCharacterStateLiteInput) : value.人物状态,
    人物认知边界: Array.isArray(value.人物认知边界) ? value.人物认知边界.map(normalizeCharacterKnowledgeLiteInput) : value.人物认知边界,
    伏笔与线索: Array.isArray(value.伏笔与线索) ? value.伏笔与线索.map(normalizeForeshadowingLiteInput) : value.伏笔与线索
  };
}

function normalizeChapterSummaryVersionDrift(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const looksLikeV3Lite =
    "章节作用" in value || "场景推进" in value || "时间地点" in value || "道具设定变化" in value || "文风要点" in value;
  if (!looksLikeV3Lite || !isRecord(value.章节信息)) {
    return value;
  }

  const normalized = normalizeChapterSummaryShapeDrift(value);
  if (!isRecord(normalized) || !isRecord(normalized.章节信息)) {
    return normalized;
  }

  return {
    ...normalized,
    章节信息: {
      ...normalized.章节信息,
      缓存类型: "章节缓存",
      缓存版本: "三-Lite",
      语言: "简体中文"
    }
  };
}

function normalizeChapterChunkVersionDrift(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const looksLikeV2Lite = "关系变化" in value || "时间地点" in value || "道具设定变化" in value;
  if (!looksLikeV2Lite || !isRecord(value.片段信息)) {
    return value;
  }

  return {
    ...value,
    片段信息: {
      ...value.片段信息,
      缓存类型: "章节片段缓存",
      缓存版本: "二-Lite",
      语言: "简体中文"
    }
  };
}

const sceneNumberSchema = z.preprocess((value) => {
  const parsed = parseLooseInteger(value);
  if (parsed === 0) {
    return 1;
  }
  return parsed ?? value;
}, positiveIntegerSchema);

function enumWithFallback<T extends readonly [string, ...string[]]>(
  values: T,
  fallback: T[number],
  aliases: Record<string, T[number]> = {}
) {
  return z.preprocess((value) => {
    const text = stringifyStructuredValue(value).trim();
    if ((values as readonly string[]).includes(text)) {
      return text;
    }
    const aliased = aliases[text];
    if (aliased) {
      return aliased;
    }
    for (const [keyword, mapped] of Object.entries(aliases)) {
      if (text.includes(keyword)) {
        return mapped;
      }
    }
    return fallback;
  }, z.enum(values));
}

const yesNoSchema = z.preprocess((value) => {
  const text = stringifyStructuredValue(value).trim();
  if (text === "是" || text === "否") {
    return text;
  }
  if (/不|否|无|没有|无需|不会|false/i.test(text)) {
    return "否";
  }
  if (/是|需要|需|有|会|true/i.test(text)) {
    return "是";
  }
  return "否";
}, z.enum(["是", "否"]));
const evidenceQuotesSchema = arrayOf(nonEmptyStringSchema);

const coverageScopeSchema = enumWithFallback(["完整章节", "片段", "不完整"], "不完整", {
  完整: "完整章节",
  全章: "完整章节",
  部分: "片段"
});
const completenessSchema = enumWithFallback(["完整", "片段", "不完整"], "不完整", {
  全部: "完整",
  部分: "片段"
});
const densitySchema = enumWithFallback(["高", "中", "低"], "中");
const foreshadowingTypeSchema = enumWithFallback(["明确伏笔", "疑似伏笔", "误导线索", "回收伏笔", "普通线索"], "疑似伏笔", {
  明确: "明确伏笔",
  疑似: "疑似伏笔",
  暗示: "疑似伏笔",
  误导: "误导线索",
  回收: "回收伏笔",
  普通: "普通线索",
  线索: "普通线索"
});
const foreshadowingStatusSchema = enumWithFallback(["埋下", "推进", "回收", "强化", "待判断"], "待判断", {
  新增: "埋下",
  出现: "埋下",
  提出: "埋下",
  延续: "推进",
  发展: "推进",
  加强: "强化",
  确认: "强化",
  解决: "回收"
});
const confidenceSchema = enumWithFallback(["高", "中", "低"], "中");
const causalSufficiencySchema = enumWithFallback(["充分", "不足", "待判断"], "待判断", {
  基本: "充分",
  明确: "充分",
  不够: "不足",
  缺少: "不足",
  疑似: "待判断"
});
const factTypeSchema = enumWithFallback(["人物状态", "人物认知", "关系", "时间", "地点", "空间移动", "道具状态", "设定规则", "因果", "伏笔", "限制事实"], "限制事实", {
  情绪: "人物状态",
  身体: "人物状态",
  认知: "人物认知",
  知情: "人物认知",
  人物关系: "关系",
  关系变化: "关系",
  空间: "空间移动",
  移动: "空间移动",
  道具: "道具状态",
  物品: "道具状态",
  设定: "设定规则",
  规则: "设定规则",
  原因: "因果",
  结果: "因果",
  线索: "伏笔",
  限制: "限制事实",
  否定: "限制事实"
});
const certaintySchema = enumWithFallback(["确定", "疑似", "否定", "未明确"], "未明确", {
  明确: "确定",
  肯定: "确定",
  可能: "疑似",
  不确定: "疑似",
  未知: "未明确"
});
const riskTypeSchema = enumWithFallback(["时间线", "空间移动", "人物状态", "人物认知", "道具状态", "关系变化", "设定规则", "因果动机", "视角越界"], "因果动机", {
  时间: "时间线",
  空间: "空间移动",
  移动: "空间移动",
  身体: "人物状态",
  情绪: "人物状态",
  认知: "人物认知",
  信息: "人物认知",
  道具: "道具状态",
  物品: "道具状态",
  关系: "关系变化",
  设定: "设定规则",
  规则: "设定规则",
  因果: "因果动机",
  动机: "因果动机",
  视角: "视角越界"
});
const severitySchema = enumWithFallback(["高", "中", "低"], "低");
const continuityConclusionSchema = enumWithFallback(["确定冲突", "疑似冲突", "需要回读原文确认", "无明显冲突"], "需要回读原文确认", {
  确定: "确定冲突",
  冲突: "确定冲突",
  疑似: "疑似冲突",
  不确定: "需要回读原文确认",
  回读: "需要回读原文确认",
  无: "无明显冲突",
  没有: "无明显冲突"
});
const yesNoPendingSchema = enumWithFallback(["是", "否", "待判断"], "待判断", {
  可能: "待判断",
  疑似: "待判断",
  需要判断: "待判断",
  不确定: "待判断"
});

const sceneIndexSchema = z
  .object({
    场景序号: sceneNumberSchema,
    场景标题: nonEmptyStringSchema,
    时间: nonEmptyStringSchema,
    地点: nonEmptyStringSchema,
    出场人物: arrayOf(nonEmptyStringSchema),
    场景目标: nonEmptyStringSchema,
    冲突或阻力: nonEmptyStringSchema,
    关键事件: arrayOf(nonEmptyStringSchema),
    场景结果: nonEmptyStringSchema,
    情绪变化: nonEmptyStringSchema,
    承接关系: nonEmptyStringSchema,
    证据短句: evidenceQuotesSchema
  })
  .strip();

const keyEventIndexSchema = z
  .object({
    事件: nonEmptyStringSchema,
    涉及人物: arrayOf(nonEmptyStringSchema),
    时间地点: nonEmptyStringSchema,
    事件原因: nonEmptyStringSchema,
    事件结果: nonEmptyStringSchema,
    后续影响: nonEmptyStringSchema,
    证据短句: evidenceQuotesSchema
  })
  .strip();

const characterStateIndexSchema = z
  .object({
    人物: nonEmptyStringSchema,
    本章出场状态: nonEmptyStringSchema,
    本章结束状态: nonEmptyStringSchema,
    身体状态: nonEmptyStringSchema,
    情绪状态: nonEmptyStringSchema,
    行动: arrayOf(nonEmptyStringSchema),
    动机: nonEmptyStringSchema,
    目标: nonEmptyStringSchema,
    阻力: nonEmptyStringSchema,
    位置变化: nonEmptyStringSchema,
    新获得信息: arrayOf(nonEmptyStringSchema),
    仍不知道的信息: arrayOf(nonEmptyStringSchema),
    误解或错误判断: arrayOf(nonEmptyStringSchema),
    与他人关系变化: arrayOf(nonEmptyStringSchema),
    需要后文承接: yesNoSchema,
    证据短句: evidenceQuotesSchema
  })
  .strip();

const characterKnowledgeIndexSchema = z
  .object({
    人物: nonEmptyStringSchema,
    已经知道: arrayOf(nonEmptyStringSchema),
    尚不知道: arrayOf(nonEmptyStringSchema),
    新得知: arrayOf(nonEmptyStringSchema),
    误以为: arrayOf(nonEmptyStringSchema),
    不能知道但后文需注意: arrayOf(nonEmptyStringSchema),
    证据短句: evidenceQuotesSchema
  })
  .strip();

const relationshipIndexSchema = z
  .object({
    关系双方: arrayOf(nonEmptyStringSchema),
    关系类型: nonEmptyStringSchema,
    本章开始状态: nonEmptyStringSchema,
    本章结束状态: nonEmptyStringSchema,
    变化原因: nonEmptyStringSchema,
    是否需要后文承接: yesNoSchema,
    证据短句: evidenceQuotesSchema
  })
  .strip();

const timePlaceIndexSchema = z
  .object({
    本章时间: nonEmptyStringSchema,
    时间跨度: nonEmptyStringSchema,
    主要地点: arrayOf(nonEmptyStringSchema),
    地点移动: arrayOf(nonEmptyStringSchema),
    明确时间锚点: arrayOf(nonEmptyStringSchema),
    相对时间锚点: arrayOf(nonEmptyStringSchema),
    可能的时间线风险: arrayOf(nonEmptyStringSchema),
    证据短句: evidenceQuotesSchema
  })
  .strip();

const spatialActionIndexSchema = z
  .object({
    人物: nonEmptyStringSchema,
    移动或行动: nonEmptyStringSchema,
    起点: nonEmptyStringSchema,
    终点: nonEmptyStringSchema,
    耗时或距离: nonEmptyStringSchema,
    是否可能需要核对: yesNoSchema,
    风险说明: textSchema,
    证据短句: evidenceQuotesSchema
  })
  .strip();

const itemStateIndexSchema = z
  .object({
    道具: nonEmptyStringSchema,
    当前持有者: nonEmptyStringSchema,
    所在位置: nonEmptyStringSchema,
    本章开始状态: nonEmptyStringSchema,
    本章结束状态: nonEmptyStringSchema,
    状态变化: nonEmptyStringSchema,
    剧情作用: nonEmptyStringSchema,
    是否需要后文追踪: yesNoSchema,
    证据短句: evidenceQuotesSchema
  })
  .strip();

const settingRuleIndexSchema = z
  .object({
    设定项: nonEmptyStringSchema,
    本章信息: nonEmptyStringSchema,
    是否新增: yesNoSchema,
    适用范围: nonEmptyStringSchema,
    限制或例外: nonEmptyStringSchema,
    是否影响后文: yesNoSchema,
    证据短句: evidenceQuotesSchema
  })
  .strip();

const negativeFactIndexSchema = z
  .object({
    对象: nonEmptyStringSchema,
    限制或否定: nonEmptyStringSchema,
    影响范围: nonEmptyStringSchema,
    后文检查意义: nonEmptyStringSchema,
    证据短句: evidenceQuotesSchema
  })
  .strip();

const foreshadowingIndexSchema = z
  .object({
    线索: nonEmptyStringSchema,
    类型: foreshadowingTypeSchema,
    涉及对象: arrayOf(nonEmptyStringSchema),
    本章状态: foreshadowingStatusSchema,
    可能指向: nonEmptyStringSchema,
    置信度: confidenceSchema,
    需要作者判断: yesNoSchema,
    证据短句: evidenceQuotesSchema
  })
  .strip();

const causalChainIndexSchema = z
  .object({
    原因: nonEmptyStringSchema,
    结果: nonEmptyStringSchema,
    中间动作: arrayOf(nonEmptyStringSchema),
    是否充分: causalSufficiencySchema,
    缺口说明: z.string(),
    证据短句: evidenceQuotesSchema
  })
  .strip();

const checkableFactIndexSchema = z
  .object({
    事实编号: nonEmptyStringSchema,
    事实类型: factTypeSchema,
    主体: nonEmptyStringSchema,
    属性: nonEmptyStringSchema,
    取值: nonEmptyStringSchema,
    时间范围: nonEmptyStringSchema,
    地点: nonEmptyStringSchema,
    确定性: certaintySchema,
    后文核对意义: nonEmptyStringSchema,
    证据短句: evidenceQuotesSchema
  })
  .strip();

const continuityRiskIndexSchema = z
  .object({
    风险: nonEmptyStringSchema,
    风险类型: riskTypeSchema,
    原因: nonEmptyStringSchema,
    严重程度: severitySchema,
    需要回看前文: yesNoSchema,
    需要作者判断: yesNoSchema,
    建议回读范围: arrayOf(nonEmptyStringSchema),
    证据短句: evidenceQuotesSchema
  })
  .strip();

const unresolvedQuestionIndexSchema = z
  .object({
    问题: nonEmptyStringSchema,
    涉及人物或事件: arrayOf(nonEmptyStringSchema),
    后续需要回答: yesNoSchema,
    证据短句: evidenceQuotesSchema
  })
  .strip();

const generatedEnglishPattern = /[A-Za-z]/u;

function addEnglishKeyIssues(value: unknown, ctx: z.RefinementCtx, path: readonly (string | number)[] = []): void {
  if (typeof value === "string") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => addEnglishKeyIssues(item, ctx, [...path, index]));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    if (generatedEnglishPattern.test(key)) {
      ctx.addIssue({
        code: "custom",
        path: [...path, key],
        message: "章节缓存 JSON 键名必须使用简体中文。"
      });
    }
    addEnglishKeyIssues(item, ctx, [...path, key]);
  }
}

export const chapterAiSummaryPayloadV2Schema = z
  .object({
    章节信息: z
      .object({
        章节序号: positiveIntegerSchema,
        章节标题: nonEmptyStringSchema,
        正文覆盖: coverageScopeSchema,
        缓存类型: z.literal("章节缓存"),
        缓存版本: z.literal("二"),
        语言: z.literal("简体中文")
      })
      .strip(),
    缓存质量: z
      .object({
        覆盖完整度: completenessSchema,
        信息密度: densitySchema,
        需要回读原文: yesNoSchema,
        缺失说明: arrayOf(nonEmptyStringSchema)
      })
      .strip(),
    一句话摘要: requiredStringSchema,
    短摘要: requiredStringSchema,
    详细梗概: requiredStringSchema,
    本章功能: z
      .object({
        章节类型: nonEmptyStringSchema,
        剧情功能: nonEmptyStringSchema,
        情绪功能: nonEmptyStringSchema,
        结构作用: nonEmptyStringSchema,
        对后文的作用: nonEmptyStringSchema
      })
      .strip(),
    场景列表: arrayOf(sceneIndexSchema),
    关键事件: arrayOf(keyEventIndexSchema),
    人物状态: arrayOf(characterStateIndexSchema),
    人物认知边界: arrayOf(characterKnowledgeIndexSchema),
    关系动态: arrayOf(relationshipIndexSchema),
    时间与地点: timePlaceIndexSchema,
    空间与行动逻辑: arrayOf(spatialActionIndexSchema),
    道具状态: arrayOf(itemStateIndexSchema),
    设定与规则: arrayOf(settingRuleIndexSchema),
    限制与否定事实: arrayOf(negativeFactIndexSchema),
    伏笔与线索: arrayOf(foreshadowingIndexSchema),
    因果链: arrayOf(causalChainIndexSchema),
    可核对事实: arrayOf(checkableFactIndexSchema),
    连续性风险: arrayOf(continuityRiskIndexSchema),
    未解决问题: arrayOf(unresolvedQuestionIndexSchema),
    文风与叙事: z
      .object({
        叙事视角: nonEmptyStringSchema,
        主要语气: nonEmptyStringSchema,
        节奏特点: nonEmptyStringSchema,
        对白特点: nonEmptyStringSchema,
        描写侧重: nonEmptyStringSchema,
        续写时应保持: arrayOf(nonEmptyStringSchema)
      })
      .strip(),
    不可丢失信息: arrayOf(nonEmptyStringSchema),
    适合回答的问题: arrayOf(nonEmptyStringSchema),
    不确定项: arrayOf(nonEmptyStringSchema)
  })
  .strip()
  .superRefine((payload, ctx) => {
    addEnglishKeyIssues(payload, ctx);
  });

const chapterFunctionLiteSchema = z
  .object({
    剧情作用: nonEmptyStringSchema,
    人物作用: nonEmptyStringSchema,
    后文作用: nonEmptyStringSchema
  })
  .strip();

const keyEventLiteSchema = z
  .object({
    事件: nonEmptyStringSchema,
    涉及人物: arrayOf(nonEmptyStringSchema),
    时间地点: nonEmptyStringSchema,
    结果: nonEmptyStringSchema,
    后续影响: nonEmptyStringSchema,
    证据短句: evidenceQuotesSchema
  })
  .strip();

const characterStateLiteSchema = z
  .object({
    人物: nonEmptyStringSchema,
    本章变化: nonEmptyStringSchema,
    行动: arrayOf(nonEmptyStringSchema),
    目标或动机: nonEmptyStringSchema,
    新获得信息: arrayOf(nonEmptyStringSchema),
    仍不知道的信息: arrayOf(nonEmptyStringSchema),
    关系变化: arrayOf(nonEmptyStringSchema),
    证据短句: evidenceQuotesSchema
  })
  .strip();

const characterKnowledgeLiteSchema = z
  .object({
    人物: nonEmptyStringSchema,
    认知变化: nonEmptyStringSchema,
    仍不知道: arrayOf(nonEmptyStringSchema),
    误解或风险: arrayOf(nonEmptyStringSchema),
    证据短句: evidenceQuotesSchema
  })
  .strip();

const timePlaceLiteSchema = z
  .object({
    本章时间: nonEmptyStringSchema,
    主要地点: arrayOf(nonEmptyStringSchema),
    时间线索: arrayOf(nonEmptyStringSchema),
    地点移动: arrayOf(nonEmptyStringSchema),
    可能风险: arrayOf(nonEmptyStringSchema)
  })
  .strip();

const foreshadowingLiteSchema = z
  .object({
    线索: nonEmptyStringSchema,
    类型: foreshadowingTypeSchema,
    状态: foreshadowingStatusSchema,
    指向或意义: nonEmptyStringSchema,
    证据短句: evidenceQuotesSchema
  })
  .strip();

const relationshipGraphIndexItemSchema = z.object({}).catchall(z.unknown());

const relationshipGraphIndexInSummarySchema = z
  .object({
    人物: arrayOf(relationshipGraphIndexItemSchema),
    关系事件: arrayOf(relationshipGraphIndexItemSchema),
    不确定项: arrayOf(nonEmptyStringSchema).optional()
  })
  .strip();

export const chapterAiSummaryPayloadV3LiteSchema = z
  .object({
    章节信息: z
      .object({
        章节序号: positiveIntegerSchema,
        章节标题: nonEmptyStringSchema,
        正文覆盖: coverageScopeSchema,
        缓存类型: z.literal("章节缓存"),
        缓存版本: z.literal("三-Lite"),
        语言: z.literal("简体中文")
      })
      .strip(),
    缓存质量: z
      .object({
        覆盖完整度: completenessSchema,
        信息密度: densitySchema,
        需要回读原文: yesNoSchema,
        缺失说明: arrayOf(nonEmptyStringSchema)
      })
      .strip(),
    一句话摘要: requiredStringSchema,
    短摘要: requiredStringSchema,
    详细梗概: requiredStringSchema,
    章节作用: chapterFunctionLiteSchema,
    场景推进: arrayOf(nonEmptyStringSchema),
    关键事件: arrayOf(keyEventLiteSchema),
    人物状态: arrayOf(characterStateLiteSchema),
    人物认知边界: arrayOf(characterKnowledgeLiteSchema),
    关系变化: arrayOf(nonEmptyStringSchema),
    人物关系索引: relationshipGraphIndexInSummarySchema.optional(),
    时间地点: timePlaceLiteSchema,
    道具设定变化: arrayOf(nonEmptyStringSchema),
    伏笔与线索: arrayOf(foreshadowingLiteSchema),
    可核对事实: arrayOf(nonEmptyStringSchema),
    连续性风险: arrayOf(nonEmptyStringSchema),
    未解决问题: arrayOf(nonEmptyStringSchema),
    文风要点: arrayOf(nonEmptyStringSchema),
    不可丢失信息: arrayOf(nonEmptyStringSchema),
    不确定项: arrayOf(nonEmptyStringSchema)
  })
  .strip()
  .superRefine((payload, ctx) => {
    addEnglishKeyIssues(payload, ctx);
  });

export const chapterAiSummaryPayloadSchema = z.preprocess(
  normalizeChapterSummaryVersionDrift,
  z.union([chapterAiSummaryPayloadV3LiteSchema, chapterAiSummaryPayloadV2Schema])
);

const chapterAiSummaryChunkPayloadV1Schema = z
  .object({
    片段信息: z
      .object({
        章节序号: positiveIntegerSchema,
        章节标题: nonEmptyStringSchema,
        片段序号: positiveIntegerSchema,
        片段总数: positiveIntegerSchema,
        正文覆盖: z.literal("片段"),
        缓存类型: z.literal("章节片段缓存"),
        缓存版本: z.literal("一"),
        语言: z.literal("简体中文")
      })
      .strip()
      .superRefine((payload, ctx) => {
        if (payload.片段序号 > payload.片段总数) {
          ctx.addIssue({
            code: "custom",
            path: ["片段序号"],
            message: "片段序号不能大于片段总数。"
          });
        }
      }),
    片段摘要: requiredStringSchema,
    关键事件: arrayOf(keyEventIndexSchema),
    人物状态: arrayOf(characterStateIndexSchema),
    人物认知边界: arrayOf(characterKnowledgeIndexSchema),
    关系动态: arrayOf(relationshipIndexSchema),
    时间与地点: timePlaceIndexSchema,
    空间与行动逻辑: arrayOf(spatialActionIndexSchema),
    道具状态: arrayOf(itemStateIndexSchema),
    设定与规则: arrayOf(settingRuleIndexSchema),
    限制与否定事实: arrayOf(negativeFactIndexSchema),
    伏笔与线索: arrayOf(foreshadowingIndexSchema),
    因果链: arrayOf(causalChainIndexSchema),
    可核对事实: arrayOf(checkableFactIndexSchema),
    连续性风险: arrayOf(continuityRiskIndexSchema),
    未解决问题: arrayOf(unresolvedQuestionIndexSchema),
    不可丢失信息: arrayOf(nonEmptyStringSchema)
  })
  .strip()
  .superRefine((payload, ctx) => {
    addEnglishKeyIssues(payload, ctx);
  });

const chapterAiSummaryChunkPayloadV2LiteSchema = z
  .object({
    片段信息: z
      .object({
        章节序号: positiveIntegerSchema,
        章节标题: nonEmptyStringSchema,
        片段序号: positiveIntegerSchema,
        片段总数: positiveIntegerSchema,
        正文覆盖: z.literal("片段"),
        缓存类型: z.literal("章节片段缓存"),
        缓存版本: z.literal("二-Lite"),
        语言: z.literal("简体中文")
      })
      .strip()
      .superRefine((payload, ctx) => {
        if (payload.片段序号 > payload.片段总数) {
          ctx.addIssue({
            code: "custom",
            path: ["片段序号"],
            message: "片段序号不能大于片段总数。"
          });
        }
      }),
    片段摘要: requiredStringSchema,
    关键事件: arrayOf(keyEventLiteSchema),
    人物状态: arrayOf(characterStateLiteSchema),
    人物认知边界: arrayOf(characterKnowledgeLiteSchema),
    关系变化: arrayOf(nonEmptyStringSchema),
    人物关系索引: relationshipGraphIndexInSummarySchema.optional(),
    时间地点: timePlaceLiteSchema,
    道具设定变化: arrayOf(nonEmptyStringSchema),
    伏笔与线索: arrayOf(foreshadowingLiteSchema),
    可核对事实: arrayOf(nonEmptyStringSchema),
    连续性风险: arrayOf(nonEmptyStringSchema),
    未解决问题: arrayOf(nonEmptyStringSchema),
    不可丢失信息: arrayOf(nonEmptyStringSchema)
  })
  .strip()
  .superRefine((payload, ctx) => {
    addEnglishKeyIssues(payload, ctx);
  });

export const chapterAiSummaryChunkPayloadSchema = z.preprocess(
  normalizeChapterChunkVersionDrift,
  z.union([chapterAiSummaryChunkPayloadV2LiteSchema, chapterAiSummaryChunkPayloadV1Schema])
);

export const arcAiSummaryPayloadSchema = z
  .object({
    阶段信息: z
      .object({
        起始章节: positiveIntegerSchema,
        结束章节: positiveIntegerSchema,
        覆盖章节: arrayOf(positiveIntegerSchema),
        覆盖限制: arrayOf(nonEmptyStringSchema)
      })
      .strip()
      .superRefine((payload, ctx) => {
        if (payload.起始章节 > payload.结束章节) {
          ctx.addIssue({
            code: "custom",
            path: ["结束章节"],
            message: "结束章节不能小于起始章节。"
          });
        }
      }),
    阶段一句话摘要: requiredStringSchema,
    阶段详细梗概: requiredStringSchema,
    主线推进: arrayOf(nonEmptyStringSchema),
    人物线变化: arrayOf(nonEmptyStringSchema),
    人物认知变化: arrayOf(nonEmptyStringSchema),
    关系线变化: arrayOf(nonEmptyStringSchema),
    伏笔线变化: arrayOf(nonEmptyStringSchema),
    道具线变化: arrayOf(nonEmptyStringSchema),
    设定变化: arrayOf(nonEmptyStringSchema),
    时间地点推进: arrayOf(nonEmptyStringSchema),
    重要因果链: arrayOf(nonEmptyStringSchema),
    未解决问题: arrayOf(nonEmptyStringSchema),
    连续性风险: arrayOf(nonEmptyStringSchema),
    可核对事实: arrayOf(nonEmptyStringSchema),
    不可丢失信息: arrayOf(nonEmptyStringSchema),
    适合回答的问题: arrayOf(nonEmptyStringSchema)
  })
  .strip()
  .superRefine((payload, ctx) => {
    addEnglishKeyIssues(payload, ctx);
  });

export const bookAiSummaryPayloadSchema = z
  .object({
    全书信息: z
      .object({
        覆盖阶段: arrayOf(nonEmptyStringSchema),
        覆盖章节范围: nonEmptyStringSchema,
        总章节数: nonnegativeIntegerSchema,
        已索引章节数: nonnegativeIntegerSchema,
        过期章节: arrayOf(nonEmptyStringSchema),
        缺失章节: arrayOf(nonEmptyStringSchema),
        过短跳过章节: arrayOf(nonEmptyStringSchema),
        覆盖限制: arrayOf(nonEmptyStringSchema)
      })
      .strip(),
    全文一句话摘要: requiredStringSchema,
    全文短摘要: requiredStringSchema,
    全文详细梗概: requiredStringSchema,
    主线剧情: arrayOf(nonEmptyStringSchema),
    主要人物线: arrayOf(nonEmptyStringSchema),
    重要关系线: arrayOf(nonEmptyStringSchema),
    人物认知线: arrayOf(nonEmptyStringSchema),
    伏笔线: arrayOf(nonEmptyStringSchema),
    道具线: arrayOf(nonEmptyStringSchema),
    世界规则与设定: arrayOf(nonEmptyStringSchema),
    时间地点结构: arrayOf(nonEmptyStringSchema),
    核心冲突: arrayOf(nonEmptyStringSchema),
    主题与情绪基调: nonEmptyStringSchema,
    未解决问题: arrayOf(nonEmptyStringSchema),
    连续性风险: arrayOf(nonEmptyStringSchema),
    可核对事实: arrayOf(nonEmptyStringSchema),
    不可丢失信息: arrayOf(nonEmptyStringSchema),
    适合回答的问题: arrayOf(nonEmptyStringSchema)
  })
  .strip()
  .superRefine((payload, ctx) => {
    if (payload.全书信息.已索引章节数 > payload.全书信息.总章节数) {
      ctx.addIssue({
        code: "custom",
        path: ["全书信息", "已索引章节数"],
        message: "已索引章节数不能超过总章节数。"
      });
    }
    addEnglishKeyIssues(payload, ctx);
  });

const continuityEvidenceSchema = z
  .object({
    章节: nonEmptyStringSchema,
    字段: nonEmptyStringSchema,
    证据短句: textSchema
  })
  .strip();

export const continuityCheckResultSchema = z
  .object({
    结论: continuityConclusionSchema,
    问题列表: arrayOf(
      z
        .object({
          问题类型: nonEmptyStringSchema,
          严重程度: severitySchema,
          涉及章节: arrayOf(nonEmptyStringSchema),
          冲突说明: nonEmptyStringSchema,
          证据一: continuityEvidenceSchema,
          证据二: continuityEvidenceSchema,
          为什么可能冲突: nonEmptyStringSchema,
          是否可能是伏笔或误导: yesNoPendingSchema,
          是否需要回读原文: yesNoSchema,
          建议处理: nonEmptyStringSchema
        })
        .strip()
    ),
    需要回读的章节: arrayOf(nonEmptyStringSchema),
    给作者的简短说明: nonEmptyStringSchema
  })
  .strip()
  .superRefine((payload, ctx) => {
    addEnglishKeyIssues(payload, ctx);
  });

export type SummaryStatus = z.output<typeof summaryStatusSchema>;
export type SummaryJobStatus = z.output<typeof summaryJobStatusSchema>;
export type SummaryJobType = z.output<typeof summaryJobTypeSchema>;
export type ChapterAiSummaryPayloadV2 = z.output<typeof chapterAiSummaryPayloadV2Schema>;
export type ChapterAiSummaryPayloadV3Lite = z.output<typeof chapterAiSummaryPayloadV3LiteSchema>;
export type ChapterAiSummaryPayload = z.output<typeof chapterAiSummaryPayloadSchema>;
export type ChapterAiSummaryChunkPayload = z.output<typeof chapterAiSummaryChunkPayloadSchema>;
export type ArcAiSummaryPayload = z.output<typeof arcAiSummaryPayloadSchema>;
export type BookAiSummaryPayload = z.output<typeof bookAiSummaryPayloadSchema>;
export type ContinuityCheckResult = z.output<typeof continuityCheckResultSchema>;

export type BookSummaryCoverage = {
  readonly totalChapterCount: number;
  readonly indexedChapterCount: number;
  readonly staleChapterIds: readonly string[];
  readonly missingChapterIds: readonly string[];
  readonly skippedTooShortChapterIds: readonly string[];
};

export function isChapterAiSummaryPayloadV3Lite(payload: ChapterAiSummaryPayload): payload is ChapterAiSummaryPayloadV3Lite {
  return payload.章节信息.缓存版本 === "三-Lite";
}

export function getChapterSummaryShortText(payload: ChapterAiSummaryPayload): string {
  return payload.一句话摘要;
}

export function getChapterSummaryLongText(payload: ChapterAiSummaryPayload): string {
  return payload.详细梗概;
}

function stringifyChapterSummaryItems(items: readonly unknown[], limit: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const text = stringifyStructuredValue(item).trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

export function getChapterSummaryKeyEvents(payload: ChapterAiSummaryPayload): readonly unknown[] {
  return payload.关键事件;
}

export function getChapterSummaryCharacterStates(payload: ChapterAiSummaryPayload): readonly unknown[] {
  return payload.人物状态;
}

export function getChapterSummaryCharacterKnowledge(payload: ChapterAiSummaryPayload): readonly unknown[] {
  return payload.人物认知边界;
}

export function getChapterSummaryRelationships(payload: ChapterAiSummaryPayload): readonly unknown[] {
  return isChapterAiSummaryPayloadV3Lite(payload) ? payload.关系变化 : payload.关系动态;
}

export function getChapterSummaryTimePlace(payload: ChapterAiSummaryPayload): unknown {
  return isChapterAiSummaryPayloadV3Lite(payload) ? payload.时间地点 : payload.时间与地点;
}

export function getChapterSummaryPropsAndRules(payload: ChapterAiSummaryPayload): readonly unknown[] {
  return isChapterAiSummaryPayloadV3Lite(payload) ? payload.道具设定变化 : [...payload.道具状态, ...payload.设定与规则, ...payload.限制与否定事实];
}

export function getChapterSummaryForeshadowing(payload: ChapterAiSummaryPayload): readonly unknown[] {
  return payload.伏笔与线索;
}

export function getChapterSummaryFacts(payload: ChapterAiSummaryPayload, focus: "overview" | "characters" | "foreshadowing" | "facts" = "overview"): readonly string[] {
  if (isChapterAiSummaryPayloadV3Lite(payload)) {
    if (focus === "characters") {
      return stringifyChapterSummaryItems([...payload.人物状态, ...payload.人物认知边界, ...payload.关系变化, ...payload.可核对事实], 16);
    }
    if (focus === "foreshadowing") {
      return stringifyChapterSummaryItems([...payload.伏笔与线索, ...payload.未解决问题, ...payload.可核对事实], 16);
    }
    return payload.可核对事实;
  }

  if (focus === "facts" || focus === "overview") {
    return stringifyChapterSummaryItems(payload.可核对事实, 24);
  }
  const factTypes = focus === "characters" ? new Set(["人物状态", "人物认知", "关系"]) : new Set(["伏笔"]);
  return stringifyChapterSummaryItems(
    payload.可核对事实.filter((fact) => factTypes.has(fact.事实类型)),
    16
  );
}

export function getChapterSummaryRisks(payload: ChapterAiSummaryPayload): readonly string[] {
  return isChapterAiSummaryPayloadV3Lite(payload) ? payload.连续性风险 : stringifyChapterSummaryItems(payload.连续性风险, 16);
}

export function getChapterSummaryUnresolvedQuestions(payload: ChapterAiSummaryPayload): readonly unknown[] {
  return payload.未解决问题;
}

export function getChapterSummaryMustKeep(payload: ChapterAiSummaryPayload): readonly string[] {
  return payload.不可丢失信息;
}

export function getArcSummaryText(payload: ArcAiSummaryPayload): string {
  return payload.阶段详细梗概;
}

export function getBookSummaryShortText(payload: BookAiSummaryPayload): string {
  return payload.全文短摘要;
}

export function getBookSummaryLongText(payload: BookAiSummaryPayload): string {
  return payload.全文详细梗概;
}

export function getBookSummaryCoverage(payload: BookAiSummaryPayload): BookSummaryCoverage {
  return {
    totalChapterCount: payload.全书信息.总章节数,
    indexedChapterCount: payload.全书信息.已索引章节数,
    staleChapterIds: payload.全书信息.过期章节,
    missingChapterIds: payload.全书信息.缺失章节,
    skippedTooShortChapterIds: payload.全书信息.过短跳过章节
  };
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function normalizeChapterSummaryText(plainText: string): string {
  return plainText.replace(/\r\n?/g, "\n").trim();
}

export function computeChapterContentHash(plainText: string): string {
  return sha256(normalizeChapterSummaryText(plainText));
}

export function computeSourceHash(parts: readonly string[]): string {
  return sha256(parts.join("\n"));
}
