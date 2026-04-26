export type ProviderId = 'deepseek' | 'openrouter';
export type ProviderConnectionStatus = 'not_configured' | 'configured_untested' | 'connected' | 'failed';

export interface ProviderConnectionState {
  status: ProviderConnectionStatus;
  model: string | null;
  testedAt: string | null;
  error: string | null;
}

export interface ProviderSettingsState {
  activeProvider: ProviderId | null;
  encryptedKeys: Partial<Record<ProviderId, string>>;
  connections?: Partial<Record<ProviderId, ProviderConnectionState>>;
}

export interface ProviderStatusResponse {
  activeProvider: ProviderId | null;
  activeConnection: (ProviderConnectionState & { providerId: ProviderId }) | null;
  providers: Record<ProviderId, { configured: boolean; connection: ProviderConnectionState }>;
}

const providerIds: ProviderId[] = ['deepseek', 'openrouter'];

function emptyConnection(status: ProviderConnectionStatus): ProviderConnectionState {
  return {
    status,
    model: null,
    testedAt: null,
    error: null,
  };
}

function connectionFor(settings: ProviderSettingsState, providerId: ProviderId): ProviderConnectionState {
  if (!settings.encryptedKeys[providerId]) {
    return emptyConnection('not_configured');
  }

  const stored = settings.connections?.[providerId];
  if (!stored || stored.status === 'not_configured') {
    return emptyConnection('configured_untested');
  }

  return {
    status: stored.status,
    model: stored.model,
    testedAt: stored.testedAt,
    error: stored.error,
  };
}

export function buildProviderStatus(settings: ProviderSettingsState): ProviderStatusResponse {
  const providers = providerIds.reduce(
    (accumulator, providerId) => {
      accumulator[providerId] = {
        configured: Boolean(settings.encryptedKeys[providerId]),
        connection: connectionFor(settings, providerId),
      };
      return accumulator;
    },
    {} as ProviderStatusResponse['providers']
  );

  const activeConnection = settings.activeProvider
    ? {
        providerId: settings.activeProvider,
        ...providers[settings.activeProvider].connection,
      }
    : null;

  return {
    activeProvider: settings.activeProvider,
    activeConnection,
    providers,
  };
}
