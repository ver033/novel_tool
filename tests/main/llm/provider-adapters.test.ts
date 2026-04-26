import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  buildDeepSeekRequest,
  buildOpenRouterRequest,
  defaultModelForProvider,
  parseProviderChatResponse,
  providerErrorMessage,
  redactProviderErrorText,
} from '../../../src/main/llm/provider-adapters';

const baseRequest = {
  model: 'deepseek-v4-pro',
  messages: [
    { role: 'system' as const, content: '你是审校助手。' },
    { role: 'user' as const, content: '检查这段。' },
  ],
  reasoningEffort: 'high' as const,
  thinkingMode: 'enabled' as const,
  stream: false,
  responseFormat: 'json_object' as const,
};

describe('provider adapters', () => {
  test('serializes DeepSeek official V4 requests with top-level thinking and reasoning effort', () => {
    const request = buildDeepSeekRequest(baseRequest, 'sk-test');

    expect(request.url).toBe('https://api.deepseek.com/chat/completions');
    expect(request.headers.Authorization).toBe('Bearer sk-test');
    expect(request.body).toEqual({
      model: 'deepseek-v4-pro',
      messages: baseRequest.messages,
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
      stream: false,
      response_format: { type: 'json_object' },
    });
  });

  test('serializes function tool definitions for agent runs', () => {
    const request = buildDeepSeekRequest(
      {
        ...baseRequest,
        tools: [
          {
            type: 'function',
            function: {
              name: 'read_paragraphs',
              description: 'Read manuscript evidence.',
              parameters: {
                type: 'object',
                properties: { paragraphIds: { type: 'array', items: { type: 'string' } } },
                required: ['paragraphIds'],
              },
            },
          },
        ],
      },
      'sk-test'
    );

    expect(request.body.tools).toEqual([
      expect.objectContaining({
        type: 'function',
        function: expect.objectContaining({
          name: 'read_paragraphs',
        }),
      }),
    ]);
  });

  test('serializes DeepSeek max reasoning effort without compatibility aliases', () => {
    const request = buildDeepSeekRequest({ ...baseRequest, reasoningEffort: 'max' }, 'sk-test');

    expect(request.body.reasoning_effort).toBe('max');
    expect(request.body.model).toBe('deepseek-v4-pro');
  });

  test('omits reasoning effort when DeepSeek thinking mode is disabled', () => {
    const request = buildDeepSeekRequest({ ...baseRequest, thinkingMode: 'disabled' }, 'sk-test');

    expect(request.body.thinking).toEqual({ type: 'disabled' });
    expect(request.body).not.toHaveProperty('reasoning_effort');
  });

  test('serializes assistant reasoning content and tool calls for DeepSeek thinking continuation', () => {
    const request = buildDeepSeekRequest(
      {
        ...baseRequest,
        messages: [
          { role: 'user', content: '查一下天气。' },
          {
            role: 'assistant',
            content: '',
            reasoningContent: '需要先调用工具。',
            toolCalls: [
              {
                id: 'call-1',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"杭州"}' },
              },
            ],
          },
          { role: 'tool', toolCallId: 'call-1', content: '多云。' },
        ],
      },
      'sk-test'
    );

    expect(request.body.messages).toEqual([
      { role: 'user', content: '查一下天气。' },
      {
        role: 'assistant',
        content: '',
        reasoning_content: '需要先调用工具。',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"杭州"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call-1', content: '多云。' },
    ]);
  });

  test('serializes OpenRouter DeepSeek V4 routes with DeepSeek-style fields', () => {
    const request = buildOpenRouterRequest(
      {
        ...baseRequest,
        model: 'deepseek/deepseek-v4-pro',
        thinkingMode: 'disabled',
      },
      'sk-or-test'
    );

    expect(request.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(request.headers.Authorization).toBe('Bearer sk-or-test');
    expect(request.body).toMatchObject({
      model: 'deepseek/deepseek-v4-pro',
      thinking: { type: 'disabled' },
    });
    expect(request.body).not.toHaveProperty('reasoning_effort');
    expect(request.body).not.toHaveProperty('reasoning');
  });

  test('does not attach DeepSeek-only fields to non-DeepSeek OpenRouter models', () => {
    const request = buildOpenRouterRequest(
      {
        ...baseRequest,
        model: 'anthropic/claude-sonnet-4.5',
      },
      'sk-or-test'
    );

    expect(request.body).not.toHaveProperty('thinking');
    expect(request.body).not.toHaveProperty('reasoning_effort');
    expect(request.body).not.toHaveProperty('reasoning');
  });

  test('keeps reasoning content separate from final content', () => {
    const parsed = parseProviderChatResponse({
      id: 'chat-1',
      choices: [
        {
          message: {
            content: '{"ok":true}',
            reasoning_content: '内部推理',
            tool_calls: [{ id: 'tool-1', type: 'function', function: { name: 'x', arguments: '{}' } }],
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        completion_tokens_details: { reasoning_tokens: 3 },
      },
    });

    expect(parsed.content).toBe('{"ok":true}');
    expect(parsed.reasoningContent).toBe('内部推理');
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.usage?.reasoningTokens).toBe(3);
  });

  test('uses provider-specific default V4 model ids', () => {
    expect(defaultModelForProvider('deepseek', 'pro')).toBe('deepseek-v4-pro');
    expect(defaultModelForProvider('deepseek', 'flash')).toBe('deepseek-v4-flash');
    expect(defaultModelForProvider('openrouter', 'pro')).toBe('deepseek/deepseek-v4-pro');
    expect(defaultModelForProvider('openrouter', 'flash')).toBe('deepseek/deepseek-v4-flash');
  });

  test('redacts provider secrets from error text', () => {
    expect(redactProviderErrorText('Authorization: Bearer sk-secret-value', 'sk-secret-value')).not.toContain(
      'sk-secret-value'
    );
  });

  test('keeps useful provider error details while redacting keys', () => {
    const message = providerErrorMessage(
      {
        isAxiosError: true,
        message: 'Request failed with status code 401',
        response: {
          status: 401,
          data: { error: 'bad key', received: 'sk-secret-value' },
        },
      },
      'sk-secret-value'
    );

    expect(message).toContain('401');
    expect(message).toContain('bad key');
    expect(message).not.toContain('sk-secret-value');
  });


  test('imports axios only from main-process LLM adapter modules', async () => {
    const root = path.join(process.cwd(), 'src');
    const sourceFiles = await listSourceFiles(root);
    const filesWithAxios = [];

    for (const filePath of sourceFiles) {
      const content = await readFile(filePath, 'utf8');
      if (content.includes("from 'axios'") || content.includes('from "axios"')) {
        filesWithAxios.push(path.relative(process.cwd(), filePath));
      }
    }

    expect(filesWithAxios).toEqual(['src/main/llm/provider-adapters.ts']);
  });
});

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return listSourceFiles(fullPath);
      }
      return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [fullPath] : [];
    })
  );
  return files.flat();
}
