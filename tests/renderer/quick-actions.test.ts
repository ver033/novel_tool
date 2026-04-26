import { describe, expect, test } from 'vitest';

import {
  buildTextScope,
  canRunQuickAction,
  editorQuickActionButtons,
  routeQuickAction,
} from '../../src/renderer/quick-actions';

describe('editor quick actions', () => {
  test('builds a selected-text scope with paragraph offsets and friendly label', () => {
    const scope = buildTextScope({
      paragraphId: 'para-1',
      friendlyLabel: '第 1 段',
      text: '雨声贴着窗棂往下淌。',
      selectionStart: 0,
      selectionEnd: 2,
    });

    expect(scope).toEqual({
      kind: 'selection',
      paragraphId: 'para-1',
      friendlyLabel: '第 1 段',
      scopeLabel: '当前选段 · 第 1 段',
      selectedText: '雨声',
      startOffset: 0,
      endOffset: 2,
      tooLong: false,
    });
  });

  test('falls back to the whole paragraph when there is no text selection', () => {
    const scope = buildTextScope({
      paragraphId: 'para-1',
      friendlyLabel: '第 1 段',
      text: '雨声贴着窗棂往下淌。',
      selectionStart: 2,
      selectionEnd: 2,
    });

    expect(scope).toMatchObject({
      kind: 'paragraph',
      scopeLabel: '第 1 段',
      selectedText: '雨声贴着窗棂往下淌。',
      startOffset: 0,
      endOffset: 10,
    });
  });

  test('routes toolbar actions to the correct standalone pages', () => {
    expect(editorQuickActionButtons).toEqual([
      { kind: 'ask', label: '问一下' },
      { kind: 'optimize', label: '润色' },
      { kind: 'proofread', label: '校对' },
      { kind: 'expand', label: '扩写' },
      { kind: 'continuity', label: '检查矛盾' },
    ]);
    expect(routeQuickAction('ask')).toBe('chat');
    expect(routeQuickAction('optimize')).toBe('polish');
    expect(routeQuickAction('proofread')).toBe('proofread');
    expect(routeQuickAction('expand')).toBe('expand');
    expect(routeQuickAction('continuity')).toBe('continuity');
  });

  test('marks long selected text and blocks model-facing quick actions', () => {
    const text = '很长'.repeat(1000);
    const scope = buildTextScope({
      paragraphId: 'para-1',
      friendlyLabel: '第 1 段',
      text,
      selectionStart: 0,
      selectionEnd: text.length,
    });

    expect(scope.tooLong).toBe(true);
    expect(canRunQuickAction('ask', scope)).toEqual({
      ok: false,
      reason: '选区过长，请缩小到更具体的片段，或后续改用本章范围。',
    });
  });

  test('allows quick actions when a scope is short enough', () => {
    const scope = buildTextScope({
      paragraphId: 'para-1',
      friendlyLabel: '第 1 段',
      text: '雨声贴着窗棂往下淌。',
      selectionStart: 0,
      selectionEnd: 2,
    });

    expect(canRunQuickAction('proofread', scope)).toEqual({ ok: true });
  });
});
