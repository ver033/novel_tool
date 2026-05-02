import { z } from "zod";

export const proofreadIssueCodes = [
  "typo",
  "punctuation",
  "grammar",
  "awkward_expression",
  "repetition",
  "unclear_reference",
  "dialogue_voice",
  "pov_leak",
  "timeline_conflict",
  "spatial_logic",
  "character_state_conflict",
  "character_knowledge_conflict",
  "relationship_conflict",
  "prop_state_conflict",
  "world_rule_conflict",
  "causality_gap",
  "motivation_gap",
  "continuity_risk",
  "style_drift",
  "ai_tone"
] as const;

export type ProofreadIssueCode = (typeof proofreadIssueCodes)[number];

export const proofreadIssueLabels: Record<ProofreadIssueCode, string> = {
  typo: "错别字",
  punctuation: "标点问题",
  grammar: "病句",
  awkward_expression: "表达不顺",
  repetition: "重复表达",
  unclear_reference: "指代不明",
  dialogue_voice: "对白不自然",
  pov_leak: "视角越界",
  timeline_conflict: "时间线冲突",
  spatial_logic: "空间逻辑问题",
  character_state_conflict: "人物状态冲突",
  character_knowledge_conflict: "人物认知冲突",
  relationship_conflict: "关系变化冲突",
  prop_state_conflict: "道具状态冲突",
  world_rule_conflict: "设定规则冲突",
  causality_gap: "因果断裂",
  motivation_gap: "动机不足",
  continuity_risk: "连续性风险",
  style_drift: "文风漂移",
  ai_tone: "AI 味 / 套话感"
};

export const proofreadEvidenceSourceSchema = z.enum([
  "target",
  "before_context",
  "after_context",
  "memory",
  "chapter_summary"
]);

const logicProofreadIssueCodes = new Set<ProofreadIssueCode>([
  "pov_leak",
  "timeline_conflict",
  "spatial_logic",
  "character_state_conflict",
  "character_knowledge_conflict",
  "relationship_conflict",
  "prop_state_conflict",
  "world_rule_conflict",
  "causality_gap",
  "motivation_gap",
  "continuity_risk"
]);

export const proofreadIssueSchema = z
  .object({
    code: z.enum(proofreadIssueCodes),
    severity: z.enum(["low", "medium", "high", "critical"]),
    quote: z.string().trim().min(1).max(600),
    locationHint: z.string().trim().min(1).max(300),
    explanation: z.string().trim().min(1).max(1200),
    suggestion: z.string().trim().min(1).max(1200),
    suggestedReplacement: z.string().trim().max(1200).optional(),
    evidence: z
      .array(
        z
          .object({
            source: proofreadEvidenceSourceSchema,
            quote: z.string().trim().min(1).max(600),
            note: z.string().trim().min(1).max(600)
          })
          .strict()
      )
      .max(8)
      .default([]),
    canAutoApply: z.boolean(),
    needsAuthorJudgment: z.boolean()
  })
  .strict()
  .transform((issue) => {
    const isLogicIssue = logicProofreadIssueCodes.has(issue.code);
    const needsAuthorJudgment = isLogicIssue ? true : issue.needsAuthorJudgment;
    return {
      ...issue,
      canAutoApply: needsAuthorJudgment ? false : issue.canAutoApply,
      needsAuthorJudgment
    };
  });

export const proofreadResultSchema = z
  .object({
    issues: z.array(proofreadIssueSchema).max(20)
  })
  .strict();

export const proofreadCandidateMetadataSchema = z
  .object({
    proofreadIssues: z.array(proofreadIssueSchema).max(20)
  })
  .strict();

export type ProofreadIssue = z.output<typeof proofreadIssueSchema>;
export type ProofreadCandidateMetadata = z.output<typeof proofreadCandidateMetadataSchema>;

export function parseProofreadCandidateMetadata(value: string | null): ProofreadCandidateMetadata | null {
  if (!value) {
    return null;
  }

  return proofreadCandidateMetadataSchema.parse(JSON.parse(value));
}

export function stringifyProofreadCandidateMetadata(issues: readonly ProofreadIssue[] | null | undefined): string | null {
  if (!issues) {
    return null;
  }

  return JSON.stringify(proofreadCandidateMetadataSchema.parse({ proofreadIssues: issues }));
}
