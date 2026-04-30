import type { ChapterRepository } from "../db/repositories/chapter-repo";
import type { SettingsService } from "../settings/settings-service";
import type { AiTaskRecord, TaskPromptPreset } from "../shared/types";
import type { AiGenerationOptions, AiTaskStreamHandlers } from "./ai-task-service";
import { logDevLlmPrompt } from "./dev-prompt-logger";
import {
  OpenRouterClient,
  type OpenRouterChatCompletionInput,
  type OpenRouterChatCompletionResult,
  type OpenRouterStreamHandlers
} from "./openrouter-client";
import { getTokenBudget } from "./token-budget";
import { planWritingOperationContext } from "./writing-context-planner";
import { getWritingOperationDefinition } from "./writing-operation-registry";
import { buildWritingOperationPrompt, parseWritingOperationResponse } from "./writing-operation-prompt";
import { loadWritingSkill } from "./writing-skill-loader";
import type { WritingOperationRequest, WritingOperationResult, WritingOperationTarget } from "./writing-operation-types";

type OpenRouterClientLike = {
  readonly createChatCompletion: (input: OpenRouterChatCompletionInput) => Promise<OpenRouterChatCompletionResult>;
  readonly streamChatCompletion: (
    input: OpenRouterChatCompletionInput,
    handlers?: OpenRouterStreamHandlers
  ) => Promise<OpenRouterChatCompletionResult>;
};

type WritingOperationRunnerOptions = {
  readonly resolveChapterRepo: (projectId: string) => ChapterRepository;
  readonly resolveTaskPreset: (presetId: string | null | undefined, taskType: AiTaskRecord["taskType"]) => TaskPromptPreset | null;
  readonly resolveModelConfig: () => Promise<{ readonly apiKey: string; readonly modelName: string; readonly contextLength: number | null }>;
  readonly createClient?: (config: { readonly apiKey: string; readonly modelName: string }) => OpenRouterClientLike;
};

function taskTarget(task: AiTaskRecord): WritingOperationTarget {
  if (task.selection) {
    return {
      kind: "selection",
      chapterId: task.selection.chapterId,
      selectionHash: task.selection.selectionHash,
      text: task.inputText
    };
  }

  return {
    kind: "inline_text",
    text: task.inputText
  };
}

function buildTruncatedResult(taskType: AiTaskRecord["taskType"], content: string): Omit<WritingOperationResult, "contextPlan"> {
  return {
    generatedText: content.trim(),
    changeSummary: `OpenRouter ${taskType} candidate（结果已截断）`,
    proofreadIssues: null,
    truncated: true
  };
}

function buildContinuationMessages(prompt: { readonly messages: readonly OpenRouterChatCompletionInput["messages"][number][] }, partialText: string): readonly OpenRouterChatCompletionInput["messages"][number][] {
  return [
    ...prompt.messages,
    {
      role: "user",
      content: [
        "上一次输出已被截断。请继续输出同一份候选正文。",
        "不要重复已输出内容，不要解释，不要总结，不要使用建议清单。",
        "只输出从以下已输出候选稿末尾继续的正文。",
        "",
        "【已输出候选稿】",
        partialText.trim()
      ].join("\n")
    }
  ];
}

function stripContinuationDraftLabel(content: string): string {
  return content
    .trim()
    .replace(/^【(?:润色稿|改写稿|扩写稿|续写稿|候选正文)】\s*/u, "")
    .replace(/^(?:润色稿|改写稿|扩写稿|续写稿|候选正文)[:：]\s*/u, "")
    .trim();
}

export class WritingOperationRunner {
  constructor(private readonly options: WritingOperationRunnerOptions) {}

  static fromSettings(settingsService: SettingsService, resolveChapterRepo: (projectId: string) => ChapterRepository): WritingOperationRunner {
    return new WritingOperationRunner({
      resolveChapterRepo,
      resolveTaskPreset: (presetId, taskType) => settingsService.getTaskPromptPresetForTask(presetId, taskType),
      resolveModelConfig: async () => {
        const config = await settingsService.getOpenRouterConfigWithModelMetadata();
        return {
          apiKey: config.apiKey,
          modelName: config.modelName,
          contextLength: config.contextLength
        };
      }
    });
  }

  private createClient(config: { readonly apiKey: string; readonly modelName: string }): OpenRouterClientLike {
    return this.options.createClient?.(config) ?? new OpenRouterClient(config);
  }

  private async buildPromptForRequest(request: WritingOperationRequest) {
    const config = await this.options.resolveModelConfig();
    const operation = getWritingOperationDefinition(request.operation);
    const tokenBudget = getTokenBudget(operation.tokenBudgetTaskType, config.contextLength);
    const contextPlan = planWritingOperationContext({
      projectId: request.projectId,
      operation,
      target: request.target,
      chapterRepo: this.options.resolveChapterRepo(request.projectId),
      tokenBudget
    });
    const prompt = buildWritingOperationPrompt({
      operation,
      skill: loadWritingSkill(operation.skillId),
      contextPlan,
      userInstruction: request.userInstruction,
      preset: request.preset ?? null,
      tokenBudget
    });

    return { config, contextPlan, operation, prompt };
  }

  private async buildPromptForTask(task: AiTaskRecord) {
    return this.buildPromptForRequest({
      projectId: task.projectId,
      source: "selection_toolbar",
      operation: task.taskType,
      target: taskTarget(task),
      userInstruction: task.instruction ?? "",
      preset: this.options.resolveTaskPreset(task.presetId, task.taskType)
    });
  }

  async runRequest(request: WritingOperationRequest, options: AiGenerationOptions = {}): Promise<WritingOperationResult> {
    const { config, contextPlan, operation, prompt } = await this.buildPromptForRequest(request);
    const client = this.createClient(config);
    logDevLlmPrompt({
      kind: `writing-operation:${operation.id}:chat-tool`,
      modelName: config.modelName,
      messages: prompt.messages,
      meta: {
        contextMode: contextPlan.mode,
        operation: request.operation,
        projectId: request.projectId,
        source: request.source
      },
      params: {
        maxCompletionTokens: prompt.maxCompletionTokens,
        reasoning: prompt.reasoning,
        responseFormat: prompt.responseFormat,
        temperature: prompt.temperature
      }
    });

    const response = await client.streamChatCompletion(
      {
        messages: prompt.messages,
        maxCompletionTokens: prompt.maxCompletionTokens,
        temperature: prompt.temperature,
        responseFormat: prompt.responseFormat,
        reasoning: prompt.reasoning,
        signal: options.signal
      },
      {}
    );
    const parsed = response.truncated ? buildTruncatedResult(operation.id, response.content) : parseWritingOperationResponse(operation, response.content);

    return {
      ...parsed,
      contextPlan,
      truncated: response.truncated
    };
  }

  async continueStream(
    task: AiTaskRecord,
    partialText: string,
    handlers: AiTaskStreamHandlers,
    options: AiGenerationOptions = {}
  ): Promise<WritingOperationResult> {
    const { config, contextPlan, operation, prompt } = await this.buildPromptForTask(task);
    if (operation.outputKind !== "candidate_text") {
      throw new Error("校对结果不能继续生成，请缩小校对范围后重试。");
    }
    const client = this.createClient(config);
    const messages = buildContinuationMessages(prompt, partialText);
    handlers.onContext?.({
      requestId: "",
      estimatedInputTokens: contextPlan.estimatedInputTokens,
      maxInputTokens: contextPlan.maxInputTokens,
      maxOutputTokens: prompt.maxCompletionTokens,
      modelContextTokens: config.contextLength,
      modelName: config.modelName,
      contextMode: contextPlan.mode,
      scopeLabel: `写作操作：${operation.label}`
    });
    logDevLlmPrompt({
      kind: `writing-operation:${operation.id}:continue`,
      modelName: config.modelName,
      messages,
      meta: {
        chapterId: task.chapterId,
        contextMode: contextPlan.mode,
        projectId: task.projectId,
        requestMode: "stream",
        taskId: task.id,
        taskType: task.taskType
      },
      params: {
        maxCompletionTokens: prompt.maxCompletionTokens,
        reasoning: prompt.reasoning,
        responseFormat: undefined,
        temperature: prompt.temperature
      }
    });

    const response = await client.streamChatCompletion(
      {
        messages,
        maxCompletionTokens: prompt.maxCompletionTokens,
        temperature: prompt.temperature,
        reasoning: prompt.reasoning,
        signal: options.signal
      },
      {
        onToken(token) {
          handlers.onChunk?.({ requestId: "", content: token });
        }
      }
    );
    const continuedText = stripContinuationDraftLabel(response.content);
    if (!continuedText) {
      throw new Error("OpenRouter 返回了空内容。");
    }

    return {
      generatedText: `${partialText}${continuedText}`,
      changeSummary: response.truncated ? `OpenRouter ${operation.id} continuation（结果已截断）` : `OpenRouter ${operation.id} continuation`,
      proofreadIssues: null,
      contextPlan,
      truncated: response.truncated
    };
  }

  async generate(task: AiTaskRecord): Promise<WritingOperationResult> {
    const { config, contextPlan, operation, prompt } = await this.buildPromptForTask(task);
    const client = this.createClient(config);
    logDevLlmPrompt({
      kind: `writing-operation:${operation.id}`,
      modelName: config.modelName,
      messages: prompt.messages,
      meta: {
        chapterId: task.chapterId,
        contextMode: contextPlan.mode,
        projectId: task.projectId,
        taskId: task.id,
        taskType: task.taskType
      },
      params: {
        maxCompletionTokens: prompt.maxCompletionTokens,
        reasoning: prompt.reasoning,
        responseFormat: prompt.responseFormat,
        temperature: prompt.temperature
      }
    });

    const response = await client.createChatCompletion({
      messages: prompt.messages,
      maxCompletionTokens: prompt.maxCompletionTokens,
      temperature: prompt.temperature,
      responseFormat: prompt.responseFormat,
      reasoning: prompt.reasoning
    });
    const parsed = response.truncated ? buildTruncatedResult(task.taskType, response.content) : parseWritingOperationResponse(operation, response.content);

    return {
      ...parsed,
      contextPlan,
      truncated: response.truncated
    };
  }

  async generateStream(
    task: AiTaskRecord,
    handlers: AiTaskStreamHandlers,
    options: AiGenerationOptions = {}
  ): Promise<WritingOperationResult> {
    const { config, contextPlan, operation, prompt } = await this.buildPromptForTask(task);
    const client = this.createClient(config);
    handlers.onContext?.({
      requestId: "",
      estimatedInputTokens: contextPlan.estimatedInputTokens,
      maxInputTokens: contextPlan.maxInputTokens,
      maxOutputTokens: prompt.maxCompletionTokens,
      modelContextTokens: config.contextLength,
      modelName: config.modelName,
      contextMode: contextPlan.mode,
      scopeLabel: `写作操作：${operation.label}`
    });
    logDevLlmPrompt({
      kind: `writing-operation:${operation.id}:stream`,
      modelName: config.modelName,
      messages: prompt.messages,
      meta: {
        chapterId: task.chapterId,
        contextMode: contextPlan.mode,
        projectId: task.projectId,
        requestMode: "stream",
        taskId: task.id,
        taskType: task.taskType
      },
      params: {
        maxCompletionTokens: prompt.maxCompletionTokens,
        reasoning: prompt.reasoning,
        responseFormat: prompt.responseFormat,
        temperature: prompt.temperature
      }
    });

    const response = await client.streamChatCompletion(
      {
        messages: prompt.messages,
        maxCompletionTokens: prompt.maxCompletionTokens,
        temperature: prompt.temperature,
        responseFormat: prompt.responseFormat,
        reasoning: prompt.reasoning,
        signal: options.signal
      },
      {
        onToken(token) {
          if (operation.outputKind === "candidate_text") {
            handlers.onChunk?.({ requestId: "", content: token });
          }
        }
      }
    );
    const parsed = response.truncated ? buildTruncatedResult(task.taskType, response.content) : parseWritingOperationResponse(operation, response.content);

    return {
      ...parsed,
      contextPlan,
      truncated: response.truncated
    };
  }
}
