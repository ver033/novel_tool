import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'src/renderer/App.tsx'), 'utf8');

describe('export page contract', () => {
  test('labels the output field as a file path because the value includes the target file name', () => {
    expect(appSource).toContain('<label>导出文件路径</label>');
    expect(appSource).not.toContain('<label>导出目录</label>');
  });
});
