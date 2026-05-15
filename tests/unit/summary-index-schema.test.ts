import { describe, expect, it } from "vitest";
import {
  bookAiSummaryPayloadSchema,
  chapterAiSummaryChunkPayloadSchema,
  chapterAiSummaryPayloadSchema,
  computeChapterContentHash,
  computeSourceHash,
  continuityCheckResultSchema,
  getBookSummaryCoverage,
  getChapterSummaryLongText,
  getChapterSummaryShortText,
  isChapterAiSummaryPayloadV3Lite,
  summaryJobStatusSchema,
  summaryJobTypeSchema,
  summaryStatusSchema,
  type ChapterAiSummaryPayloadV2
} from "../../src/main/shared/summary-index";

const validChapterIndexPayloadV2 = {
  章节信息: {
    章节序号: 1,
    章节标题: "第1章 陨落的天才",
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
  一句话摘要: "萧炎在家族测试中暴露低谷，承受众人嘲讽。",
  短摘要: "萧炎测试结果低微，家族众人态度冷淡，萧薰儿仍然维护他。",
  详细梗概: "本章以萧炎的斗气测试为核心，展现他从昔日天才跌落后的尴尬处境。测试结果公布后，广场上的族人议论和嘲笑加重了他的屈辱感，萧薰儿的态度则保留了重要情感支撑。",
  本章功能: {
    章节类型: "开局低谷",
    剧情功能: "确立主角当前困境",
    情绪功能: "压抑和屈辱",
    结构作用: "建立主线冲突起点",
    对后文的作用: "为主角恢复实力和查明原因埋下动机"
  },
  场景列表: [
    {
      场景序号: 1,
      场景标题: "测试广场",
      时间: "未明确",
      地点: "萧家测试广场",
      出场人物: ["萧炎", "测试中年男子", "萧薰儿"],
      场景目标: "公布斗气测试结果",
      冲突或阻力: "萧炎结果低微并遭到嘲笑",
      关键事件: ["萧炎被公布斗之力三段", "族人议论嘲讽", "萧薰儿态度支持"],
      场景结果: "萧炎处境被进一步公开化",
      情绪变化: "从强忍平静转为苦涩自嘲",
      承接关系: "引出萧炎低谷原因的悬念",
      证据短句: ["斗之力，三段"]
    }
  ],
  关键事件: [
    {
      事件: "萧炎斗气测试结果为斗之力三段",
      涉及人物: ["萧炎"],
      时间地点: "萧家测试广场",
      事件原因: "家族进行斗气测试",
      事件结果: "萧炎被公开评价为低级",
      后续影响: "加深萧炎恢复实力的压力",
      证据短句: ["斗之力，三段"]
    }
  ],
  人物状态: [
    {
      人物: "萧炎",
      本章出场状态: "正在参加家族测试",
      本章结束状态: "承受嘲讽但仍压抑情绪",
      身体状态: "紧握手掌导致指甲刺入掌心",
      情绪状态: "自嘲、屈辱、苦涩",
      行动: ["参加测试", "强忍众人嘲笑"],
      动机: "证明自己或承受测试结果",
      目标: "恢复尊严",
      阻力: "斗气低微和族人轻视",
      位置变化: "未明确",
      新获得信息: ["测试结果被公开"],
      仍不知道的信息: ["修为跌落的根本原因"],
      误解或错误判断: [],
      与他人关系变化: ["与族人的距离进一步拉开"],
      需要后文承接: "是",
      证据短句: ["斗之力，三段"]
    }
  ],
  人物认知边界: [
    {
      人物: "萧炎",
      已经知道: ["自己的测试结果低微"],
      尚不知道: ["修为异常原因"],
      新得知: ["众人对他的轻视仍然存在"],
      误以为: [],
      不能知道但后文需注意: [],
      证据短句: ["斗之力，三段"]
    }
  ],
  关系动态: [
    {
      关系双方: ["萧炎", "萧薰儿"],
      关系类型: "支持关系",
      本章开始状态: "萧炎处于被嘲笑境地",
      本章结束状态: "萧薰儿仍对萧炎保持支持",
      变化原因: "萧薰儿没有随众人轻视萧炎",
      是否需要后文承接: "是",
      证据短句: []
    }
  ],
  时间与地点: {
    本章时间: "未明确",
    时间跨度: "一次测试过程",
    主要地点: ["萧家测试广场"],
    地点移动: [],
    明确时间锚点: [],
    相对时间锚点: ["测试期间"],
    可能的时间线风险: [],
    证据短句: []
  },
  空间与行动逻辑: [],
  道具状态: [
    {
      道具: "测验魔石碑",
      当前持有者: "萧家测试场",
      所在位置: "测试广场",
      本章开始状态: "用于测试斗气等级",
      本章结束状态: "显示萧炎测试结果",
      状态变化: "无明显变化",
      剧情作用: "公开萧炎低谷",
      是否需要后文追踪: "否",
      证据短句: ["测验魔石碑"]
    }
  ],
  设定与规则: [
    {
      设定项: "斗气测试等级",
      本章信息: "斗之力三段被判为低级",
      是否新增: "是",
      适用范围: "萧家测试体系",
      限制或例外: "未明确",
      是否影响后文: "是",
      证据短句: ["斗之力，三段"]
    }
  ],
  限制与否定事实: [
    {
      对象: "萧炎",
      限制或否定: "当前不是家族认可的高等级修炼者",
      影响范围: "家族评价与个人处境",
      后文检查意义: "后文若突然获得尊重需要解释",
      证据短句: []
    }
  ],
  伏笔与线索: [
    {
      线索: "萧炎从天才跌落的原因未解释",
      类型: "明确伏笔",
      涉及对象: ["萧炎"],
      本章状态: "埋下",
      可能指向: "修为异常原因",
      置信度: "高",
      需要作者判断: "否",
      证据短句: []
    }
  ],
  因果链: [
    {
      原因: "测试结果显示低级",
      结果: "众人嘲讽萧炎",
      中间动作: ["中年男子公布结果"],
      是否充分: "充分",
      缺口说明: "",
      证据短句: []
    }
  ],
  可核对事实: [
    {
      事实编号: "事实-1",
      事实类型: "人物状态",
      主体: "萧炎",
      属性: "斗气测试结果",
      取值: "斗之力三段",
      时间范围: "本章测试时",
      地点: "萧家测试广场",
      确定性: "确定",
      后文核对意义: "后文实力变化需要有过程或解释",
      证据短句: ["斗之力，三段"]
    }
  ],
  连续性风险: [
    {
      风险: "后文若直接让萧炎恢复高等级，需要解释修为变化原因",
      风险类型: "人物状态",
      原因: "本章明确他测试结果低微",
      严重程度: "中",
      需要回看前文: "否",
      需要作者判断: "否",
      建议回读范围: [],
      证据短句: ["斗之力，三段"]
    }
  ],
  未解决问题: [
    {
      问题: "萧炎修为跌落的原因是什么",
      涉及人物或事件: ["萧炎", "斗气测试"],
      后续需要回答: "是",
      证据短句: []
    }
  ],
  文风与叙事: {
    叙事视角: "第三人称",
    主要语气: "压抑、讽刺",
    节奏特点: "以测试结果快速制造冲突",
    对白特点: "公告式对白带来压迫感",
    描写侧重: "心理屈辱和外界嘲讽",
    续写时应保持: ["主角压抑情绪", "外界轻视氛围"]
  },
  不可丢失信息: ["萧炎测试结果为斗之力三段", "萧炎修为异常原因未揭示", "萧薰儿仍支持萧炎"],
  适合回答的问题: ["本章萧炎状态如何", "本章埋下了哪些伏笔", "萧炎和族人的关系如何"],
  不确定项: []
};

const validChapterIndexPayloadV3Lite = {
  章节信息: {
    章节序号: 1,
    章节标题: "第1章 陨落的天才",
    正文覆盖: "完整章节",
    缓存类型: "章节缓存",
    缓存版本: "三-Lite",
    语言: "简体中文"
  },
  缓存质量: {
    覆盖完整度: "完整",
    信息密度: "中",
    需要回读原文: "否",
    缺失说明: []
  },
  一句话摘要: "萧炎在家族测试中暴露低谷，承受众人嘲讽。",
  短摘要: "萧炎测试结果低微，家族众人态度冷淡，萧薰儿仍然维护他。",
  详细梗概: "本章以萧炎的斗气测试为核心，展现他从昔日天才跌落后的尴尬处境。测试结果公布后，广场上的族人议论和嘲笑加重了他的屈辱感，萧薰儿的态度则保留了重要情感支撑。",
  章节作用: {
    剧情作用: "确立主角当前困境",
    人物作用: "建立萧炎低谷状态和萧薰儿支持关系",
    后文作用: "为主角恢复实力和查明原因埋下动机"
  },
  场景推进: ["萧炎完成测试", "众人嘲讽", "萧薰儿维持支持"],
  关键事件: [
    {
      事件: "萧炎斗气测试结果为斗之力三段",
      涉及人物: ["萧炎"],
      时间地点: "萧家测试广场",
      结果: "萧炎被公开评价为低级",
      后续影响: "后文实力变化需要解释",
      证据短句: ["斗之力，三段"]
    }
  ],
  人物状态: [
    {
      人物: "萧炎",
      本章变化: "从强忍平静转为苦涩自嘲",
      行动: ["参加测试", "强忍众人嘲笑"],
      目标或动机: "维护尊严并承受测试结果",
      新获得信息: ["测试结果被公开"],
      仍不知道的信息: ["修为跌落的根本原因"],
      关系变化: ["与族人的距离进一步拉开"],
      证据短句: ["斗之力，三段"]
    }
  ],
  人物认知边界: [
    {
      人物: "萧炎",
      认知变化: "确认众人对他的轻视仍然存在",
      仍不知道: ["修为异常原因"],
      误解或风险: [],
      证据短句: ["斗之力，三段"]
    }
  ],
  关系变化: ["萧薰儿没有随众人轻视萧炎，支持关系需要后续承接"],
  时间地点: {
    本章时间: "未明确",
    主要地点: ["萧家测试广场"],
    时间线索: ["测试期间"],
    地点移动: [],
    可能风险: []
  },
  道具设定变化: ["测验魔石碑用于公开斗气等级", "斗之力三段被判为低级"],
  伏笔与线索: [
    {
      线索: "萧炎从天才跌落的原因未解释",
      类型: "明确伏笔",
      状态: "埋下",
      指向或意义: "修为异常原因",
      证据短句: []
    }
  ],
  可核对事实: ["萧炎本章测试结果为斗之力三段", "斗之力三段在萧家测试中被判为低级"],
  连续性风险: ["后文若直接让萧炎恢复高等级，需要解释修为变化原因"],
  未解决问题: ["萧炎修为跌落的原因是什么"],
  文风要点: ["第三人称", "压抑、讽刺", "心理屈辱和外界嘲讽"],
  不可丢失信息: ["萧炎测试结果为斗之力三段", "萧炎修为异常原因未揭示", "萧薰儿仍支持萧炎"],
  不确定项: []
};

describe("summary index schemas", () => {
  it("rejects removed relationship jobs and unknown job types", () => {
    expect(() => summaryJobTypeSchema.parse("relationship_original_text_upgrade")).toThrow();
    expect(() => summaryJobTypeSchema.parse("relationship_index_job")).toThrow();
  });

  it("rejects legacy V1 structured chapter summary payloads", () => {
    expect(() =>
      chapterAiSummaryPayloadSchema.parse({
        oneLine: "少年在测试中失利，承受众人的嘲讽。",
        synopsis: "本章围绕萧炎的斗气测试展开，展现他跌落天才光环后的处境。",
        keyEvents: ["萧炎斗之力测试结果为三段"],
        characterMentions: [{ name: "萧炎", roleInChapter: "测试失败的少年主角" }],
        relationshipHints: [],
        timeAndPlace: [],
        foreshadowingHints: [],
        unresolvedQuestions: [],
        emotionalArc: "从强忍平静到苦涩自嘲。",
        importantQuotes: []
      })
    ).toThrow();
  });

  it("accepts a V3 Lite Chinese chapter fact index payload and derives display summaries from it", () => {
    const parsed = chapterAiSummaryPayloadSchema.parse(validChapterIndexPayloadV3Lite);

    expect(parsed).toEqual(validChapterIndexPayloadV3Lite);
    expect(getChapterSummaryShortText(parsed)).toBe(validChapterIndexPayloadV3Lite.一句话摘要);
    expect(getChapterSummaryLongText(parsed)).toBe(validChapterIndexPayloadV3Lite.详细梗概);
    expect(JSON.stringify(parsed).length).toBeLessThan(JSON.stringify(validChapterIndexPayloadV2).length / 2);
  });

  it("keeps future-facing index material inside the V3 Lite chapter cache payload", () => {
    const payload = JSON.parse(JSON.stringify(validChapterIndexPayloadV3Lite));
    payload.索引原料 = {
      场景节点: [
        {
          序号: 1,
          标题: "测试广场",
          类型: "公开测试",
          出场人物: ["萧炎", "萧薰儿"],
          地点: "萧家测试广场",
          场景目标: "公布斗气测试结果",
          核心冲突: "萧炎测试结果低微并遭到嘲笑",
          结果: "萧炎处境被公开化",
          情绪变化: "从强忍平静转为苦涩自嘲",
          功能: "建立开局低谷",
          证据短句: ["斗之力，三段"],
          后续可用: "可用于大纲场景卡"
        }
      ],
      时间线事件: [
        {
          事件: "萧炎斗气测试结果被公布",
          叙事顺序: 1,
          故事内时间: "未明确",
          相对时间锚点: "测试期间",
          参与人物: ["萧炎"],
          地点: "萧家测试广场",
          因果前置: ["家族进行斗气测试"],
          结果影响: ["萧炎被公开评价为低级"],
          置信度: 0.9,
          证据短句: ["斗之力，三段"]
        }
      ],
      通用实体: [
        {
          名称: "测验魔石碑",
          别名: ["魔石碑"],
          类型: "道具",
          本章状态: "显示萧炎斗之力三段",
          新增信息: ["用于测试斗气等级"],
          关联人物: ["萧炎"],
          证据短句: ["测验魔石碑"]
        }
      ],
      原子事实: [
        {
          主体: "萧炎",
          类型: "人物状态",
          属性: "斗气测试结果",
          值: "斗之力三段",
          生效范围: "本章测试期间",
          确定性: "确定",
          证据短句: ["斗之力，三段"]
        }
      ],
      结构标记: {
        章节位置: "开局",
        叙事功能: ["建立困境", "埋下修为异常悬念"],
        节奏: "压迫",
        情绪走向: "受辱",
        视角: "第三人称",
        备注: "供后续大纲、时间线和资料库复用"
      },
      未来扩展字段: "保留"
    };

    const parsed = chapterAiSummaryPayloadSchema.parse(payload);

    expect((parsed as typeof payload).索引原料).toEqual(payload.索引原料);
  });

  it("keeps future-facing index material inside V2 Lite chapter chunk caches", () => {
    const payload = {
      片段信息: {
        章节序号: 1,
        章节标题: "第1章 陨落的天才",
        片段序号: 1,
        片段总数: 2,
        正文覆盖: "片段",
        缓存类型: "章节片段缓存",
        缓存版本: "二-Lite",
        语言: "简体中文"
      },
      片段摘要: "本片段记录萧炎测试失利后的处境变化。",
      关键事件: [
        {
          事件: "萧炎测试结果被公布",
          涉及人物: ["萧炎"],
          时间地点: "萧家测试广场",
          结果: "众人得知萧炎斗气低微",
          后续影响: "加重萧炎低谷处境",
          证据短句: ["斗之力，三段"]
        }
      ],
      人物状态: [
        {
          人物: "萧炎",
          本章变化: "承受嘲讽",
          行动: ["参加测试"],
          目标或动机: "保持尊严",
          新获得信息: ["测试结果被公开"],
          仍不知道的信息: ["修为跌落原因"],
          关系变化: ["与族人距离加深"],
          证据短句: ["斗之力，三段"]
        }
      ],
      人物认知边界: [
        {
          人物: "萧炎",
          认知变化: "得知众人轻视仍在",
          仍不知道: ["修为跌落原因"],
          误解或风险: [],
          证据短句: ["斗之力，三段"]
        }
      ],
      关系变化: ["萧炎与族人的距离加深"],
      时间地点: {
        本章时间: "未明确",
        主要地点: ["萧家测试广场"],
        时间线索: ["测试期间"],
        地点移动: [],
        可能风险: []
      },
      道具设定变化: ["测验魔石碑用于公开斗气等级"],
      伏笔与线索: [],
      可核对事实: ["萧炎测试结果为斗之力三段"],
      连续性风险: [],
      未解决问题: [],
      索引原料: {
        场景节点: [{ 序号: 1, 标题: "测试广场", 类型: "公开测试", 出场人物: ["萧炎"], 地点: "萧家测试广场", 证据短句: ["斗之力，三段"] }],
        时间线事件: [{ 事件: "萧炎测试结果被公布", 叙事顺序: 1, 参与人物: ["萧炎"], 证据短句: ["斗之力，三段"] }],
        通用实体: [{ 名称: "测验魔石碑", 类型: "道具", 证据短句: ["测验魔石碑"] }],
        原子事实: [{ 主体: "萧炎", 类型: "人物状态", 属性: "斗气测试结果", 值: "斗之力三段", 证据短句: ["斗之力，三段"] }],
        结构标记: { 章节位置: "开局", 叙事功能: ["建立困境"] }
      },
      不可丢失信息: ["萧炎测试结果为斗之力三段"]
    };

    const parsed = chapterAiSummaryChunkPayloadSchema.parse(payload);

    expect((parsed as typeof payload).索引原料).toEqual(payload.索引原料);
  });

  it("normalizes V3 Lite chapter indexes when the model keeps the previous version label", () => {
    const payload = JSON.parse(JSON.stringify(validChapterIndexPayloadV3Lite));
    payload.章节信息.缓存版本 = "二";

    const parsed = chapterAiSummaryPayloadSchema.parse(payload);

    expect(parsed.章节信息.缓存版本).toBe("三-Lite");
    expect(parsed).toMatchObject({
      章节作用: validChapterIndexPayloadV3Lite.章节作用,
      时间地点: validChapterIndexPayloadV3Lite.时间地点,
      文风要点: validChapterIndexPayloadV3Lite.文风要点
    });
  });

  it("normalizes full chapter caches when the model copies the chunk-only Lite version label", () => {
    const payload = JSON.parse(JSON.stringify(validChapterIndexPayloadV3Lite));
    payload.章节信息.缓存版本 = "二-Lite";

    const parsed = chapterAiSummaryPayloadSchema.parse(payload);

    expect(parsed.章节信息.缓存版本).toBe("三-Lite");
    expect(parsed).toMatchObject({
      章节作用: validChapterIndexPayloadV3Lite.章节作用,
      关键事件: validChapterIndexPayloadV3Lite.关键事件,
      不可丢失信息: validChapterIndexPayloadV3Lite.不可丢失信息
    });
  });

  it("continues to accept legacy V2 Chinese chapter fact indexes as read-only cache data", () => {
    const parsed = chapterAiSummaryPayloadSchema.parse(validChapterIndexPayloadV2);

    expect(parsed).toEqual(validChapterIndexPayloadV2);
    expect(getChapterSummaryShortText(parsed)).toBe(validChapterIndexPayloadV2.一句话摘要);
    expect(getChapterSummaryLongText(parsed)).toBe(validChapterIndexPayloadV2.详细梗概);
  });

  it("normalizes common model shape drift without accepting legacy chapter indexes", () => {
    const payload = JSON.parse(JSON.stringify(validChapterIndexPayloadV2));
    payload.场景列表[0].场景序号 = 0;
    payload.人物状态[0].新获得信息 = "测试结果被公开";
    payload.人物状态[0].仍不知道的信息 = "未明确";
    payload.人物认知边界[0].新得知 = "众人对他的轻视仍然存在";

    const parsed = chapterAiSummaryPayloadSchema.parse(payload);

    expect(parsed.章节信息.缓存版本).toBe("二");
    if (parsed.章节信息.缓存版本 !== "二") {
      throw new Error("expected legacy V2 payload");
    }
    const legacy = parsed as ChapterAiSummaryPayloadV2;
    expect(legacy.场景列表[0].场景序号).toBe(1);
    expect(legacy.人物状态[0].新获得信息).toEqual(["测试结果被公开"]);
    expect(legacy.人物状态[0].仍不知道的信息).toEqual([]);
    expect(legacy.人物认知边界[0].新得知).toEqual(["众人对他的轻视仍然存在"]);
  });

  it("keeps thin but otherwise usable chapter fact indexes instead of forcing a retry", () => {
    const parsed = chapterAiSummaryPayloadSchema.parse({
      ...validChapterIndexPayloadV2,
      可核对事实: []
    });

    expect(parsed.可核对事实).toEqual([]);
  });

  it("allows mixed source terms in Chinese values and strips extra model fields", () => {
    const mixedTermPayload = JSON.parse(JSON.stringify(validChapterIndexPayloadV3Lite));
    mixedTermPayload.一句话摘要 = "萧炎发现 U盘 线索，并将 AI 标记视为后文疑点。";
    mixedTermPayload.englishKey = "不合法但可忽略";

    const parsed = chapterAiSummaryPayloadSchema.parse(mixedTermPayload);

    expect(parsed.一句话摘要).toContain("U盘");
    expect(parsed).not.toHaveProperty("englishKey");
  });

  it("accepts recoverable V3 Lite shape drift from model output", () => {
    const payload = JSON.parse(JSON.stringify(validChapterIndexPayloadV3Lite));
    payload.章节信息.章节序号 = "第2章";
    payload.章节信息.缓存版本 = "三 Lite";
    payload.详细梗概 = "主角逃离商场后发现U盘线索。";
    payload.适合回答的问题 = ["这一章讲了什么？"];
    payload.章节作用.结构作用 = "承接前文冲突";
    payload.关键事件 = [
      {
        事件: "主角拿走书包",
        涉及人物: ["主角", "马俊明"],
        时间地点: "商场",
        事件结果: "主角获得U盘线索",
        后续影响: "主角开始怀疑吕曼华身份",
        证据短句: ["伸手拿上他的书包跑出了商场"]
      }
    ];
    payload.人物状态 = [
      {
        人物: "主角",
        本章出场状态: "被卷入冲突",
        本章结束状态: "发现U盘线索",
        动机: "查清书包内容",
        目标: "读取U盘",
        行动: ["逃跑", "检查书包"],
        新获得信息: ["书包内有U盘"],
        仍不知道的信息: ["U盘内容"],
        与他人关系变化: [],
        证据短句: []
      }
    ];
    payload.人物认知边界 = [
      {
        人物: "主角",
        新得知: ["U盘写有吕曼华名字"],
        尚不知道: ["U盘内容"],
        误以为: [],
        证据短句: []
      }
    ];
    payload.伏笔与线索 = [
      {
        线索: "U盘标签",
        类型: "关键线索",
        本章状态: "待判断",
        可能指向: "吕曼华与马俊明关系",
        证据短句: []
      }
    ];
    payload.可核对事实 = [];

    const parsed = chapterAiSummaryPayloadSchema.parse(payload);

    expect(parsed.章节信息.章节序号).toBe(2);
    expect(parsed.章节信息.缓存版本).toBe("三-Lite");
    expect(parsed.详细梗概).toBe("主角逃离商场后发现U盘线索。");
    if (!isChapterAiSummaryPayloadV3Lite(parsed)) {
      throw new Error("expected V3 Lite payload");
    }
    expect(parsed.关键事件[0].结果).toBe("主角获得U盘线索");
    expect(parsed.人物状态[0].本章变化).toContain("被卷入冲突");
    expect(parsed.人物认知边界[0].仍不知道).toEqual(["U盘内容"]);
    expect(parsed.伏笔与线索[0].指向或意义).toBe("吕曼华与马俊明关系");
    expect(parsed).not.toHaveProperty("适合回答的问题");
  });

  it("rejects empty required chapter summary fields", () => {
    expect(() =>
      chapterAiSummaryPayloadSchema.parse({
        ...validChapterIndexPayloadV2,
        一句话摘要: ""
      })
    ).toThrow();
  });

  it("accepts book summary coverage with stale, missing, and skipped chapter ids", () => {
    const payload = {
      全书信息: {
        覆盖阶段: ["第1章至第2章"],
        覆盖章节范围: "第1章至第4章",
        总章节数: 4,
        已索引章节数: 2,
        过期章节: ["第2章"],
        缺失章节: ["第3章"],
        过短跳过章节: ["第4章"],
        覆盖限制: ["第2章摘要过期", "第3章摘要缺失", "第4章正文过短"]
      },
      全文一句话摘要: "全书当前围绕少年失势后的处境展开。",
      全文短摘要: "萧炎在家族测试中暴露修炼低谷，外界评价和自身困境形成主要压力。",
      全文详细梗概: "故事目前集中在萧炎失去昔日天才光环后的处境。测试结果公开后，族人态度变化让他的低谷更加明显，也为后续恢复实力和查明原因留下动力。",
      主线剧情: ["萧炎在家族测试中暴露修炼低谷"],
      主要人物线: ["萧炎处于低谷并承受外界评价"],
      重要关系线: ["族人对萧炎的尊重下降"],
      人物认知线: ["萧炎知道自己处境尴尬"],
      伏笔线: ["修为倒退原因未揭示"],
      道具线: [],
      世界规则与设定: ["斗之力等级会影响家族评价"],
      时间地点结构: ["开篇主要发生在家族测试场景"],
      核心冲突: ["萧炎与家族评价之间的冲突"],
      主题与情绪基调: "低谷、压抑和不甘",
      未解决问题: ["萧炎能否恢复实力"],
      连续性风险: [],
      可核对事实: ["萧炎当前测试结果低微"],
      不可丢失信息: ["萧炎处于低谷"],
      适合回答的问题: ["全文目前讲了什么"]
    };

    expect(bookAiSummaryPayloadSchema.parse(payload)).toEqual(payload);
    expect(getBookSummaryCoverage(payload)).toEqual({
      totalChapterCount: 4,
      indexedChapterCount: 2,
      staleChapterIds: ["第2章"],
      missingChapterIds: ["第3章"],
      skippedTooShortChapterIds: ["第4章"]
    });
  });

  it("accepts continuity check results with no obvious conflict", () => {
    const payload = {
      结论: "无明显冲突",
      问题列表: [],
      需要回读的章节: [],
      给作者的简短说明: "根据当前章节缓存，暂未发现明确连续性冲突。"
    };

    expect(continuityCheckResultSchema.parse(payload)).toEqual(payload);
  });

  it("keeps possible foreshadowing separate from definite continuity errors", () => {
    const payload = {
      结论: "疑似冲突",
      问题列表: [
        {
          问题类型: "人物认知",
          严重程度: "中",
          涉及章节: ["第3章", "第20章"],
          冲突说明: "人物后文似乎知道了前文未公开的信息。",
          证据一: {
            章节: "第3章",
            字段: "人物认知边界",
            证据短句: "他尚不知道旧信的来源"
          },
          证据二: {
            章节: "第20章",
            字段: "人物状态",
            证据短句: "他直接说出旧信来自祠堂"
          },
          为什么可能冲突: "缓存显示前文未建立该信息来源，后文直接使用该信息。",
          是否可能是伏笔或误导: "是",
          是否需要回读原文: "是",
          建议处理: "回读第3章和第20章，确认中间是否有补充信息。"
        }
      ],
      需要回读的章节: ["第3章", "第20章"],
      给作者的简短说明: "这更像需要核对的信息差，不应直接判定为错误。"
    };

    expect(continuityCheckResultSchema.parse(payload).问题列表[0].是否可能是伏笔或误导).toBe("是");
  });

  it("rejects unknown summary and job statuses", () => {
    expect(() => summaryStatusSchema.parse("queued")).toThrow();
    expect(() => summaryJobStatusSchema.parse("stale")).toThrow();
  });

  it("computes a stable chapter content hash across CRLF and LF text", () => {
    expect(computeChapterContentHash("第一段\r\n\r\n第二段\n")).toBe(computeChapterContentHash("第一段\n\n第二段"));
  });

  it("computes source hashes from ordered child hashes", () => {
    const first = computeSourceHash(["chapter_1:aaa", "chapter_2:bbb"]);
    const second = computeSourceHash(["chapter_2:bbb", "chapter_1:aaa"]);

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
  });
});
