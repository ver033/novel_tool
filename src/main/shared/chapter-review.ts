import { z } from "zod";
import { proofreadIssueSchema, type ProofreadIssue } from "./proofread";

export const chapterReviewStatusSchema = z.enum(["running", "completed", "failed"]);
export const chapterReviewAiToneRiskSchema = z.enum(["none", "low", "medium", "high"]);

export const chapterReviewModelResponseSchema = z
  .object({
    summary: z.string().trim().min(1).max(2000),
    readabilityScore: z.number().int().min(1).max(5),
    aiToneRisk: chapterReviewAiToneRiskSchema,
    issues: z.array(proofreadIssueSchema).max(80)
  })
  .strict();

export type ChapterReviewStatus = z.output<typeof chapterReviewStatusSchema>;
export type ChapterReviewAiToneRisk = z.output<typeof chapterReviewAiToneRiskSchema>;
export type ChapterReviewModelResponse = z.output<typeof chapterReviewModelResponseSchema>;

export type ChapterReviewChapterResult = {
  readonly id: string;
  readonly runId: string;
  readonly projectId: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly chapterSortOrder: number;
  readonly summary: string;
  readonly readabilityScore: number;
  readonly aiToneRisk: ChapterReviewAiToneRisk;
  readonly issues: readonly ProofreadIssue[];
  readonly issueCount: number;
  readonly chunkCount: number;
  readonly reviewedAt: string;
};

export type ChapterReviewRunRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly chapterIds: readonly string[];
  readonly status: ChapterReviewStatus;
  readonly issueCount: number;
  readonly requestedAt: string;
  readonly completedAt: string | null;
  readonly error: string | null;
  readonly chapters: readonly ChapterReviewChapterResult[];
};

export type ChapterReviewProgressPhase = "preparing" | "reviewing" | "saving" | "completed" | "failed";

export type ChapterReviewProgressEvent = {
  readonly requestId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly phase: ChapterReviewProgressPhase;
  readonly totalChapters: number;
  readonly completedChapters: number;
  readonly currentChapterTitle: string | null;
  readonly totalChunks: number;
  readonly completedChunks: number;
  readonly progressPercent: number;
  readonly message: string;
};
