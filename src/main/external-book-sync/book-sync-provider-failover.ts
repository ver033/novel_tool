import { OpenRouterError } from "../ai/openrouter-error";

export const EXTERNAL_BOOK_SYNC_PROVIDER_ORDER = [
  "tencent-tokenhub",
  "openrouter",
  "deepseek"
] as const;

export type ExternalBookSyncProvider = (typeof EXTERNAL_BOOK_SYNC_PROVIDER_ORDER)[number];

export type ExternalBookSyncProviderTransport = {
  readonly isConfigured: (provider: ExternalBookSyncProvider) => boolean;
  readonly send: (input: {
    readonly provider: ExternalBookSyncProvider;
    readonly requestId: string;
    readonly projectId: string;
    readonly sessionId: string;
    readonly message: string;
  }) => Promise<void>;
};

export type ExternalBookSyncFailoverResult = {
  readonly provider: ExternalBookSyncProvider;
  readonly completion: "observable" | "emergency";
};

const NETWORK_GATEWAY_STATUSES = new Set([408, 502, 503, 504, 520, 521, 522, 523, 524]);

export function isExternalBookSyncNetworkFailure(error: unknown): boolean {
  return error instanceof OpenRouterError && (
    error.code === "network_error"
    || error.code === "timeout"
    || (error.status !== undefined && NETWORK_GATEWAY_STATUSES.has(error.status))
  );
}

export class ExternalBookSyncFailoverSender {
  constructor(private readonly transport: ExternalBookSyncProviderTransport) {}

  async send(input: {
    readonly requestId: string;
    readonly projectId: string;
    readonly sessionId: string;
    readonly plaintextMessage: string;
    readonly encryptedMessage: string;
    readonly allowEmergency?: boolean;
  }): Promise<ExternalBookSyncFailoverResult> {
    let lastNetworkError: unknown = null;
    for (const provider of EXTERNAL_BOOK_SYNC_PROVIDER_ORDER) {
      if (provider === "deepseek" && input.allowEmergency === false) {
        continue;
      }
      if (!this.transport.isConfigured(provider)) {
        continue;
      }
      try {
        await this.transport.send({
          provider,
          requestId: input.requestId,
          projectId: input.projectId,
          sessionId: input.sessionId,
          message: provider === "openrouter" ? input.plaintextMessage : input.encryptedMessage
        });
        return {
          provider,
          completion: provider === "deepseek" ? "emergency" : "observable"
        };
      } catch (error) {
        if (!isExternalBookSyncNetworkFailure(error)) {
          throw error;
        }
        lastNetworkError = error;
      }
    }
    if (lastNetworkError) {
      throw lastNetworkError;
    }
    throw new Error("外部同步没有可用的 AI Provider。");
  }
}
