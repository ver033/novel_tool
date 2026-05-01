import continueSkillContent from "./writing-skills/continue/SKILL.md?raw";
import expandSkillContent from "./writing-skills/expand/SKILL.md?raw";
import polishSkillContent from "./writing-skills/polish/SKILL.md?raw";
import proofreadSkillContent from "./writing-skills/proofread/SKILL.md?raw";
import type { WritingSkill, WritingSkillMetadata } from "./writing-operation-types";

const WRITING_SKILLS = [
  {
    id: "moshu.polish",
    name: "中文小说润色",
    description: "提升选中文本的语言表现力，保留事实、人物意图和情节顺序。",
    content: polishSkillContent.trim()
  },
  {
    id: "moshu.expand",
    name: "中文小说扩写",
    description: "在选中文本周围补充合理细节，使场景、情绪或动作更完整。",
    content: expandSkillContent.trim()
  },
  {
    id: "moshu.proofread",
    name: "中文小说校对",
    description: "找出正文中的硬错误和高价值修改建议，由作者手动决定是否修改。",
    content: proofreadSkillContent.trim()
  },
  {
    id: "moshu.continue",
    name: "中文小说续写",
    description: "基于当前章节和必要前文继续写作，保持风格、人物和剧情连续。",
    content: continueSkillContent.trim()
  }
] as const satisfies readonly WritingSkill[];

export function listWritingSkillMetadata(): readonly WritingSkillMetadata[] {
  return WRITING_SKILLS.map(({ id, name, description }) => ({ id, name, description }));
}

export function loadWritingSkill(skillId: string): WritingSkill {
  const skill = WRITING_SKILLS.find((item) => item.id === skillId);
  if (!skill) {
    throw new Error(`未知写作技能：${skillId}`);
  }
  return skill;
}
