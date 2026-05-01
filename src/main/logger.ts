import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";

const MAX_MAIN_LOG_BYTES = 5 * 1024 * 1024;
const REDACTED = "[REDACTED]";

let logFilePath: string | null = null;
let pendingWrite: Promise<void> = Promise.resolve();

function redactText(value: string): string {
  return value
    .replace(/sk-or-v1-[A-Za-z0-9._-]+/g, REDACTED)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, `Bearer ${REDACTED}`);
}

function shouldRedactKey(key: string): boolean {
  const normalized = key.replace(/[\s_-]+/g, "").toLowerCase();
  return (
    normalized === "apikey" ||
    normalized === "authorization" ||
    normalized === "bearer" ||
    normalized === "token" ||
    (normalized.endsWith("token") && /^(access|refresh|auth|id|session)/u.test(normalized)) ||
    normalized.includes("secret") ||
    normalized.includes("password")
  );
}

function sanitizeLogValue(value: unknown, key = "", depth = 0): unknown {
  if (depth > 5) {
    return "[MaxDepth]";
  }
  if (shouldRedactKey(key)) {
    return REDACTED;
  }
  if (typeof value === "string") {
    return redactText(value);
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      stack: value.stack ? redactText(value.stack) : undefined
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, "", depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeLogValue(entryValue, entryKey, depth + 1)
      ])
    );
  }
  return value;
}

async function rotateMainLogIfNeeded(filePath: string): Promise<void> {
  try {
    const info = await stat(filePath);
    if (info.size <= MAX_MAIN_LOG_BYTES) {
      return;
    }
    await rename(filePath, `${filePath}.1`);
  } catch {
    // Missing or temporarily unavailable log files should not affect the app.
  }
}

function enqueueLogWrite(write: () => Promise<void>): void {
  pendingWrite = pendingWrite
    .catch(() => undefined)
    .then(write)
    .catch(() => undefined);
}

export function initializeMainLogger(userDataPath: string): void {
  const logDirectory = path.join(userDataPath, "logs");
  const nextLogFilePath = path.join(logDirectory, "main.log");
  logFilePath = nextLogFilePath;
  enqueueLogWrite(async () => {
    await mkdir(logDirectory, { recursive: true });
    await rotateMainLogIfNeeded(nextLogFilePath);
  });
}

export function writeMainLog(level: "info" | "warn" | "error", message: string, metadata: Record<string, unknown> = {}): void {
  if (!logFilePath) {
    return;
  }

  const targetPath = logFilePath;
  const payload = sanitizeLogValue({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...metadata
  }) as Record<string, unknown>;
  enqueueLogWrite(async () => {
    await rotateMainLogIfNeeded(targetPath);
    await appendFile(targetPath, `${JSON.stringify(payload)}\n`, "utf8");
  });
}

export function logMainError(message: string, error: unknown): void {
  writeMainLog("error", message, {
    error
  });
}

export async function flushMainLoggerForTests(): Promise<void> {
  await pendingWrite;
}

export function installMainProcessErrorHandlers(): void {
  process.on("uncaughtException", (error) => {
    logMainError("uncaughtException", error);
  });
  process.on("unhandledRejection", (reason) => {
    logMainError("unhandledRejection", reason);
  });
}
