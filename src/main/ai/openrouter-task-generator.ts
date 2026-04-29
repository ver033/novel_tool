import type { AiTaskRecord } from "../shared/types";
import type { AiGenerationOptions, AiTaskGenerationResult, AiTaskGenerator, AiTaskStreamHandlers } from "./ai-task-service";
import { logDevLlmPrompt } from "./dev-prompt-logger";
import { OpenRouterClient } from "./openrouter-client";
import { buildAiTaskContinuationPrompt, buildAiTaskPrompt, parseProofreadResponse } from "./prompt-builder";
import { SettingsService } from "../settings/settings-service";

function trimGeneratedText(task: AiTaskRecord, content: string, truncated = false): AiTaskGenerationResult {
  const generatedText = content.trim();
  if (!generatedText) {
    throw new Error("OpenRouter 返回了空内容。");
  }

  return {
    generatedText,
    changeSummary: truncated ? `OpenRouter ${task.taskType} candidate（结果已截断）` : `OpenRouter ${task.taskType} candidate`,
    truncated
  };
}

export class OpenRouterTaskGenerator implements AiTaskGenerator {
  constructor(private readonly settingsService: SettingsService) {}

  async generate(task: AiTaskRecord): Promise<AiTaskGenerationResult> {
    const config = this.settingsService.getOpenRouterConfig();
    const taskPreset = this.settingsService.getTaskPromptPresetForTask(task.presetId, task.taskType);
    const prompt = buildAiTaskPrompt(task, { taskPreset });
    const client = new OpenRouterClient({
      apiKey: config.apiKey,
      modelName: config.modelName
    });
    logDevLlmPrompt({
      kind: `task:${task.taskType}`,
      modelName: config.modelName,
      messages: prompt.messages,
      meta: {
        chapterId: task.chapterId,
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

    const result = await client.createChatCompletion({
      messages: prompt.messages,
      maxCompletionTokens: prompt.maxCompletionTokens,
      temperature: prompt.temperature,
      responseFormat: prompt.responseFormat,
      reasoning: prompt.reasoning
    });

    if (result.truncated) {
      return {
        generatedText: result.content.trim(),
        changeSummary: "结果已截断",
        truncated: true
      };
    }

    if (task.taskType === "proofread") {
      return parseProofreadResponse(result.content);
    }

    return trimGeneratedText(task, result.content);
  }

  async generateStream(task: AiTaskRecord, handlers: AiTaskStreamHandlers, options: AiGenerationOptions = {}): Promise<AiTaskGenerationResult> {
    const config = this.settingsService.getOpenRouterConfig();
    const taskPreset = this.settingsService.getTaskPromptPresetForTask(task.presetId, task.taskType);
    const prompt = buildAiTaskPrompt(task, { taskPreset });
    const client = new OpenRouterClient({
      apiKey: config.apiKey,
      modelName: config.modelName
    });
    logDevLlmPrompt({
      kind: `task:${task.taskType}`,
      modelName: config.modelName,
      messages: prompt.messages,
      meta: {
        chapterId: task.chapterId,
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

    const result = await client.streamChatCompletion(
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
          handlers.onChunk?.({ requestId: "", content: token });
        }
      }
    );

    if (result.truncated) {
      return {
        generatedText: result.content.trim(),
        changeSummary: "结果已截断",
        truncated: true
      };
    }

    if (task.taskType === "proofread") {
      return parseProofreadResponse(result.content);
    }

    return trimGeneratedText(task, result.content, result.truncated);
  }

  async continueStream(
    task: AiTaskRecord,
    partialText: string,
    handlers: AiTaskStreamHandlers,
    options: AiGenerationOptions = {}
  ): Promise<AiTaskGenerationResult> {
    const config = this.settingsService.getOpenRouterConfig();
    const taskPreset = this.settingsService.getTaskPromptPresetForTask(task.presetId, task.taskType);
    const prompt = buildAiTaskContinuationPrompt(task, partialText, { taskPreset });
    const client = new OpenRouterClient({
      apiKey: config.apiKey,
      modelName: config.modelName
    });
    logDevLlmPrompt({
      kind: `task:${task.taskType}:continue`,
      modelName: config.modelName,
      messages: prompt.messages,
      meta: {
        chapterId: task.chapterId,
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

    const result = await client.streamChatCompletion(
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
          handlers.onChunk?.({ requestId: "", content: token });
        }
      }
    );
    const continuedText = result.content.trim();
    if (!continuedText) {
      throw new Error("OpenRouter 返回了空内容。");
    }

    return {
      generatedText: `${partialText}${continuedText}`,
      changeSummary: result.truncated ? `OpenRouter ${task.taskType} continuation（结果已截断）` : `OpenRouter ${task.taskType} continuation`,
      truncated: result.truncated
    };
  }
}
