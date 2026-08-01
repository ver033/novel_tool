import { describe, expect, it } from "vitest";
import {
  ExternalBookSyncFailoverSender,
  type ExternalBookSyncProvider,
  type ExternalBookSyncProviderTransport
} from "../../src/main/external-book-sync/book-sync-provider-failover";
import { OpenRouterError } from "../../src/main/ai/openrouter-error";

function createTransport(options: {
  readonly configured?: readonly ExternalBookSyncProvider[];
  readonly send?: ExternalBookSyncProviderTransport["send"];
} = {}) {
  const configured = new Set(options.configured ?? ["tencent-tokenhub", "openrouter", "deepseek"]);
  const deliveries: Array<{ readonly provider: ExternalBookSyncProvider; readonly message: string }> = [];
  const transport: ExternalBookSyncProviderTransport = {
    isConfigured(provider) {
      return configured.has(provider);
    },
    async send(input) {
      deliveries.push({ provider: input.provider, message: input.message });
      await options.send?.(input);
    }
  };
  return { deliveries, transport };
}

describe("ExternalBookSyncFailoverSender", () => {
  it("completes through TokenHub with ciphertext without contacting fallback providers", async () => {
    const { deliveries, transport } = createTransport();
    const sender = new ExternalBookSyncFailoverSender(transport);

    const result = await sender.send({
      requestId: "delivery_1",
      projectId: "project_1",
      sessionId: "session_1",
      plaintextMessage: "第二章\n雨落青瓦。",
      encryptedMessage: "MOSHU-AES1.ciphertext"
    });

    expect(result).toEqual({
      provider: "tencent-tokenhub",
      completion: "observable"
    });
    expect(deliveries).toEqual([
      {
        provider: "tencent-tokenhub",
        message: "MOSHU-AES1.ciphertext"
      }
    ]);
  });

  it("falls back to OpenRouter plaintext after a TokenHub network failure", async () => {
    const { deliveries, transport } = createTransport({
      async send(input) {
        if (input.provider === "tencent-tokenhub") {
          throw new OpenRouterError({
            code: "network_error",
            message: "connect ECONNREFUSED 127.0.0.1:443"
          });
        }
      }
    });
    const sender = new ExternalBookSyncFailoverSender(transport);

    const result = await sender.send({
      requestId: "delivery_2",
      projectId: "project_1",
      sessionId: "session_1",
      plaintextMessage: "第二章\n雨落青瓦。",
      encryptedMessage: "MOSHU-AES1.ciphertext"
    });

    expect(result).toEqual({ provider: "openrouter", completion: "observable" });
    expect(deliveries).toEqual([
      { provider: "tencent-tokenhub", message: "MOSHU-AES1.ciphertext" },
      { provider: "openrouter", message: "第二章\n雨落青瓦。" }
    ]);
  });

  it("uses DeepSeek ciphertext as a non-observable emergency delivery after two network failures", async () => {
    const { deliveries, transport } = createTransport({
      async send(input) {
        if (input.provider !== "deepseek") {
          throw new OpenRouterError({
            code: input.provider === "openrouter" ? "timeout" : "network_error",
            message: `${input.provider} unavailable`
          });
        }
      }
    });
    const sender = new ExternalBookSyncFailoverSender(transport);

    const result = await sender.send({
      requestId: "delivery_3",
      projectId: "project_1",
      sessionId: "session_1",
      plaintextMessage: "第三章\n潮声渐近。",
      encryptedMessage: "MOSHU-AES1.emergency-ciphertext"
    });

    expect(result).toEqual({ provider: "deepseek", completion: "emergency" });
    expect(deliveries).toEqual([
      { provider: "tencent-tokenhub", message: "MOSHU-AES1.emergency-ciphertext" },
      { provider: "openrouter", message: "第三章\n潮声渐近。" },
      { provider: "deepseek", message: "MOSHU-AES1.emergency-ciphertext" }
    ]);
  });

  it("treats gateway timeout responses as network fallback failures", async () => {
    const { deliveries, transport } = createTransport({
      async send(input) {
        if (input.provider === "tencent-tokenhub") {
          throw new OpenRouterError({
            code: "provider_error",
            status: 504,
            message: "The upstream response timed out"
          });
        }
      }
    });
    const sender = new ExternalBookSyncFailoverSender(transport);

    const result = await sender.send({
      requestId: "delivery_gateway_timeout",
      projectId: "project_1",
      sessionId: "session_1",
      plaintextMessage: "第四章\n风停了。",
      encryptedMessage: "MOSHU-AES1.gateway-timeout"
    });

    expect(result).toEqual({ provider: "openrouter", completion: "observable" });
    expect(deliveries.map((delivery) => delivery.provider)).toEqual(["tencent-tokenhub", "openrouter"]);
  });

  it("does not repeat DeepSeek for a payload that already used the emergency channel", async () => {
    const { deliveries, transport } = createTransport({
      async send() {
        throw new OpenRouterError({ code: "network_error", message: "network unavailable" });
      }
    });
    const sender = new ExternalBookSyncFailoverSender(transport);

    await expect(sender.send({
      requestId: "delivery_emergency_already_used",
      projectId: "project_1",
      sessionId: "session_1",
      plaintextMessage: "第五章\n霜落无声。",
      encryptedMessage: "MOSHU-AES1.emergency-already-used",
      allowEmergency: false
    })).rejects.toThrow("network unavailable");

    expect(deliveries.map((delivery) => delivery.provider)).toEqual(["tencent-tokenhub", "openrouter"]);
  });

  it("stops immediately on non-network provider failures", async () => {
    const { deliveries, transport } = createTransport({
      async send(input) {
        if (input.provider === "tencent-tokenhub") {
          throw new OpenRouterError({
            code: "rate_limited",
            status: 429,
            message: "rate limited"
          });
        }
      }
    });
    const sender = new ExternalBookSyncFailoverSender(transport);

    await expect(sender.send({
      requestId: "delivery_rate_limited",
      projectId: "project_1",
      sessionId: "session_1",
      plaintextMessage: "第六章\n灯火阑珊。",
      encryptedMessage: "MOSHU-AES1.rate-limited"
    })).rejects.toThrow("rate limited");

    expect(deliveries.map((delivery) => delivery.provider)).toEqual(["tencent-tokenhub"]);
  });

  it("silently skips providers whose API key is not configured", async () => {
    const { deliveries, transport } = createTransport({ configured: ["openrouter"] });
    const sender = new ExternalBookSyncFailoverSender(transport);

    const result = await sender.send({
      requestId: "delivery_openrouter_only",
      projectId: "project_1",
      sessionId: "session_1",
      plaintextMessage: "第七章\n云开月明。",
      encryptedMessage: "MOSHU-AES1.openrouter-only"
    });

    expect(result).toEqual({ provider: "openrouter", completion: "observable" });
    expect(deliveries).toEqual([
      { provider: "openrouter", message: "第七章\n云开月明。" }
    ]);
  });
});
