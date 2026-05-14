import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRelationshipIndexMessages } from "../../src/main/relationships/relationship-index-prompts";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("relationship index prompt contract", () => {
  it("requires current-chapter-only extraction with dynamic relationship dimensions", () => {
    const messages = buildRelationshipIndexMessages({
      projectId: "project_1",
      chapterId: "chapter_1",
      title: "第1章 雾起",
      ordinal: 1,
      plainText: "林砚避开灰雾的问题，雾灵却知道契约还有代价。",
      knownEntities: [
        {
          canonicalName: "林砚",
          aliases: ["阿砚"],
          entityKind: "person",
          importance: "main"
        }
      ]
    });
    const prompt = messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("只能根据当前章节正文");
    expect(prompt).toContain("关系语义必须来自正文理解");
    expect(prompt).toContain("基础关系");
    expect(prompt).toContain("剧情关系");
    expect(prompt).toContain("关系维度");
    expect(prompt).toContain("一个关系事件可以有多个关系维度");
    expect(prompt).toContain("关系维度由模型根据当前作品动态生成");
    expect(prompt).toContain("不是产品固定枚举");
    expect(prompt).toContain("妈妈、母亲、妈、娘");
    expect(prompt).toContain("不要把称呼词单独当成新人物");
    expect(prompt).toContain("人物最多 30 个");
    expect(prompt).toContain("关系事件最多 45 条");
    expect(prompt).toContain("输出 JSON，且只能输出 JSON");
    expect(prompt).not.toMatch(/family\s*\|\s*ally\s*\|\s*enemy\s*\|\s*romance/i);
  });

  it("adds OpenRouter extraction entry point and parses through the relationship payload converter", () => {
    const source = readSource("src/main/ai/openrouter-chat-generator.ts");

    expect(source).toContain("extractChapterRelationshipsForIndex");
    expect(source).toContain("parseRelationshipExtractionPayload");
    expect(source).toContain('kind: "relationship-index:chapter"');
    expect(source).toContain('responseFormat: { type: "json_object" }');
  });
});
