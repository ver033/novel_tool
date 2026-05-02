import { createHash } from "node:crypto";
import { z } from "zod";

export const summaryStatusSchema = z.enum(["ready", "stale", "building", "failed", "skipped_too_short"]);
export const summaryJobStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled", "skipped"]);
export const summaryJobTypeSchema = z.enum(["chapter_summary", "arc_summary", "book_summary", "rebuild_project_index"]);

const nonEmptyStringSchema = z.string().trim().min(1);

export const chapterAiSummaryPayloadSchema = z
  .object({
    oneLine: nonEmptyStringSchema,
    synopsis: nonEmptyStringSchema,
    keyEvents: z.array(nonEmptyStringSchema),
    characterMentions: z.array(
      z
        .object({
          name: nonEmptyStringSchema,
          roleInChapter: nonEmptyStringSchema,
          stateOrChange: nonEmptyStringSchema.optional()
        })
        .strict()
    ),
    relationshipHints: z.array(nonEmptyStringSchema),
    timeAndPlace: z.array(nonEmptyStringSchema),
    foreshadowingHints: z.array(nonEmptyStringSchema),
    unresolvedQuestions: z.array(nonEmptyStringSchema),
    emotionalArc: nonEmptyStringSchema,
    importantQuotes: z.array(nonEmptyStringSchema)
  })
  .strict();

export const arcAiSummaryPayloadSchema = z
  .object({
    chapterFrom: z.number().int().positive(),
    chapterTo: z.number().int().positive(),
    synopsis: nonEmptyStringSchema,
    keyEvents: z.array(nonEmptyStringSchema),
    characterChanges: z.array(nonEmptyStringSchema),
    relationshipChanges: z.array(nonEmptyStringSchema),
    foreshadowingHints: z.array(nonEmptyStringSchema),
    unresolvedQuestions: z.array(nonEmptyStringSchema)
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.chapterFrom > payload.chapterTo) {
      ctx.addIssue({
        code: "custom",
        path: ["chapterTo"],
        message: "chapterTo must be greater than or equal to chapterFrom"
      });
    }
  });

export const bookAiSummaryPayloadSchema = z
  .object({
    coverage: z
      .object({
        totalChapterCount: z.number().int().nonnegative(),
        indexedChapterCount: z.number().int().nonnegative(),
        staleChapterIds: z.array(nonEmptyStringSchema),
        missingChapterIds: z.array(nonEmptyStringSchema),
        skippedTooShortChapterIds: z.array(nonEmptyStringSchema)
      })
      .strict(),
    synopsis: nonEmptyStringSchema,
    mainPlot: z.array(nonEmptyStringSchema),
    majorCharacters: z.array(
      z
        .object({
          name: nonEmptyStringSchema,
          summary: nonEmptyStringSchema
        })
        .strict()
    ),
    majorConflicts: z.array(nonEmptyStringSchema),
    relationshipChanges: z.array(nonEmptyStringSchema),
    foreshadowingHints: z.array(nonEmptyStringSchema),
    unresolvedQuestions: z.array(nonEmptyStringSchema)
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.coverage.indexedChapterCount > payload.coverage.totalChapterCount) {
      ctx.addIssue({
        code: "custom",
        path: ["coverage", "indexedChapterCount"],
        message: "indexedChapterCount cannot exceed totalChapterCount"
      });
    }
  });

export type SummaryStatus = z.output<typeof summaryStatusSchema>;
export type SummaryJobStatus = z.output<typeof summaryJobStatusSchema>;
export type SummaryJobType = z.output<typeof summaryJobTypeSchema>;
export type ChapterAiSummaryPayload = z.output<typeof chapterAiSummaryPayloadSchema>;
export type ArcAiSummaryPayload = z.output<typeof arcAiSummaryPayloadSchema>;
export type BookAiSummaryPayload = z.output<typeof bookAiSummaryPayloadSchema>;

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function normalizeChapterSummaryText(plainText: string): string {
  return plainText.replace(/\r\n?/g, "\n").trim();
}

export function computeChapterContentHash(plainText: string): string {
  return sha256(normalizeChapterSummaryText(plainText));
}

export function computeSourceHash(parts: readonly string[]): string {
  return sha256(parts.join("\n"));
}
