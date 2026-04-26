import { describe, expect, test } from 'vitest';

import { buildMainWindowOptions, createContentSecurityPolicy } from '../../../src/main/window-options';

describe('Electron window security options', () => {
  test('keeps renderer isolated from Node.js', () => {
    const options = buildMainWindowOptions('/tmp/preload.js');

    expect(options.webPreferences?.preload).toBe('/tmp/preload.js');
    expect(options.webPreferences?.contextIsolation).toBe(true);
    expect(options.webPreferences?.nodeIntegration).toBe(false);
    expect(options.webPreferences?.sandbox).toBe(true);
    expect(options.webPreferences?.webSecurity).toBe(true);
  });

  test('uses a strict local content security policy', () => {
    const csp = createContentSecurityPolicy();

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  test('allows Vite React development preamble and websocket only in development', () => {
    const csp = createContentSecurityPolicy({ isDevelopment: true });

    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain('ws://localhost:*');
    expect(csp).not.toContain("'unsafe-eval'");
  });
});
