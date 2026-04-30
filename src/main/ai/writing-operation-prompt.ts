import { proofreadIssueTypes, proofreadResultSchema } from "../shared/proofread";
import type { TaskPromptPreset } from "../shared/types";
import type { OpenRouterMessage, OpenRouterReasoningConfig, OpenRouterResponseFormat } from "./openrouter-client";
import type { TokenBudget } from "./token-budget";
import type {
  BuiltWritingOperationPrompt,
  WritingContextPlan,
  WritingOperationDefinition,
  WritingOperationResult,
  WritingSkill
} from "./writing-operation-types";

type BuildWritingOperationPromptInput = {
  readonly operation: WritingOperationDefinition;
  readonly skill: WritingSkill;
  readonly contextPlan: WritingContextPlan;
  readonly userInstruction: string;
  readonly preset: TaskPromptPreset | null;
  readonly tokenBudget: TokenBudget;
};

const candidateReasoning: OpenRouterReasoningConfig = {
  effort: "high",
  exclude: true
};

const proofreadReasoning: OpenRouterReasoningConfig = {
  effort: "medium",
  exclude: true
};

const actionableProofreadIssueTypes = proofreadIssueTypes.filter((type) => type !== "无问题");

const proofreadResponseFormat: OpenRouterResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "proofread_result",
    strict: true,
    schema: {
      type: "object",
      properties: {
        issues: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: actionableProofreadIssueTypes },
              quote: { type: "string" },
              suggestion: { type: "string" },
              reason: { type: "string" }
            },
            required: ["type", "quote", "suggestion", "reason"],
            additionalProperties: false
          }
        }
      },
      required: ["issues"],
      additionalProperties: false
    }
  }
};

function formatSupportingContext(contextPlan: WritingContextPlan): string {
  if (contextPlan.supportingContext.length === 0) {
    return "（无）";
  }

  return contextPlan.supportingContext
    .map((item, index) => [`[${index + 1}] ${item.label}`, `用途：${item.reason}`, item.content].join("\n"))
    .join("\n\n");
}

function buildMessages(input: BuildWritingOperationPromptInput): readonly OpenRouterMessage[] {
  const presetLines = input.preset
    ? [`任务预设：${input.preset.name}`, `预设要求：${input.preset.instruction}`]
    : ["任务预设：无"];
  const instruction = input.userInstruction.trim() || "无";

  return [
    {
      role: "system",
      content: [
        "你是墨枢的中文小说写作操作 agent。",
        "你会收到一个固定写作操作、目标文本和参考上下文。",
        "硬性规则：参考上下文不能作为改写目标，不能把参考上下文混入输出，不能自动保存草稿纸，不能声称已经写回正文。",
        input.skill.content
      ].join("\n\n")
    },
    {
      role: "user",
      content: [
        `写作操作：${input.operation.label}`,
        ...presetLines,
        `本次要求：${instruction}`,
        "",
        "【目标文本】",
        input.contextPlan.targetText,
        "",
        "【参考上下文】",
        formatSupportingContext(input.contextPlan),
        "",
        "【输出要求】",
        input.operation.outputKind === "proofread_issues"
          ? '只输出符合 JSON Schema 的校对结果；没有明确问题时输出 {"issues":[]}。'
          : "只输出可直接使用的候选正文，不要解释，不要建议清单。"
      ].join("\n")
    }
  ] satisfies readonly OpenRouterMessage[];
}

export function buildWritingOperationPrompt(input: BuildWritingOperationPromptInput): BuiltWritingOperationPrompt {
  return {
    messages: buildMessages(input),
    maxCompletionTokens: input.tokenBudget.maxOutputTokens,
    temperature: input.operation.id === "polish" ? 0.45 : input.operation.id === "proofread" ? 0.2 : 0.65,
    responseFormat: input.operation.outputKind === "proofread_issues" ? proofreadResponseFormat : undefined,
    reasoning: input.operation.outputKind === "proofread_issues" ? proofreadReasoning : candidateReasoning,
    tokenBudget: input.tokenBudget
  };
}

function looksAdviceOnly(content: string): boolean {
  const compact = content.trim().slice(0, 160);
  return /^(以下是|这里是|我已经|建议|润色建议|修改建议|核心润色|改进点)/.test(compact) || /请告诉我你的偏好/.test(content);
}

function stripCandidateDraftLabel(content: string): string {
  return content
    .trim()
    .replace(/^【(?:润色稿|改写稿|扩写稿|续写稿|候选正文)】\s*/u, "")
    .replace(/^(?:润色稿|改写稿|扩写稿|续写稿|候选正文|润色版本|扩写版本|续写版本)[:：]\s*/u, "")
    .replace(/^以下是(?:润色后|扩写后|续写后|改写后)?(?:的)?(?:候选)?正文[:：]\s*/u, "")
    .trim();
}

export function parseWritingOperationResponse(
  operation: WritingOperationDefinition,
  content: string
): Omit<WritingOperationResult, "contextPlan"> {
  if (operation.outputKind === "proofread_issues") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("OpenRouter 校对结果不是合法 JSON。");
    }

    const result = proofreadResultSchema.parse(parsed);
    const proofreadIssues = result.issues.filter((issue) => issue.type !== "无问题");
    return {
      generatedText: "",
      changeSummary: proofreadIssues.length === 0 ? "无问题" : `发现 ${proofreadIssues.length} 个问题`,
      proofreadIssues
    };
  }

  const generatedText = stripCandidateDraftLabel(content);
  if (!generatedText || looksAdviceOnly(generatedText)) {
    throw new Error("AI 没有返回可直接使用的候选正文。请重试，或缩小目标文本。");
  }

  return {
    generatedText,
    changeSummary: `OpenRouter ${operation.id} candidate`,
    proofreadIssues: null
  };
}
