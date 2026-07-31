import { SettingsRepository } from "../db/repositories/settings-repo";
import type {
  AiProviderSettingsState,
  AiProviderKeyStatus,
  AiProviderType,
  CacheSettings,
  EditorSettings,
  ExperimentalSettings,
  OpenRouterModelSummary,
  SettingsListModelsInput,
  SettingsSaveInput,
  SettingsTestConnectionInput,
  SettingsState,
  TaskPromptPreset,
  TaskType
} from "../shared/types";
import { appLocaleSchema, DEFAULT_APP_LOCALE } from "../shared/language";
import { DEFAULT_EDITOR_SETTINGS } from "../shared/editor-settings";
import {
  DEEPSEEK_MODEL_SUMMARIES,
  getAiProviderDefaults,
  getAiProviderDisplayName,
  isAiProviderType,
  TENCENT_TOKENHUB_KNOWN_MODEL_SUMMARIES
} from "../shared/ai-provider";

const EDITOR_SETTINGS_KEY = "editor";
const AI_PROVIDER_SETTINGS_KEY = "aiProvider";
const PROJECT_PATH_SETTINGS_KEY = "projectPath";
const TASK_PROMPT_PRESETS_SETTINGS_KEY = "taskPromptPresets";
const CACHE_SETTINGS_KEY = "cache";
const APP_LOCALE_SETTINGS_KEY = "appLocale";
const EXPERIMENTAL_SETTINGS_KEY = "experimental";
export const OPENROUTER_BASE_URL = getAiProviderDefaults("openrouter").baseUrl;
export const OPENROUTER_CONNECTION_TEST_MODEL = getAiProviderDefaults("openrouter").connectionTestModel;
export const DEEPSEEK_BASE_URL = getAiProviderDefaults("deepseek").baseUrl;
export const DEEPSEEK_DEFAULT_MODEL = getAiProviderDefaults("deepseek").modelName;
export const TENCENT_TOKENHUB_BASE_URL = getAiProviderDefaults("tencent-tokenhub").baseUrl;
export const TENCENT_TOKENHUB_DEFAULT_MODEL = getAiProviderDefaults("tencent-tokenhub").modelName;

const DEFAULT_CACHE_SETTINGS: CacheSettings = {
  chapterCacheBuildOrder: "latest_first"
};

const DEFAULT_EXPERIMENTAL_SETTINGS: ExperimentalSettings = {
  externalBookSyncAutomaticEnabled: true
};

export type SecretStore = {
  readonly encrypt: (value: string) => string;
  readonly decrypt: (value: string) => string;
};

export type AiRuntimeConfig = {
  readonly providerType: AiProviderType;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly modelName: string;
  readonly contextLength: number | null;
  readonly supportsTools?: boolean | null;
};

/** @deprecated Use AiRuntimeConfig. Kept for compatibility with existing callers. */
export type OpenRouterRuntimeConfig = AiRuntimeConfig;

export type AiConnectionTestResult = {
  readonly ok: true;
  readonly modelName: string;
};

/** @deprecated Use AiConnectionTestResult. */
export type OpenRouterConnectionTestResult = AiConnectionTestResult;

export type AiConnectionTester = {
  readonly testConnection: (config: AiRuntimeConfig) => Promise<AiConnectionTestResult>;
};

/** @deprecated Use AiConnectionTester. */
export type OpenRouterConnectionTester = AiConnectionTester;

export type OpenRouterModelCatalog = {
  readonly listModels: (input?: {
    readonly providerType?: AiProviderType;
    readonly baseUrl?: string;
    readonly apiKey?: string;
  }) => Promise<readonly OpenRouterModelSummary[]>;
};

export type SettingsServiceDeps = {
  readonly secretStore?: SecretStore;
  readonly connectionTester?: AiConnectionTester;
  readonly modelCatalog?: OpenRouterModelCatalog;
};

type RemovedAiProviderType = "tokenhub";

type StoredAiProviderSettings = Omit<AiProviderSettingsState, "providerType" | "apiKeyConfigured"> & {
  readonly providerType: AiProviderType | RemovedAiProviderType;
  readonly encryptedApiKeys?: Partial<Record<AiProviderType | RemovedAiProviderType, string>>;
  /** Legacy single-provider ciphertext. Migrated to encryptedApiKeys on read. */
  readonly encryptedApiKey?: string;
  /** Legacy plaintext key from early development builds. Re-encrypted on next save. */
  readonly apiKey?: string;
};

const unavailableSecretStore: SecretStore = {
  encrypt() {
    throw new Error("安全存储未初始化，不能保存 AI Provider API Key。");
  },
  decrypt() {
    throw new Error("安全存储未初始化，不能读取 AI Provider API Key。");
  }
};

const unavailableConnectionTester: AiConnectionTester = {
  async testConnection() {
    throw new Error("AI Provider 连接测试未初始化。");
  }
};

const unavailableModelCatalog: OpenRouterModelCatalog = {
  async listModels() {
    throw new Error("OpenRouter 模型列表服务未初始化。");
  }
};

function sanitizeAiProvider(settings: StoredAiProviderSettings | null): AiProviderSettingsState | null {
  if (!settings) {
    return null;
  }

  const providerType = normalizeProviderType(settings.providerType);
  const defaults = getAiProviderDefaults(providerType);
  return {
    providerType,
    baseUrl: settings.baseUrl || defaults.baseUrl,
    modelName: settings.modelName || defaults.modelName,
    contextLength: settings.contextLength ?? null,
    supportsTools: settings.supportsTools ?? null,
    apiKeyConfigured: Boolean(settings.encryptedApiKeys?.[providerType] ?? settings.encryptedApiKey ?? settings.apiKey)
  };
}

function normalizeProviderType(value: unknown): AiProviderType {
  return isAiProviderType(value) ? value : "openrouter";
}

function emptyAiProviderKeyStatus(): AiProviderKeyStatus {
  return {
    openrouter: false,
    deepseek: false,
    "tencent-tokenhub": false
  };
}

function enrichTencentTokenHubModels(models: readonly OpenRouterModelSummary[]): OpenRouterModelSummary[] {
  const knownById = new Map<string, OpenRouterModelSummary>(
    TENCENT_TOKENHUB_KNOWN_MODEL_SUMMARIES.map((model) => [model.id, model])
  );
  return models.map((model) => {
    const known = knownById.get(model.id);
    return known
      ? {
          ...model,
          name: known.name,
          contextLength: known.contextLength,
          supportsTools: known.supportsTools
        }
      : model;
  });
}

function normalizeTaskPromptPresets(presets: readonly TaskPromptPreset[]): TaskPromptPreset[] {
  const seenIds = new Set<string>();
  return presets.map((preset) => {
    const id = preset.id.trim();
    const name = preset.name.trim();
    const instruction = preset.instruction.trim();
    if (!id) {
      throw new Error("提示词预设 ID 不能为空。");
    }
    if (!name) {
      throw new Error("提示词预设名称不能为空。");
    }
    if (!instruction) {
      throw new Error("提示词预设要求不能为空。");
    }
    if (!["polish", "expand", "continue"].includes(preset.taskType)) {
      throw new Error("提示词预设只支持润色、扩写、续写。");
    }
    if (seenIds.has(id)) {
      throw new Error("提示词预设 ID 重复。");
    }
    seenIds.add(id);
    return {
      id,
      name,
      taskType: preset.taskType,
      instruction,
      showInSelectionMenu: preset.showInSelectionMenu
    };
  });
}

function normalizeCacheSettings(settings: Partial<CacheSettings> | null): CacheSettings {
  return {
    ...DEFAULT_CACHE_SETTINGS,
    ...settings
  };
}

function taskTypeLabel(taskType: TaskType): string {
  return {
    polish: "润色",
    expand: "扩写",
    proofread: "校对",
    continue: "续写"
  }[taskType];
}

export class SettingsService {
  private readonly secretStore: SecretStore;
  private readonly connectionTester: AiConnectionTester;
  private readonly modelCatalog: OpenRouterModelCatalog;

  constructor(
    private readonly settingsRepo: SettingsRepository,
    deps: SettingsServiceDeps = {}
  ) {
    this.secretStore = deps.secretStore ?? unavailableSecretStore;
    this.connectionTester = deps.connectionTester ?? unavailableConnectionTester;
    this.modelCatalog = deps.modelCatalog ?? unavailableModelCatalog;
  }

  getSettings(): SettingsState {
    const savedEditor = this.settingsRepo.getJson<Partial<EditorSettings>>(EDITOR_SETTINGS_KEY);
    const savedCache = this.settingsRepo.getJson<Partial<CacheSettings>>(CACHE_SETTINGS_KEY);
    const savedExperimental = this.settingsRepo.getJson<Partial<ExperimentalSettings>>(EXPERIMENTAL_SETTINGS_KEY);
    const storedAiProvider = this.getStoredAiProviderSettings();
    return {
      appLocale: appLocaleSchema.catch(DEFAULT_APP_LOCALE).parse(this.settingsRepo.getJson<unknown>(APP_LOCALE_SETTINGS_KEY)),
      editor: {
        ...DEFAULT_EDITOR_SETTINGS,
        ...savedEditor
      },
      aiProvider: sanitizeAiProvider(storedAiProvider),
      aiProviderKeyStatus: this.getAiProviderKeyStatus(storedAiProvider),
      projectPath: this.settingsRepo.getJson<string>(PROJECT_PATH_SETTINGS_KEY),
      taskPromptPresets: this.listTaskPromptPresets(),
      cache: normalizeCacheSettings(savedCache),
      experimental: {
        ...DEFAULT_EXPERIMENTAL_SETTINGS,
        ...savedExperimental,
        externalBookSyncAutomaticEnabled: true
      }
    };
  }

  saveSettings(input: SettingsSaveInput): SettingsState {
    if (input.appLocale) {
      this.settingsRepo.setJson(APP_LOCALE_SETTINGS_KEY, input.appLocale);
    }

    if (input.editor) {
      this.settingsRepo.setJson(EDITOR_SETTINGS_KEY, {
        ...this.getSettings().editor,
        ...input.editor
      });
    }

    if (input.aiProvider) {
      const current = this.getStoredAiProviderSettings();
      const providerType = input.aiProvider.providerType;
      const defaults = getAiProviderDefaults(providerType);
      const currentProviderType = current ? normalizeProviderType(current.providerType) : null;
      const encryptedApiKeys = {
        ...(current?.encryptedApiKeys ?? {})
      };
      if (input.aiProvider.apiKey) {
        encryptedApiKeys[providerType] = this.secretStore.encrypt(input.aiProvider.apiKey);
      }
      this.settingsRepo.setJson(AI_PROVIDER_SETTINGS_KEY, {
        providerType,
        baseUrl: input.aiProvider.baseUrl?.trim()
          || (currentProviderType === providerType ? current?.baseUrl : undefined)
          || defaults.baseUrl,
        modelName: input.aiProvider.modelName?.trim()
          || (currentProviderType === providerType ? current?.modelName : undefined)
          || defaults.modelName,
        contextLength: input.aiProvider.contextLength ?? null,
        supportsTools: input.aiProvider.supportsTools
          ?? (currentProviderType === providerType ? current?.supportsTools : undefined)
          ?? null,
        ...(Object.keys(encryptedApiKeys).length > 0 ? { encryptedApiKeys } : {})
      } satisfies StoredAiProviderSettings);
    }

    if (input.projectPath !== undefined) {
      this.settingsRepo.setJson(PROJECT_PATH_SETTINGS_KEY, input.projectPath);
    }

    if (input.taskPromptPresets !== undefined) {
      this.settingsRepo.setJson(TASK_PROMPT_PRESETS_SETTINGS_KEY, normalizeTaskPromptPresets(input.taskPromptPresets));
    }

    if (input.cache) {
      this.settingsRepo.setJson(CACHE_SETTINGS_KEY, normalizeCacheSettings({
        ...this.getSettings().cache,
        ...input.cache
      }));
    }

    if (input.experimental) {
      this.settingsRepo.setJson(EXPERIMENTAL_SETTINGS_KEY, {
        ...this.getSettings().experimental,
        ...input.experimental,
        externalBookSyncAutomaticEnabled: true
      } satisfies ExperimentalSettings);
    }

    return this.getSettings();
  }

  listTaskPromptPresets(): TaskPromptPreset[] {
    return normalizeTaskPromptPresets(this.settingsRepo.getJson<TaskPromptPreset[]>(TASK_PROMPT_PRESETS_SETTINGS_KEY) ?? []);
  }

  getTaskPromptPresetForTask(presetId: string | null | undefined, taskType: TaskType): TaskPromptPreset | null {
    if (!presetId) {
      return null;
    }

    const preset = this.listTaskPromptPresets().find((item) => item.id === presetId);
    if (!preset) {
      throw new Error(`提示词预设不存在：${presetId}。`);
    }
    if (preset.taskType !== taskType) {
      throw new Error(`提示词预设“${preset.name}”不适用于${taskTypeLabel(taskType)}任务。`);
    }

    return preset;
  }

  getAiConfig(override?: SettingsSaveInput["aiProvider"]): AiRuntimeConfig {
    const settings = this.getStoredAiProviderSettings();
    const providerType = override?.providerType ?? (settings ? normalizeProviderType(settings.providerType) : "openrouter");
    const defaults = getAiProviderDefaults(providerType);
    const usesStoredProviderSettings = settings ? normalizeProviderType(settings.providerType) === providerType : false;
    const modelName = override?.modelName?.trim()
      || (usesStoredProviderSettings ? settings?.modelName : undefined)
      || defaults.modelName;
    const apiKey = override?.apiKey?.trim() || this.getStoredApiKey(settings, providerType);
    const providerName = getAiProviderDisplayName(providerType);

    if (!modelName) {
      throw new Error(`${providerName} 模型名称未配置。`);
    }
    if (!apiKey) {
      throw new Error(`${providerName} API Key 未配置。`);
    }

    return {
      providerType,
      apiKey,
      baseUrl: override?.baseUrl?.trim()
        || (usesStoredProviderSettings ? settings?.baseUrl : undefined)
        || defaults.baseUrl,
      modelName,
      contextLength: override?.contextLength
        ?? (usesStoredProviderSettings ? settings?.contextLength : undefined)
        ?? null,
      supportsTools: override?.supportsTools
        ?? (usesStoredProviderSettings ? settings?.supportsTools : undefined)
        ?? null
    };
  }

  getAiConfigForProvider(providerType: AiProviderType): AiRuntimeConfig {
    const defaults = getAiProviderDefaults(providerType);
    return this.getAiConfig({
      providerType,
      baseUrl: defaults.baseUrl,
      modelName: defaults.modelName,
      contextLength: null,
      supportsTools: null
    });
  }

  /** @deprecated Use getAiConfig. */
  getOpenRouterConfig(override?: SettingsSaveInput["aiProvider"]): OpenRouterRuntimeConfig {
    return this.getAiConfig(override);
  }

  async getAiConfigWithModelMetadata(
    override?: SettingsSaveInput["aiProvider"],
    options: { readonly requireTools?: boolean } = {}
  ): Promise<AiRuntimeConfig> {
    const config = this.getAiConfig(override);
    if (options.requireTools && config.supportsTools === false) {
      throw new Error(this.unsupportedToolsModelMessage(config.providerType, config.modelName));
    }
    if (config.contextLength !== null && (!options.requireTools || config.supportsTools === true)) {
      return config;
    }

    const metadata = await this.findModelMetadata(config);
    if (
      options.requireTools
      && (metadata?.supportsTools === false || (!metadata && config.providerType !== "tencent-tokenhub"))
    ) {
      throw new Error(this.unsupportedToolsModelMessage(config.providerType, config.modelName));
    }
    if (!metadata) {
      return config;
    }

    if (!override?.modelName && !override?.contextLength && override?.supportsTools === undefined) {
      this.saveSettings({
        aiProvider: {
          providerType: config.providerType,
          baseUrl: config.baseUrl,
          modelName: config.modelName,
          contextLength: metadata.contextLength,
          supportsTools: metadata.supportsTools ?? null
        }
      });
    }

    return {
      ...config,
      contextLength: metadata.contextLength,
      supportsTools: metadata.supportsTools ?? null
    };
  }

  getAiConfigWithModelMetadataForProvider(
    providerType: AiProviderType,
    options: { readonly requireTools?: boolean } = {}
  ): Promise<AiRuntimeConfig> {
    const defaults = getAiProviderDefaults(providerType);
    return this.getAiConfigWithModelMetadata(
      {
        providerType,
        baseUrl: defaults.baseUrl,
        modelName: defaults.modelName,
        contextLength: null,
        supportsTools: null
      },
      options
    );
  }

  /** @deprecated Use getAiConfigWithModelMetadata. */
  async getOpenRouterConfigWithModelMetadata(
    override?: SettingsSaveInput["aiProvider"],
    options: { readonly requireTools?: boolean } = {}
  ): Promise<OpenRouterRuntimeConfig> {
    return this.getAiConfigWithModelMetadata(override, options);
  }

  async testConnection(input?: SettingsTestConnectionInput): Promise<AiConnectionTestResult> {
    const override = input?.aiProvider;
    if (!override) {
      return this.connectionTester.testConnection(await this.getAiConfigWithModelMetadata(undefined, { requireTools: true }));
    }
    if (!override.modelName?.trim()) {
      return this.connectionTester.testConnection(this.getConnectionTestConfig(override));
    }

    return this.connectionTester.testConnection(
      await this.getAiConfigWithModelMetadata(
        {
          providerType: override.providerType,
          baseUrl: override.baseUrl,
          modelName: override.modelName,
          contextLength: override.contextLength,
          supportsTools: override.supportsTools,
          apiKey: override.apiKey
        },
        { requireTools: true }
      )
    );
  }

  async listAiModels(input?: SettingsListModelsInput): Promise<OpenRouterModelSummary[]> {
    const stored = this.getStoredAiProviderSettings();
    const providerType = input?.providerType ?? (stored ? normalizeProviderType(stored.providerType) : "openrouter");
    const query = input?.query?.trim().toLocaleLowerCase("zh-CN") ?? "";
    const models = providerType === "deepseek"
      ? DEEPSEEK_MODEL_SUMMARIES
      : providerType === "tencent-tokenhub"
        ? enrichTencentTokenHubModels(await this.modelCatalog.listModels({
            providerType,
            baseUrl: input?.baseUrl?.trim()
              || (stored && normalizeProviderType(stored.providerType) === providerType ? stored.baseUrl : undefined)
              || getAiProviderDefaults(providerType).baseUrl,
            apiKey: input?.apiKey?.trim() || this.getStoredApiKey(stored, providerType) || undefined
          }))
        : await this.modelCatalog.listModels({ providerType });
    const filtered = query
      ? models.filter((model) => `${model.id} ${model.name}`.toLocaleLowerCase("zh-CN").includes(query))
      : models;
    return filtered.slice(0, query ? 30 : 400).map((model) => ({
      id: model.id,
      name: model.name,
      contextLength: model.contextLength,
      supportsTools: model.supportsTools ?? null
    }));
  }

  /** @deprecated Use listAiModels. */
  async listOpenRouterModels(input?: SettingsListModelsInput): Promise<OpenRouterModelSummary[]> {
    return this.listAiModels(input);
  }

  private getStoredApiKey(settings: StoredAiProviderSettings | null, providerType: AiProviderType): string | null {
    if (!settings) {
      return null;
    }
    const encryptedApiKey = settings.encryptedApiKeys?.[providerType];
    if (encryptedApiKey) {
      return this.secretStore.decrypt(encryptedApiKey);
    }
    return null;
  }

  private getAiProviderKeyStatus(settings: StoredAiProviderSettings | null): AiProviderKeyStatus {
    const status = emptyAiProviderKeyStatus();
    if (!settings) {
      return status;
    }
    for (const providerType of ["openrouter", "deepseek", "tencent-tokenhub"] as const) {
      status[providerType] = Boolean(settings.encryptedApiKeys?.[providerType]);
    }
    return status;
  }

  private getConnectionTestConfig(
    override: NonNullable<NonNullable<SettingsTestConnectionInput>["aiProvider"]>
  ): AiRuntimeConfig {
    const settings = this.getStoredAiProviderSettings();
    const providerType = override.providerType;
    const providerName = getAiProviderDisplayName(providerType);
    const defaults = getAiProviderDefaults(providerType);
    const settingsMatchProvider = settings ? normalizeProviderType(settings.providerType) === providerType : false;
    const apiKey = override.apiKey?.trim() || this.getStoredApiKey(settings, providerType);
    if (!apiKey) {
      throw new Error(`${providerName} API Key 未配置。`);
    }

    return {
      providerType,
      apiKey,
      baseUrl: override.baseUrl?.trim()
        || (settingsMatchProvider ? settings?.baseUrl : undefined)
        || defaults.baseUrl,
      modelName: defaults.connectionTestModel,
      contextLength: null,
      supportsTools: null
    };
  }

  private getStoredAiProviderSettings(): StoredAiProviderSettings | null {
    const settings = this.settingsRepo.getJson<StoredAiProviderSettings>(AI_PROVIDER_SETTINGS_KEY);
    if (!settings) {
      return null;
    }

    const removedTokenHubWasActive = settings.providerType === "tokenhub";
    const providerType: AiProviderType = removedTokenHubWasActive
      ? "tencent-tokenhub"
      : normalizeProviderType(settings.providerType);
    const defaults = getAiProviderDefaults(providerType);
    const {
      tokenhub: removedTokenHubEncryptedKey,
      ...retainedEncryptedApiKeys
    } = settings.encryptedApiKeys ?? {};
    const legacyEncryptedApiKey = removedTokenHubWasActive
      ? undefined
      : settings.encryptedApiKey
        ?? (settings.apiKey ? this.secretStore.encrypt(settings.apiKey) : undefined);
    const encryptedApiKeys = {
      ...retainedEncryptedApiKeys,
      ...(legacyEncryptedApiKey ? { [providerType]: legacyEncryptedApiKey } : {})
    };
    const requiresMigration = removedTokenHubWasActive
      || Boolean(removedTokenHubEncryptedKey)
      || Boolean(settings.encryptedApiKey)
      || Boolean(settings.apiKey);
    if (!requiresMigration) {
      return settings as StoredAiProviderSettings;
    }
    const migrated = {
      providerType,
      baseUrl: removedTokenHubWasActive ? defaults.baseUrl : settings.baseUrl || defaults.baseUrl,
      modelName: removedTokenHubWasActive ? defaults.modelName : settings.modelName || defaults.modelName,
      contextLength: removedTokenHubWasActive ? 1_000_000 : settings.contextLength ?? null,
      supportsTools: removedTokenHubWasActive ? true : settings.supportsTools ?? null,
      ...(Object.keys(encryptedApiKeys).length > 0 ? { encryptedApiKeys } : {})
    } satisfies StoredAiProviderSettings;
    this.settingsRepo.setJson(AI_PROVIDER_SETTINGS_KEY, migrated);
    return migrated;
  }

  private unsupportedToolsModelMessage(providerType: AiProviderType, modelName: string): string {
    const providerName = getAiProviderDisplayName(providerType);
    const example = providerType === "openrouter"
      ? "deepseek/deepseek-v3.2"
      : providerType === "tencent-tokenhub"
        ? TENCENT_TOKENHUB_DEFAULT_MODEL
        : DEEPSEEK_DEFAULT_MODEL;
    return `当前模型不支持 ${providerName} tools：${modelName}。AI 对话需要工具调用能力，请在设置中选择支持工具调用的模型，例如 ${example}。`;
  }

  private async findModelMetadata(config: AiRuntimeConfig): Promise<OpenRouterModelSummary | null> {
    const normalizedModelName = config.modelName.trim().toLocaleLowerCase("zh-CN");
    if (!normalizedModelName) {
      return null;
    }

    if (config.providerType === "tencent-tokenhub") {
      return TENCENT_TOKENHUB_KNOWN_MODEL_SUMMARIES.find(
        (item) => item.id.toLocaleLowerCase("zh-CN") === normalizedModelName
      ) ?? null;
    }

    const models = config.providerType === "deepseek"
      ? DEEPSEEK_MODEL_SUMMARIES
      : await this.modelCatalog.listModels({
          providerType: config.providerType,
          baseUrl: config.baseUrl,
          apiKey: undefined
        });
    return models.find((item) => item.id.toLocaleLowerCase("zh-CN") === normalizedModelName) ?? null;
  }
}
