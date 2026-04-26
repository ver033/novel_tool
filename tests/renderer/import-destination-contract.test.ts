import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'src/renderer/App.tsx'), 'utf8');
const styles = readFileSync(join(process.cwd(), 'src/renderer/styles.css'), 'utf8');

describe('import destination display contract', () => {
  test('shows the full project destination in a readable path block instead of a muted inline sentence', () => {
    expect(appSource).toContain('className="path-preview"');
    expect(appSource).toContain('title={baseDirectory}');
    expect(appSource).not.toContain('<p className="muted">{hasPreview ? `将保存到 ${baseDirectory}` :');
    expect(styles).toContain('.path-preview');
    expect(styles).toContain('overflow-wrap: anywhere;');
  });
});
