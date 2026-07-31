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
      appLocale: "zh-CN",
      editor: {
        fontSize: 18,
        lineHeight: 1.82,
        autosaveMs: 1000
      },
      aiProvider: null,
      projectPath: null,
      cache: {
        chapterCacheBuildOrder: "latest_first"
      },
      experimental: {
        externalBookSyncAutomaticEnabled: true
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

  it("persists the application locale independently from editor and project settings", () => {
    const { db, settingsService } = createSettingsService();

    expect(settingsService.saveSettings({ appLocale: "ja-JP" }).appLocale).toBe("ja-JP");
    expect(new SettingsService(new SettingsRepository(db), { secretStore: memorySecretStore }).getSettings().appLocale).toBe("ja-JP");

    db.close();
  });

  it("keeps experimental automation enabled even when an old caller requests disabling it", () => {
    const { db, settingsService } = createSettingsService();

    expect(settingsService.getSettings().experimental.externalBookSyncAutomaticEnabled).toBe(true);
    expect(
      settingsService.saveSettings({
        experimental: { externalBookSyncAutomaticEnabled: false }
      }).experimental.externalBookSyncAutomaticEnabled
    ).toBe(true);
    expect(
      new SettingsService(new SettingsRepository(db), { secretStore: memorySecretStore }).getSettings().experimental
        .externalBookSyncAutomaticEnabled
    ).toBe(true);

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

  it("uses DeepSeek V4 Flash as the direct-provider default and exposes its static model capabilities", async () => {
    const testedConfigs: Array<{
      readonly providerType: string;
      readonly baseUrl: string;
      readonly modelName: string;
    }> = [];
    const { db, settingsService } = createSettingsService({
      async testConnection(config) {
        testedConfigs.push(config);
        return { ok: true, modelName: config.modelName };
      }
    }, {
      async listModels() {
        throw new Error("DeepSeek model listing must not call the OpenRouter catalog");
      }
    });

    await expect(settingsService.testConnection({
      aiProvider: {
        providerType: "deepseek",
        baseUrl: "https://api.deepseek.com",
        apiKey: "deepseek-secret"
      }
    })).resolves.toEqual({
      ok: true,
      modelName: "deepseek-v4-flash"
    });
    expect(testedConfigs).toEqual([{
      providerType: "deepseek",
      baseUrl: "https://api.deepseek.com",
      modelName: "deepseek-v4-flash",
      apiKey: "deepseek-secret",
      contextLength: null,
      supportsTools: null
    }]);
    await expect(settingsService.listAiModels({ providerType: "deepseek" })).resolves.toEqual([
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        contextLength: 1_000_000,
        supportsTools: true
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        contextLength: 1_000_000,
        supportsTools: true
      }
    ]);

    db.close();
  });

  it("keeps OpenRouter, DeepSeek, and Tencent Cloud TokenHub API keys isolated when switching providers", async () => {
    const { db, settingsService } = createSettingsService();

    settingsService.saveSettings({
      aiProvider: {
        providerType: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        modelName: "openai/gpt-5.2",
        apiKey: "openrouter-secret"
      }
    });
    expect(() => settingsService.getAiConfig({
      providerType: "deepseek",
      baseUrl: "https://api.deepseek.com",
      modelName: "deepseek-v4-flash"
    })).toThrow("DeepSeek API Key 未配置");

    settingsService.saveSettings({
      aiProvider: {
        providerType: "deepseek",
        baseUrl: "https://api.deepseek.com",
        modelName: "deepseek-v4-flash",
        apiKey: "deepseek-secret"
      }
    });
    expect(() => settingsService.getAiConfig({
      providerType: "tencent-tokenhub",
      baseUrl: "https://tokenhub.tencentmaas.com/v1",
      modelName: "deepseek-v4-flash"
    })).toThrow("腾讯云 TokenHub API Key 未配置");

    settingsService.saveSettings({
      aiProvider: {
        providerType: "tencent-tokenhub",
        baseUrl: "https://tokenhub.tencentmaas.com/v1",
        modelName: "deepseek-v4-flash",
        apiKey: "tencent-tokenhub-secret"
      }
    });
    expect(settingsService.getSettings().aiProviderKeyStatus).toEqual({
      openrouter: true,
      deepseek: true,
      "tencent-tokenhub": true
    });
    expect(settingsService.getAiConfig()).toMatchObject({
      providerType: "tencent-tokenhub",
      apiKey: "tencent-tokenhub-secret",
      modelName: "deepseek-v4-flash"
    });

    settingsService.saveSettings({
      aiProvider: {
        providerType: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        modelName: "openai/gpt-5.2"
      }
    });
    expect(settingsService.getAiConfig()).toMatchObject({
      providerType: "openrouter",
      apiKey: "openrouter-secret",
      modelName: "openai/gpt-5.2"
    });
    expect(settingsService.getAiConfigForProvider("deepseek")).toMatchObject({
      providerType: "deepseek",
      apiKey: "deepseek-secret",
      baseUrl: "https://api.deepseek.com",
      modelName: "deepseek-v4-flash"
    });
    expect(settingsService.getAiConfigForProvider("tencent-tokenhub")).toMatchObject({
      providerType: "tencent-tokenhub",
      apiKey: "tencent-tokenhub-secret",
      baseUrl: "https://tokenhub.tencentmaas.com/v1",
      modelName: "deepseek-v4-flash"
    });
    await expect(settingsService.getAiConfigWithModelMetadataForProvider("deepseek")).resolves.toMatchObject({
      providerType: "deepseek",
      contextLength: 1_000_000,
      supportsTools: true
    });
    expect(JSON.stringify(settingsService.getSettings())).not.toContain("secret");

    db.close();
  });

  it("migrates the legacy single encrypted OpenRouter key into provider-scoped storage", () => {
    const { db, settingsService } = createSettingsService();
    new SettingsRepository(db).setJson("aiProvider", {
      providerType: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      modelName: "openai/gpt-5.2",
      contextLength: 400_000,
      supportsTools: true,
      encryptedApiKey: memorySecretStore.encrypt("legacy-openrouter-secret")
    });

    expect(settingsService.getAiConfig()).toMatchObject({
      providerType: "openrouter",
      apiKey: "legacy-openrouter-secret"
    });
    expect(settingsService.getSettings().aiProviderKeyStatus).toEqual({
      openrouter: true,
      deepseek: false,
      "tencent-tokenhub": false
    });
    const stored = new SettingsRepository(db).getJson<Record<string, unknown>>("aiProvider");
    expect(stored).toHaveProperty("encryptedApiKeys.openrouter");
    expect(stored).not.toHaveProperty("encryptedApiKey");

    db.close();
  });

  it("uses Tencent Cloud TokenHub defaults and forwards its temporary key to the authenticated model catalog", async () => {
    const testedConfigs: unknown[] = [];
    const catalogInputs: unknown[] = [];
    const { db, settingsService } = createSettingsService({
      async testConnection(config) {
        testedConfigs.push(config);
        return { ok: true, modelName: config.modelName };
      }
    }, {
      async listModels(input) {
        catalogInputs.push(input);
        return [{
          id: "deepseek-v4-flash",
          name: "deepseek-v4-flash",
          contextLength: null,
          supportsTools: null
        }];
      }
    });

    await expect(settingsService.testConnection({
      aiProvider: {
        providerType: "tencent-tokenhub",
        baseUrl: "https://tokenhub.tencentmaas.com/v1",
        apiKey: "temporary-tencent-tokenhub-secret"
      }
    })).resolves.toEqual({
      ok: true,
      modelName: "deepseek-v4-flash"
    });
    await expect(settingsService.listAiModels({
      providerType: "tencent-tokenhub",
      baseUrl: "https://tokenhub.tencentmaas.com/v1",
      apiKey: "temporary-tencent-tokenhub-secret"
    })).resolves.toEqual([{
      id: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      contextLength: 1_000_000,
      supportsTools: true
    }]);

    expect(testedConfigs).toEqual([{
      providerType: "tencent-tokenhub",
      apiKey: "temporary-tencent-tokenhub-secret",
      baseUrl: "https://tokenhub.tencentmaas.com/v1",
      modelName: "deepseek-v4-flash",
      contextLength: null,
      supportsTools: null
    }]);
    expect(catalogInputs).toEqual([{
      providerType: "tencent-tokenhub",
      baseUrl: "https://tokenhub.tencentmaas.com/v1",
      apiKey: "temporary-tencent-tokenhub-secret"
    }]);

    db.close();
  });

  it("allows a manually selected Tencent Cloud TokenHub model when the official catalog has no capability metadata", async () => {
    const { db, settingsService } = createSettingsService(undefined, {
      async listModels() {
        throw new Error("runtime metadata lookup should use only locally verified Tencent Cloud TokenHub overrides");
      }
    });
    settingsService.saveSettings({
      aiProvider: {
        providerType: "tencent-tokenhub",
        baseUrl: "https://tokenhub.tencentmaas.com/v1",
        modelName: "another-tencent-tokenhub-chat-model",
        apiKey: "tencent-tokenhub-secret"
      }
    });

    await expect(settingsService.getAiConfigWithModelMetadata(undefined, { requireTools: true })).resolves.toMatchObject({
      providerType: "tencent-tokenhub",
      modelName: "another-tencent-tokenhub-chat-model",
      contextLength: null,
      supportsTools: null
    });

    db.close();
  });

  it("removes the old tokenhub.com key and resets an active legacy TokenHub provider to Tencent Cloud defaults", () => {
    const { db, settingsService } = createSettingsService();
    new SettingsRepository(db).setJson("aiProvider", {
      providerType: "tokenhub",
      baseUrl: "https://us-api.tokenhub.com/v1",
      modelName: "deepseek-v4-flash",
      contextLength: 1_000_000,
      supportsTools: true,
      encryptedApiKeys: {
        openrouter: memorySecretStore.encrypt("openrouter-secret"),
        tokenhub: memorySecretStore.encrypt("removed-tokenhub-com-secret")
      }
    });

    expect(settingsService.getSettings().aiProvider).toMatchObject({
      providerType: "tencent-tokenhub",
      baseUrl: "https://tokenhub.tencentmaas.com/v1",
      modelName: "deepseek-v4-flash",
      apiKeyConfigured: false
    });
    expect(settingsService.getSettings().aiProviderKeyStatus).toEqual({
      openrouter: true,
      deepseek: false,
      "tencent-tokenhub": false
    });
    expect(() => settingsService.getAiConfig()).toThrow("腾讯云 TokenHub API Key 未配置");
    const stored = new SettingsRepository(db).getJson<Record<string, unknown>>("aiProvider");
    expect(stored).not.toHaveProperty("encryptedApiKeys.tokenhub");
    expect(JSON.stringify(stored)).not.toContain("removed-tokenhub-com-secret");

    db.close();
  });

  it("hydrates DeepSeek runtime metadata without querying OpenRouter", async () => {
    const { db, settingsService } = createSettingsService(undefined, {
      async listModels() {
        throw new Error("OpenRouter catalog should not be used for DeepSeek");
      }
    });
    settingsService.saveSettings({
      aiProvider: {
        providerType: "deepseek",
        baseUrl: "https://api.deepseek.com",
        modelName: "deepseek-v4-flash",
        apiKey: "deepseek-secret"
      }
    });

    await expect(settingsService.getAiConfigWithModelMetadata(undefined, { requireTools: true })).resolves.toMatchObject({
      providerType: "deepseek",
      modelName: "deepseek-v4-flash",
      contextLength: 1_000_000,
      supportsTools: true
    });
    expect(settingsService.getSettings().aiProvider).toMatchObject({
      providerType: "deepseek",
      contextLength: 1_000_000,
      supportsTools: true,
      apiKeyConfigured: true
    });

    db.close();
  });
});
