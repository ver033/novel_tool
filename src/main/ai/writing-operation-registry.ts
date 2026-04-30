import type { WritingOperationDefinition, WritingOperationId } from "./writing-operation-types";

const WRITING_OPERATION_DEFINITIONS = [
  {
    id: "polish",
    label: "润色",
    description: "在不改写剧情事实的前提下，提升中文小说段落的语感、节奏和画面感。",
    skillId: "moshu.polish",
    outputKind: "candidate_text",
    sideEffectPolicy: "none",
    tokenBudgetTaskType: "polish",
    contextPolicy: {
      includeLocalBeforeChars: 1500,
      includeLocalAfterChars: 1500
    }
  },
  {
    id: "expand",
    label: "扩写",
    description: "围绕选中文本补足动作、心理、环境和承接，让片段更饱满。",
    skillId: "moshu.expand",
    outputKind: "candidate_text",
    sideEffectPolicy: "none",
    tokenBudgetTaskType: "expand",
    contextPolicy: {
      includeLocalBeforeChars: 2200,
      includeLocalAfterChars: 1200
    }
  },
  {
    id: "proofread",
    label: "校对",
    description: "发现错别字、病句、指代、时间线和设定冲突，只给出问题与建议。",
    skillId: "moshu.proofread",
    outputKind: "proofread_issues",
    sideEffectPolicy: "none",
    tokenBudgetTaskType: "proofread",
    contextPolicy: {
      includeLocalBeforeChars: 0,
      includeLocalAfterChars: 0
    }
  },
  {
    id: "continue",
    label: "续写",
    description: "基于当前上下文延续正文，不越权改动既有文本。",
    skillId: "moshu.continue",
    outputKind: "candidate_text",
    sideEffectPolicy: "none",
    tokenBudgetTaskType: "continue",
    contextPolicy: {
      includeLocalBeforeChars: 3000,
      includeLocalAfterChars: 0
    }
  }
] as const satisfies readonly WritingOperationDefinition[];

export function listWritingOperationDefinitions(): readonly WritingOperationDefinition[] {
  return WRITING_OPERATION_DEFINITIONS;
}

export function getWritingOperationDefinition(operationId: WritingOperationId): WritingOperationDefinition {
  const definition = WRITING_OPERATION_DEFINITIONS.find((item) => item.id === operationId);
  if (!definition) {
    throw new Error(`未知写作操作：${operationId}`);
  }
  return definition;
}
