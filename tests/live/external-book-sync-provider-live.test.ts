import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiProviderType } from "../../src/main/shared/ai-provider";
import type { AiRuntimeConfig, SettingsService } from "../../src/main/settings/settings-service";
import { ExternalBookSyncFailoverSender, type ExternalBookSyncProvider } from "../../src/main/external-book-sync/book-sync-provider-failover";
import { SettingsExternalBookSyncProviderTransport } from "../../src/main/external-book-sync/book-sync-provider-transport";
import { encryptExternalBookSyncMessage } from "../../src/main/external-book-sync/book-sync-crypto";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { SettingsRepository } from "../../src/main/db/repositories/settings-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { emptyChapterContent } from "../../src/main/chapter/default-content";
import { createId } from "../../src/main/shared/ids";
import { countWritingUnits } from "../../src/main/shared/text";
import { ExternalBookSourceStore } from "../../src/main/external-book-sync/book-source-store";
import { ExternalBookSyncAutomationStore } from "../../src/main/external-book-sync/book-automation-store";
import { ExternalBookSentChapterStore } from "../../src/main/external-book-sync/book-send-history-store";
import { ExternalBookSyncDeliveryStore } from "../../src/main/external-book-sync/book-sync-delivery-store";
import { ExternalBookSyncService } from "../../src/main/external-book-sync/external-book-sync-service";

const liveEnabled = process.env.NOVEL_TOOL_LIVE_EXTERNAL_SYNC === "1";
const providerKeys: Record<ExternalBookSyncProvider, string> = {
  "tencent-tokenhub": process.env.NOVEL_TOOL_LIVE_TOKENHUB_KEY ?? "",
  openrouter: process.env.NOVEL_TOOL_LIVE_OPENROUTER_KEY ?? "",
  deepseek: process.env.NOVEL_TOOL_LIVE_DEEPSEEK_KEY ?? ""
};
const providerDefaults: Record<ExternalBookSyncProvider, Pick<AiRuntimeConfig, "baseUrl" | "modelName">> = {
  "tencent-tokenhub": {
    baseUrl: "https://tokenhub.tencentmaas.com/v1",
    modelName: "deepseek-v4-flash"
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    modelName: "openrouter/auto"
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    modelName: "deepseek-v4-flash"
  }
};

function createSettings(options: {
  readonly configured: readonly ExternalBookSyncProvider[];
  readonly forcedOffline?: readonly ExternalBookSyncProvider[];
  readonly invalidKey?: ExternalBookSyncProvider;
}): Pick<SettingsService, "getSettings" | "getAiConfigForProvider"> {
  const configured = new Set(options.configured);
  const forcedOffline = new Set(options.forcedOffline ?? []);
  return {
    getSettings() {
      return {
        aiProviderKeyStatus: {
          "tencent-tokenhub": configured.has("tencent-tokenhub"),
          openrouter: configured.has("openrouter"),
          deepseek: configured.has("deepseek")
        }
      } as ReturnType<SettingsService["getSettings"]>;
    },
    getAiConfigForProvider(providerType: AiProviderType) {
      const provider = providerType as ExternalBookSyncProvider;
      return {
        providerType,
        apiKey: options.invalidKey === provider ? "invalid-key-for-live-acceptance" : providerKeys[provider],
        baseUrl: forcedOffline.has(provider) ? "https://127.0.0.1:1/v1" : providerDefaults[provider].baseUrl,
        modelName: providerDefaults[provider].modelName,
        contextLength: null,
        supportsTools: null
      };
    }
  };
}

async function sendWith(options: {
  readonly configured: readonly ExternalBookSyncProvider[];
  readonly forcedOffline?: readonly ExternalBookSyncProvider[];
  readonly invalidKey?: ExternalBookSyncProvider;
}) {
  const sender = new ExternalBookSyncFailoverSender(
    new SettingsExternalBookSyncProviderTransport(createSettings(options))
  );
  const plaintextMessage = [
    "【墨枢外部同步真实验收】",
    "投递编号：live_external_sync_中文_20260801",
    "",
    "第二章　雨夜归人",
    "𠮷野撑着油纸伞，说：“山河無恙🌙。”"
  ].join("\n");
  return sender.send({
    requestId: "live_external_sync_20260801",
    projectId: "live_project",
    sessionId: "live_session",
    plaintextMessage,
    encryptedMessage: await encryptExternalBookSyncMessage(plaintextMessage)
  });
}

describe.skipIf(!liveEnabled)("external Book sync live providers", () => {
  it.each([
    ["tencent-tokenhub"],
    ["openrouter"],
    ["deepseek"]
  ] as const)("accepts a minimal real request through %s", async (provider) => {
    expect(providerKeys[provider]).not.toBe("");
    const result = await sendWith({ configured: [provider] });
    expect(result.provider).toBe(provider);
    expect(result.completion).toBe(provider === "deepseek" ? "emergency" : "observable");
  }, 330_000);

  it("falls back from a forced TokenHub network failure to the real OpenRouter API", async () => {
    const result = await sendWith({
      configured: ["tencent-tokenhub", "openrouter"],
      forcedOffline: ["tencent-tokenhub"]
    });
    expect(result).toEqual({ provider: "openrouter", completion: "observable" });
  }, 330_000);

  it("falls back through two forced network failures to the real DeepSeek API", async () => {
    const result = await sendWith({
      configured: ["tencent-tokenhub", "openrouter", "deepseek"],
      forcedOffline: ["tencent-tokenhub", "openrouter"]
    });
    expect(result).toEqual({ provider: "deepseek", completion: "emergency" });
  }, 330_000);

  it("does not fall back after a real non-network authentication rejection", async () => {
    await expect(sendWith({
      configured: ["tencent-tokenhub", "openrouter", "deepseek"],
      invalidKey: "tencent-tokenhub"
    })).rejects.toMatchObject({ status: 401 });
  }, 330_000);

  it("runs a real Book scan and completes it through the OpenRouter fallback only once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "moshu-live-external-sync-"));
    const database = createDatabase(":memory:");
    try {
      runMigrations(database);
      const settingsRepo = new SettingsRepository(database);
      const projectRepo = new ProjectRepository(database);
      const chapterRepo = new ChapterRepository(database);
      const project = projectRepo.create({
        id: createId("live_project"),
        name: "真实同步验收",
        rootPath: join(dir, "真实同步验收.noveltool"),
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z"
      });
      chapterRepo.create({
        id: createId("live_chapter"),
        projectId: project.id,
        title: "第一章",
        volumeTitle: null,
        sortOrder: 0,
        contentJson: emptyChapterContent,
        plainText: "第一章正文。",
        wordCount: countWritingUnits("第一章正文。"),
        dailyWordCount: 0,
        dailyWordCountDate: null,
        targetWordCount: null,
        status: "draft",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z"
      });
      const bookDir = join(dir, "真实同步验收");
      mkdirSync(bookDir, { recursive: true });
      writeFileSync(join(bookDir, "第二章.Book"), "第二章　雨夜归人\n𠮷野撑着油纸伞，说：“山河無恙🌙。”", "utf8");
      const failover = new ExternalBookSyncFailoverSender(new SettingsExternalBookSyncProviderTransport(createSettings({
        configured: ["tencent-tokenhub", "openrouter"],
        forcedOffline: ["tencent-tokenhub"]
      })));
      const service = new ExternalBookSyncService({
        sourceStore: new ExternalBookSourceStore(settingsRepo),
        automationStore: new ExternalBookSyncAutomationStore(settingsRepo),
        sentChapterStore: new ExternalBookSentChapterStore(settingsRepo),
        deliveryStore: new ExternalBookSyncDeliveryStore(settingsRepo),
        resolveChapterRepo: () => chapterRepo,
        projectRepo,
        aiSender: {
          createChatSession(input) {
            return { id: createId("live_external_session"), title: input.title };
          },
          sendChatMessage(input) {
            return failover.send({
              requestId: input.requestId,
              projectId: input.projectId,
              sessionId: input.sessionId,
              plaintextMessage: input.plaintextMessage,
              encryptedMessage: input.message,
              allowEmergency: input.allowEmergency
            });
          }
        }
      });
      const scan = await service.scanProject({
        projectId: project.id,
        mode: "directory",
        directoryPath: bookDir,
        roots: [bookDir],
        timeBudgetMs: 10_000
      });
      const candidate = scan.candidates[0];
      const sendInput = {
        projectId: project.id,
        candidateId: candidate.id,
        chapterKeys: candidate.comparison.missingChapters.map((chapter) => chapter.key)
      };

      const first = await service.sendMissingChaptersToAi(sendInput);
      const duplicate = await service.sendMissingChaptersToAi(sendInput);

      expect(first).toMatchObject({ sentChapterCount: 1, sentMissingChapterCount: 1 });
      expect(duplicate).toMatchObject({ sentChapterCount: 0, sentMessageCount: 0 });
    } finally {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 330_000);
});
