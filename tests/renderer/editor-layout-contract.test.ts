import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'src/renderer/App.tsx'), 'utf8');
const styles = readFileSync(join(process.cwd(), 'src/renderer/styles.css'), 'utf8');

describe('editor layout contract', () => {
  test('keeps the editor page title separate from the manuscript chapter title', () => {
    expect(appSource).toContain('<h2>正文编辑</h2>');
    expect(appSource).toContain('className="manuscript-title"');
  });

  test('keeps editor quick actions in the editor header instead of a bottom bar', () => {
    expect(styles).toContain('.chapter-head .editor-actions');
    expect(styles).toContain('border-top: 0');
  });

  test('keeps right-click selection menus open after the contextmenu event', () => {
    expect(appSource).toContain("onMouseUp={(event) => {\n                      if (event.button === 0) {");
    expect(appSource).toContain("onMouseDown={(event) => {\n                      if (event.button === 2");
  });

  test('keeps selection quick actions visible above the editor instead of clipping inside scroll containers', () => {
    expect(styles).toContain('.selection-toolbar {\n  position: fixed;');
    expect(styles).toContain('transform: translateX(-50%);');
  });
});
