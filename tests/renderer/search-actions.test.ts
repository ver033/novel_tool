import { describe, expect, test } from 'vitest';

import { buildReferenceRouteStatus, buildSearchJumpStatus, isHighlightedParagraph } from '../../src/renderer/search-actions';

describe('search action helpers', () => {
  test('builds an author-facing jump status from a friendly location', () => {
    expect(buildSearchJumpStatus('第一章 / 第 3 段')).toBe('已定位：第一章 / 第 3 段');
  });

  test('matches only the highlighted paragraph id', () => {
    expect(isHighlightedParagraph('para-1', 'para-1')).toBe(true);
    expect(isHighlightedParagraph('para-2', 'para-1')).toBe(false);
    expect(isHighlightedParagraph(null, 'para-1')).toBe(false);
  });

  test('builds a clear status when sending references to a task page', () => {
    expect(buildReferenceRouteStatus(3, '问一下')).toBe('已带 3 条引用到问一下');
    expect(buildReferenceRouteStatus(2, '校对')).toBe('已带 2 条引用到校对');
  });
});
