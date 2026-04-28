import axios from "axios";
import type { OpenRouterModelSummary } from "../shared/types";
import { parseOpenRouterSsePayload } from "./openrouter-stream-parser";

export type OpenRouterMessage = {
  readonly role: "system" | "user" | "assistant";
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
  readonly allowEmptyContent?: boolean;
};

export type OpenRouterChatCompletionResult = {
  readonly content: string;
};

export type OpenRouterStreamHandlers = {
  readonly onToken?: (token: string) => void;
};

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models?output_modalities=text";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function redactSecrets(message: string, apiKey: string): string {
  return message.replaceAll(apiKey, "[REDACTED]").replace(/sk-or-v1-[A-Za-z0-9._-]+/g, "[REDACTED]");
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

function parseContent(response: unknown, allowEmptyContent: boolean): string {
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

  const content = firstChoice.message.content;
  if (typeof content === "string") {
    return content;
  }

  if (allowEmptyContent && (content === null || content === undefined)) {
    return "";
  }

  throw new Error(`OpenRouter 响应没有文本内容（finish_reason: ${getFinishReason(firstChoice)}）。`);
}

async function defaultHttpPost(request: OpenRouterHttpRequest): Promise<unknown> {
  const response = await axios.post(request.url, request.body, {
    headers: request.headers,
    timeout: 60_000
  });
  return response.data;
}

async function defaultHttpStreamPost(request: OpenRouterHttpRequest): Promise<OpenRouterHttpStream> {
  const response = await axios.post(request.url, request.body, {
    headers: request.headers,
    timeout: 60_000,
    responseType: "stream"
  });
  return response.data as OpenRouterHttpStream;
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

    return [
      {
        id: item.id,
        name: item.name,
        contextLength: typeof item.context_length === "number" ? item.context_length : null
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

    return {
      url: OPENROUTER_CHAT_COMPLETIONS_URL,
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
        "X-OpenRouter-Title": "MoShu"
      },
      body
    };
  }

  async createChatCompletion(input: OpenRouterChatCompletionInput): Promise<OpenRouterChatCompletionResult> {
    const request = this.buildChatCompletionRequest(input, false);
    try {
      return {
        content: parseContent(await this.httpPost(request), Boolean(input.allowEmptyContent))
      };
    } catch (error) {
      const provider = extractProviderMessage(error);
      const suffix = provider.status ? ` (${provider.status})` : "";
      throw new Error(`OpenRouter 请求失败${suffix}：${redactSecrets(provider.message, this.options.apiKey)}`);
    }
  }

  async streamChatCompletion(input: OpenRouterChatCompletionInput, handlers: OpenRouterStreamHandlers = {}): Promise<OpenRouterChatCompletionResult> {
    const request = this.buildChatCompletionRequest(input, true);
    let buffer = "";
    let content = "";

    try {
      const stream = await this.httpStreamPost(request);
      for await (const chunk of stream) {
        buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? "";
        const events = parseOpenRouterSsePayload(blocks.map((block) => `${block}\n\n`).join(""));

        for (const event of events) {
          if (event.type === "content") {
            content += event.content;
            handlers.onToken?.(event.content);
          }
          if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }

      if (buffer.trim()) {
        const events = parseOpenRouterSsePayload(`${buffer}\n\n`);
        for (const event of events) {
          if (event.type === "content") {
            content += event.content;
            handlers.onToken?.(event.content);
          }
          if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }

      return { content };
    } catch (error) {
      const provider = extractProviderMessage(error);
      const suffix = provider.status ? ` (${provider.status})` : "";
      throw new Error(`OpenRouter 请求失败${suffix}：${redactSecrets(provider.message, this.options.apiKey)}`);
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
