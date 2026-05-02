import { proofreadIssueTypes, proofreadResultSchema, type ProofreadIssue } from "../shared/proofread";
import type { AiTaskRecord, TaskPromptPreset } from "../shared/types";
import type { OpenRouterMessage, OpenRouterReasoningConfig, OpenRouterResponseFormat } from "./openrouter-client";
import { buildReasoningConfig } from "./reasoning-budget";
import { estimateMessagesTokens } from "./token-estimator";
import { getTokenBudget } from "./token-budget";

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
  readonly proofreadIssues?: readonly ProofreadIssue[];
};

type PromptBuildContext = {
  readonly taskPreset?: TaskPromptPreset | null;
};

const actionableProofreadIssueTypes = proofreadIssueTypes.filter((type) => type !== "无问题");

const proofreadJsonSchema = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: actionableProofreadIssueTypes,
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
      "重点检查错别字、标点、病句、表达不顺、对白不自然、重复表达、指代不明，以及时间线、空间移动、人物状态、人物认知、道具状态、设定规则、因果动机、视角越界和伏笔状态问题。",
      "不要改变剧情事实、人物关系、时间地点、叙事视角。",
      '如果没有明确问题，只输出 {"issues":[]}',
      "如果存在问题，最多返回 20 个最重要的问题。",
      "逻辑和连续性问题只作为建议列出，不要自动应用。",
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

function userPromptFor(task: AiTaskRecord, context: PromptBuildContext): string {
  const customInstruction = task.instruction?.trim() || "无";
  const taskLabel = {
    polish: "润色",
    expand: "扩写",
    proofread: "校对",
    continue: "续写"
  }[task.taskType];
  const presetLines = context.taskPreset
    ? [`任务预设：${context.taskPreset.name}`, `预设要求：${context.taskPreset.instruction}`]
    : [];

  return [
    `任务：${taskLabel}`,
    "通用硬性约束：",
    "1. 不改变剧情事实。",
    "2. 不改变人物关系。",
    "3. 不改变时间地点。",
    "4. 不改变叙事视角。",
    "5. 不新增关键剧情结论。",
    ...presetLines,
    `本次要求：${customInstruction}`,
    "文本：",
    task.inputText
  ].join("\n");
}

function taskLabelFor(taskType: AiTaskRecord["taskType"]): string {
  return {
    polish: "润色",
    expand: "扩写",
    proofread: "校对",
    continue: "续写"
  }[taskType];
}

function assertWithinInputBudget(task: AiTaskRecord, messages: readonly OpenRouterMessage[]): void {
  const budget = getTokenBudget(task.taskType);
  const estimatedTokens = estimateMessagesTokens(messages);
  if (estimatedTokens <= budget.maxInputTokens) {
    return;
  }

  throw new Error(
    `选区太长，${taskLabelFor(task.taskType)}任务预计输入约 ${estimatedTokens} tokens，超过上限 ${budget.maxInputTokens}。请缩短选区后重试。`
  );
}

export function buildAiTaskPrompt(task: AiTaskRecord, context: PromptBuildContext = {}): BuiltPrompt {
  const budget = getTokenBudget(task.taskType);
  const base = {
    messages: [
      { role: "system", content: systemPromptFor(task) },
      { role: "user", content: userPromptFor(task, context) }
    ] satisfies readonly OpenRouterMessage[]
  };
  assertWithinInputBudget(task, base.messages);

  if (task.taskType === "proofread") {
    return {
      ...base,
      maxCompletionTokens: budget.maxOutputTokens,
      temperature: 0.2,
      reasoning: buildReasoningConfig(budget, { exclude: true, fallbackEffort: "medium" }),
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
    maxCompletionTokens: budget.maxOutputTokens,
    temperature: task.taskType === "polish" ? 0.45 : 0.65,
    reasoning: buildReasoningConfig(budget, { exclude: true, fallbackEffort: "medium" })
  };
}

export function buildAiTaskContinuationPrompt(task: AiTaskRecord, partialText: string, context: PromptBuildContext = {}): BuiltPrompt {
  if (task.taskType === "proofread") {
    throw new Error("校对任务不支持继续生成，请缩短选区后重新校对。");
  }

  const budget = getTokenBudget(task.taskType);
  const customInstruction = task.instruction?.trim() || "无";
  const presetLines = context.taskPreset
    ? [`任务预设：${context.taskPreset.name}`, `预设要求：${context.taskPreset.instruction}`]
    : [];
  const messages = [
    { role: "system", content: systemPromptFor(task) },
    {
      role: "user",
      content: [
        `任务：继续生成被截断的${taskLabelFor(task.taskType)}结果`,
        "通用硬性约束：",
        "1. 不改变剧情事实。",
        "2. 不改变人物关系。",
        "3. 不改变时间地点。",
        "4. 不改变叙事视角。",
        "5. 不重复已生成部分。",
        ...presetLines,
        `本次要求：${customInstruction}`,
        "原始文本：",
        task.inputText,
        "已生成部分：",
        partialText,
        "请只输出紧接在已生成部分之后的后续正文，不要解释。"
      ].join("\n")
    }
  ] satisfies readonly OpenRouterMessage[];
  assertWithinInputBudget(task, messages);

  return {
    messages,
    maxCompletionTokens: budget.maxOutputTokens,
    temperature: task.taskType === "polish" ? 0.45 : 0.65,
    reasoning: buildReasoningConfig(budget, { exclude: true, fallbackEffort: "medium" })
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
  const proofreadIssues = result.issues.filter((item) => item.type !== "无问题");

  if (proofreadIssues.length === 0) {
    return {
      generatedText: "",
      changeSummary: "无问题",
      proofreadIssues: []
    };
  }

  return {
    generatedText: "",
    changeSummary: `发现 ${proofreadIssues.length} 个问题`,
    proofreadIssues
  };
}
