export type OpenRouterErrorCode = "canceled" | "rate_limited" | "provider_error" | "invalid_response" | "network_error" | "timeout";

export class OpenRouterError extends Error {
  readonly code: OpenRouterErrorCode;
  readonly status?: number;
  readonly isCanceled: boolean;
  override readonly cause?: unknown;

  constructor(input: {
    readonly code: OpenRouterErrorCode;
    readonly message: string;
    readonly status?: number;
    readonly isCanceled?: boolean;
    readonly cause?: unknown;
  }) {
    super(input.message);
    this.name = "OpenRouterError";
    this.code = input.code;
    this.status = input.status;
    this.isCanceled = Boolean(input.isCanceled);
    this.cause = input.cause;
  }
}

export function isOpenRouterCanceledError(reason: unknown): boolean {
  return reason instanceof OpenRouterError && reason.isCanceled;
}
