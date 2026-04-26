import { describe, expect, test } from 'vitest';

import { pickInitialChapterId, shouldLoadWorkspaceProject } from '../../src/renderer/editor-project-state';

describe('editor project state helpers', () => {
  test('opens the first non-empty chapter after import', () => {
    expect(
      pickInitialChapterId([
        { id: 'empty-1', title: '目录', index: 0, wordCount: 0, paragraphCount: 0 },
        { id: 'real-1', title: '序章', index: 1, wordCount: 42, paragraphCount: 3 },
      ])
    ).toBe('real-1');
  });

  test('does not reload the first chapter when switching workspace tools with an active chapter', () => {
    expect(
      shouldLoadWorkspaceProject({
        activeChapterId: 'real-1',
        chapterCount: 8,
        skipNextReload: false,
      })
    ).toBe(false);
  });
});
