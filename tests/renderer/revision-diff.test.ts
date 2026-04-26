import { describe, expect, test } from 'vitest';

import { buildRevisionDiffRows, previewRevisionText } from '../../src/renderer/revision-diff';

describe('revision diff helpers', () => {
  test('builds side-by-side rows for unchanged, removed, and added text', () => {
    const rows = buildRevisionDiffRows('雨声贴着窗棂往下淌。', '雨声贴着旧窗往下淌，像银箔。');

    expect(rows.some((row) => row.kind === 'unchanged' && row.before.includes('雨声贴着'))).toBe(true);
    expect(rows.some((row) => row.kind === 'removed' && row.before.includes('棂'))).toBe(true);
    expect(rows.some((row) => row.kind === 'added' && row.after.includes('旧'))).toBe(true);
    expect(rows.some((row) => row.kind === 'added' && row.after.includes('像银箔'))).toBe(true);
  });

  test('keeps preview text compact for revision cards', () => {
    expect(previewRevisionText(' 雨声\n贴着窗棂往下淌。 ')).toBe('雨声 贴着窗棂往下淌。');
    expect(previewRevisionText('很长'.repeat(60))).toHaveLength(85);
  });
});
