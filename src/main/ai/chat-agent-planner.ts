import { chatAgentPlanSchema, type ChatAgentPlan } from "./chat-agent-types";
import { logDevLlmPrompt } from "./dev-prompt-logger";
import type { OpenRouterMessage, OpenRouterResponseFormat } from "./openrouter-client";
import { OpenRouterClient } from "./openrouter-client";
import type { SettingsService } from "../settings/settings-service";
import type { ChapterSummary } from "../shared/types";

export type ChatPlannerInput = {
  readonly projectId: string;
  readonly message: string;
  readonly currentChapterId?: string;
  readonly selectionText?: string;
  readonly chapters: readonly ChapterSummary[];
};

export type ChatPlannerOptions = {
  readonly signal?: AbortSignal;
};

export type ChatPlanner = {
  readonly plan: (input: ChatPlannerInput, options?: ChatPlannerOptions) => Promise<ChatAgentPlan>;
};

const PLAN_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "moshu_chat_agent_plan",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["intent", "scope", "actions"],
      properties: {
        intent: {
          type: "string",
          enum: ["answer", "summarize", "analyze", "proofread", "rewrite_suggest", "organize"]
        },
        scope: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["type"],
              properties: {
                type: { type: "string", enum: ["current_chapter"] }
              }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["type"],
              properties: {
                type: { type: "string", enum: ["selection"] }
              }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "ordinal"],
              properties: {
                type: { type: "string", enum: ["chapter"] },
                ordinal: { type: "integer", minimum: 1 }
              }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "from", "to"],
              properties: {
                type: { type: "string", enum: ["chapter_range"] },
                from: { type: "integer", minimum: 1 },
                to: { type: "integer", minimum: 1 }
              }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["type"],
              properties: {
                type: { type: "string", enum: ["all_chapters"] }
              }
            }
          ]
        },
        actions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["type"],
            properties: {
              type: { type: "string", enum: ["add_to_scratchpad"] }
            }
          }
        },
        needsClarification: {
          type: "boolean"
        },
        clarificationQuestion: {
          type: "string"
        },
        reason: {
          type: "string"
        }
      }
    }
  }
} satisfies OpenRouterResponseFormat;

function buildPlannerMessages(input: ChatPlannerInput): OpenRouterMessage[] {
  const chapterLines = input.chapters.map((chapter, index) =>
    [
      `${index + 1}. ${chapter.title}`,
      `id=${chapter.id}`,
      `字数=${chapter.wordCount}`,
      input.currentChapterId === chapter.id ? "当前打开" : null
    ]
      .filter(Boolean)
      .join(" | ")
  );
  return [
    {
      role: "system",
      content: [
        "你是本地中文小说写作工具的对话规划器，只输出 JSON。",
        "你不能读取文件，也不能编造章节内容；你只能根据用户问题和章节目录选择上下文范围。",
        "如果用户明确要求保存、加入、放到草稿纸，将 actions 设为 [{\"type\":\"add_to_scratchpad\"}]。",
        "如果用户要求写回正文、替换正文、创建章节，不要生成写回动作；仍然只回答或给建议。",
        "选择范围规则：",
        "- 问到本章、这章、当前内容，选择 current_chapter。",
        "- 问到选中内容、这段，且有 selectionText，选择 selection。",
        "- 问到第 N 章，选择 chapter。",
        "- 问到第 N 到 M 章，选择 chapter_range。",
        "- 问到所有章节、现有所有章节、全书、全文、整本书，选择 all_chapters。",
        "只有无法判断范围时才 needsClarification=true。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `用户问题：${input.message}`,
        input.selectionText ? "当前有选中文本。" : "当前没有选中文本。",
        "章节目录：",
        chapterLines.length > 0 ? chapterLines.join("\n") : "（暂无章节）"
      ].join("\n")
    }
  ];
}

function parsePlanContent(content: string): ChatAgentPlan {
  try {
    return chatAgentPlanSchema.parse(JSON.parse(content));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`AI 对话规划结果无效：${message}`);
  }
}

export class OpenRouterChatPlanner implements ChatPlanner {
  constructor(private readonly settingsService: SettingsService) {}

  async plan(input: ChatPlannerInput, options: ChatPlannerOptions = {}): Promise<ChatAgentPlan> {
    const config = this.settingsService.getOpenRouterConfig();
    const client = new OpenRouterClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      modelName: config.modelName
    });
    const messages = buildPlannerMessages(input);
    logDevLlmPrompt({
      kind: "chat:planner",
      modelName: config.modelName,
      messages,
      meta: {
        projectId: input.projectId,
        currentChapterId: input.currentChapterId,
        chapterCount: input.chapters.length
      },
      params: {
        maxCompletionTokens: 900,
        temperature: 0,
        responseFormat: PLAN_RESPONSE_FORMAT
      }
    });
    const response = await client.createChatCompletion({
      messages,
      maxCompletionTokens: 900,
      temperature: 0,
      responseFormat: PLAN_RESPONSE_FORMAT,
      signal: options.signal
    });
    return parsePlanContent(response.content);
  }
}
