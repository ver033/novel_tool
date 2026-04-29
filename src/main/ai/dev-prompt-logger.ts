import type { OpenRouterMessage, OpenRouterReasoningConfig, OpenRouterResponseFormat } from "./openrouter-client";

type PromptLogEnv = {
  readonly NODE_ENV?: string;
  readonly NOVEL_TOOL_LOG_LLM_PROMPTS?: string;
};

type PromptLogParams = {
  readonly maxCompletionTokens?: number;
  readonly temperature?: number;
  readonly responseFormat?: OpenRouterResponseFormat;
  readonly reasoning?: OpenRouterReasoningConfig;
};

type PromptLogMeta = Record<string, string | number | boolean | null | undefined>;

type PromptLogger = {
  readonly info: (message: string) => void;
};

type DevLlmPromptLogInput = {
  readonly kind: string;
  readonly modelName: string;
  readonly messages: readonly OpenRouterMessage[];
  readonly meta?: PromptLogMeta;
  readonly params?: PromptLogParams;
};

export function shouldLogDevLlmPrompt(env: PromptLogEnv = process.env): boolean {
  if (env.NOVEL_TOOL_LOG_LLM_PROMPTS === "0") {
    return false;
  }

  return env.NODE_ENV === "development" || env.NOVEL_TOOL_LOG_LLM_PROMPTS === "1";
}

function stringifyBlock(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatMessages(messages: readonly OpenRouterMessage[]): string {
  return messages
    .map((message, index) => `${index + 1}. ${message.role}:\n${message.content}`)
    .join("\n\n");
}

export function logDevLlmPrompt(
  input: DevLlmPromptLogInput,
  logger: PromptLogger = console,
  env: PromptLogEnv = process.env
): void {
  if (!shouldLogDevLlmPrompt(env)) {
    return;
  }

  logger.info(
    [
      `[MoShu Dev LLM Prompt] ${input.kind}`,
      `model: ${input.modelName}`,
      `meta: ${stringifyBlock(input.meta ?? {})}`,
      `params: ${stringifyBlock(input.params ?? {})}`,
      "messages:",
      formatMessages(input.messages)
    ].join("\n")
  );
}
