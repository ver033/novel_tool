import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { flushMainLoggerForTests, initializeMainLogger, writeMainLog } from "../../src/main/logger";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("main logger", () => {
  it("writes asynchronously and redacts secrets from metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-tool-logger-"));
    tempDirs.push(dir);
    initializeMainLogger(dir);

    writeMainLog("error", "OpenRouter failed", {
      apiKey: "sk-or-v1-secret-key",
      authorization: "Bearer third-party-token",
      nested: {
        message: "provider echoed sk-or-v1-secret-key and Bearer another-secret"
      },
      maxInputTokens: 12000
    });
    await flushMainLoggerForTests();

    const log = readFileSync(join(dir, "logs", "main.log"), "utf8");
    expect(log).toContain("OpenRouter failed");
    expect(log).toContain("[REDACTED]");
    expect(log).toContain('"maxInputTokens":12000');
    expect(log).not.toContain("sk-or-v1-secret-key");
    expect(log).not.toContain("third-party-token");
    expect(log).not.toContain("another-secret");
  });
});
