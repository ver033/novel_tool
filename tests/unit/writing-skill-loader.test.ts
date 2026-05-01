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

  it("rejects unknown skill ids", () => {
    expect(() => loadWritingSkill("moshu.unknown")).toThrow("未知写作技能：moshu.unknown");
  });

  it("keeps Markdown skill files as the runtime source of truth", () => {
    const source = readFileSync("src/main/ai/writing-skill-loader.ts", "utf8");

    expect(source).toContain("SKILL.md?raw");
    expect(source).not.toContain("content: [");
  });
});
