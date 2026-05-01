import { z } from "zod";

export const proofreadIssueTypes = ["错别字", "标点", "病句", "表达不顺", "对白不自然", "重复表达", "无问题"] as const;

export const proofreadIssueSchema = z
  .object({
    type: z.enum(proofreadIssueTypes),
    quote: z.string(),
    suggestion: z.string(),
    reason: z.string()
  })
  .strict();

export const proofreadResultSchema = z
  .object({
    issues: z.array(proofreadIssueSchema).max(3)
  })
  .strict();

export const proofreadCandidateMetadataSchema = z
  .object({
    proofreadIssues: z.array(proofreadIssueSchema).max(3)
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
