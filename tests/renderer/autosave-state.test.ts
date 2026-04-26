import { describe, expect, test } from 'vitest';

import { clearParagraphDirty, markParagraphDirty } from '../../src/renderer/autosave-state';

describe('autosave state helpers', () => {
  test('tracks each dirty paragraph once', () => {
    expect(markParagraphDirty([], 'para-1')).toEqual(['para-1']);
    expect(markParagraphDirty(['para-1'], 'para-1')).toEqual(['para-1']);
    expect(markParagraphDirty(['para-1'], 'para-2')).toEqual(['para-1', 'para-2']);
  });

  test('clears only the paragraph that was saved', () => {
    expect(clearParagraphDirty(['para-1', 'para-2'], 'para-1')).toEqual(['para-2']);
  });
});
