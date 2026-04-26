import { describe, expect, test, vi } from 'vitest';

import { logMain } from '../../../src/main/log-main';

describe('main process logging', () => {
  test('writes a scoped main-process message', () => {
    const writer = vi.fn();

    logMain('window ready-to-show', { windowId: 1 }, writer);

    expect(writer).toHaveBeenCalledWith('[main] window ready-to-show', { windowId: 1 });
  });

  test('does not crash the app when the parent terminal pipe has closed', () => {
    const error = new Error('write EPIPE') as NodeJS.ErrnoException;
    error.code = 'EPIPE';
    const writer = vi.fn(() => {
      throw error;
    });

    expect(() => logMain('window closed', undefined, writer)).not.toThrow();
  });
});
