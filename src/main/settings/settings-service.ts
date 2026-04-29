import { SettingsRepository } from "../db/repositories/settings-repo";
import type {
  AiProviderSettingsState,
  EditorSettings,
  OpenRouterModelSummary,
  SettingsListModelsInput,
  SettingsSaveInput,
  SettingsState,
  TaskPromptPreset,
  TaskType
} from "../shared/types";

const EDITOR_SETTINGS_KEY = "editor";
const AI_PROVIDER_SETTINGS_KEY = "aiProvider";
const PROJECT_PATH_SETTINGS_KEY = "projectPath";
const TASK_PROMPT_PRESETS_SETTINGS_KEY = "taskPromptPresets";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontSize: 20,
  lineHeight: 2.08,
  autosaveMs: 1000,
  layoutPreset: "immersive",
  pageWidth: "medium",
  fontFamily: "system",
  paragraphSpacing: "standard",
  firstLineIndent: "two",
  theme: "light"
};

export type SecretStore = {
  readonly encrypt: (value: string) => string;
  readonly decrypt: (value: string) => string;
};

export type OpenRouterRuntimeConfig = {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly modelName: string;
};

export type OpenRouterConnectionTestResult = {
  readonly ok: true;
  readonly modelName: string;
};

export type OpenRouterConnectionTester = {
  readonly testConnection: (config: OpenRouterRuntimeConfig) => Promise<OpenRouterConnectionTestResult>;
};

export type OpenRouterModelCatalog = {
  readonly listModels: () => Promise<readonly OpenRouterModelSummary[]>;
};

export type SettingsServiceDeps = {
  readonly secretStore?: SecretStore;
  readonly connectionTester?: OpenRouterConnectionTester;
  readonly modelCatalog?: OpenRouterModelCatalog;
};

type StoredAiProviderSettings = Omit<AiProviderSettingsState, "apiKeyConfigured"> & {
  readonly encryptedApiKey?: string;
  /** Legacy plaintext key from early development builds. Re-encrypted on next save. */
  readonly apiKey?: string;
};

const unavailableSecretStore: SecretStore = {
  encrypt() {
    throw new Error("安全存储未初始化，不能保存 OpenRouter API Key。");
  },
  decrypt() {
    throw new Error("安全存储未初始化，不能读取 OpenRouter API Key。");
  }
};

const unavailableConnectionTester: OpenRouterConnectionTester = {
  async testConnection() {
    throw new Error("OpenRouter 连接测试未初始化。");
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

  return {
    providerType: "openrouter",
    baseUrl: settings.baseUrl || OPENROUTER_BASE_URL,
    modelName: settings.modelName,
    apiKeyConfigured: Boolean(settings.encryptedApiKey ?? settings.apiKey)
  };
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
  private readonly connectionTester: OpenRouterConnectionTester;
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
    return {
      editor: {
        ...DEFAULT_EDITOR_SETTINGS,
        ...savedEditor
      },
      aiProvider: sanitizeAiProvider(this.getStoredAiProviderSettings()),
      projectPath: this.settingsRepo.getJson<string>(PROJECT_PATH_SETTINGS_KEY),
      taskPromptPresets: this.listTaskPromptPresets()
    };
  }

  saveSettings(input: SettingsSaveInput): SettingsState {
    if (input.editor) {
      this.settingsRepo.setJson(EDITOR_SETTINGS_KEY, {
        ...this.getSettings().editor,
        ...input.editor
      });
    }

    if (input.aiProvider) {
      const current = this.getStoredAiProviderSettings();
      const encryptedApiKey = input.aiProvider.apiKey
        ? this.secretStore.encrypt(input.aiProvider.apiKey)
        : current?.encryptedApiKey ?? (current?.apiKey ? this.secretStore.encrypt(current.apiKey) : undefined);
      this.settingsRepo.setJson(AI_PROVIDER_SETTINGS_KEY, {
        providerType: "openrouter",
        baseUrl: OPENROUTER_BASE_URL,
        modelName: input.aiProvider.modelName,
        ...(encryptedApiKey ? { encryptedApiKey } : {})
      } satisfies StoredAiProviderSettings);
    }

    if (input.projectPath !== undefined) {
      this.settingsRepo.setJson(PROJECT_PATH_SETTINGS_KEY, input.projectPath);
    }

    if (input.taskPromptPresets !== undefined) {
      this.settingsRepo.setJson(TASK_PROMPT_PRESETS_SETTINGS_KEY, normalizeTaskPromptPresets(input.taskPromptPresets));
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

  getOpenRouterConfig(override?: SettingsSaveInput["aiProvider"]): OpenRouterRuntimeConfig {
    const settings = this.getStoredAiProviderSettings();
    const modelName = override?.modelName?.trim() || settings?.modelName;
    const apiKey = override?.apiKey?.trim() || this.getStoredApiKey(settings);

    if (!modelName) {
      throw new Error("OpenRouter 模型名称未配置。");
    }
    if (!apiKey) {
      throw new Error("OpenRouter API Key 未配置。");
    }

    return {
      apiKey,
      baseUrl: OPENROUTER_BASE_URL,
      modelName
    };
  }

  async testConnection(input?: { readonly aiProvider?: SettingsSaveInput["aiProvider"] }): Promise<OpenRouterConnectionTestResult> {
    return this.connectionTester.testConnection(this.getOpenRouterConfig(input?.aiProvider));
  }

  async listOpenRouterModels(input?: SettingsListModelsInput): Promise<OpenRouterModelSummary[]> {
    const query = input?.query?.trim().toLocaleLowerCase("zh-CN") ?? "";
    const models = await this.modelCatalog.listModels();
    const filtered = query
      ? models.filter((model) => `${model.id} ${model.name}`.toLocaleLowerCase("zh-CN").includes(query))
      : models;
    return filtered.slice(0, query ? 30 : 400).map((model) => ({
      id: model.id,
      name: model.name,
      contextLength: model.contextLength
    }));
  }

  private getStoredApiKey(settings: StoredAiProviderSettings | null): string | null {
    if (!settings) {
      return null;
    }
    if (settings.encryptedApiKey) {
      return this.secretStore.decrypt(settings.encryptedApiKey);
    }
    return settings.apiKey ?? null;
  }

  private getStoredAiProviderSettings(): StoredAiProviderSettings | null {
    const settings = this.settingsRepo.getJson<StoredAiProviderSettings>(AI_PROVIDER_SETTINGS_KEY);
    if (!settings?.apiKey || settings.encryptedApiKey) {
      return settings;
    }

    const encryptedApiKey = this.secretStore.encrypt(settings.apiKey);
    const migrated = {
      providerType: "openrouter",
      baseUrl: settings.baseUrl || OPENROUTER_BASE_URL,
      modelName: settings.modelName,
      encryptedApiKey
    } satisfies StoredAiProviderSettings;
    this.settingsRepo.setJson(AI_PROVIDER_SETTINGS_KEY, migrated);
    return migrated;
  }
}
