import axios, { type AxiosResponse } from 'axios';

export type ProviderId = 'deepseek' | 'openrouter';
export type ModelRole = 'pro' | 'flash';
export type ReasoningEffort = 'high' | 'max';
export type ThinkingMode = 'enabled' | 'disabled';
export type ResponseFormat = 'text' | 'json_object';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  reasoningContent?: string;
  toolCalls?: unknown[];
  toolCallId?: string;
}

export interface LlmTaskRequest {
  model: string;
  messages: LlmMessage[];
  reasoningEffort: ReasoningEffort;
  thinkingMode: ThinkingMode;
  stream: boolean;
  responseFormat?: ResponseFormat;
  tools?: unknown[];
}

export interface SerializedProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface ParsedProviderResponse {
  id?: string;
  content: string;
  reasoningContent: string | null;
  toolCalls: unknown[];
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
  };
}

const deepSeekBaseUrl = 'https://api.deepseek.com';
const openRouterBaseUrl = 'https://openrouter.ai/api/v1';

function withBearer(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

function serializeMessages(
  messages: LlmMessage[]
): Array<{
  role: LlmMessage['role'];
  content: string;
  reasoning_content?: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}> {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: message.role,
        content: message.content,
        tool_call_id: message.toolCallId ?? '',
      };
    }
    if (message.role === 'assistant') {
      return {
        role: message.role,
        content: message.content,
        ...(message.reasoningContent ? { reasoning_content: message.reasoningContent } : {}),
        ...(message.toolCalls ? { tool_calls: message.toolCalls } : {}),
      };
    }
    return {
      role: message.role,
      content: message.content,
    };
  });
}

function buildOpenAiCompatibleBody(request: LlmTaskRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: serializeMessages(request.messages),
    stream: request.stream,
  };

  if (request.responseFormat) {
    body.response_format = { type: request.responseFormat };
  }
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools;
  }

  return body;
}

function buildDeepSeekThinkingBody(request: LlmTaskRequest): Record<string, unknown> {
  return {
    thinking: { type: request.thinkingMode },
    ...(request.thinkingMode === 'enabled' ? { reasoning_effort: request.reasoningEffort } : {}),
  };
}

export function isOpenRouterDeepSeekV4Model(model: string): boolean {
  return /^deepseek\/deepseek-v4-(pro|flash)$/i.test(model.trim());
}

export function defaultModelForProvider(provider: ProviderId, role: ModelRole): string {
  if (provider === 'deepseek') {
    return role === 'pro' ? 'deepseek-v4-pro' : 'deepseek-v4-flash';
  }
  return role === 'pro' ? 'deepseek/deepseek-v4-pro' : 'deepseek/deepseek-v4-flash';
}

export function buildDeepSeekRequest(request: LlmTaskRequest, apiKey: string): SerializedProviderRequest {
  return {
    url: `${deepSeekBaseUrl}/chat/completions`,
    headers: withBearer(apiKey),
    body: {
      ...buildOpenAiCompatibleBody(request),
      ...buildDeepSeekThinkingBody(request),
    },
  };
}

export function buildOpenRouterRequest(request: LlmTaskRequest, apiKey: string): SerializedProviderRequest {
  const body = buildOpenAiCompatibleBody(request);

  if (isOpenRouterDeepSeekV4Model(request.model)) {
    Object.assign(body, buildDeepSeekThinkingBody(request));
  }

  return {
    url: `${openRouterBaseUrl}/chat/completions`,
    headers: withBearer(apiKey),
    body,
  };
}

export function buildProviderRequest(
  provider: ProviderId,
  request: LlmTaskRequest,
  apiKey: string
): SerializedProviderRequest {
  return provider === 'deepseek' ? buildDeepSeekRequest(request, apiKey) : buildOpenRouterRequest(request, apiKey);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export function parseProviderChatResponse(payload: unknown): ParsedProviderResponse {
  const root = asRecord(payload);
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice.message);
  const usage = asRecord(root.usage);
  const completionDetails = asRecord(usage.completion_tokens_details);
  const content = typeof message.content === 'string' ? message.content : '';
  const reasoningContent = typeof message.reasoning_content === 'string' ? message.reasoning_content : null;
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

  return {
    id: typeof root.id === 'string' ? root.id : undefined,
    content,
    reasoningContent,
    toolCalls,
    finishReason: typeof firstChoice.finish_reason === 'string' ? firstChoice.finish_reason : undefined,
    usage: {
      promptTokens: numberOrUndefined(usage.prompt_tokens),
      completionTokens: numberOrUndefined(usage.completion_tokens),
      totalTokens: numberOrUndefined(usage.total_tokens),
      reasoningTokens: numberOrUndefined(completionDetails.reasoning_tokens),
    },
  };
}

export function redactProviderErrorText(value: unknown, apiKey?: string): string {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) {
    return 'Provider request failed';
  }
  if (apiKey) {
    text = text.split(apiKey).join('[REDACTED_API_KEY]');
  }
  return text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [REDACTED_API_KEY]');
}

export function providerErrorMessage(error: unknown, apiKey?: string): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const responseData = error.response?.data;
    const details = [
      'Provider request failed',
      status ? `status ${status}` : null,
      error.message,
      responseData ? redactProviderErrorText(responseData, apiKey) : null,
    ].filter(Boolean);
    return redactProviderErrorText(details.join(': '), apiKey);
  }

  if (error instanceof Error) {
    return redactProviderErrorText(error.message, apiKey);
  }

  return redactProviderErrorText(error, apiKey);
}

export async function sendProviderChatCompletion(
  provider: ProviderId,
  request: LlmTaskRequest,
  apiKey: string,
  timeoutMs = 120_000
): Promise<ParsedProviderResponse> {
  const serialized = buildProviderRequest(provider, request, apiKey);
  try {
    const response: AxiosResponse<unknown> = await axios.post(serialized.url, serialized.body, {
      headers: serialized.headers,
      timeout: timeoutMs,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    return parseProviderChatResponse(response.data);
  } catch (error) {
    throw new Error(providerErrorMessage(error, apiKey));
  }
}
