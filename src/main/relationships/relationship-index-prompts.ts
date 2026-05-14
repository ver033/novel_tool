import type { OpenRouterMessage } from "../ai/openrouter-client";
import type { RelationshipEntityImportance, RelationshipEntityKind } from "../shared/relationship-index";

export type RelationshipIndexKnownEntity = {
  readonly canonicalName: string;
  readonly aliases?: readonly string[];
  readonly entityKind?: RelationshipEntityKind;
  readonly importance?: RelationshipEntityImportance;
  readonly roleSummary?: string | null;
  readonly faction?: string | null;
};

export type RelationshipIndexSummaryInput = {
  readonly projectId: string;
  readonly chapterId: string;
  readonly title: string;
  readonly ordinal: number;
  readonly plainText: string;
  readonly knownEntities: readonly RelationshipIndexKnownEntity[];
};

const RELATIONSHIP_JSON_CONTRACT = [
  "{",
  '  "索引信息": {"缓存版本": "关系索引一", "章节序号": 1, "章节标题": "标题", "语言": "简体中文"},',
  '  "人物": [',
  "    {",
  '      "姓名": "正文中的人物、非人实体、组织、身份或群体名",',
  '      "别名": [],',
  '      "实体类型": "person | nonhuman | group | identity | unknown",',
  '      "重要程度": "main | supporting | minor | unknown",',
  '      "身份摘要": "只写当前章节能确认的身份、状态或叙事作用",',
  '      "阵营": "未明确",',
  '      "置信度": 0.8,',
  '      "证据短句": []',
  "    }",
  "  ],",
  '  "关系事件": [',
  "    {",
  '      "主体": "关系一端的规范姓名",',
  '      "客体": "关系另一端的规范姓名",',
  '      "关系维度": [{"名称": "由模型根据本作品和本章正文动态生成的维度名称", "说明": "维度含义", "置信度": 0.8}],',
  '      "主维度": "必须等于关系维度中的某一个名称",',
  '      "基础关系": {"名称": "稳定身份或结构关系的自然语言标签", "说明": "当前章节能确认的稳定说明"},',
  '      "剧情关系": {"名称": "本章阶段互动或状态变化的自然语言标签", "说明": "当前章节发生的动态说明"},',
  '      "语义标记": [],',
  '      "方向": "undirected | source_to_target | target_to_source | unclear",',
  '      "极性": "positive | negative | mixed | neutral | unknown",',
  '      "强度": 0.5,',
  '      "本章变化": "本章中这条关系发生了什么变化；无变化则写未明确",',
  '      "开始状态": "未明确",',
  '      "结束状态": "未明确",',
  '      "变化原因": "未明确",',
  '      "证据短句": "必须来自当前章节正文的短句",',
  '      "置信度": 0.8,',
  '      "不确定说明": null',
  "    }",
  "  ],",
  '  "不确定项": []',
  "}"
].join("\n");

function formatKnownEntities(entities: readonly RelationshipIndexKnownEntity[]): string {
  if (entities.length === 0) {
    return "[]";
  }
  return JSON.stringify(
    entities.map((entity) => ({
      规范名: entity.canonicalName,
      别名: entity.aliases ?? [],
      实体类型: entity.entityKind ?? "unknown",
      重要程度: entity.importance ?? "unknown",
      身份摘要: entity.roleSummary ?? "",
      阵营: entity.faction ?? ""
    })),
    null,
    2
  );
}

export function buildRelationshipIndexMessages(input: RelationshipIndexSummaryInput): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文长篇小说的人物关系索引助手。",
        "任务是从单章正文抽取可缓存的人物/实体关系，用于关系图谱、章节进展滑块和以某个角色为中心的关系探索。",
        "只能根据当前章节正文抽取，不得调用外部知识，不得补写前后章节没有提供的事实。",
        "关系语义必须来自正文理解；不得用关键词、固定表、模板标签或产品内置枚举替代阅读判断。",
        "每条关系必须同时给出基础关系和剧情关系：基础关系记录较稳定的身份/结构层，剧情关系记录当前章节阶段的互动、变化或张力层。",
        "必须输出关系维度；一个关系事件可以有多个关系维度，并用主维度标明默认聚合维度。",
        "关系维度由模型根据当前作品动态生成，不是产品固定枚举；维度名称、基础关系名称、剧情关系名称都用自然语言短标签。",
        "证据短句必须来自当前章节正文。不能确认的内容写不确定说明，不要把猜测写成事实。",
        "输出 JSON，且只能输出 JSON。不要 Markdown、代码块、解释、前言或结尾。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `项目 ID：${input.projectId}`,
        `章节 ID：${input.chapterId}`,
        `章节序号：${input.ordinal}`,
        `章节标题：${input.title}`,
        "可参考的已知实体线索：",
        formatKnownEntities(input.knownEntities),
        "这些线索只用于统一称呼和别名；关系判断仍然只能根据当前章节正文。",
        "JSON 字段格式：",
        RELATIONSHIP_JSON_CONTRACT,
        "抽取要求：",
        "1. 人物可包括人、非人实体、组织、身份、群体；不要把普通地点、物品或抽象概念当作人物关系节点，除非正文把它作为行动主体。",
        "2. 关系事件必须有主体、客体、关系维度、基础关系、剧情关系和证据短句。",
        "3. 基础关系写稳定层；剧情关系写本章阶段层。两层都必须来自当前章节。",
        "4. 关系维度、基础关系名称、剧情关系名称都由你按正文动态命名，不要从固定清单中挑选。",
        "5. 若本章没有可靠关系事件，人物可以保留，关系事件输出空数组。",
        "6. 证据短句必须短，不要复制长段正文。",
        "章节正文：",
        input.plainText.trim() || "（本章暂无正文）"
      ].join("\n")
    }
  ];
}
