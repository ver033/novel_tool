import axios from "axios";
import { StringDecoder } from "node:string_decoder";
import type { OpenRouterModelSummary } from "../shared/types";
import { parseOpenRouterSsePayload, type OpenRouterStreamEvent } from "./openrouter-stream-parser";

export type OpenRouterToolCall = {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
};

export type OpenRouterToolDefinition = {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: object;
  };
};

export type OpenRouterMessage =
  | {
      readonly role: "system" | "user";
      readonly content: string;
    }
  | {
      readonly role: "assistant";
      readonly content: string | null;
      readonly tool_calls?: readonly unknown[];
    }
  | {
      readonly role: "tool";
      readonly tool_call_id: string;
      readonly name?: string;
      readonly content: string;
    };

export type OpenRouterResponseFormat =
  | { readonly type: "json_object" }
  | {
      readonly type: "json_schema";
      readonly json_schema: {
        readonly name: string;
        readonly strict?: boolean;
        readonly schema: object;
      };
    };

export type OpenRouterReasoningConfig = {
  readonly effort?: "xhigh" | "high" | "medium" | "low" | "minimal" | "none";
  readonly max_tokens?: number;
  readonly exclude?: boolean;
  readonly enabled?: boolean;
};

export type OpenRouterHttpRequest = {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
  readonly signal?: AbortSignal;
};

export type OpenRouterHttpGetRequest = {
  readonly url: string;
};

export type OpenRouterHttpStream = AsyncIterable<string | Buffer> | Iterable<string | Buffer>;

export type OpenRouterClientOptions = {
  readonly apiKey: string;
  readonly modelName: string;
  readonly httpPost?: (request: OpenRouterHttpRequest) => Promise<unknown>;
  readonly httpStreamPost?: (request: OpenRouterHttpRequest) => Promise<OpenRouterHttpStream>;
};

export type OpenRouterChatCompletionInput = {
  readonly messages: readonly OpenRouterMessage[];
  readonly maxCompletionTokens?: number;
  readonly temperature?: number;
  readonly responseFormat?: OpenRouterResponseFormat;
  readonly reasoning?: OpenRouterReasoningConfig;
  readonly tools?: readonly OpenRouterToolDefinition[];
  readonly toolChoice?: "auto" | "none";
  readonly parallelToolCalls?: boolean;
  readonly allowEmptyContent?: boolean;
  readonly signal?: AbortSignal;
};

export type OpenRouterChatCompletionResult = {
  readonly content: string;
  readonly reasoning?: string;
  readonly toolCalls?: readonly OpenRouterToolCall[];
  readonly truncated: boolean;
};

export type OpenRouterStreamHandlers = {
  readonly onToken?: (token: string) => void;
  readonly onReasoning?: (token: string) => void;
};

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models?output_modalities=text&supported_parameters=tools";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function redactSecrets(message: string, apiKey: string): string {
  return message
    .replaceAll(apiKey, "[REDACTED]")
    .replace(/sk-or-v1-[A-Za-z0-9._-]+/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]");
}

function extractProviderMessage(error: unknown): { readonly status?: number; readonly message: string } {
  if (!isObject(error)) {
    return { message: String(error) };
  }

  const response = error.response;
  if (isObject(response)) {
    const status = typeof response.status === "number" ? response.status : undefined;
    const data = response.data;
    if (isObject(data)) {
      const providerError = data.error;
      if (isObject(providerError) && typeof providerError.message === "string") {
        return { status, message: withProviderMetadata(providerError.message, providerError.metadata) };
      }
      if (typeof data.message === "string") {
        return { status, message: data.message };
      }
    }
    return { status, message: "provider returned an error" };
  }

  return { message: error instanceof Error ? error.message : String(error) };
}

function extractRawProviderMessage(raw: unknown): string | null {
  if (typeof raw === "string") {
    return raw;
  }
  if (!isObject(raw)) {
    return null;
  }

  const rawError = raw.error;
  if (isObject(rawError) && typeof rawError.message === "string") {
    return rawError.message;
  }
  if (typeof raw.message === "string") {
    return raw.message;
  }
  if (typeof raw.detail === "string") {
    return raw.detail;
  }

  return null;
}

function withProviderMetadata(message: string, metadata: unknown): string {
  if (!isObject(metadata)) {
    return message;
  }

  const details: string[] = [];
  if (typeof metadata.provider_name === "string") {
    details.push(`Provider: ${metadata.provider_name}`);
  }

  const rawMessage = extractRawProviderMessage(metadata.raw);
  if (rawMessage) {
    details.push(rawMessage);
  }

  return details.length > 0 ? `${message}；${details.join("；")}` : message;
}

function formatOpenRouterRequestError(provider: { readonly status?: number; readonly message: string }, apiKey: string): string {
  const suffix = provider.status ? ` (${provider.status})` : "";
  const message = redactSecrets(provider.message, apiKey);
  if (provider.status === 429) {
    return `OpenRouter 请求失败${suffix}：上游 Provider 限流或暂时不可用。请稍后重试，或在设置中换用其他模型。原始错误：${message}`;
  }

  return `OpenRouter 请求失败${suffix}：${message}`;
}

function getChoiceError(choice: Record<string, unknown>): string | null {
  const error = choice.error;
  if (!isObject(error)) {
    return null;
  }

  const code = typeof error.code === "number" ? ` (${error.code})` : "";
  const message = typeof error.message === "string" ? error.message : "unknown choice error";
  return `OpenRouter 模型返回错误${code}：${message}`;
}

function getFinishReason(choice: Record<string, unknown>): string {
  return typeof choice.finish_reason === "string" ? choice.finish_reason : "unknown";
}

function extractReasoningDetailText(detail: unknown): string | null {
  if (!isObject(detail)) {
    return null;
  }
  if (typeof detail.text === "string" && detail.text.trim()) {
    return detail.text.trim();
  }
  if (typeof detail.summary === "string" && detail.summary.trim()) {
    return detail.summary.trim();
  }
  return null;
}

function appendUniqueReasoning(parts: string[], text: string): void {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  const alreadyCovered = parts.some((part) => part === trimmed || part.includes(trimmed) || trimmed.includes(part));
  if (!alreadyCovered) {
    parts.push(trimmed);
  }
}

function extractReasoningFromMessage(message: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  if (Array.isArray(message.reasoning_details)) {
    for (const detail of message.reasoning_details) {
      const text = extractReasoningDetailText(detail);
      if (text) {
        appendUniqueReasoning(parts, text);
      }
    }
  }
  if (typeof message.reasoning_content === "string" && message.reasoning_content.trim()) {
    appendUniqueReasoning(parts, message.reasoning_content);
  }
  if (typeof message.reasoning === "string" && message.reasoning.trim()) {
    appendUniqueReasoning(parts, message.reasoning);
  }

  return parts.length > 0 ? parts.join("\n") : undefined;
}

function buildCompletionResult(
  content: string,
  truncated: boolean,
  reasoning?: string,
  toolCalls?: readonly OpenRouterToolCall[]
): OpenRouterChatCompletionResult {
  const trimmedReasoning = reasoning?.trim();
  return {
    content,
    ...(trimmedReasoning ? { reasoning: trimmedReasoning } : {}),
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    truncated
  };
}

function parseToolCalls(message: Record<string, unknown>): readonly OpenRouterToolCall[] {
  const rawToolCalls = message.tool_calls;
  if (rawToolCalls === undefined || rawToolCalls === null) {
    return [];
  }
  if (!Array.isArray(rawToolCalls)) {
    throw new Error("OpenRouter 响应工具调用格式无效：tool_calls 不是数组。");
  }

  return rawToolCalls.map((rawToolCall, index) => {
    if (!isObject(rawToolCall)) {
      throw new Error(`OpenRouter 响应工具调用格式无效：第 ${index + 1} 个 tool_call 不是对象。`);
    }
    const fn = rawToolCall.function;
    if (typeof rawToolCall.id !== "string" || !rawToolCall.id.trim() || !isObject(fn)) {
      throw new Error(`OpenRouter 响应工具调用格式无效：第 ${index + 1} 个 tool_call 缺少 id 或 function。`);
    }
    if (typeof fn.name !== "string" || !fn.name.trim() || typeof fn.arguments !== "string") {
      throw new Error(`OpenRouter 响应工具调用格式无效：第 ${index + 1} 个 tool_call 缺少 function.name 或 function.arguments。`);
    }

    return {
      id: rawToolCall.id,
      name: fn.name,
      argumentsJson: fn.arguments
    };
  });
}

function parseCompletionResponse(response: unknown, allowEmptyContent: boolean): OpenRouterChatCompletionResult {
  if (!isObject(response) || !Array.isArray(response.choices)) {
    throw new Error("OpenRouter 响应缺少 choices。");
  }

  const firstChoice = response.choices[0] as unknown;
  if (!isObject(firstChoice)) {
    throw new Error("OpenRouter 响应缺少 choices[0]。");
  }

  const choiceError = getChoiceError(firstChoice);
  if (choiceError) {
    throw new Error(choiceError);
  }

  if (!isObject(firstChoice.message)) {
    throw new Error("OpenRouter 响应缺少 choices[0].message。");
  }

  const truncated = getFinishReason(firstChoice) === "length";
  const reasoning = extractReasoningFromMessage(firstChoice.message);
  const toolCalls = parseToolCalls(firstChoice.message);
  const content = firstChoice.message.content;
  if (typeof content === "string") {
    return buildCompletionResult(content, truncated, reasoning, toolCalls);
  }

  if ((allowEmptyContent || truncated || toolCalls.length > 0) && (content === null || content === undefined)) {
    return buildCompletionResult("", truncated, reasoning, toolCalls);
  }

  throw new Error(`OpenRouter 响应没有文本内容（finish_reason: ${getFinishReason(firstChoice)}）。`);
}

async function defaultHttpPost(request: OpenRouterHttpRequest): Promise<unknown> {
  const response = await axios.post(request.url, request.body, {
    headers: request.headers,
    timeout: 60_000,
    signal: request.signal
  });
  return response.data;
}

async function defaultHttpStreamPost(request: OpenRouterHttpRequest): Promise<OpenRouterHttpStream> {
  const response = await axios.post(request.url, request.body, {
    headers: request.headers,
    timeout: 60_000,
    responseType: "stream",
    signal: request.signal
  });
  return response.data as OpenRouterHttpStream;
}

class ReasoningAccumulator {
  private readonly textByKey = new Map<string, string>();

  append(event: Extract<OpenRouterStreamEvent, { readonly type: "reasoning" }>): string | null {
    const key = this.keyFor(event);
    const previous = this.textByKey.get(key);

    if (!previous) {
      this.textByKey.set(key, event.content);
      return event.content;
    }
    if (event.content === previous || previous.includes(event.content)) {
      return null;
    }
    if (event.content.startsWith(previous)) {
      const suffix = event.content.slice(previous.length);
      this.textByKey.set(key, event.content);
      return suffix || null;
    }

    const next = `${previous}${event.content}`;
    this.textByKey.set(key, next);
    return event.content;
  }

  private keyFor(event: Extract<OpenRouterStreamEvent, { readonly type: "reasoning" }>): string {
    if (event.detailId) {
      return `${event.source}:id:${event.detailId}`;
    }
    if (event.detailIndex !== undefined) {
      return `${event.source}:index:${event.detailIndex}:${event.detailType ?? ""}`;
    }
    return event.source;
  }
}

class ToolCallAccumulator {
  private readonly calls = new Map<number, { id?: string; name?: string; argumentsJson: string }>();

  append(event: Extract<OpenRouterStreamEvent, { readonly type: "tool_call_delta" }>): void {
    const previous = this.calls.get(event.index) ?? { argumentsJson: "" };
    this.calls.set(event.index, {
      id: event.id ?? previous.id,
      name: event.name ?? previous.name,
      argumentsJson: `${previous.argumentsJson}${event.argumentsJsonDelta ?? ""}`
    });
  }

  toToolCalls(): readonly OpenRouterToolCall[] {
    return Array.from(this.calls.entries())
      .sort(([left], [right]) => left - right)
      .map(([index, call]) => {
        if (!call.id || !call.name) {
          throw new Error(`OpenRouter 流式工具调用格式无效：第 ${index + 1} 个 tool_call 缺少 id 或 function.name。`);
        }
        return {
          id: call.id,
          name: call.name,
          argumentsJson: call.argumentsJson
        };
      });
  }
}

async function defaultHttpGet(request: OpenRouterHttpGetRequest): Promise<unknown> {
  const response = await axios.get(request.url, {
    timeout: 60_000
  });
  return response.data;
}

function parseModelList(response: unknown): OpenRouterModelSummary[] {
  if (!isObject(response) || !Array.isArray(response.data)) {
    throw new Error("OpenRouter 模型列表响应缺少 data。");
  }

  return response.data.flatMap((item): OpenRouterModelSummary[] => {
    if (!isObject(item) || typeof item.id !== "string" || typeof item.name !== "string") {
      return [];
    }

    const topProvider = item.top_provider;
    const topProviderContextLength = isObject(topProvider) && typeof topProvider.context_length === "number" ? topProvider.context_length : null;
    const supportedParameters = Array.isArray(item.supported_parameters)
      ? item.supported_parameters.filter((parameter): parameter is string => typeof parameter === "string")
      : [];

    return [
      {
        id: item.id,
        name: item.name,
        contextLength: typeof item.context_length === "number" ? item.context_length : topProviderContextLength,
        supportsTools: supportedParameters.length === 0 ? true : supportedParameters.includes("tools")
      }
    ];
  });
}

export class OpenRouterClient {
  private readonly httpPost: (request: OpenRouterHttpRequest) => Promise<unknown>;
  private readonly httpStreamPost: (request: OpenRouterHttpRequest) => Promise<OpenRouterHttpStream>;

  constructor(private readonly options: OpenRouterClientOptions) {
    this.httpPost = options.httpPost ?? defaultHttpPost;
    this.httpStreamPost = options.httpStreamPost ?? defaultHttpStreamPost;
  }

  private buildChatCompletionRequest(input: OpenRouterChatCompletionInput, stream: boolean): OpenRouterHttpRequest {
    const body: Record<string, unknown> = {
      model: this.options.modelName,
      messages: input.messages,
      stream
    };

    if (input.maxCompletionTokens !== undefined) {
      body.max_completion_tokens = input.maxCompletionTokens;
    }
    if (input.temperature !== undefined) {
      body.temperature = input.temperature;
    }
    if (input.responseFormat) {
      body.response_format = input.responseFormat;
    }
    if (input.reasoning) {
      body.reasoning = input.reasoning;
    }
    if (input.tools) {
      body.tools = input.tools;
    }
    if (input.toolChoice) {
      body.tool_choice = input.toolChoice;
    }
    if (input.parallelToolCalls !== undefined) {
      body.parallel_tool_calls = input.parallelToolCalls;
    }

    return {
      url: OPENROUTER_CHAT_COMPLETIONS_URL,
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
        "X-OpenRouter-Title": "MoShu"
      },
      body,
      signal: input.signal
    };
  }

  async createChatCompletion(input: OpenRouterChatCompletionInput): Promise<OpenRouterChatCompletionResult> {
    const request = this.buildChatCompletionRequest(input, false);
    try {
      return parseCompletionResponse(await this.httpPost(request), Boolean(input.allowEmptyContent));
    } catch (error) {
      const provider = extractProviderMessage(error);
      throw new Error(formatOpenRouterRequestError(provider, this.options.apiKey));
    }
  }

  async streamChatCompletion(input: OpenRouterChatCompletionInput, handlers: OpenRouterStreamHandlers = {}): Promise<OpenRouterChatCompletionResult> {
    const request = this.buildChatCompletionRequest(input, true);
    let buffer = "";
    let content = "";
    let reasoning = "";
    let truncated = false;
    const decoder = new StringDecoder("utf8");
    const reasoningAccumulator = new ReasoningAccumulator();
    const toolCallAccumulator = new ToolCallAccumulator();

    const applyEvents = (events: readonly OpenRouterStreamEvent[]): void => {
      for (const event of events) {
        if (event.type === "content") {
          content += event.content;
          handlers.onToken?.(event.content);
        }
        if (event.type === "reasoning") {
          const delta = reasoningAccumulator.append(event);
          if (delta) {
            reasoning += delta;
            handlers.onReasoning?.(delta);
          }
        }
        if (event.type === "tool_call_delta") {
          toolCallAccumulator.append(event);
        }
        if (event.type === "error") {
          throw new Error(event.message);
        }
        if (event.type === "truncated") {
          truncated = true;
        }
      }
    };

    try {
      const stream = await this.httpStreamPost(request);
      for await (const chunk of stream) {
        buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? "";
        const events = parseOpenRouterSsePayload(blocks.map((block) => `${block}\n\n`).join(""));
        applyEvents(events);
      }

      buffer += decoder.end();
      if (buffer.trim()) {
        const events = parseOpenRouterSsePayload(`${buffer}\n\n`);
        applyEvents(events);
      }

      return buildCompletionResult(content, truncated, reasoning, toolCallAccumulator.toToolCalls());
    } catch (error) {
      const provider = extractProviderMessage(error);
      throw new Error(formatOpenRouterRequestError(provider, this.options.apiKey));
    }
  }
}

export class OpenRouterModelCatalogClient {
  private readonly httpGet: (request: OpenRouterHttpGetRequest) => Promise<unknown>;

  constructor(options: { readonly httpGet?: (request: OpenRouterHttpGetRequest) => Promise<unknown> } = {}) {
    this.httpGet = options.httpGet ?? defaultHttpGet;
  }

  async listModels(): Promise<OpenRouterModelSummary[]> {
    return parseModelList(await this.httpGet({ url: OPENROUTER_MODELS_URL }));
  }
}
