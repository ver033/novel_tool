import { z } from "zod";

export const proofreadIssueTypes = [
  "错别字",
  "标点",
  "病句",
  "表达不顺",
  "对白不自然",
  "重复表达",
  "指代不明",
  "时间线",
  "空间移动",
  "人物状态",
  "人物认知",
  "人物关系",
  "道具状态",
  "设定规则",
  "因果动机",
  "视角越界",
  "伏笔状态",
  "无问题"
] as const;

const logicProofreadIssueTypes = new Set<(typeof proofreadIssueTypes)[number]>([
  "时间线",
  "空间移动",
  "人物状态",
  "人物认知",
  "人物关系",
  "道具状态",
  "设定规则",
  "因果动机",
  "视角越界",
  "伏笔状态"
]);

export const proofreadIssueSchema = z
  .object({
    type: z.enum(proofreadIssueTypes),
    quote: z.string(),
    suggestion: z.string(),
    reason: z.string(),
    严重程度: z.enum(["低", "中", "高", "严重"]).optional(),
    置信度: z.enum(["低", "中", "高"]).optional(),
    缓存证据: z.array(z.string()).optional(),
    是否可自动应用: z.enum(["是", "否"]).optional(),
    是否需要作者判断: z.enum(["是", "否"]).optional(),
    是否需要回读原文: z.enum(["是", "否"]).optional()
  })
  .strict()
  .transform((issue) =>
    logicProofreadIssueTypes.has(issue.type)
      ? {
          ...issue,
          是否可自动应用: issue.是否可自动应用 ?? "否",
          是否需要作者判断: issue.是否需要作者判断 ?? "是",
          是否需要回读原文: issue.是否需要回读原文 ?? "是"
        }
      : issue
  );

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
