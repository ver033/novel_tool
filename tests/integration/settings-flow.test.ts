import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { SettingsRepository } from "../../src/main/db/repositories/settings-repo";
import {
  SettingsService,
  type OpenRouterConnectionTester,
  type OpenRouterModelCatalog,
  type SecretStore
} from "../../src/main/settings/settings-service";

const tempDirs: string[] = [];

const memorySecretStore: SecretStore = {
  encrypt(value) {
    return `encrypted:${Buffer.from(value, "utf8").toString("base64")}`;
  },
  decrypt(value) {
    return Buffer.from(value.replace(/^encrypted:/, ""), "base64").toString("utf8");
  }
};

function createSettingsService(connectionTester?: OpenRouterConnectionTester, modelCatalog?: OpenRouterModelCatalog) {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-settings-flow-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "novel-tool.sqlite3"));
  runMigrations(db);

  return {
    db,
    settingsService: new SettingsService(new SettingsRepository(db), {
      secretStore: memorySecretStore,
      connectionTester,
      modelCatalog
    })
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("settings flow", () => {
  it("persists editor, AI provider, and project path settings without exposing the API key", () => {
    const { db, settingsService } = createSettingsService();

    expect(settingsService.getSettings()).toMatchObject({
      editor: {
        fontSize: 20,
        lineHeight: 2.08,
        autosaveMs: 1000
      },
      aiProvider: null,
      projectPath: null,
      cache: {
        chapterCacheBuildOrder: "latest_first"
      }
    });

    const saved = settingsService.saveSettings({
      editor: {
        fontSize: 18,
        lineHeight: 2,
        autosaveMs: 800
      },
      aiProvider: {
        providerType: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        modelName: "deepseek-chat",
        apiKey: "secret_key",
        contextLength: 65_536
      },
      projectPath: "/tmp/novels"
    });

    expect(saved).toMatchObject({
      editor: {
        fontSize: 18,
        lineHeight: 2,
        autosaveMs: 800
      },
      aiProvider: {
        providerType: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        modelName: "deepseek-chat",
        apiKeyConfigured: true,
        contextLength: 65_536
      },
      projectPath: "/tmp/novels"
    });
    expect(JSON.stringify(saved)).not.toContain("secret_key");

    const reopenedSettingsService = new SettingsService(new SettingsRepository(db), {
      secretStore: memorySecretStore
    });
    const reopened = reopenedSettingsService.getSettings();
    expect(reopened.aiProvider?.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(reopened)).not.toContain("secret_key");

    const preservedKey = reopenedSettingsService.saveSettings({
      aiProvider: {
        providerType: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        modelName: "deepseek-reasoner"
      }
    });
    expect(preservedKey.aiProvider).toMatchObject({
      modelName: "deepseek-reasoner",
      apiKeyConfigured: true,
      contextLength: null
    });
    expect(JSON.stringify(preservedKey)).not.toContain("secret_key");

    db.close();
  });

  it("persists cache scheduling settings without dropping other settings sections", () => {
    const { db, settingsService } = createSettingsService();

    const saved = settingsService.saveSettings({
      cache: {
        chapterCacheBuildOrder: "front_to_back"
      }
    });
    expect(saved.cache.chapterCacheBuildOrder).toBe("front_to_back");

    const reopenedSettingsService = new SettingsService(new SettingsRepository(db), {
      secretStore: memorySecretStore
    });
    expect(reopenedSettingsService.getSettings().cache.chapterCacheBuildOrder).toBe("front_to_back");

    reopenedSettingsService.saveSettings({
      editor: {
        fontSize: 19
      }
    });
    expect(reopenedSettingsService.getSettings()).toMatchObject({
      editor: {
        fontSize: 19
      },
      cache: {
        chapterCacheBuildOrder: "front_to_back"
      }
    });

    db.close();
  });

  it("persists custom AI task prompt presets without accepting duplicate IDs", () => {
    const { db, settingsService } = createSettingsService();

    const saved = settingsService.saveSettings({
      taskPromptPresets: [
        {
          id: "preset_polish_classic",
          name: "古风润色",
          taskType: "polish",
          instruction: "用更古雅但不晦涩的表达润色选中文本。",
          showInSelectionMenu: true
        },
        {
          id: "preset_expand_mind",
          name: "增强心理描写",
          taskType: "expand",
          instruction: "补充人物心理活动，保持动作事实不变。",
          showInSelectionMenu: false
        }
      ]
    });

    expect(saved.taskPromptPresets).toEqual([
      {
        id: "preset_polish_classic",
        name: "古风润色",
        taskType: "polish",
        instruction: "用更古雅但不晦涩的表达润色选中文本。",
        showInSelectionMenu: true
      },
      {
        id: "preset_expand_mind",
        name: "增强心理描写",
        taskType: "expand",
        instruction: "补充人物心理活动，保持动作事实不变。",
        showInSelectionMenu: false
      }
    ]);

    const reopenedSettingsService = new SettingsService(new SettingsRepository(db), {
      secretStore: memorySecretStore
    });
    expect(reopenedSettingsService.getSettings().taskPromptPresets).toEqual(saved.taskPromptPresets);
    expect(reopenedSettingsService.getTaskPromptPresetForTask("preset_polish_classic", "polish")).toMatchObject({
      name: "古风润色",
      taskType: "polish"
    });
    expect(() => reopenedSettingsService.getTaskPromptPresetForTask("preset_polish_classic", "expand")).toThrow(
      "提示词预设“古风润色”不适用于扩写任务"
    );
    expect(() => reopenedSettingsService.getTaskPromptPresetForTask("preset_missing", "polish")).toThrow("提示词预设不存在");
    expect(() =>
      reopenedSettingsService.saveSettings({
        taskPromptPresets: [
          {
            id: "preset_duplicate",
            name: "压缩润色",
            taskType: "polish",
            instruction: "压缩啰嗦句子。",
            showInSelectionMenu: true
          },
          {
            id: "preset_duplicate",
            name: "动作续写",
            taskType: "continue",
            instruction: "承接动作继续写。",
            showInSelectionMenu: true
          }
        ]
      })
    ).toThrow("提示词预设 ID 重复");

    db.close();
  });

  it("tests OpenRouter connections with the decrypted saved key", async () => {
    const testedKeys: string[] = [];
    const { db, settingsService } = createSettingsService(
      {
        async testConnection(config) {
          testedKeys.push(config.apiKey);
          return { ok: true, modelName: config.modelName };
        }
      },
      {
        async listModels() {
          return [{ id: "deepseek-chat", name: "DeepSeek Chat", contextLength: 65_536, supportsTools: true }];
        }
      }
    );

    settingsService.saveSettings({
      aiProvider: {
        providerType: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        modelName: "deepseek-chat",
        apiKey: "secret_key"
      }
    });

    await expect(settingsService.testConnection()).resolves.toEqual({
      ok: true,
      modelName: "deepseek-chat"
    });
    expect(testedKeys).toEqual(["secret_key"]);

    db.close();
  });

  it("can test an OpenRouter API key before the user selects an exact model", async () => {
    const testedModels: string[] = [];
    const { db, settingsService } = createSettingsService({
      async testConnection(config) {
        testedModels.push(config.modelName);
        return { ok: true, modelName: config.modelName };
      }
    });

    await expect(
      settingsService.testConnection({
        aiProvider: {
          providerType: "openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: "secret_key"
        }
      })
    ).resolves.toEqual({
      ok: true,
      modelName: "openrouter/auto"
    });
    expect(testedModels).toEqual(["openrouter/auto"]);

    db.close();
  });

  it("rejects saved OpenRouter models that do not support tools before agent chat calls OpenRouter", async () => {
    let connectionCalled = false;
    const { db, settingsService } = createSettingsService(
      {
        async testConnection(config) {
          connectionCalled = true;
          return { ok: true, modelName: config.modelName };
        }
      },
      {
        async listModels() {
          return [{ id: "deepseek/deepseek-v3.2", name: "DeepSeek V3.2", contextLength: 131_072, supportsTools: true }];
        }
      }
    );

    settingsService.saveSettings({
      aiProvider: {
        providerType: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        modelName: "deepseek/deepseek-v3.2-speciale",
        apiKey: "secret_key",
        contextLength: 163_840
      }
    });

    await expect(settingsService.testConnection()).rejects.toThrow("当前模型不支持 OpenRouter tools");
    await expect(settingsService.getOpenRouterConfigWithModelMetadata(undefined, { requireTools: true })).rejects.toThrow(
      "deepseek/deepseek-v3.2-speciale"
    );
    expect(connectionCalled).toBe(false);

    db.close();
  });

  it("persists selected OpenRouter model context length for runtime budgets", () => {
    const { db, settingsService } = createSettingsService();

    settingsService.saveSettings({
      aiProvider: {
        providerType: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        modelName: "google/gemini-2.5-pro",
        apiKey: "secret_key",
        contextLength: 1_048_576
      }
    });

    expect(settingsService.getSettings().aiProvider).toMatchObject({
      modelName: "google/gemini-2.5-pro",
      contextLength: 1_048_576
    });
    expect(settingsService.getOpenRouterConfig()).toMatchObject({
      modelName: "google/gemini-2.5-pro",
      contextLength: 1_048_576
    });

    db.close();
  });

  it("preserves the configured OpenRouter-compatible base URL in runtime config", () => {
    const { db, settingsService } = createSettingsService();

    settingsService.saveSettings({
      aiProvider: {
        providerType: "openrouter",
        baseUrl: "https://openrouter-proxy.example.com/api/v1/",
        modelName: "google/gemini-2.5-pro",
        apiKey: "secret_key",
        contextLength: 1_048_576
      }
    });

    expect(settingsService.getOpenRouterConfig()).toMatchObject({
      baseUrl: "https://openrouter-proxy.example.com/api/v1/"
    });

    db.close();
  });

  it("lists OpenRouter models and filters suggestions by id or display name", async () => {
    const { db, settingsService } = createSettingsService(undefined, {
      async listModels() {
        return [
          { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", contextLength: 1_048_576, supportsTools: true },
          { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", contextLength: 200_000, supportsTools: true },
          { id: "openai/gpt-5.2", name: "GPT-5.2", contextLength: 400_000, supportsTools: true }
        ];
      }
    });

    await expect(settingsService.listOpenRouterModels({ query: "gem" })).resolves.toEqual([
      { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", contextLength: 1_048_576, supportsTools: true }
    ]);
    await expect(settingsService.listOpenRouterModels({ query: "sonnet" })).resolves.toEqual([
      { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", contextLength: 200_000, supportsTools: true }
    ]);

    db.close();
  });

  it("hydrates and persists the selected model context length when old settings do not have it", async () => {
    const { db, settingsService } = createSettingsService(undefined, {
      async listModels() {
        return [
          { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", contextLength: 1_048_576, supportsTools: true },
          { id: "openai/gpt-5.2", name: "GPT-5.2", contextLength: 400_000, supportsTools: true }
        ];
      }
    });
    settingsService.saveSettings({
      aiProvider: {
        providerType: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        modelName: "google/gemini-2.5-pro",
        apiKey: "secret_key"
      }
    });

    await expect(settingsService.getOpenRouterConfigWithModelMetadata()).resolves.toMatchObject({
      modelName: "google/gemini-2.5-pro",
      contextLength: 1_048_576
    });
    expect(settingsService.getSettings().aiProvider?.contextLength).toBe(1_048_576);
    expect(settingsService.getSettings().aiProvider?.supportsTools).toBe(true);

    db.close();
  });
});
