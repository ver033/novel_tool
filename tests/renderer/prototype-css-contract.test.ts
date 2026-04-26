import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const styles = readFileSync(join(process.cwd(), 'src/renderer/styles.css'), 'utf8');

describe('approved prototype CSS contract', () => {
  test('keeps the narrow topbar controls visible like the prototype', () => {
    expect(styles).toContain('@media (max-width: 1180px)');
    expect(styles).toContain('grid-template-columns: 252px minmax(250px, 1fr) 360px');
    expect(styles).toContain('max-width: 220px');
  });

  test('uses the prototype workspace collapse instead of clipping the right panel', () => {
    expect(styles).toContain('.workspace-view {\n    grid-template-columns: 56px 232px minmax(0, 1fr);');
    expect(styles).toContain('.workspace-inspector {\n    display: none;');
  });

  test('keeps import review from clipping at the narrow prototype viewport', () => {
    expect(styles).toContain('.import {\n    grid-template-columns: 316px minmax(0, 1fr);');
    expect(styles).toContain('.import > .panel.right {\n    display: none;');
  });

  test('keeps global and export pages readable at the narrow prototype viewport', () => {
    expect(styles).toContain('.global-page,\n  .export-view {\n    grid-template-columns: 300px minmax(0, 1fr);');
    expect(styles).toContain('.canon-document-layout {\n    grid-template-columns: 1fr;');
    expect(styles).toContain('.timeline-event-card {\n    grid-template-columns: 44px minmax(0, 1fr);');
  });

  test('keeps the start page compact and action-led', () => {
    expect(styles).toContain('place-items: start center');
    expect(styles).toContain('align-items: start');
    expect(styles).toContain('min-height: 108px');
  });

  test('uses the prototype bottom strip structure instead of a generic footer', () => {
    expect(styles).toContain('.bottom-strip');
    expect(styles).toContain('.strip-cell');
    expect(styles).toContain('.strip-error');
  });

  test('keeps editor quick actions in one row', () => {
    expect(styles).toContain('flex-wrap: nowrap');
    expect(styles).toContain('overflow-x: auto');
  });
});
