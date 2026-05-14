import { describe, expect, it } from "vitest";
import {
  parseRelationshipExtractionPayload,
  relationshipEntityKey,
  relationshipEntityLookupKeys,
  normalizeRelationshipCharacterName
} from "../../src/main/shared/relationship-index";

type RawRelationshipPayload = {
  readonly 索引信息: Record<string, unknown>;
  人物: Array<Record<string, unknown>>;
  关系事件: Array<Record<string, unknown>>;
  readonly 不确定项: string[];
};

function basePayload(): RawRelationshipPayload {
  return {
    索引信息: {
      缓存版本: "关系索引一",
      章节序号: 12,
      章节标题: "第12章 雾下归来",
      语言: "简体中文"
    },
    人物: [
      {
        姓名: " 林 砚 ",
        别名: ["阿砚", "  "],
        实体类型: "person",
        重要程度: "main",
        身份摘要: "暂时离开宗门的少年",
        阵营: "青石门",
        置信度: 1.4,
        证据短句: ["林砚按住剑柄"]
      },
      {
        姓名: "雾灵",
        别名: ["灰雾"],
        实体类型: "nonhuman",
        重要程度: "supporting",
        身份摘要: "伴随林砚的非人实体",
        阵营: "未明确",
        置信度: -0.3,
        证据短句: ["灰雾在他袖口盘旋"]
      }
    ],
    关系事件: [
      {
        主体: "林砚",
        客体: "雾灵",
        关系维度: [
          { 名称: "灵魂契约", 说明: "人与非人实体之间的绑定", 置信度: 0.8 },
          { 名称: "信息差", 说明: "一方知道另一方暂时不知道的信息", 置信度: 0.6 }
        ],
        主维度: "信息差",
        基础关系: { 名称: "契约同行者", 说明: "雾灵依附林砚行动" },
        剧情关系: { 名称: "隐瞒关键代价", 说明: "雾灵没有说明契约代价" },
        语义标记: [" 隐瞒 ", "", "契约", "隐瞒"],
        方向: "source_to_target",
        极性: "mixed",
        强度: 1.3,
        本章变化: "林砚意识到雾灵知道更多",
        开始状态: "同行",
        结束状态: "互相试探",
        变化原因: "雾灵回避问题",
        证据短句: "灰雾避开他的目光",
        置信度: -0.2,
        不确定说明: "契约代价仍需后文确认"
      }
    ],
    不确定项: ["雾灵真实来历未明"]
  };
}

describe("relationship index extraction schema", () => {
  it("normalizes names without deriving relationship semantics", () => {
    expect(normalizeRelationshipCharacterName("  林   砚\n")).toBe("林 砚");
    expect(relationshipEntityKey("  林   砚\n")).toBe("林 砚");
    expect(relationshipEntityLookupKeys("妈妈")).toEqual(["address:母亲"]);
    expect(relationshipEntityLookupKeys("母亲")).toEqual(["address:母亲"]);
    expect(relationshipEntityLookupKeys("林砚")).toEqual(["林砚"]);
  });

  it("parses arbitrary LLM-generated dimensions and dual-layer relationship labels", () => {
    const payload = parseRelationshipExtractionPayload(basePayload());

    expect(payload.indexInfo).toMatchObject({
      chapterOrder: 12,
      chapterTitle: "第12章 雾下归来"
    });
    expect(payload.characters[0]).toMatchObject({
      name: "林 砚",
      aliases: ["阿砚"],
      entityKind: "person",
      importance: "main",
      confidence: 1
    });
    expect(payload.characters[1]).toMatchObject({
      name: "雾灵",
      entityKind: "nonhuman",
      confidence: 0
    });
    expect(payload.mentions[0]).toMatchObject({
      sourceName: "林砚",
      targetName: "雾灵",
      primaryDimensionName: "信息差",
      baseRelationLabel: "契约同行者",
      plotRelationLabel: "隐瞒关键代价",
      intensity: 1,
      confidence: 0
    });
    expect(payload.mentions[0]?.relationshipDimensions.map((dimension) => dimension.name)).toEqual(["灵魂契约", "信息差"]);
  });

  it("accepts all supported relationship entity kinds", () => {
    const input = basePayload();
    input.人物 = ["person", "nonhuman", "group", "identity", "unknown"].map((kind) => ({
      姓名: `实体-${kind}`,
      别名: [],
      实体类型: kind,
      重要程度: "unknown",
      身份摘要: "",
      阵营: "",
      置信度: 0.5,
      证据短句: []
    }));

    const payload = parseRelationshipExtractionPayload(input);

    expect(payload.characters.map((character) => character.entityKind)).toEqual(["person", "nonhuman", "group", "identity", "unknown"]);
  });

  it("drops invalid relationship events while keeping valid characters", () => {
    const input = basePayload();
    input.关系事件 = [
      {
        主体: "",
        客体: "雾灵",
        关系维度: [{ 名称: "灵魂契约", 说明: "", 置信度: 0.7 }],
        主维度: "灵魂契约",
        基础关系: { 名称: "契约", 说明: "" },
        剧情关系: { 名称: "隐瞒", 说明: "" },
        证据短句: "证据"
      },
      {
        主体: "林砚",
        客体: "雾灵",
        关系维度: [{ 名称: "灵魂契约", 说明: "", 置信度: 0.7 }],
        主维度: "灵魂契约",
        基础关系: { 名称: "", 说明: "" },
        剧情关系: { 名称: "隐瞒", 说明: "" },
        证据短句: "证据"
      },
      {
        主体: "林砚",
        客体: "雾灵",
        关系维度: [],
        主维度: "",
        基础关系: { 名称: "契约", 说明: "" },
        剧情关系: { 名称: "隐瞒", 说明: "" },
        证据短句: "证据"
      }
    ];

    const payload = parseRelationshipExtractionPayload(input);

    expect(payload.characters).toHaveLength(2);
    expect(payload.mentions).toHaveLength(0);
    expect(payload.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("主体"),
        expect.stringContaining("基础关系"),
        expect.stringContaining("关系维度")
      ])
    );
  });

  it("falls back mismatched or missing primary dimension to the first valid LLM dimension", () => {
    const input = basePayload();
    input.关系事件[0].主维度 = "产品固定分类";

    const payload = parseRelationshipExtractionPayload(input);

    expect(payload.mentions[0]?.primaryDimensionName).toBe("灵魂契约");
  });

  it("keeps semantic markers as arbitrary model output and only trims empties", () => {
    const payload = parseRelationshipExtractionPayload(basePayload());

    expect(payload.mentions[0]?.semanticMarkers).toEqual(["隐瞒", "契约"]);
  });
});
