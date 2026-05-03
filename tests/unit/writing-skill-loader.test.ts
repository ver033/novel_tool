import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadWritingSkill, listWritingSkillMetadata } from "../../src/main/ai/writing-skill-loader";

describe("writing skill loader", () => {
  it("lists compact metadata without loading all skill bodies into one prompt", () => {
    const metadata = listWritingSkillMetadata();

    expect(metadata).toHaveLength(4);
    expect(metadata.map((item) => item.id)).toEqual(["moshu.polish", "moshu.expand", "moshu.proofread", "moshu.continue"]);
    for (const item of metadata) {
      expect(item.description.length).toBeGreaterThan(10);
      expect("content" in item).toBe(false);
    }
  });

  it("loads only the requested skill body", () => {
    const skill = loadWritingSkill("moshu.polish");

    expect(skill.id).toBe("moshu.polish");
    expect(skill.content).toContain("中文小说润色");
    expect(skill.content).toContain("只输出润色后的候选正文");
    expect(skill.content).not.toContain("中文小说校对");
  });

  it("keeps bundled operation skills strict enough for long-form novel editing", () => {
    const polish = loadWritingSkill("moshu.polish").content;
    const expand = loadWritingSkill("moshu.expand").content;
    const proofread = loadWritingSkill("moshu.proofread").content;
    const continuation = loadWritingSkill("moshu.continue").content;

    expect(polish).toContain("不改变原文事实");
    expect(polish).toContain("不输出解释、建议、标题或 Markdown");
    expect(polish).toContain("不要为了显得改过而大改");

    expect(expand).toContain("不新增关键设定或人物");
    expect(expand).toContain("不要为了凑字数重复同一情绪");
    expect(expand).toContain("只输出扩写后的候选正文");
    expect(expand).toContain("扩写结果用于替换原选区");
    expect(expand).toContain("不要只输出新增补充内容");
    expect(expand).toContain("必须保持原文文风");
    expect(expand).toContain("句式节奏");
    expect(expand).toContain("描写密度");

    expect(continuation).toContain("保持当前 POV");
    expect(continuation).toContain("不让角色知道他当前不应知道的信息");
    expect(continuation).toContain("不要重复已给出的前文");
    expect(continuation).toContain("续写结果用于插入选区下方");
    expect(continuation).toContain("不要改写选区正文");
    expect(continuation).toContain("必须延续当前章节文风");
    expect(continuation).toContain("对白习惯");
    expect(continuation).toContain("信息释放速度");

    expect(proofread).toContain("人物认知冲突");
    expect(proofread).toContain("道具状态冲突");
    expect(proofread).toContain("needsAuthorJudgment");
    expect(proofread).toContain("只输出符合 JSON Schema 的对象");
  });

  it("rejects unknown skill ids", () => {
    expect(() => loadWritingSkill("moshu.unknown")).toThrow("未知写作技能：moshu.unknown");
  });

  it("keeps Markdown skill files as the runtime source of truth", () => {
    const source = readFileSync("src/main/ai/writing-skill-loader.ts", "utf8");

    expect(source).toContain("SKILL.md?raw");
    expect(source).not.toContain("content: [");
  });
});
