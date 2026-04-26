import { describe, expect, test } from 'vitest';

import { providerCards, settingsTaskRows } from '../../src/renderer/settings-view-model';

describe('approved settings page view model', () => {
  test('keeps the provider selector copy aligned with the approved prototype', () => {
    expect(providerCards).toEqual([
      {
        id: 'deepseek',
        mark: 'DS',
        title: 'DeepSeek',
        subtitle: '直连接口 · V4 系列',
        scopeBadge: '直连',
        baseUrl: 'https://api.deepseek.com',
        modelScope: 'DeepSeek V4 Pro / V4 Flash。',
      },
      {
        id: 'openrouter',
        mark: 'OR',
        title: 'OpenRouter',
        subtitle: '模型网关 · 自定义模型',
        scopeBadge: '网关',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelScope: '可填写 OpenRouter 上的任意模型 ID。',
      },
    ]);
  });

  test('keeps visible task model rows in the same order as full-prototype.html', () => {
    expect(settingsTaskRows.map((row) => row.label)).toEqual([
      '对话 Agent',
      '检查矛盾',
      '扩写',
      '润色',
      '校对',
    ]);
  });
});
