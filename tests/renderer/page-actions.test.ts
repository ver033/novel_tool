import { describe, expect, test } from 'vitest';

import { buildPendingFeatureStatus, isAiTaskPage, taskTypeForPage } from '../../src/renderer/page-actions';

describe('page action helpers', () => {
  test('builds an explicit pending-feature status instead of pretending success', () => {
    expect(buildPendingFeatureStatus('Agent 对话')).toBe('Agent 对话会在后续阶段接入；当前阶段不会伪装成功。');
  });

  test('maps task pages to AI task types and rejects non-task pages', () => {
    expect(isAiTaskPage('chat')).toBe(true);
    expect(isAiTaskPage('polish')).toBe(true);
    expect(isAiTaskPage('search')).toBe(false);
    expect(taskTypeForPage('continuity')).toBe('continuity');
  });
});
