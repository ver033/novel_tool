export type SystemProxySession = {
  readonly setProxy: (config: { readonly mode: "system" }) => Promise<void>;
  readonly clearHostResolverCache: () => Promise<void>;
  readonly closeAllConnections: () => Promise<void>;
};

export type SystemProxyNetworkLog = (
  level: "info" | "warn" | "error",
  message: string,
  metadata?: Record<string, unknown>
) => void;

export type SystemProxyNetwork = {
  readonly install: () => Promise<void>;
};

type SystemProxyNetworkOptions = {
  readonly fetchImpl: typeof globalThis.fetch;
  readonly session: SystemProxySession;
  readonly setGlobalFetch: (fetchImpl: typeof globalThis.fetch) => void;
  readonly log?: SystemProxyNetworkLog;
};

const LOOPBACK_HTTPS_REFUSAL_PATTERN =
  /ECONNREFUSED\s+(?:127\.0\.0\.1|\[?::1\]?|::ffff:127\.0\.0\.1):443\b/iu;
const CHROMIUM_CONNECTION_REFUSED_PATTERN = /\bERR_CONNECTION_REFUSED\b/iu;
const MAX_ERROR_CAUSE_DEPTH = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isLoopbackAddress(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1";
}

function isHttpsPort(value: unknown): boolean {
  return value === 443 || value === "443";
}

function isLoopbackRefusalRecord(value: Record<string, unknown>): boolean {
  if (value.code === "ECONNREFUSED" && isLoopbackAddress(value.address) && isHttpsPort(value.port)) {
    return true;
  }
  return typeof value.message === "string" && LOOPBACK_HTTPS_REFUSAL_PATTERN.test(value.message);
}

export function isLoopbackHttpsConnectionRefused(reason: unknown): boolean {
  const visited = new Set<unknown>();
  const queue: Array<{ readonly value: unknown; readonly depth: number }> = [{ value: reason, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > MAX_ERROR_CAUSE_DEPTH || visited.has(current.value)) {
      continue;
    }
    visited.add(current.value);

    if (!isRecord(current.value)) {
      continue;
    }
    if (isLoopbackRefusalRecord(current.value)) {
      return true;
    }

    if ("cause" in current.value) {
      queue.push({ value: current.value.cause, depth: current.depth + 1 });
    }
    if (Array.isArray(current.value.errors)) {
      for (const error of current.value.errors) {
        queue.push({ value: error, depth: current.depth + 1 });
      }
    }
  }

  return false;
}

function isOpenRouterRequest(input: RequestInfo | URL): boolean {
  try {
    const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
    return url.protocol === "https:" && url.hostname.toLowerCase() === "openrouter.ai";
  } catch {
    return false;
  }
}

function isChromiumOpenRouterConnectionRefused(input: RequestInfo | URL, reason: unknown): boolean {
  if (!isOpenRouterRequest(input)) {
    return false;
  }

  const visited = new Set<unknown>();
  const queue: Array<{ readonly value: unknown; readonly depth: number }> = [{ value: reason, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > MAX_ERROR_CAUSE_DEPTH || visited.has(current.value)) {
      continue;
    }
    visited.add(current.value);
    if (!isRecord(current.value)) {
      continue;
    }
    if (typeof current.value.message === "string" && CHROMIUM_CONNECTION_REFUSED_PATTERN.test(current.value.message)) {
      return true;
    }
    if ("cause" in current.value) {
      queue.push({ value: current.value.cause, depth: current.depth + 1 });
    }
    if (Array.isArray(current.value.errors)) {
      for (const error of current.value.errors) {
        queue.push({ value: error, depth: current.depth + 1 });
      }
    }
  }
  return false;
}

function getRequestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | null {
  if (init?.signal) {
    return init.signal;
  }
  return input instanceof Request ? input.signal : null;
}

function canceledReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

export function createSystemProxyNetwork(options: SystemProxyNetworkOptions): SystemProxyNetwork {
  let recoveryInFlight: Promise<void> | null = null;

  const applySystemProxy = async (): Promise<void> => {
    await options.session.setProxy({ mode: "system" });
    await options.session.clearHostResolverCache();
    await options.session.closeAllConnections();
  };

  const recoverSystemProxy = (): Promise<void> => {
    if (recoveryInFlight) {
      return recoveryInFlight;
    }

    options.log?.("warn", "OpenRouter loopback refusal detected; refreshing the system proxy");
    recoveryInFlight = applySystemProxy()
      .then(() => {
        options.log?.("info", "System proxy refresh completed");
      })
      .finally(() => {
        recoveryInFlight = null;
      });
    return recoveryInFlight;
  };

  const recoveringFetch: typeof globalThis.fetch = async (input, init) => {
    try {
      return await options.fetchImpl(input, init);
    } catch (error) {
      const signal = getRequestSignal(input, init);
      const recoverable = isLoopbackHttpsConnectionRefused(error)
        || isChromiumOpenRouterConnectionRefused(input, error);
      if (!recoverable || signal?.aborted) {
        throw error;
      }

      try {
        await recoverSystemProxy();
      } catch (recoveryError) {
        options.log?.("error", "System proxy refresh failed", {
          error: recoveryError
        });
        throw error;
      }

      if (signal?.aborted) {
        throw canceledReason(signal);
      }

      return options.fetchImpl(input, init);
    }
  };

  return {
    async install() {
      options.setGlobalFetch(recoveringFetch);
      await applySystemProxy();
      options.log?.("info", "Electron system proxy network installed");
    }
  };
}
