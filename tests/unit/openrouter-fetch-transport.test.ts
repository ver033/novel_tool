import { afterEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.resetModules();
});

describe("OpenRouter fetch transport", () => {
  it("uses the fetch installed after module loading for normal, streaming, and model-list requests", async () => {
    const preInstallFetch = vi.fn(async () => {
      throw new Error("captured the pre-install fetch");
    });
    globalThis.fetch = preInstallFetch as typeof globalThis.fetch;
    vi.resetModules();

    const { OpenRouterClient, OpenRouterModelCatalogClient } = await import("../../src/main/ai/openrouter-client");
    const installedFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          message: { content: "normal" }
        }]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response([
        'data: {"choices":[{"delta":{"content":"stream"}}]}',
        "",
        "data: [DONE]",
        "",
        ""
      ].join("\n"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{
          id: "openai/gpt-5.2",
          name: "GPT-5.2",
          context_length: 128_000,
          supported_parameters: ["tools"]
        }]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));
    globalThis.fetch = installedFetch as typeof globalThis.fetch;

    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "openai/gpt-5.2"
    });
    await expect(client.createChatCompletion({
      messages: [{ role: "user", content: "normal" }]
    })).resolves.toMatchObject({ content: "normal" });
    await expect(client.streamChatCompletion({
      messages: [{ role: "user", content: "stream" }]
    })).resolves.toMatchObject({ content: "stream" });

    const catalog = new OpenRouterModelCatalogClient();
    await expect(catalog.listModels()).resolves.toEqual([{
      id: "openai/gpt-5.2",
      name: "GPT-5.2",
      contextLength: 128_000,
      supportsTools: true
    }]);

    expect(preInstallFetch).not.toHaveBeenCalled();
    expect(installedFetch).toHaveBeenCalledTimes(3);
  });

  it("recovers a refused streaming request inside one client operation without duplicating tokens", async () => {
    vi.resetModules();
    const [{ OpenRouterClient }, { createSystemProxyNetwork }] = await Promise.all([
      import("../../src/main/ai/openrouter-client"),
      import("../../src/main/network/system-proxy-network")
    ]);
    const loopbackRefusal = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
      code: "ECONNREFUSED",
      address: "127.0.0.1",
      port: 443
    });
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(loopbackRefusal)
      .mockResolvedValueOnce(new Response([
        'data: {"choices":[{"delta":{"content":"single"}}]}',
        "",
        "data: [DONE]",
        "",
        ""
      ].join("\n"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" }
      }));
    const setProxy = vi.fn(async () => undefined);
    const network = createSystemProxyNetwork({
      fetchImpl,
      session: {
        setProxy,
        clearHostResolverCache: vi.fn(async () => undefined),
        closeAllConnections: vi.fn(async () => undefined)
      },
      setGlobalFetch(fetch) {
        globalThis.fetch = fetch;
      }
    });
    await network.install();

    const client = new OpenRouterClient({
      apiKey: "sk-or-v1-test-key",
      modelName: "openai/gpt-5.2"
    });
    const tokens: string[] = [];
    await expect(client.streamChatCompletion({
      messages: [{ role: "user", content: "stream" }]
    }, {
      onToken(token) {
        tokens.push(token);
      }
    })).resolves.toMatchObject({ content: "single" });

    expect(tokens).toEqual(["single"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(setProxy).toHaveBeenCalledTimes(2);
  });
});
