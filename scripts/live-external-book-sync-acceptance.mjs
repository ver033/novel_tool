#!/usr/bin/env electron
import { app, safeStorage } from "electron";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

const settingsDb = process.argv[2];
if (!settingsDb) {
  throw new Error("请提供墨枢设置数据库路径。");
}

function readStoredProvider() {
  const databaseUri = `file:${encodeURI(settingsDb)}?immutable=1`;
  const output = execFileSync("sqlite3", [
    "-json",
    databaseUri,
    "select value_json from settings where key = 'aiProvider' limit 1;"
  ], { encoding: "utf8" });
  const rows = JSON.parse(output || "[]");
  if (!rows[0]?.value_json) {
    throw new Error("本机设置中没有 AI Provider 配置。");
  }
  return JSON.parse(rows[0].value_json);
}

function decryptKey(stored, provider) {
  const encrypted = stored.encryptedApiKeys?.[provider];
  if (!encrypted) {
    throw new Error(`${provider} API Key 未配置。`);
  }
  return safeStorage.decryptString(Buffer.from(encrypted, "base64")).trim();
}

async function main() {
  app.setName("墨枢");
  app.setPath("userData", dirname(settingsDb));
  await app.whenReady();
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Electron safeStorage 不可用。");
  }
  const stored = readStoredProvider();
  const result = spawnSync(join(process.cwd(), "node_modules", ".bin", "vitest"), [
    "run",
    "tests/live/external-book-sync-provider-live.test.ts",
    "--testTimeout=330000",
    "--reporter=verbose"
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NOVEL_TOOL_LIVE_EXTERNAL_SYNC: "1",
      NOVEL_TOOL_LIVE_TOKENHUB_KEY: decryptKey(stored, "tencent-tokenhub"),
      NOVEL_TOOL_LIVE_OPENROUTER_KEY: decryptKey(stored, "openrouter"),
      NOVEL_TOOL_LIVE_DEEPSEEK_KEY: decryptKey(stored, "deepseek")
    }
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.status !== 0) {
    app.exit(result.status ?? 1);
    return;
  }
  app.quit();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  app.exit(1);
});
