import { z } from "zod";

export const chatAgentScopeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("current_chapter")
  }),
  z.object({
    type: z.literal("selection")
  }),
  z.object({
    type: z.literal("chapter"),
    ordinal: z.number().int().positive()
  }),
  z.object({
    type: z.literal("chapter_range"),
    from: z.number().int().positive(),
    to: z.number().int().positive()
  }),
  z.object({
    type: z.literal("all_chapters")
  })
]);

export const chatAgentActionSchema = z.object({
  type: z.literal("add_to_scratchpad")
});

const optionalNonEmptyStringSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional()
);

export const chatAgentPlanSchema = z
  .object({
    intent: z.enum(["answer", "summarize", "analyze", "proofread", "rewrite_suggest", "organize"]),
    scope: chatAgentScopeSchema,
    actions: z.array(chatAgentActionSchema).default([]),
    needsClarification: z.boolean().optional(),
    clarificationQuestion: optionalNonEmptyStringSchema,
    reason: optionalNonEmptyStringSchema
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (plan.scope.type === "chapter_range" && plan.scope.from > plan.scope.to) {
      ctx.addIssue({
        code: "custom",
        path: ["scope", "to"],
        message: "chapter range end must be greater than or equal to start"
      });
    }
    if (plan.needsClarification && !plan.clarificationQuestion) {
      ctx.addIssue({
        code: "custom",
        path: ["clarificationQuestion"],
        message: "clarificationQuestion is required when needsClarification is true"
      });
    }
  });

export type ChatAgentScope = z.output<typeof chatAgentScopeSchema>;
export type ChatAgentAction = z.output<typeof chatAgentActionSchema>;
export type ChatAgentPlan = z.output<typeof chatAgentPlanSchema>;

export type ChatAgentContextMode = "direct" | "summarized";

export type ChatAgentContext = {
  readonly scopeLabel: string;
  readonly contextText: string;
  readonly sourceChapterIds: readonly string[];
  readonly mode: ChatAgentContextMode;
};

export type ChatChapterSummaryInput = {
  readonly projectId: string;
  readonly chapterId: string;
  readonly title: string;
  readonly ordinal: number;
  readonly plainText: string;
  readonly userMessage: string;
  readonly scopeLabel: string;
};

export type ChatContextBatchChapterInput = {
  readonly chapterId: string;
  readonly title: string;
  readonly ordinal: number;
  readonly plainText: string;
};

export type ChatContextBatchSummaryInput = {
  readonly projectId: string;
  readonly userMessage: string;
  readonly scopeLabel: string;
  readonly chapters: readonly ChatContextBatchChapterInput[];
};

export type ChatContextSummaryItem = {
  readonly chapterId: string;
  readonly title: string;
  readonly ordinal: number;
  readonly summary: string;
};

export type ChatContextSummaryMergeInput = {
  readonly projectId: string;
  readonly userMessage: string;
  readonly scopeLabel: string;
  readonly summaries: readonly ChatContextSummaryItem[];
};
