import { z } from "zod";
import type { AiTaskRecord } from "../shared/types";
import type { OpenRouterMessage, OpenRouterReasoningConfig, OpenRouterResponseFormat } from "./openrouter-client";

type BuiltPrompt = {
  readonly messages: readonly OpenRouterMessage[];
  readonly maxCompletionTokens: number;
  readonly temperature: number;
  readonly responseFormat?: OpenRouterResponseFormat;
  readonly reasoning?: OpenRouterReasoningConfig;
};

type GeneratedCandidateText = {
  readonly generatedText: string;
  readonly changeSummary: string | null;
};

const defaultReasoning: OpenRouterReasoningConfig = {
  effort: "high",
  exclude: true
};

const proofreadReasoning: OpenRouterReasoningConfig = {
  effort: "medium",
  exclude: true
};

const maxCompletionTokensByTask: Record<AiTaskRecord["taskType"], number> = {
  polish: 4096,
  expand: 4096,
  proofread: 4096,
  continue: 4096
};

const proofreadIssueSchema = z.object({
  type: z.enum(["错别字", "标点", "病句", "表达不顺", "对白不自然", "重复表达", "无问题"]),
  quote: z.string(),
  suggestion: z.string(),
  reason: z.string()
});

const proofreadResultSchema = z.object({
  issues: z.array(proofreadIssueSchema).max(3)
});

const proofreadJsonSchema = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["错别字", "标点", "病句", "表达不顺", "对白不自然", "重复表达", "无问题"],
            description: "问题类型"
          },
          quote: {
            type: "string",
            description: "原文中的问题片段，没有问题时为空字符串"
          },
          suggestion: {
            type: "string",
            description: "建议修改后的文本，没有问题时为空字符串"
          },
          reason: {
            type: "string",
            description: "简短原因"
          }
        },
        required: ["type", "quote", "suggestion", "reason"],
        additionalProperties: false
      }
    }
  },
  required: ["issues"],
  additionalProperties: false
};

function systemPromptFor(task: AiTaskRecord): string {
  if (task.taskType === "proofread") {
    return [
      "你是中文小说校对助手。",
      "你只检查文本，不重写整段正文。",
      "重点检查错别字、标点、病句、表达不顺、对白不自然和重复表达。",
      "不要改变剧情事实、人物关系、时间地点、叙事视角。",
      '如果没有明确问题，只输出 {"issues":[{"type":"无问题","quote":"","suggestion":"","reason":"未发现明显问题"}]}',
      "如果存在问题，最多返回 3 个最重要的问题。",
      "必须输出符合 JSON Schema 的结果。"
    ].join("\n");
  }

  if (task.taskType === "expand") {
    return [
      "你是中文小说扩写助手。",
      "你擅长补环境、动作、心理、对白和转场，但不会为了变长而灌水。",
      "必须保留原有剧情方向，不改变人物关系、时间地点、叙事视角和已经发生的动作事实。",
      "文风应贴近原文，避免解释腔和模板化 AI 句式。",
      "输出只包含扩写后的正文，不要解释。"
    ].join("\n");
  }

  if (task.taskType === "continue") {
    return [
      "你是中文小说续写助手。",
      "你要承接给定文本，继续写下一小段或下一小场景。",
      "不得跳视角，不得突然改设定，不得提前替作者决定大剧情。",
      "保持人物动机、场景压力和原文节奏。",
      "输出只包含续写正文，不要解释。"
    ].join("\n");
  }

  return [
    "你是中文小说润色助手。",
    "你的目标是让语言更顺滑、更有画面感，同时保留作者原本的叙事意图。",
    "必须不改变剧情事实、人物关系、时间地点、叙事视角和关键信息。",
    "避免堆砌辞藻、解释腔、假深刻和模板化 AI 句式。",
    "输出只包含润色后的正文，不要解释。"
  ].join("\n");
}

function userPromptFor(task: AiTaskRecord): string {
  const customInstruction = task.instruction?.trim() || "无";
  const taskLabel = {
    polish: "润色",
    expand: "扩写",
    proofread: "校对",
    continue: "续写"
  }[task.taskType];

  return [
    `任务：${taskLabel}`,
    "通用硬性约束：",
    "1. 不改变剧情事实。",
    "2. 不改变人物关系。",
    "3. 不改变时间地点。",
    "4. 不改变叙事视角。",
    "5. 不新增关键剧情结论。",
    `额外要求：${customInstruction}`,
    "文本：",
    task.inputText
  ].join("\n");
}

export function buildAiTaskPrompt(task: AiTaskRecord): BuiltPrompt {
  const base = {
    messages: [
      { role: "system", content: systemPromptFor(task) },
      { role: "user", content: userPromptFor(task) }
    ] satisfies readonly OpenRouterMessage[]
  };

  if (task.taskType === "proofread") {
    return {
      ...base,
      maxCompletionTokens: maxCompletionTokensByTask.proofread,
      temperature: 0.2,
      reasoning: proofreadReasoning,
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "proofread_result",
          strict: true,
          schema: proofreadJsonSchema
        }
      }
    };
  }

  return {
    ...base,
    maxCompletionTokens: maxCompletionTokensByTask[task.taskType],
    temperature: task.taskType === "polish" ? 0.45 : 0.65,
    reasoning: defaultReasoning
  };
}

export function parseProofreadResponse(content: string): GeneratedCandidateText {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenRouter 校对结果不是合法 JSON。");
  }

  const result = proofreadResultSchema.parse(parsed);
  const issue = result.issues.find((item) => item.type !== "无问题") ?? result.issues[0];

  if (!issue || issue.type === "无问题") {
    return {
      generatedText: "",
      changeSummary: "无问题"
    };
  }

  return {
    generatedText: issue.suggestion,
    changeSummary: `${issue.type}：${issue.reason}`
  };
}
