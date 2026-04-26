type LogWriter = (...data: unknown[]) => void;

function isBrokenPipeError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EPIPE';
}

export function logMain(message: string, details?: unknown, writer: LogWriter = console.log): void {
  try {
    if (details === undefined) {
      writer(`[main] ${message}`);
      return;
    }
    writer(`[main] ${message}`, details);
  } catch (error) {
    if (isBrokenPipeError(error)) {
      return;
    }
    throw error;
  }
}
