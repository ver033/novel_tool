import type { TaskPromptPreset, TaskType } from "../shared/types";
import type { ProofreadIssue } from "../shared/proofread";
import type { WritingContextPlanMetadata, WritingSupportingContextMetadata } from "../shared/ai-candidate-metadata";
import type { OpenRouterMessage, OpenRouterReasoningConfig, OpenRouterResponseFormat } from "./openrouter-client";
import type { TokenBudget } from "./token-budget";

export type WritingOperationId = TaskType;
export type WritingOperationOutputKind = "candidate_text" | "proofread_issues";
export type WritingOperationSideEffectPolicy = "none";
export type WritingSkillId = `moshu.${WritingOperationId}`;

export type WritingOperationContextPolicy = {
  readonly includeLocalBeforeChars: number;
  readonly includeLocalAfterChars: number;
};

export type WritingOperationDefinition = {
  readonly id: WritingOperationId;
  readonly label: string;
  readonly description: string;
  readonly skillId: WritingSkillId;
  readonly outputKind: WritingOperationOutputKind;
  readonly sideEffectPolicy: WritingOperationSideEffectPolicy;
  readonly tokenBudgetTaskType: TaskType;
  readonly contextPolicy: WritingOperationContextPolicy;
};

export type WritingSkillMetadata = {
  readonly id: WritingSkillId;
  readonly name: string;
  readonly description: string;
};

export type WritingSkill = WritingSkillMetadata & {
  readonly content: string;
};

export type WritingOperationTarget =
  | {
      readonly kind: "selection";
      readonly chapterId: string;
      readonly selectionHash: string;
      readonly text: string;
    }
  | {
      readonly kind: "inline_text";
      readonly text: string;
    }
  | {
      readonly kind: "chapter";
      readonly chapterId: string;
    }
  | {
      readonly kind: "chapter_range";
      readonly fromOrdinal: number;
      readonly toOrdinal: number;
    };

export type WritingOperationSource = "selection_toolbar" | "chat_tool";

export type WritingOperationRequest = {
  readonly projectId: string;
  readonly source: WritingOperationSource;
  readonly operation: WritingOperationId;
  readonly target: WritingOperationTarget;
  readonly userInstruction: string;
  readonly preset?: TaskPromptPreset | null;
};

export type WritingSupportingContextKind = WritingSupportingContextMetadata["kind"];

export type WritingSupportingContextItem = WritingSupportingContextMetadata;

export type WritingContextPlanMode = WritingContextPlanMetadata["mode"];

export type WritingContextPlan = WritingContextPlanMetadata;

export type BuiltWritingOperationPrompt = {
  readonly messages: readonly OpenRouterMessage[];
  readonly maxCompletionTokens: number;
  readonly temperature: number;
  readonly responseFormat?: OpenRouterResponseFormat;
  readonly reasoning?: OpenRouterReasoningConfig;
  readonly tokenBudget: TokenBudget;
};

export type WritingOperationResult = {
  readonly generatedText: string;
  readonly changeSummary: string | null;
  readonly proofreadIssues: readonly ProofreadIssue[] | null;
  readonly contextPlan: WritingContextPlan;
  readonly truncated?: boolean;
};
