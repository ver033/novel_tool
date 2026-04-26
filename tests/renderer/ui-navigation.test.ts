import { describe, expect, test } from 'vitest';

import {
  agentBackendModeForUiMode,
  buildAgentMessageWithInstruction,
  mainViews,
  primaryViewForPage,
  prototypeNavigationLabel,
  workspaceViews,
} from '../../src/renderer/ui-navigation';

describe('approved UI navigation model', () => {
  test('keeps the approved top-level pages in order', () => {
    expect(prototypeNavigationLabel).toBe('原型导航');
    expect(mainViews.map((view) => view.id)).toEqual([
      'start',
      'import',
      'workspace',
      'canon',
      'memory',
      'timeline',
      'settings',
      'export',
    ]);
  });

  test('keeps workspace tools as standalone pages under the workspace view', () => {
    expect(workspaceViews).toEqual([
      { id: 'editor', label: '正文', sublabel: '编辑' },
      { id: 'chat', label: '对话', sublabel: 'Agent' },
      { id: 'polish', label: '润色', sublabel: '优化' },
      { id: 'expand', label: '扩写', sublabel: '场景' },
      { id: 'proofread', label: '校对', sublabel: '语言' },
      { id: 'continuity', label: '查矛盾', sublabel: '证据' },
      { id: 'search', label: '搜索', sublabel: '引用' },
    ]);
    expect(primaryViewForPage('polish')).toBe('workspace');
    expect(primaryViewForPage('timeline')).toBe('timeline');
  });

  test('exposes only Plan and Build agent modes while using existing backend modes', () => {
    expect(agentBackendModeForUiMode('plan')).toBe('investigate');
    expect(agentBackendModeForUiMode('build')).toBe('draft');
  });

  test('adds selected instruction text to the outgoing agent message', () => {
    expect(buildAgentMessageWithInstruction('这里是否矛盾？', 'evidence')).toContain('证据优先');
    expect(buildAgentMessageWithInstruction('这里是否矛盾？', 'none')).toBe('这里是否矛盾？');
  });
});
