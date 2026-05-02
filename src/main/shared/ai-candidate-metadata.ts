import { z } from "zod";
import { proofreadIssueSchema, type ProofreadIssue } from "./proofread";

export const writingSupportingContextItemSchema = z
  .object({
    kind: z.enum([
      "same_chapter_before",
      "same_chapter_after",
      "same_chapter_summary",
      "previous_chapter_summary",
      "chapter_range_summary",
      "chat_memory"
    ]),
    label: z.string(),
    content: z.string(),
    reason: z.string()
  })
  .strict();

export const writingContextPlanMetadataSchema = z
  .object({
    targetText: z.string(),
    supportingContext: z.array(writingSupportingContextItemSchema),
    mode: z.enum(["direct", "summarized", "mixed"]),
    estimatedInputTokens: z.number().int().nonnegative(),
    maxInputTokens: z.number().int().positive(),
    reason: z.string()
  })
  .strict();

export const aiCandidateMetadataSchema = z
  .object({
    proofreadIssues: z.array(proofreadIssueSchema).max(20).nullable().optional(),
    writingContextPlan: writingContextPlanMetadataSchema.nullable().optional()
  })
  .strict();

type ParsedWritingSupportingContextMetadata = z.output<typeof writingSupportingContextItemSchema>;
type ParsedWritingContextPlanMetadata = z.output<typeof writingContextPlanMetadataSchema>;

export type WritingSupportingContextMetadata = {
  readonly kind: ParsedWritingSupportingContextMetadata["kind"];
  readonly label: string;
  readonly content: string;
  readonly reason: string;
};

export type WritingContextPlanMetadata = {
  readonly targetText: string;
  readonly supportingContext: readonly WritingSupportingContextMetadata[];
  readonly mode: ParsedWritingContextPlanMetadata["mode"];
  readonly estimatedInputTokens: number;
  readonly maxInputTokens: number;
  readonly reason: string;
};

export type AiCandidateMetadata = {
  readonly proofreadIssues?: readonly ProofreadIssue[] | null;
  readonly writingContextPlan?: WritingContextPlanMetadata | null;
};

export function parseAiCandidateMetadata(value: string | null): AiCandidateMetadata | null {
  if (!value) {
    return null;
  }
  return aiCandidateMetadataSchema.parse(JSON.parse(value));
}

export function stringifyAiCandidateMetadata(value: AiCandidateMetadata | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = aiCandidateMetadataSchema.parse(value);
  if (!parsed.proofreadIssues && !parsed.writingContextPlan) {
    return null;
  }

  return JSON.stringify(parsed);
}
