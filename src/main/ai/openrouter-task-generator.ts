import type { AiTaskRecord } from "../shared/types";
import type { AiTaskGenerationResult, AiTaskGenerator, AiTaskStreamHandlers } from "./ai-task-service";
import { OpenRouterClient } from "./openrouter-client";
import { buildAiTaskPrompt, parseProofreadResponse } from "./prompt-builder";
import { SettingsService } from "../settings/settings-service";

function trimGeneratedText(task: AiTaskRecord, content: string): AiTaskGenerationResult {
  const generatedText = content.trim();
  if (!generatedText) {
    throw new Error("OpenRouter 返回了空内容。");
  }

  return {
    generatedText,
    changeSummary: `OpenRouter ${task.taskType} candidate`
  };
}

export class OpenRouterTaskGenerator implements AiTaskGenerator {
  constructor(private readonly settingsService: SettingsService) {}

  async generate(task: AiTaskRecord): Promise<AiTaskGenerationResult> {
    const config = this.settingsService.getOpenRouterConfig();
    const prompt = buildAiTaskPrompt(task);
    const client = new OpenRouterClient({
      apiKey: config.apiKey,
      modelName: config.modelName
    });

    const result = await client.createChatCompletion({
      messages: prompt.messages,
      maxCompletionTokens: prompt.maxCompletionTokens,
      temperature: prompt.temperature,
      responseFormat: prompt.responseFormat,
      reasoning: prompt.reasoning
    });

    if (task.taskType === "proofread") {
      return parseProofreadResponse(result.content);
    }

    return trimGeneratedText(task, result.content);
  }

  async generateStream(task: AiTaskRecord, handlers: AiTaskStreamHandlers): Promise<AiTaskGenerationResult> {
    const config = this.settingsService.getOpenRouterConfig();
    const prompt = buildAiTaskPrompt(task);
    const client = new OpenRouterClient({
      apiKey: config.apiKey,
      modelName: config.modelName
    });

    const result = await client.streamChatCompletion(
      {
        messages: prompt.messages,
        maxCompletionTokens: prompt.maxCompletionTokens,
        temperature: prompt.temperature,
        responseFormat: prompt.responseFormat,
        reasoning: prompt.reasoning
      },
      {
        onToken(token) {
          handlers.onChunk?.({ requestId: "", content: token });
        }
      }
    );

    if (task.taskType === "proofread") {
      return parseProofreadResponse(result.content);
    }

    return trimGeneratedText(task, result.content);
  }
}
