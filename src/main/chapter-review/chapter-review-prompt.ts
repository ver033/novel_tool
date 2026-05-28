import { proofreadIssueCodes } from "../shared/proofread";
import { chapterReviewModelResponseSchema, type ChapterReviewModelResponse } from "../shared/chapter-review";
import type { OpenRouterMessage, OpenRouterResponseFormat } from "../ai/openrouter-client";
import { estimateTextTokens, truncateTextToTokenBudget } from "../ai/token-estimator";
import { buildReasoningConfig } from "../ai/reasoning-budget";
import type { TokenBudget } from "../ai/token-budget";

export type ChapterReviewPromptInput = {
  readonly projectName: string;
  readonly chapterTitle: string;
  readonly chapterOrder: number;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly chapterText: string;
  readonly nearbyContext: string;
  readonly maxCompletionTokens: number;
  readonly tokenBudget?: TokenBudget;
};

export type ChapterReviewPrompt = {
  readonly messages: readonly OpenRouterMessage[];
  readonly responseFormat: OpenRouterResponseFormat;
  readonly temperature: number;
  readonly maxCompletionTokens: number;
  readonly reasoning?: ReturnType<typeof buildReasoningConfig>;
};

const reviewEvidenceSourceValues = ["target", "before_context", "after_context", "memory", "chapter_summary"];

const chapterReviewResponseFormat: OpenRouterResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "chapter_review_result",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "readabilityScore", "aiToneRisk", "issues"],
      properties: {
        summary: { type: "string", minLength: 1, maxLength: 2000 },
        readabilityScore: { type: "integer", minimum: 1, maximum: 5 },
        aiToneRisk: { type: "string", enum: ["none", "low", "medium", "high"] },
        issues: {
          type: "array",
          maxItems: 80,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "code",
              "severity",
              "quote",
              "locationHint",
              "explanation",
              "suggestion",
              "evidence",
              "canAutoApply",
              "needsAuthorJudgment"
            ],
            properties: {
              code: { type: "string", enum: proofreadIssueCodes },
              severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
              quote: { type: "string", minLength: 1, maxLength: 600 },
              locationHint: { type: "string", minLength: 1, maxLength: 300 },
              explanation: { type: "string", minLength: 1, maxLength: 1200 },
              suggestion: { type: "string", minLength: 1, maxLength: 1200 },
              suggestedReplacement: { type: "string", maxLength: 1200 },
              evidence: {
                type: "array",
                maxItems: 8,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["source", "quote", "note"],
                  properties: {
                    source: { type: "string", enum: reviewEvidenceSourceValues },
                    quote: { type: "string", minLength: 1, maxLength: 600 },
                    note: { type: "string", minLength: 1, maxLength: 600 }
                  }
                }
              },
              canAutoApply: { type: "boolean" },
              needsAuthorJudgment: { type: "boolean" }
            }
          }
        }
      }
    }
  }
};

function splitOversizedParagraph(paragraph: string, maxTokens: number): string[] {
  const chunks: string[] = [];
  let remaining = paragraph.trim();
  while (remaining) {
    const truncated = truncateTextToTokenBudget(remaining, maxTokens);
    if (!truncated.text) {
      chunks.push(remaining);
      break;
    }
    chunks.push(truncated.text);
    remaining = remaining.slice(truncated.text.length).trim();
  }
  return chunks;
}

export function splitChapterTextForReview(text: string, maxChunkTokens: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const chunks: string[] = [];
  let current = "";
  for (const paragraph of trimmed.split(/\n{2,}/u).map((item) => item.trim()).filter(Boolean)) {
    if (estimateTextTokens(paragraph) > maxChunkTokens) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = "";
      }
      chunks.push(...splitOversizedParagraph(paragraph, maxChunkTokens));
      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (estimateTextTokens(candidate) > maxChunkTokens && current.trim()) {
      chunks.push(current.trim());
      current = paragraph;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks;
}

export function buildChapterReviewPrompt(input: ChapterReviewPromptInput): ChapterReviewPrompt {
  const chunkLabel = input.chunkCount > 1 ? `分段 ${input.chunkIndex + 1}/${input.chunkCount}` : "全文";
  const messages: readonly OpenRouterMessage[] = [
    {
      role: "system",
      content: [
        "你是中文长篇小说的审稿编辑，不是 AI 文本检测器。",
        "你的任务是帮助作者改进章节质量：发现错别字、病句、表达不顺、重复表达、指代不明、逻辑连续性问题、文风漂移，以及可能让读者感觉机械、空泛、套话化的段落。",
        "硬性规则：",
        "1. 不判断作者是否使用过 AI。",
        "2. 不输出“AI生成概率”“人类概率”。",
        "3. 只指出文本中有具体证据的问题。",
        "4. 如果只是个人审美偏好，不要列为问题。",
        "5. 对网络小说常见节奏、口语化对白、强情绪表达要谨慎，不要为了凑问题而误判。",
        "6. 不改写整章，不自动替作者重写正文。",
        "7. 每条问题必须包含原文 quote、问题类型、严重程度、说明、建议。",
        "8. 没有明确问题时返回空 issues。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `项目名：${input.projectName}`,
        `章节：第 ${input.chapterOrder} 章，${input.chapterTitle}`,
        `审稿范围：${chunkLabel}`,
        "",
        "【邻近上下文】",
        input.nearbyContext.trim() || "（无）",
        "",
        "【章节正文】",
        '"""',
        input.chapterText,
        '"""',
        "",
        "【输出要求】",
        "只输出符合 JSON Schema 的对象。",
        "summary 用中文概括本段/本章的主要质量问题；readabilityScore 为 1-5 的可读性评分；aiToneRisk 只表示文本机械感/套话感风险，不表示作者是否使用 AI。",
        "issues 只列明确、值得作者处理的问题；AI味相关问题必须指向具体 quote，并说明为什么读起来机械、空泛或公式化。"
      ].join("\n")
    }
  ];

  return {
    messages,
    responseFormat: chapterReviewResponseFormat,
    temperature: 0.2,
    maxCompletionTokens: input.maxCompletionTokens,
    reasoning: input.tokenBudget ? buildReasoningConfig(input.tokenBudget, { exclude: true, fallbackEffort: "medium" }) : undefined
  };
}

export function parseChapterReviewModelResponse(content: string): ChapterReviewModelResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenRouter 审稿结果不是合法 JSON。");
  }

  try {
    return chapterReviewModelResponseSchema.parse(parsed);
  } catch (error) {
    throw new Error(`OpenRouter 审稿结果结构无效：${error instanceof Error ? error.message : String(error)}`);
  }
}
