import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

let logFilePath: string | null = null;

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }
  return {
    message: String(error)
  };
}

export function initializeMainLogger(userDataPath: string): void {
  const logDirectory = path.join(userDataPath, "logs");
  mkdirSync(logDirectory, { recursive: true });
  logFilePath = path.join(logDirectory, "main.log");
}

export function writeMainLog(level: "info" | "warn" | "error", message: string, metadata: Record<string, unknown> = {}): void {
  if (!logFilePath) {
    return;
  }

  appendFileSync(
    logFilePath,
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...metadata
    })}\n`,
    "utf8"
  );
}

export function logMainError(message: string, error: unknown): void {
  writeMainLog("error", message, {
    error: serializeError(error)
  });
}

export function installMainProcessErrorHandlers(): void {
  process.on("uncaughtException", (error) => {
    logMainError("uncaughtException", error);
  });
  process.on("unhandledRejection", (reason) => {
    logMainError("unhandledRejection", reason);
  });
}
