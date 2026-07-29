import { describe, expect, it, vi } from "vitest";
import {
  createSystemProxyNetwork,
  isLoopbackHttpsConnectionRefused
} from "../../src/main/network/system-proxy-network";

function loopbackRefusal(address = "127.0.0.1", port = 443): Error {
  return Object.assign(new Error(`connect ECONNREFUSED ${address}:${port}`), {
    code: "ECONNREFUSED",
    address,
    port
  });
}

describe("system proxy network", () => {
  it("recognizes nested IPv4 and IPv6 loopback HTTPS refusals", () => {
    expect(isLoopbackHttpsConnectionRefused({
      cause: {
        cause: loopbackRefusal()
      }
    })).toBe(true);
    expect(isLoopbackHttpsConnectionRefused(loopbackRefusal("::1"))).toBe(true);
    expect(isLoopbackHttpsConnectionRefused(loopbackRefusal("127.0.0.1", 80))).toBe(false);
    expect(isLoopbackHttpsConnectionRefused(loopbackRefusal("203.0.113.10"))).toBe(false);
  });

  it("reapplies the system proxy and retries the same request once", async () => {
    const response = new Response("ok", { status: 200 });
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(loopbackRefusal())
      .mockResolvedValueOnce(response);
    const setProxy = vi.fn(async () => undefined);
    const clearHostResolverCache = vi.fn(async () => undefined);
    const closeAllConnections = vi.fn(async () => undefined);
    const setGlobalFetch = vi.fn();
    const network = createSystemProxyNetwork({
      fetchImpl,
      session: {
        setProxy,
        clearHostResolverCache,
        closeAllConnections
      },
      setGlobalFetch
    });

    await network.install();
    const installedFetch = setGlobalFetch.mock.calls[0]?.[0] as typeof globalThis.fetch;
    await expect(installedFetch("https://openrouter.ai/api/v1/models")).resolves.toBe(response);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]).toEqual(fetchImpl.mock.calls[0]);
    expect(setProxy).toHaveBeenCalledTimes(2);
    expect(clearHostResolverCache).toHaveBeenCalledTimes(2);
    expect(closeAllConnections).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent recovery into one system proxy refresh", async () => {
    let releaseRecovery: (() => void) | undefined;
    const recoveryGate = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });
    let recoveryCount = 0;
    const setProxy = vi.fn(async () => {
      recoveryCount += 1;
      if (recoveryCount > 1) {
        await recoveryGate;
      }
    });
    const fetchAttempts = new Map<string, number>();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const attempt = (fetchAttempts.get(url) ?? 0) + 1;
      fetchAttempts.set(url, attempt);
      if (attempt === 1) {
        throw loopbackRefusal();
      }
      return new Response(url, { status: 200 });
    });
    const setGlobalFetch = vi.fn();
    const network = createSystemProxyNetwork({
      fetchImpl,
      session: {
        setProxy,
        clearHostResolverCache: vi.fn(async () => undefined),
        closeAllConnections: vi.fn(async () => undefined)
      },
      setGlobalFetch
    });

    await network.install();
    const installedFetch = setGlobalFetch.mock.calls[0]?.[0] as typeof globalThis.fetch;
    const first = installedFetch("https://openrouter.ai/api/v1/models");
    const second = installedFetch("https://openrouter.ai/api/v1/key");

    await vi.waitFor(() => expect(setProxy).toHaveBeenCalledTimes(2));
    releaseRecovery?.();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(setProxy).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated failures or retry again after recovery", async () => {
    const unrelatedFetch = vi.fn(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED 203.0.113.10:443"), {
        code: "ECONNREFUSED",
        address: "203.0.113.10",
        port: 443
      });
    });
    const unrelatedSetGlobalFetch = vi.fn();
    const unrelatedSetProxy = vi.fn(async () => undefined);
    const unrelatedNetwork = createSystemProxyNetwork({
      fetchImpl: unrelatedFetch,
      session: {
        setProxy: unrelatedSetProxy,
        clearHostResolverCache: vi.fn(async () => undefined),
        closeAllConnections: vi.fn(async () => undefined)
      },
      setGlobalFetch: unrelatedSetGlobalFetch
    });

    await unrelatedNetwork.install();
    const unrelatedInstalledFetch = unrelatedSetGlobalFetch.mock.calls[0]?.[0] as typeof globalThis.fetch;
    await expect(unrelatedInstalledFetch("https://openrouter.ai/api/v1/models")).rejects.toThrow("203.0.113.10");
    expect(unrelatedFetch).toHaveBeenCalledTimes(1);
    expect(unrelatedSetProxy).toHaveBeenCalledTimes(1);

    const repeatedFetch = vi.fn(async () => {
      throw loopbackRefusal();
    });
    const repeatedSetGlobalFetch = vi.fn();
    const repeatedSetProxy = vi.fn(async () => undefined);
    const repeatedNetwork = createSystemProxyNetwork({
      fetchImpl: repeatedFetch,
      session: {
        setProxy: repeatedSetProxy,
        clearHostResolverCache: vi.fn(async () => undefined),
        closeAllConnections: vi.fn(async () => undefined)
      },
      setGlobalFetch: repeatedSetGlobalFetch
    });

    await repeatedNetwork.install();
    const repeatedInstalledFetch = repeatedSetGlobalFetch.mock.calls[0]?.[0] as typeof globalThis.fetch;
    await expect(repeatedInstalledFetch("https://openrouter.ai/api/v1/models")).rejects.toThrow("127.0.0.1");
    expect(repeatedFetch).toHaveBeenCalledTimes(2);
    expect(repeatedSetProxy).toHaveBeenCalledTimes(2);
  });

  it("recovers Chromium's generic refusal only for OpenRouter", async () => {
    const openRouterResponse = new Response("ok", { status: 200 });
    const openRouterFetch = vi.fn()
      .mockRejectedValueOnce(new TypeError("Error invoking remote method: net::ERR_CONNECTION_REFUSED"))
      .mockResolvedValueOnce(openRouterResponse);
    const openRouterSetGlobalFetch = vi.fn();
    const openRouterSetProxy = vi.fn(async () => undefined);
    const openRouterNetwork = createSystemProxyNetwork({
      fetchImpl: openRouterFetch,
      session: {
        setProxy: openRouterSetProxy,
        clearHostResolverCache: vi.fn(async () => undefined),
        closeAllConnections: vi.fn(async () => undefined)
      },
      setGlobalFetch: openRouterSetGlobalFetch
    });

    await openRouterNetwork.install();
    const openRouterInstalledFetch = openRouterSetGlobalFetch.mock.calls[0]?.[0] as typeof globalThis.fetch;
    await expect(openRouterInstalledFetch("https://openrouter.ai/api/v1/models")).resolves.toBe(openRouterResponse);
    expect(openRouterFetch).toHaveBeenCalledTimes(2);
    expect(openRouterSetProxy).toHaveBeenCalledTimes(2);

    const unrelatedFetch = vi.fn(async () => {
      throw new TypeError("net::ERR_CONNECTION_REFUSED");
    });
    const unrelatedSetGlobalFetch = vi.fn();
    const unrelatedSetProxy = vi.fn(async () => undefined);
    const unrelatedNetwork = createSystemProxyNetwork({
      fetchImpl: unrelatedFetch,
      session: {
        setProxy: unrelatedSetProxy,
        clearHostResolverCache: vi.fn(async () => undefined),
        closeAllConnections: vi.fn(async () => undefined)
      },
      setGlobalFetch: unrelatedSetGlobalFetch
    });

    await unrelatedNetwork.install();
    const unrelatedInstalledFetch = unrelatedSetGlobalFetch.mock.calls[0]?.[0] as typeof globalThis.fetch;
    await expect(unrelatedInstalledFetch("https://example.com/")).rejects.toThrow("ERR_CONNECTION_REFUSED");
    expect(unrelatedFetch).toHaveBeenCalledTimes(1);
    expect(unrelatedSetProxy).toHaveBeenCalledTimes(1);
  });

  it("does not issue the retry if the request is canceled during recovery", async () => {
    let releaseRecovery: (() => void) | undefined;
    const recoveryGate = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });
    let setProxyCount = 0;
    const setProxy = vi.fn(async () => {
      setProxyCount += 1;
      if (setProxyCount > 1) {
        await recoveryGate;
      }
    });
    const fetchImpl = vi.fn(async () => {
      throw loopbackRefusal();
    });
    const setGlobalFetch = vi.fn();
    const network = createSystemProxyNetwork({
      fetchImpl,
      session: {
        setProxy,
        clearHostResolverCache: vi.fn(async () => undefined),
        closeAllConnections: vi.fn(async () => undefined)
      },
      setGlobalFetch
    });

    await network.install();
    const installedFetch = setGlobalFetch.mock.calls[0]?.[0] as typeof globalThis.fetch;
    const controller = new AbortController();
    const request = installedFetch("https://openrouter.ai/api/v1/models", {
      signal: controller.signal
    });

    await vi.waitFor(() => expect(setProxy).toHaveBeenCalledTimes(2));
    controller.abort();
    releaseRecovery?.();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
