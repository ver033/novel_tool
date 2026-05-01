import {
  GearSix,
  Robot,
  Sliders,
  X
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AiProviderSettingsState, EditorSettings, OpenRouterModelSummary, SettingsSaveInput, SettingsState, SettingsTestConnectionInput, TaskPromptPreset } from "../../main/shared/types";
import { Button } from "../components/Button";
import { IconButton } from "../components/IconButton";
import { Input } from "../components/Input";
import { Textarea } from "../components/Textarea";
import { getNovelToolApi } from "../state/app-store";

export type SettingsCategory = "通用" | "编辑器" | "AI 服务" | "提示词预设" | "导入导出" | "备份与数据" | "快捷键";

type SettingsPageProps = {
  readonly activeCategory: SettingsCategory;
  readonly onCategoryChange: (category: SettingsCategory) => void;
  readonly onWelcome: () => void;
  readonly onClose: () => void;
};

type EditableAiProviderSettings = Omit<AiProviderSettingsState, "apiKeyConfigured"> & {
  readonly apiKey: string;
};

type SettingsFormState = {
  readonly editor: EditorSettings;
  readonly aiProvider: EditableAiProviderSettings;
  readonly projectPath: string;
  readonly taskPromptPresets: readonly TaskPromptPreset[];
};

type StatusState = {
  readonly kind: "idle" | "loading" | "saving" | "saved" | "testing" | "error";
  readonly message: string | null;
};

type SettingsContentProps = {
  readonly apiKeyConfigured: boolean;
  readonly category: SettingsCategory;
  readonly form: SettingsFormState;
  readonly isBusy: boolean;
  readonly modelListLoaded: boolean;
  readonly modelOptions: readonly OpenRouterModelSummary[];
  readonly status: StatusState;
  readonly onAiProviderChange: (patch: Partial<EditableAiProviderSettings>) => void;
  readonly onTaskPromptPresetsChange: (taskPromptPresets: readonly TaskPromptPreset[]) => void;
  readonly onTestConnection: () => void;
  readonly onSaveSettings: () => void;
};

const visibleCategories = ["AI 服务", "提示词预设"] as const satisfies readonly SettingsCategory[];
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const taskPromptPresetLabels: Record<TaskPromptPreset["taskType"], string> = {
  polish: "润色",
  expand: "扩写",
  continue: "续写"
};

const builtInPromptPresetDescriptions: readonly [string, string, string][] = [
  ["基础润色", "润色", "保持事实不变，让语言更顺滑。"],
  ["细节扩写", "扩写", "补充环境、动作和心理细节。"],
  ["自然续写", "续写", "承接当前章节语气继续推进。"]
];

type VisibleSettingsCategory = (typeof visibleCategories)[number];

const categoryIcons: Record<VisibleSettingsCategory, ReactNode> = {
  "AI 服务": <Robot size={20} />,
  提示词预设: <Sliders size={20} />
};

function isVisibleCategory(category: SettingsCategory): category is VisibleSettingsCategory {
  return (visibleCategories as readonly SettingsCategory[]).includes(category);
}

const defaultForm: SettingsFormState = {
  editor: {
    fontSize: 20,
    lineHeight: 2.08,
    autosaveMs: 1000,
    layoutPreset: "immersive",
    pageWidth: "medium",
    fontFamily: "system",
    paragraphSpacing: "standard",
    firstLineIndent: "two",
    theme: "light"
  },
  aiProvider: {
    providerType: "openrouter",
    baseUrl: OPENROUTER_BASE_URL,
    modelName: "openai/gpt-5.2",
    contextLength: null,
    supportsTools: null,
    apiKey: ""
  },
  projectPath: "",
  taskPromptPresets: []
};

function formatError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function formFromSettings(settings: SettingsState): SettingsFormState {
  return {
    editor: settings.editor,
    aiProvider: {
      providerType: settings.aiProvider?.providerType ?? defaultForm.aiProvider.providerType,
      baseUrl: settings.aiProvider?.baseUrl ?? defaultForm.aiProvider.baseUrl,
      modelName: settings.aiProvider?.modelName ?? defaultForm.aiProvider.modelName,
      contextLength: settings.aiProvider?.contextLength ?? null,
      supportsTools: settings.aiProvider?.supportsTools ?? null,
      apiKey: ""
    },
    projectPath: settings.projectPath ?? "",
    taskPromptPresets: [...settings.taskPromptPresets]
  };
}

function buildSaveInput(form: SettingsFormState): SettingsSaveInput {
  const apiKey = form.aiProvider.apiKey.trim();
  return {
    editor: form.editor,
    aiProvider: {
      providerType: form.aiProvider.providerType,
      baseUrl: form.aiProvider.baseUrl.trim(),
      modelName: form.aiProvider.modelName.trim(),
      contextLength: form.aiProvider.contextLength ?? null,
      supportsTools: form.aiProvider.supportsTools ?? null,
      ...(apiKey ? { apiKey } : {})
    },
    taskPromptPresets: [...form.taskPromptPresets],
    ...(form.projectPath.trim() ? { projectPath: form.projectPath.trim() } : {})
  };
}

function buildConnectionTestInput(form: SettingsFormState): SettingsTestConnectionInput {
  const apiKey = form.aiProvider.apiKey.trim();
  return {
    aiProvider: {
      providerType: form.aiProvider.providerType,
      baseUrl: form.aiProvider.baseUrl.trim(),
      ...(apiKey ? { apiKey } : {})
    }
  };
}

function createTaskPromptPresetId(): string {
  if (globalThis.crypto?.randomUUID) {
    return `preset_${globalThis.crypto.randomUUID()}`;
  }
  return `preset_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function filterModelSuggestions(models: readonly OpenRouterModelSummary[], query: string): readonly OpenRouterModelSummary[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  if (!normalizedQuery) {
    return [];
  }

  return models
    .filter((model) => `${model.id} ${model.name}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery))
    .slice(0, 8);
}

function formatContextLength(value: number | null): string {
  if (!value) {
    return "上下文未知";
  }
  return `${value.toLocaleString("zh-CN")} tokens`;
}

function findExactModel(models: readonly OpenRouterModelSummary[], modelName: string): OpenRouterModelSummary | null {
  const normalized = modelName.trim().toLocaleLowerCase("zh-CN");
  return models.find((model) => model.id.toLocaleLowerCase("zh-CN") === normalized) ?? null;
}

export function SettingsPage({ activeCategory, onCategoryChange, onWelcome, onClose }: SettingsPageProps) {
  const api = useMemo(getNovelToolApi, []);
  const [form, setForm] = useState<SettingsFormState>(defaultForm);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [modelOptions, setModelOptions] = useState<OpenRouterModelSummary[]>([]);
  const [modelListLoaded, setModelListLoaded] = useState(false);
  const [status, setStatus] = useState<StatusState>({ kind: "loading", message: "正在读取设置" });
  const activeVisibleCategory = isVisibleCategory(activeCategory) ? activeCategory : "AI 服务";

  const isBusy = status.kind === "loading" || status.kind === "saving" || status.kind === "testing";

  const applySettings = (settings: SettingsState) => {
    setForm(formFromSettings(settings));
    setApiKeyConfigured(Boolean(settings.aiProvider?.apiKeyConfigured));
  };

  useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      setStatus({ kind: "loading", message: "正在读取设置" });
      try {
        const settings = (await api.settings.get()) as SettingsState;
        if (cancelled) {
          return;
        }
        applySettings(settings);
        setStatus({ kind: "idle", message: null });
      } catch (reason) {
        if (cancelled) {
          return;
        }
        setStatus({ kind: "error", message: formatError(reason) });
      }
    }

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const saveSettings = async () => {
    const selectedModel = form.aiProvider.modelName.trim();
    if (!selectedModel) {
      setStatus({ kind: "error", message: "请选择模型后保存。" });
      return;
    }

    setStatus({ kind: "saving", message: "正在保存设置" });
    try {
      const matchedModel = findExactModel(modelOptions, selectedModel);
      const formToSave = matchedModel
        ? {
            ...form,
            aiProvider: {
              ...form.aiProvider,
              contextLength: matchedModel.contextLength,
              supportsTools: matchedModel.supportsTools ?? null
            }
          } satisfies SettingsFormState
        : form;
      const saved = (await api.settings.save(buildSaveInput(formToSave))) as SettingsState;
      applySettings(saved);
      setStatus({ kind: "saved", message: "设置已保存" });
    } catch (reason) {
      setStatus({ kind: "error", message: formatError(reason) });
    }
  };

  const testConnection = async () => {
    setStatus({ kind: "testing", message: "正在测试 AI 连接" });
    try {
      await api.settings.testConnection(buildConnectionTestInput(form));
    } catch (reason) {
      setStatus({ kind: "error", message: `连接测试失败：${formatError(reason)}` });
      return;
    }

    setStatus({ kind: "testing", message: "连接测试通过，正在获取模型列表" });
    try {
      const models = (await api.settings.listModels({})) as OpenRouterModelSummary[];
      const matchedModel = findExactModel(models, form.aiProvider.modelName);
      setModelOptions([...models]);
      setModelListLoaded(true);
      setForm((current) => ({
        ...current,
        aiProvider: {
          ...current.aiProvider,
          contextLength: matchedModel?.contextLength ?? current.aiProvider.contextLength ?? null,
          supportsTools: matchedModel?.supportsTools ?? current.aiProvider.supportsTools ?? null
        }
      }));
      setStatus({
        kind: "saved",
        message: matchedModel
          ? `测试连接成功，已获取 ${models.length} 个可用模型。当前模型上下文 ${formatContextLength(matchedModel.contextLength)}，请选择模型后保存。`
          : `测试连接成功，已获取 ${models.length} 个可用模型。请选择模型后保存。`
      });
    } catch (reason) {
      setStatus({ kind: "error", message: `连接可用，但获取模型列表失败：${formatError(reason)}` });
    }
  };

  const updateAiProvider = (patch: Partial<EditableAiProviderSettings>) => {
    setForm((current) => ({
      ...current,
      aiProvider: {
        ...current.aiProvider,
        ...patch,
        ...(patch.modelName !== undefined && patch.contextLength === undefined
          ? {
              contextLength: findExactModel(modelOptions, patch.modelName)?.contextLength ?? null,
              supportsTools: findExactModel(modelOptions, patch.modelName)?.supportsTools ?? null
            }
          : {})
      }
    }));
  };

  const updateTaskPromptPresets = (taskPromptPresets: readonly TaskPromptPreset[]) => {
    setForm((current) => ({
      ...current,
      taskPromptPresets
    }));
  };

  return (
    <div className="settings-page">
      <header className="settings-top">
        <button className="brand brand-button" onClick={onWelcome} title="返回上一页" type="button">
          <span className="line-icon">
            <GearSix size={24} />
          </span>
          <span>设置</span>
        </button>
        <div className="top-actions">
          <IconButton label="关闭设置" onClick={onClose}>
            <X size={22} />
          </IconButton>
        </div>
      </header>

      <main className="settings-layout">
        <nav className="settings-nav" aria-label="设置分类">
          {visibleCategories.map((category) => (
            <button className={activeVisibleCategory === category ? "active" : ""} key={category} onClick={() => onCategoryChange(category)} type="button">
              <span className="nav-icon">{categoryIcons[category]}</span>
              {category}
            </button>
          ))}
        </nav>
        <section className="settings-content">
          <SettingsContent
            apiKeyConfigured={apiKeyConfigured}
            category={activeVisibleCategory}
            form={form}
            isBusy={isBusy}
            modelListLoaded={modelListLoaded}
            modelOptions={modelOptions}
            status={status}
            onAiProviderChange={updateAiProvider}
            onTaskPromptPresetsChange={updateTaskPromptPresets}
            onSaveSettings={() => void saveSettings()}
            onTestConnection={testConnection}
          />
          <div className="notice">
            <span>你的作品和设置仅保存在本地设备，不会默认同步到云端。只有在你主动使用 AI 功能时，相关内容才会发送到所选 AI 服务。</span>
          </div>
          {status.message ? <p className={`settings-message ${status.kind}`}>{status.message}</p> : null}
          <div className="wizard-actions">
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button variant="primary" disabled={isBusy} onClick={() => void saveSettings()}>保存设置</Button>
          </div>
        </section>
      </main>
    </div>
  );
}

function SettingsContent({
  apiKeyConfigured,
  category,
  form,
  isBusy,
  modelListLoaded,
  modelOptions,
  status,
  onAiProviderChange,
  onTaskPromptPresetsChange,
  onSaveSettings,
  onTestConnection
}: SettingsContentProps) {
  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetTaskType, setNewPresetTaskType] = useState<TaskPromptPreset["taskType"]>("polish");
  const [newPresetInstruction, setNewPresetInstruction] = useState("");

  const addTaskPromptPreset = () => {
    const name = newPresetName.trim();
    const instruction = newPresetInstruction.trim();
    if (!name || !instruction) {
      return;
    }

    onTaskPromptPresetsChange([
      ...form.taskPromptPresets,
      {
        id: createTaskPromptPresetId(),
        name,
        taskType: newPresetTaskType,
        instruction,
        showInSelectionMenu: true
      }
    ]);
    setNewPresetName("");
    setNewPresetTaskType("polish");
    setNewPresetInstruction("");
  };

  const updateTaskPromptPreset = (presetId: string, patch: Partial<TaskPromptPreset>) => {
    onTaskPromptPresetsChange(form.taskPromptPresets.map((preset) => (preset.id === presetId ? { ...preset, ...patch } : preset)));
  };

  const deleteTaskPromptPreset = (presetId: string) => {
    onTaskPromptPresetsChange(form.taskPromptPresets.filter((preset) => preset.id !== presetId));
  };

  if (category === "AI 服务") {
    const modelSuggestions = filterModelSuggestions(modelOptions, form.aiProvider.modelName);
    const connectionText =
      status.kind === "testing"
        ? "正在测试"
        : status.kind === "error"
          ? status.message ?? "连接失败"
          : status.kind === "saved" && status.message?.startsWith("测试连接成功")
            ? "连接测试成功，模型列表已加载"
          : apiKeyConfigured
            ? "API Key 已保存，连接测试会使用真实 provider"
            : "未配置 API Key";

    return (
      <div className="settings-grid">
        <div className="settings-card">
          <h3>AI 服务连接</h3>
          <p className="muted">配置大语言模型服务，用于润色、扩写、校对、续写。</p>
          <div className="form-grid">
            <label>服务提供商</label>
            <select
              className="input"
              value={form.aiProvider.providerType}
              onChange={(event) => onAiProviderChange({ providerType: event.target.value as "openrouter" })}
            >
              <option value="openrouter">OpenRouter</option>
            </select>
            <label>API 地址</label>
            <Input value={form.aiProvider.baseUrl} disabled onChange={(event) => onAiProviderChange({ baseUrl: event.target.value })} />
            <label>API Key</label>
            <Input
              type="password"
              value={form.aiProvider.apiKey}
              placeholder={apiKeyConfigured ? "已保存 API Key，留空则保留" : "输入 API Key"}
              onChange={(event) => onAiProviderChange({ apiKey: event.target.value })}
            />
            <label>模型名称</label>
            <div className="model-picker">
              <Input
                value={form.aiProvider.modelName}
                placeholder="输入模型 ID，如 google/gemini"
                onChange={(event) => onAiProviderChange({ modelName: event.target.value })}
              />
              {modelListLoaded ? (
                <>
                  {modelSuggestions.length > 0 ? (
                    <div className="model-suggestion-list">
                      {modelSuggestions.map((model) => {
                        function selectModel(modelId: string): void {
                          const selected = findExactModel(modelOptions, modelId);
                          onAiProviderChange({
                            modelName: modelId,
                            contextLength: selected?.contextLength ?? null,
                            supportsTools: selected?.supportsTools ?? null
                          });
                        }

                        return (
                          <button key={model.id} onClick={() => selectModel(model.id)} type="button">
                            <span>
                              <b>{model.name}</b>
                              <small>{model.id}</small>
                            </span>
                            <small>{formatContextLength(model.contextLength)}</small>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="model-picker-hint">{form.aiProvider.modelName.trim() ? "没有匹配的模型。可以继续手动输入模型 ID。" : "输入关键词筛选模型。"}</p>
                  )}
                </>
              ) : (
                <p className="model-picker-hint">测试连接成功后会获取可用模型列表。</p>
              )}
              <p className="model-picker-hint">当前模型上下文：{formatContextLength(form.aiProvider.contextLength ?? null)}</p>
            </div>
          </div>
          <div className="connection-row">
            <Button variant="ghost" disabled={isBusy} onClick={onTestConnection}>测试连接</Button>
            <Button variant="secondary" disabled={isBusy} onClick={onSaveSettings}>保存 AI 设置</Button>
            <span className={status.kind === "error" ? "settings-message error" : "muted"}>{connectionText}</span>
          </div>
        </div>
      </div>
    );
  }

  if (category === "提示词预设") {
    return (
      <div className="settings-grid">
        <div className="settings-card">
          <h3>内置任务</h3>
          <p className="muted">内置任务由系统维护，保证写回方式和输出格式稳定。校对暂不开放自定义预设。</p>
          {builtInPromptPresetDescriptions.map(([name, taskTypeLabel, desc]) => (
            <div className="detected-row preset-row" key={name}>
              <span>
                <b>{name}</b>
                <br />
                <span className="muted">{desc}</span>
              </span>
              <span className="tag">{taskTypeLabel}</span>
            </div>
          ))}
        </div>
        <div className="settings-card wide">
          <h3>我的任务预设</h3>
          <p className="muted">预设只用于选中文字后的润色、扩写、续写。本次任务仍可在右侧面板追加临时要求。</p>
          {form.taskPromptPresets.length === 0 ? (
            <div className="empty-inline">还没有自定义预设。可以先添加一个常用润色或扩写指令。</div>
          ) : (
            <div className="prompt-preset-list">
              {form.taskPromptPresets.map((preset) => (
                <div className="prompt-preset-editor" key={preset.id}>
                  <div className="prompt-preset-head">
                    <Input aria-label="预设名称" value={preset.name} onChange={(event) => updateTaskPromptPreset(preset.id, { name: event.target.value })} />
                    <select
                      aria-label={`${preset.name} 的任务大类`}
                      className="input"
                      value={preset.taskType}
                      onChange={(event) => updateTaskPromptPreset(preset.id, { taskType: event.target.value as TaskPromptPreset["taskType"] })}
                    >
                      <option value="polish">润色</option>
                      <option value="expand">扩写</option>
                      <option value="continue">续写</option>
                    </select>
                    <button
                      className={`toggle ${preset.showInSelectionMenu ? "on" : ""}`}
                      onClick={() => updateTaskPromptPreset(preset.id, { showInSelectionMenu: !preset.showInSelectionMenu })}
                      type="button"
                      aria-label={`${preset.name} 是否显示在选区菜单`}
                    />
                    <button className="small-button" onClick={() => deleteTaskPromptPreset(preset.id)} type="button">
                      删除
                    </button>
                  </div>
                  <Textarea
                    aria-label={`${preset.name} 的预设要求`}
                    value={preset.instruction}
                    placeholder="写清楚这类任务的固定要求。"
                    onChange={(event) => updateTaskPromptPreset(preset.id, { instruction: event.target.value })}
                  />
                  <div className="prompt-preset-meta">
                    <span>{taskPromptPresetLabels[preset.taskType]}</span>
                    <span>{preset.showInSelectionMenu ? "显示在选中文字 AI 菜单" : "不显示在选中文字 AI 菜单"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="settings-card wide">
          <h3>新增预设</h3>
          <p className="muted">新增后需要点击底部“保存设置”才会写入本地设置。</p>
          <div className="prompt-preset-new">
            <Input aria-label="新预设名称" value={newPresetName} placeholder="预设名称，例如：古风润色" onChange={(event) => setNewPresetName(event.target.value)} />
            <select aria-label="新预设任务大类" className="input" value={newPresetTaskType} onChange={(event) => setNewPresetTaskType(event.target.value as TaskPromptPreset["taskType"])}>
              <option value="polish">润色</option>
              <option value="expand">扩写</option>
              <option value="continue">续写</option>
            </select>
            <Textarea aria-label="新预设要求" value={newPresetInstruction} placeholder="预设要求，例如：用更古雅但不晦涩的表达润色选中文本，保持事实不变。" onChange={(event) => setNewPresetInstruction(event.target.value)} />
            <Button disabled={!newPresetName.trim() || !newPresetInstruction.trim()} onClick={addTaskPromptPreset} variant="secondary">
              添加预设
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
