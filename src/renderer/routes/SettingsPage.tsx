import {
  Database,
  DownloadSimple,
  GearSix,
  Robot,
  Sliders,
  UploadSimple,
  X
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { RelationshipGraphResult, RelationshipGraphSourceStatus } from "../../main/shared/relationship-graph";
import type {
  AiProviderSettingsState,
  CacheSettings,
  ChapterCacheBuildOrder,
  EditorSettings,
  ExportShareableProjectCopyResult,
  OpenRouterModelSummary,
  ProjectRecord,
  SettingsSaveInput,
  SettingsState,
  SettingsTestConnectionInput,
  SummaryArcCacheDetail,
  SummaryArcCacheEntry,
  SummaryChapterCacheDetail,
  SummaryChapterCacheEntry,
  SummaryIndexStatus,
  TaskPromptPreset
} from "../../main/shared/types";
import { Button } from "../components/Button";
import { IconButton } from "../components/IconButton";
import { Input } from "../components/Input";
import { Textarea } from "../components/Textarea";
import { RelationshipGraphCachePanel } from "../relationship-graph/RelationshipGraphCachePanel";
import { getNovelToolApi } from "../state/app-store";

export type SettingsCategory = "通用" | "编辑器" | "AI 服务" | "提示词预设" | "章节索引缓存" | "导入导出" | "备份与数据" | "快捷键";

type SettingsPageProps = {
  readonly activeCategory: SettingsCategory;
  readonly currentProject: ProjectRecord | null;
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
  readonly cache: CacheSettings;
};

type StatusState = {
  readonly kind: "idle" | "loading" | "saving" | "saved" | "testing" | "error";
  readonly message: string | null;
};

type SettingsContentProps = {
  readonly apiKeyConfigured: boolean;
  readonly category: SettingsCategory;
  readonly currentProject: ProjectRecord | null;
  readonly form: SettingsFormState;
  readonly isBusy: boolean;
  readonly modelListLoaded: boolean;
  readonly modelOptions: readonly OpenRouterModelSummary[];
  readonly status: StatusState;
  readonly onAiProviderChange: (patch: Partial<EditableAiProviderSettings>) => void;
  readonly onCacheSettingsChange: (patch: Partial<CacheSettings>) => void;
  readonly onTaskPromptPresetsChange: (taskPromptPresets: readonly TaskPromptPreset[]) => void;
  readonly onTestConnection: () => void;
  readonly onSaveSettings: () => void;
};

const visibleCategories = ["AI 服务", "提示词预设", "章节索引缓存", "导入导出"] as const satisfies readonly SettingsCategory[];
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
  提示词预设: <Sliders size={20} />,
  章节索引缓存: <Database size={20} />,
  导入导出: <UploadSimple size={20} />
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
    pageWidth: "screen",
    fontFamily: "system",
    editorPadding: "compact",
    paragraphSpacing: "standard",
    firstLineIndent: "none",
    theme: "light",
    ruledPaper: true,
    ruledPaperIntensity: "standard"
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
  taskPromptPresets: [],
  cache: {
    chapterCacheBuildOrder: "latest_first"
  }
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
    taskPromptPresets: [...settings.taskPromptPresets],
    cache: settings.cache
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
    cache: form.cache,
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

function formatCacheState(entry: Pick<SummaryChapterCacheEntry, "cacheState"> | Pick<SummaryArcCacheEntry, "cacheState"> | null): string {
  if (!entry) {
    return "未选择";
  }
  const labels: Record<SummaryChapterCacheEntry["cacheState"] | SummaryArcCacheEntry["cacheState"], string> = {
    ready: "已缓存",
    stale: "过期",
    building: "构建中",
    failed: "失败",
    skipped_too_short: "过短跳过",
    missing: "缺失",
    queued: "排队中",
    running: "正在缓存",
    cancelled: "已停止"
  };
  return labels[entry.cacheState];
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "无";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatCacheJobNote(entry: SummaryChapterCacheEntry): string | null {
  if (entry.cacheState !== "ready" && entry.jobError) {
    const fallback = entry.jobError.length > 140 ? `${entry.jobError.slice(0, 140)}...` : entry.jobError;
    const reason = entry.jobFailureCategory ?? fallback;
    return `错误：${reason}${entry.jobActionHint ? `；${entry.jobActionHint}` : ""}`;
  }
  if (entry.cacheState !== "ready" && entry.nextRunAt) {
    return `等待重试：${formatDateTime(entry.nextRunAt)}`;
  }
  if (entry.jobStatus === "queued") {
    return "等待后台处理";
  }
  if (entry.jobStatus === "running") {
    return "当前正在生成缓存";
  }
  return null;
}

function getChapterCacheActionLabel(entry: SummaryChapterCacheEntry | null): string {
  if (!entry) {
    return "选择章节";
  }

  const labels: Record<SummaryChapterCacheEntry["cacheState"], string> = {
    ready: "重新缓存",
    stale: "重新缓存",
    building: "正在缓存",
    failed: "重试本章缓存",
    skipped_too_short: "内容过短",
    missing: "生成本章缓存",
    queued: "已排队",
    running: "正在缓存",
    cancelled: "重试本章缓存"
  };
  return labels[entry.cacheState];
}

function canRunChapterCacheAction(entry: SummaryChapterCacheEntry | null): boolean {
  if (!entry) {
    return false;
  }
  return entry.cacheState === "ready" || entry.cacheState === "stale" || entry.cacheState === "missing" || entry.cacheState === "failed" || entry.cacheState === "cancelled";
}

function formatArcCacheJobNote(entry: SummaryArcCacheEntry): string | null {
  if (entry.cacheState !== "ready" && entry.jobError) {
    const fallback = entry.jobError.length > 140 ? `${entry.jobError.slice(0, 140)}...` : entry.jobError;
    const reason = entry.jobFailureCategory ?? fallback;
    return `错误：${reason}${entry.jobActionHint ? `；${entry.jobActionHint}` : ""}`;
  }
  if (entry.cacheState !== "ready" && entry.nextRunAt) {
    return `等待重试：${formatDateTime(entry.nextRunAt)}`;
  }
  if (entry.jobStatus === "queued") {
    return "等待后台处理";
  }
  if (entry.jobStatus === "running") {
    return "当前正在生成阶段摘要";
  }
  if (entry.readyChapterCount < entry.chapterCount) {
    return `等待章节缓存：${entry.readyChapterCount}/${entry.chapterCount}`;
  }
  return null;
}

function getArcCacheActionLabel(entry: SummaryArcCacheEntry | null): string {
  if (!entry) {
    return "选择阶段";
  }
  const labels: Record<SummaryArcCacheEntry["cacheState"], string> = {
    ready: "重新生成阶段摘要",
    stale: "重新生成阶段摘要",
    building: "正在生成",
    failed: "重试阶段摘要",
    missing: "生成阶段摘要",
    queued: "已排队",
    running: "正在生成",
    cancelled: "重试阶段摘要"
  };
  return labels[entry.cacheState];
}

function canRunArcCacheAction(entry: SummaryArcCacheEntry | null): boolean {
  if (!entry || entry.readyChapterCount <= 0 || entry.readyChapterCount < entry.chapterCount) {
    return false;
  }
  return entry.cacheState === "ready" || entry.cacheState === "stale" || entry.cacheState === "missing" || entry.cacheState === "failed" || entry.cacheState === "cancelled";
}

export function formatRelationshipOverviewMetric(
  indexStatus: SummaryIndexStatus | null,
  sourceStatus: RelationshipGraphSourceStatus | null
): { readonly value: string; readonly detail: string } {
  if (!indexStatus || !sourceStatus) {
    return { value: "--", detail: "正在读取状态" };
  }
  if (indexStatus.totalChapterCount === 0) {
    return { value: "未开始", detail: "还没有章节" };
  }
  if (sourceStatus.state === "ready") {
    return { value: `${sourceStatus.nodeCount}/${sourceStatus.edgeCount}`, detail: "人物 / 关系" };
  }
  if (sourceStatus.state === "failed") {
    return { value: "失败", detail: sourceStatus.latestFailure ?? "摘要任务失败" };
  }
  return {
    value: sourceStatus.arcSummary.readyForGraph > 0 ? `${sourceStatus.arcSummary.readyForGraph}/${sourceStatus.arcSummary.total}` : "等待",
    detail: sourceStatus.message
  };
}

export function getRelationshipSourceStatusText(sourceStatus: RelationshipGraphSourceStatus | null): string {
  if (!sourceStatus) {
    return "正在读取人物关系图来源状态。";
  }
  return sourceStatus.message;
}

function findExactModel(models: readonly OpenRouterModelSummary[], modelName: string): OpenRouterModelSummary | null {
  const normalized = modelName.trim().toLocaleLowerCase("zh-CN");
  return models.find((model) => model.id.toLocaleLowerCase("zh-CN") === normalized) ?? null;
}

export function SettingsPage({ activeCategory, currentProject, onCategoryChange, onWelcome, onClose }: SettingsPageProps) {
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

  const updateCacheSettings = (patch: Partial<CacheSettings>) => {
    setForm((current) => ({
      ...current,
      cache: {
        ...current.cache,
        ...patch
      }
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
             currentProject={currentProject}
             form={form}
            isBusy={isBusy}
            modelListLoaded={modelListLoaded}
            modelOptions={modelOptions}
            status={status}
            onAiProviderChange={updateAiProvider}
            onCacheSettingsChange={updateCacheSettings}
            onTaskPromptPresetsChange={updateTaskPromptPresets}
            onSaveSettings={() => void saveSettings()}
            onTestConnection={testConnection}
          />
          {activeVisibleCategory !== "章节索引缓存" && activeVisibleCategory !== "导入导出" ? (
            <>
              <div className="notice">
                <span>你的作品和设置仅保存在本地设备，不会默认同步到云端。只有在你主动使用 AI 功能时，相关内容才会发送到所选 AI 服务。</span>
              </div>
              {status.message ? <p className={`settings-message ${status.kind}`}>{status.message}</p> : null}
              <div className="wizard-actions">
                <Button variant="ghost" onClick={onClose}>取消</Button>
                <Button variant="primary" disabled={isBusy} onClick={() => void saveSettings()}>保存设置</Button>
              </div>
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function SettingsContent({
  apiKeyConfigured,
  category,
  currentProject,
  form,
  isBusy,
  modelListLoaded,
  modelOptions,
  status,
  onAiProviderChange,
  onCacheSettingsChange,
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

  if (category === "章节索引缓存") {
    return <SummaryCacheSettingsPane cache={form.cache} currentProject={currentProject} onCacheSettingsChange={onCacheSettingsChange} />;
  }

  if (category === "导入导出") {
    return <ShareableProjectExportPane currentProject={currentProject} />;
  }

  return null;
}

type ShareableProjectExportPaneProps = {
  readonly currentProject: ProjectRecord | null;
};

type SelectedShareableProjectPath = {
  readonly filePath: string;
};

type ShareableExportOptions = {
  readonly includeScratchNotes: boolean;
  readonly includePromptPresets: boolean;
  readonly includeSummaryCache: boolean;
};

const defaultShareableExportOptions: ShareableExportOptions = {
  includeScratchNotes: false,
  includePromptPresets: false,
  includeSummaryCache: true
};

const alwaysRemovedShareableItems = ["AI 聊天记录", "AI 改写任务记录", "章节快照", "导入记录", "本机路径", "缓存任务记录"] as const;

function formatSelectedPath(filePath: string | null): string {
  if (!filePath) {
    return "尚未选择保存位置";
  }
  const parts = filePath.split(/[/\\]/);
  return parts.length > 2 ? `${parts.at(-2)}/${parts.at(-1)}` : filePath;
}

function ShareableProjectExportPane({ currentProject }: ShareableProjectExportPaneProps) {
  const api = useMemo(getNovelToolApi, []);
  const [options, setOptions] = useState<ShareableExportOptions>(defaultShareableExportOptions);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportShareableProjectCopyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function updateOption(key: keyof ShareableExportOptions, value: boolean): void {
    setOptions((current) => ({ ...current, [key]: value }));
    setResult(null);
    setError(null);
  }

  async function selectShareableProjectPath(): Promise<void> {
    if (!currentProject) {
      return;
    }
    setError(null);
    try {
      const selected = (await api.export.selectShareableProjectFilePath({
        projectId: currentProject.id,
        suggestedName: currentProject.name
      })) as SelectedShareableProjectPath | null;
      if (selected) {
        setFilePath(selected.filePath);
        setResult(null);
      }
    } catch (reason) {
      setError(formatError(reason));
    }
  }

  async function exportShareableProjectCopy(): Promise<void> {
    if (!currentProject || !filePath) {
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const exported = (await api.export.exportShareableProjectCopy({
        projectId: currentProject.id,
        filePath,
        ...options
      })) as ExportShareableProjectCopyResult;
      setResult(exported);
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  }

  const canExport = Boolean(currentProject && filePath && !busy);

  return (
    <div className="settings-grid import-export-settings">
      <div className="settings-card wide shareable-export-card">
        <div className="settings-card-head">
          <div>
            <h3>导出可分享副本</h3>
            <p className="muted">生成一个新的 .noveltool 文件，只用于分享给他人查看或继续协作。原项目不会被修改。</p>
          </div>
          <span className="tag">严格隐私清理</span>
        </div>

        {!currentProject ? (
          <div className="empty-inline">请先打开项目，再导出可分享副本。</div>
        ) : (
          <>
            <section className="shareable-export-privacy">
              <div>
                <b>始终移除</b>
                <span>AI 聊天记录、AI 改写任务记录、章节快照和导入记录会始终移除。</span>
              </div>
              <div className="shareable-export-chip-list">
                {alwaysRemovedShareableItems.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </section>

            <section className="shareable-export-options" aria-label="可分享副本导出内容">
              <label className="shareable-export-option fixed">
                <input checked disabled type="checkbox" />
                <span>
                  <b>章节正文</b>
                  <small>项目名称、章节结构、章节正文会保留。</small>
                </span>
              </label>
              <label className={`shareable-export-option ${options.includeSummaryCache ? "active" : ""}`}>
                <input
                  checked={options.includeSummaryCache}
                  onChange={(event) => updateOption("includeSummaryCache", event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <b>章节索引缓存</b>
                  <small>保留可用章节、阶段、全书摘要；人物关系图会随摘要结果保留。</small>
                </span>
              </label>
              <label className={`shareable-export-option ${options.includeScratchNotes ? "active" : ""}`}>
                <input
                  checked={options.includeScratchNotes}
                  onChange={(event) => updateOption("includeScratchNotes", event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <b>草稿纸/素材</b>
                  <small>可能包含私人构思，默认不导出。</small>
                </span>
              </label>
              <label className={`shareable-export-option ${options.includePromptPresets ? "active" : ""}`}>
                <input
                  checked={options.includePromptPresets}
                  onChange={(event) => updateOption("includePromptPresets", event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <b>提示词预设</b>
                  <small>可能包含个人写作习惯，默认不导出。</small>
                </span>
              </label>
            </section>

            <section className="shareable-export-destination">
              <span title={filePath ?? undefined}>{formatSelectedPath(filePath)}</span>
              <Button disabled={busy} onClick={() => void selectShareableProjectPath()} type="button" variant="secondary">
                选择位置
              </Button>
            </section>

            <div className="shareable-export-actions">
              <Button disabled={!canExport} onClick={() => void exportShareableProjectCopy()} type="button" variant="primary">
                <DownloadSimple size={20} />
                {busy ? "正在导出" : "导出可分享副本"}
              </Button>
              <span className="summary-cache-hint">导出前会复制到临时文件，清理、压缩并扫描通过后才会生成最终副本。</span>
            </div>
          </>
        )}

        {result ? (
          <div className="shareable-export-result" role="status">
            <b>可分享副本已生成</b>
            <span>{formatSelectedPath(result.filePath)}</span>
            <small>
              已保留：{result.included.join("、")}；已移除：{result.removed.join("、")}；扫描 {result.privacyScan.scannedValueCount.toLocaleString("zh-CN")} 项。
            </small>
          </div>
        ) : null}
        {error ? <p className="settings-message error">{error}</p> : null}
      </div>
    </div>
  );
}

type SummaryCacheSettingsPaneProps = {
  readonly cache: CacheSettings;
  readonly currentProject: ProjectRecord | null;
  readonly onCacheSettingsChange: (patch: Partial<CacheSettings>) => void;
};

type RelationshipGraphCacheSettingsBlockProps = {
  readonly currentProject: ProjectRecord | null;
  readonly onSourceStatusChange?: (status: RelationshipGraphSourceStatus | null) => void;
};

function RelationshipGraphCacheSettingsBlock({ currentProject, onSourceStatusChange }: RelationshipGraphCacheSettingsBlockProps) {
  const api = useMemo(getNovelToolApi, []);
  const [graph, setGraph] = useState<RelationshipGraphResult | null>(null);
  const [sourceStatus, setSourceStatus] = useState<RelationshipGraphSourceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadRelationshipGraphSource(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      if (!currentProject) {
        setGraph(null);
        setSourceStatus(null);
        onSourceStatusChange?.(null);
        return;
      }

      const [status, result] = await Promise.all([
        api.relationshipGraph.getSourceStatus({ projectId: currentProject.id }) as Promise<RelationshipGraphSourceStatus>,
        api.relationshipGraph.getGraph({
          projectId: currentProject.id,
          chapterCursor: "all",
          roleScope: "all",
          mode: "global",
          hopDepth: 1,
          minConfidence: 0,
          includeUncertain: true
        }) as Promise<RelationshipGraphResult>
      ]);
      setSourceStatus(status);
      onSourceStatusChange?.(status);
      setGraph(result);
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRelationshipGraphSource();
  }, [currentProject?.id]);

  return (
    <div className="settings-card wide relationship-cache-settings-card">
      <div className="settings-card-head">
        <div>
          <h3>人物关系图来源</h3>
          <p className="muted">人物关系图由阶段摘要和全书摘要派生，不再额外维护逐章图谱任务或独立融合任务。</p>
        </div>
        <Button variant="ghost" disabled={loading} onClick={() => void loadRelationshipGraphSource()}>
          {loading ? "读取中" : "刷新"}
        </Button>
      </div>
      {!currentProject ? (
        <div className="empty-inline">请先打开项目，再查看人物关系图来源。</div>
      ) : (
        <>
          <section className="cache-status-card relationship-cache-detail-card">
            <div>
              <h4>当前状态</h4>
              <p>{getRelationshipSourceStatusText(sourceStatus)}</p>
            </div>
            <div className="cache-status-metrics">
              <span>
                <b>{sourceStatus?.nodeCount ?? 0}</b>
                人物
              </span>
              <span>
                <b>{sourceStatus?.edgeCount ?? 0}</b>
                关系
              </span>
              <span>
                <b>{sourceStatus ? `${sourceStatus.arcSummary.readyForGraph}/${sourceStatus.arcSummary.total}` : "0/0"}</b>
                阶段图谱
              </span>
              <span>
                <b>{sourceStatus?.arcSummary.missingGraphFields ?? 0}</b>
                阶段待重试
              </span>
              <span>
                <b>{sourceStatus?.bookSummary.hasRelationshipGraph ? "已生成" : "未生成"}</b>
                全书图谱
              </span>
            </div>
            <p className="summary-cache-hint">
              {sourceStatus?.chapterRange ? `覆盖第 ${sourceStatus.chapterRange.start}-${sourceStatus.chapterRange.end} 章。` : "暂无可用覆盖范围。"}
              {sourceStatus?.latestFailure ? ` 最近失败：${sourceStatus.latestFailure}` : ""}
            </p>
          </section>
          <div className="relationship-cache-result-heading">人物关系图结果</div>
          <RelationshipGraphCachePanel graph={graph} loading={loading} status={sourceStatus} />
        </>
      )}
      {error ? <p className="settings-message error">{error}</p> : null}
    </div>
  );
}

function SummaryCacheSettingsPane({ cache, currentProject, onCacheSettingsChange }: SummaryCacheSettingsPaneProps) {
  const api = useMemo(getNovelToolApi, []);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [indexStatus, setIndexStatus] = useState<SummaryIndexStatus | null>(null);
  const [relationshipOverviewStatus, setRelationshipOverviewStatus] = useState<RelationshipGraphSourceStatus | null>(null);
  const [entries, setEntries] = useState<SummaryChapterCacheEntry[]>([]);
  const [arcEntries, setArcEntries] = useState<SummaryArcCacheEntry[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [selectedArcKey, setSelectedArcKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<SummaryChapterCacheDetail | null>(null);
  const [arcDetail, setArcDetail] = useState<SummaryArcCacheDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [forceConfirm, setForceConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedEntry = entries.find((entry) => entry.chapterId === selectedChapterId) ?? entries[0] ?? null;
  const selectedArcEntry = arcEntries.find((entry) => entry.arcKey === selectedArcKey) ?? arcEntries[0] ?? null;
  const running = Boolean(indexStatus?.runningJobLabel);
  const hasQueuedOrRunning = Boolean(indexStatus && (indexStatus.queuedJobCount > 0 || indexStatus.runningJobLabel));
  const backgroundEnabled = indexStatus?.backgroundEnabled ?? true;
  const fullCachePreview = detail
    ? JSON.stringify(
        {
          章节: {
            标题: detail.chapterTitle,
            序号: detail.chapterOrder,
            状态: formatCacheState(detail),
            更新时间: detail.summary?.updatedAt ?? null
          },
          摘要: detail.summary,
          片段缓存: detail.chunks
        },
        null,
        2
      )
    : "请选择一个章节查看完整缓存信息。";
  const fullArcPreview = arcDetail
    ? JSON.stringify(
        {
          阶段: {
            范围: arcDetail.label,
            状态: formatCacheState(arcDetail),
            已覆盖章节: `${arcDetail.readyChapterCount}/${arcDetail.chapterCount}`,
            更新时间: arcDetail.summary?.updatedAt ?? null
          },
          摘要: arcDetail.summary
        },
        null,
        2
      )
    : "请选择一个阶段查看完整阶段摘要。";

  async function loadCache(nextSelectedChapterId?: string | null, nextSelectedArcKey?: string | null): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setProject(currentProject);
      if (!currentProject) {
        setEntries([]);
        setIndexStatus(null);
        setRelationshipOverviewStatus(null);
        setSelectedChapterId(null);
        setSelectedArcKey(null);
        setDetail(null);
        setArcDetail(null);
        return;
      }

      const relationshipGraphSourceStatusPromise = (api.relationshipGraph.getSourceStatus({ projectId: currentProject.id }) as Promise<RelationshipGraphSourceStatus>).catch(() => null);
      const [status, cacheEntries, nextArcEntries, relationshipGraphSourceStatus] = await Promise.all([
        api.summary.getIndexStatus({ projectId: currentProject.id }) as Promise<SummaryIndexStatus>,
        api.summary.listCacheEntries({ projectId: currentProject.id }) as Promise<SummaryChapterCacheEntry[]>,
        api.summary.listArcCacheEntries({ projectId: currentProject.id }) as Promise<SummaryArcCacheEntry[]>,
        relationshipGraphSourceStatusPromise
      ]);
      setIndexStatus(status);
      setEntries([...cacheEntries]);
      setArcEntries([...nextArcEntries]);
      setRelationshipOverviewStatus(relationshipGraphSourceStatus);
      const fallbackChapterId = cacheEntries[0]?.chapterId ?? null;
      const chapterId = nextSelectedChapterId && cacheEntries.some((entry) => entry.chapterId === nextSelectedChapterId) ? nextSelectedChapterId : fallbackChapterId;
      const fallbackArcKey = nextArcEntries[0]?.arcKey ?? null;
      const arcKey = nextSelectedArcKey && nextArcEntries.some((entry) => entry.arcKey === nextSelectedArcKey) ? nextSelectedArcKey : fallbackArcKey;
      setSelectedChapterId(chapterId);
      setSelectedArcKey(arcKey);
      if (chapterId) {
        setDetail((await api.summary.getChapterCache({ projectId: currentProject.id, chapterId })) as SummaryChapterCacheDetail);
      } else {
        setDetail(null);
      }
      if (arcKey) {
        setArcDetail((await api.summary.getArcCache({ projectId: currentProject.id, arcKey })) as SummaryArcCacheDetail);
      } else {
        setArcDetail(null);
      }
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCache();
  }, [currentProject?.id]);

  async function selectChapter(chapterId: string): Promise<void> {
    if (!project) {
      return;
    }
    setSelectedChapterId(chapterId);
    setError(null);
    try {
      setDetail((await api.summary.getChapterCache({ projectId: project.id, chapterId })) as SummaryChapterCacheDetail);
    } catch (reason) {
      setError(formatError(reason));
    }
  }

  async function selectArc(arcKey: string): Promise<void> {
    if (!project) {
      return;
    }
    setSelectedArcKey(arcKey);
    setError(null);
    try {
      setArcDetail((await api.summary.getArcCache({ projectId: project.id, arcKey })) as SummaryArcCacheDetail);
    } catch (reason) {
      setError(formatError(reason));
    }
  }

  async function runAction(action: () => Promise<unknown>, successMessage: string): Promise<void> {
    if (!project) {
      return;
    }
    setActionBusy(true);
    setMessage(null);
    setError(null);
    try {
      await action();
      setMessage(successMessage);
      setForceConfirm(false);
      await loadCache(selectedChapterId, selectedArcKey);
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setActionBusy(false);
    }
  }

  async function saveChapterCacheBuildOrder(chapterCacheBuildOrder: ChapterCacheBuildOrder): Promise<void> {
    setActionBusy(true);
    setMessage(null);
    setError(null);
    try {
      const saved = (await api.settings.save({ cache: { chapterCacheBuildOrder } })) as SettingsState;
      onCacheSettingsChange(saved.cache);
      setMessage("章节缓存顺序已保存。正在排队的任务会按新顺序继续领取。");
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setActionBusy(false);
    }
  }

  const selectedCanRunCacheAction = Boolean(project && canRunChapterCacheAction(selectedEntry));
  const selectedCanRunArcCacheAction = Boolean(project && canRunArcCacheAction(selectedArcEntry));
  const relationshipOverviewMetric = formatRelationshipOverviewMetric(indexStatus, relationshipOverviewStatus);
  const relationshipNeedsAttention =
    (relationshipOverviewStatus?.arcSummary.missingGraphFields ?? 0) +
    (relationshipOverviewStatus?.arcSummary.failed ?? 0) +
    (relationshipOverviewStatus?.bookSummary.failed ? 1 : 0);

  return (
    <div className="settings-grid summary-cache-settings">
      <div className="settings-card wide cache-system-overview">
        <div className="settings-card-head">
          <div>
            <h3>缓存总览</h3>
            <p className="muted">先看整体状态，再分别处理章节缓存、阶段摘要和由摘要派生的人物关系图。</p>
          </div>
        </div>
        {!currentProject ? (
          <div className="empty-inline">请先打开项目，再查看缓存状态。</div>
        ) : (
          <div className="cache-system-metrics" aria-label="缓存总览">
            <span>
              <b>{indexStatus ? `${indexStatus.readyChapterCount}/${indexStatus.totalChapterCount}` : "--"}</b>
              章节缓存
              <small>已缓存 / 总章节</small>
            </span>
            <span>
              <b>{relationshipOverviewMetric.value}</b>
              人物关系图
              <small>{relationshipOverviewMetric.detail}</small>
            </span>
            <span>
              <b>{indexStatus?.queuedJobCount ?? 0}</b>
              排队或运行
              <small>章节、阶段、全书摘要任务</small>
            </span>
            <span>
              <b>{(indexStatus?.staleChapterCount ?? 0) + (indexStatus?.failedJobCount ?? 0) + relationshipNeedsAttention}</b>
              需要处理
              <small>过期、失败或摘要图谱字段缺失</small>
            </span>
          </div>
        )}
        <div className="cache-schedule-controls" aria-label="章节缓存顺序">
          <div>
            <b>章节缓存顺序</b>
            <small>只影响同优先级的章节缓存领取顺序；新写章节和失败重试仍按优先级处理。</small>
          </div>
          <div className="segmented-control">
            <button
              className={cache.chapterCacheBuildOrder === "latest_first" ? "active" : ""}
              disabled={actionBusy}
              onClick={() => void saveChapterCacheBuildOrder("latest_first")}
              type="button"
            >
              最近章节优先
            </button>
            <button
              className={cache.chapterCacheBuildOrder === "front_to_back" ? "active" : ""}
              disabled={actionBusy}
              onClick={() => void saveChapterCacheBuildOrder("front_to_back")}
              type="button"
            >
              从第 1 章开始
            </button>
          </div>
        </div>
      </div>

      <div className="settings-card wide summary-cache-overview">
        <div className="settings-card-head">
          <div>
            <h3>章节缓存详情</h3>
            <p className="muted">用于全文总结、人物查询、伏笔查询和跨章节问答。这里不手动编辑缓存，只预览完整缓存信息并调度重试。</p>
          </div>
          <Button variant="ghost" disabled={loading || actionBusy} onClick={() => void loadCache(selectedChapterId, selectedArcKey)}>
            刷新
          </Button>
        </div>

        {!project ? (
          <div className="empty-inline">请先打开项目，再管理章节索引缓存。</div>
        ) : (
          <>
            <div className="summary-cache-status-grid">
              <span>
                <b>{indexStatus?.readyChapterCount ?? 0}</b>
                已缓存
              </span>
              <span>
                <b>{indexStatus?.missingChapterCount ?? 0}</b>
                缺失
              </span>
              <span>
                <b>{indexStatus?.staleChapterCount ?? 0}</b>
                过期
              </span>
              <span>
                <b>{indexStatus?.failedJobCount ?? 0}</b>
                失败
              </span>
              <span>
                <b>{indexStatus?.queuedJobCount ?? 0}</b>
                排队
              </span>
              <span>
                <b>{backgroundEnabled ? "开" : "关"}</b>
                后台
              </span>
            </div>
            {!backgroundEnabled ? <p className="summary-cache-hint">后台索引已关闭。新章节和过期章节不会自动缓存，点击“继续建立索引”会重新开启。</p> : null}
            <div className="summary-cache-actions">
              <Button
                variant="secondary"
                disabled={loading || actionBusy || running}
                onClick={() => void runAction(() => api.summary.rebuildProjectIndex({ projectId: project.id }), "后台索引任务已继续排队。")}
              >
                继续建立索引
              </Button>
              <Button
                variant="ghost"
                disabled={loading || actionBusy || (!backgroundEnabled && !hasQueuedOrRunning)}
                onClick={() => void runAction(() => api.summary.cancelCurrentJob({ projectId: project.id }), "后台索引已关闭；已完成的章节缓存会保留。")}
              >
                {backgroundEnabled ? "停止后台索引" : "后台索引已关闭"}
              </Button>
              <Button
                variant={forceConfirm ? "primary" : "ghost"}
                disabled={loading || actionBusy || running}
                onClick={() => {
                  if (!forceConfirm) {
                    setForceConfirm(true);
                    setMessage("再次点击“确认重建全书索引”会强制重排全部章节。");
                    return;
                  }
                  void runAction(() => api.summary.rebuildProjectIndex({ projectId: project.id, force: true }), "全书索引已强制重新排队。");
                }}
              >
                {forceConfirm ? "确认重建全书索引" : "强制重建全书索引"}
              </Button>
            </div>
            {indexStatus?.runningJobLabel ? <p className="summary-cache-hint">当前任务：{indexStatus.runningJobLabel}</p> : null}
            {indexStatus?.nextRetryAt ? (
              <p className="summary-cache-hint">
                自动重试：{indexStatus.nextRetryJobLabel ?? "摘要任务"}，{formatDateTime(indexStatus.nextRetryAt)}
              </p>
            ) : null}
            {indexStatus?.recentFailedJobs.length ? (
              <div className="summary-cache-problems">
                <b>最近失败</b>
                {indexStatus.recentFailedJobs.map((job) => (
                  <span key={job.jobId}>
                    {job.label}：{job.failureCategory ?? job.error ?? "未知错误"}
                    {job.actionHint ? `；${job.actionHint}` : ""}
                  </span>
                ))}
              </div>
            ) : null}
            {indexStatus?.retryingJobs.length ? (
              <div className="summary-cache-problems">
                <b>等待重试</b>
                {indexStatus.retryingJobs.map((job) => (
                  <span key={job.jobId}>
                    {job.label}：{formatDateTime(job.nextRunAt)}
                    {job.failureCategory ? `；上次错误：${job.failureCategory}` : job.error ? `；上次错误：${job.error}` : ""}
                    {job.actionHint ? `；${job.actionHint}` : ""}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        )}
        {message ? <p className="settings-message saved">{message}</p> : null}
        {error ? <p className="settings-message error">{error}</p> : null}
      </div>

      <RelationshipGraphCacheSettingsBlock currentProject={currentProject} onSourceStatusChange={setRelationshipOverviewStatus} />

      {project ? (
        <div className="settings-card wide summary-cache-browser">
          <div className="summary-cache-list" aria-label="阶段摘要列表">
            {arcEntries.length === 0 ? (
              <div className="empty-inline">章节缓存完成后会自动生成阶段摘要。</div>
            ) : (
              arcEntries.map((entry) => (
                <button
                  className={selectedArcEntry?.arcKey === entry.arcKey ? "summary-cache-row active" : "summary-cache-row"}
                  key={entry.arcKey}
                  onClick={() => void selectArc(entry.arcKey)}
                  type="button"
                >
                  <span>
                    <b>{entry.label}</b>
                    <small>{formatArcCacheJobNote(entry) ?? `已覆盖章节 ${entry.readyChapterCount}/${entry.chapterCount}`}</small>
                  </span>
                  <em className={`cache-state ${entry.cacheState}`}>{formatCacheState(entry)}</em>
                </button>
              ))
            )}
          </div>
          <div className="summary-cache-detail">
            <div className="settings-card-head">
              <div>
                <h3>{selectedArcEntry?.label ?? "未选择阶段"}</h3>
                <p className="muted">
                  状态：{formatCacheState(selectedArcEntry)}；更新：{formatDateTime(selectedArcEntry?.summaryUpdatedAt ?? null)}
                </p>
                {selectedArcEntry && formatArcCacheJobNote(selectedArcEntry) ? <p className="summary-cache-hint">{formatArcCacheJobNote(selectedArcEntry)}</p> : null}
              </div>
              <Button
                variant="secondary"
                disabled={!selectedCanRunArcCacheAction || actionBusy}
                onClick={() =>
                  selectedArcEntry &&
                  void runAction(
                    () => api.summary.clearAndRetryArcCache({ projectId: project.id, arcKey: selectedArcEntry.arcKey }),
                    "已重新排队生成该阶段摘要；章节缓存不会被清空。"
                  )
                }
              >
                {getArcCacheActionLabel(selectedArcEntry)}
              </Button>
            </div>
            <div className="summary-cache-preview-block">
              <h4>阶段摘要</h4>
              <p>{arcDetail?.summary?.summary ?? "当前阶段还没有可预览的摘要。"}</p>
            </div>
            <div className="summary-cache-preview-block">
              <h4>完整阶段缓存</h4>
              <pre className="summary-cache-json">{fullArcPreview}</pre>
            </div>
          </div>
        </div>
      ) : null}

      {project ? (
        <div className="settings-card wide summary-cache-browser">
          <div className="summary-cache-list" aria-label="章节缓存列表">
            {entries.length === 0 ? (
              <div className="empty-inline">当前项目还没有章节。</div>
            ) : (
              entries.map((entry) => (
                <button
                  className={selectedEntry?.chapterId === entry.chapterId ? "summary-cache-row active" : "summary-cache-row"}
                  key={entry.chapterId}
                  onClick={() => void selectChapter(entry.chapterId)}
                  type="button"
                >
                  <span>
                    <b>{entry.chapterTitle}</b>
                    <small>
                      {entry.wordCount.toLocaleString("zh-CN")} 字 · {formatCacheJobNote(entry) ?? "点击查看完整缓存"}
                    </small>
                  </span>
                  <em className={`cache-state ${entry.cacheState}`}>{formatCacheState(entry)}</em>
                </button>
              ))
            )}
          </div>
          <div className="summary-cache-detail">
            <div className="settings-card-head">
              <div>
                <h3>{selectedEntry?.chapterTitle ?? "未选择章节"}</h3>
                <p className="muted">
                  状态：{formatCacheState(selectedEntry)}；更新：{formatDateTime(selectedEntry?.summaryUpdatedAt ?? null)}
                </p>
                {selectedEntry && formatCacheJobNote(selectedEntry) ? <p className="summary-cache-hint">{formatCacheJobNote(selectedEntry)}</p> : null}
              </div>
              <Button
                variant="secondary"
                disabled={!selectedCanRunCacheAction || actionBusy}
                onClick={() =>
                  selectedEntry &&
                  void runAction(
                    () => api.summary.clearAndRetryChapterCache({ projectId: project.id, chapterId: selectedEntry.chapterId }),
                    "已重新排队生成本章缓存。"
                  )
                }
              >
                {getChapterCacheActionLabel(selectedEntry)}
              </Button>
            </div>
            {running ? <p className="summary-cache-hint">后台索引正在运行。其他章节的缓存操作会排队等待当前章节完成；同一章节正在缓存时不能重复重试。</p> : null}
            <div className="summary-cache-preview-block">
              <h4>缓存摘要</h4>
              <p>{detail?.summary?.summaryShort ?? "当前章节还没有可预览的缓存摘要。"}</p>
              {detail?.summary?.summaryLong ? <p className="muted">{detail.summary.summaryLong}</p> : null}
            </div>
            <div className="summary-cache-preview-block">
              <h4>完整缓存信息</h4>
              <pre className="summary-cache-json">{fullCachePreview}</pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
