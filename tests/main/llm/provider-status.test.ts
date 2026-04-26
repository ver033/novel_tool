import { describe, expect, test } from 'vitest';

import { buildProviderStatus } from '../../../src/main/llm/provider-status';

describe('provider status', () => {
  test('marks a configured active provider as untested until a connection test succeeds', () => {
    const status = buildProviderStatus({
      activeProvider: 'deepseek',
      encryptedKeys: { deepseek: 'encrypted-key' },
      connections: {},
    });

    expect(status.activeConnection).toMatchObject({
      providerId: 'deepseek',
      status: 'configured_untested',
      model: null,
      testedAt: null,
      error: null,
    });
    expect(status.providers.deepseek.connection.status).toBe('configured_untested');
  });

  test('returns the last successful connection state for the active provider', () => {
    const status = buildProviderStatus({
      activeProvider: 'openrouter',
      encryptedKeys: { openrouter: 'encrypted-key' },
      connections: {
        openrouter: {
          status: 'connected',
          model: 'deepseek/deepseek-v4-pro',
          testedAt: '2026-04-24T00:00:00.000Z',
          error: null,
        },
      },
    });

    expect(status.activeConnection).toEqual({
      providerId: 'openrouter',
      status: 'connected',
      model: 'deepseek/deepseek-v4-pro',
      testedAt: '2026-04-24T00:00:00.000Z',
      error: null,
    });
  });

  test('does not report a disconnected provider as ready', () => {
    const status = buildProviderStatus({
      activeProvider: 'deepseek',
      encryptedKeys: {},
      connections: {
        deepseek: {
          status: 'connected',
          model: 'deepseek-v4-flash',
          testedAt: '2026-04-24T00:00:00.000Z',
          error: null,
        },
      },
    });

    expect(status.activeConnection).toMatchObject({
      providerId: 'deepseek',
      status: 'not_configured',
      model: null,
    });
  });
});
