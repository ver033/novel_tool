import {
  FileText,
  GearSix,
  HardDrives,
  Keyboard,
  PencilSimpleLine,
  Robot,
  Sliders,
  X
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AiProviderSettingsState, EditorSettings, OpenRouterModelSummary, SettingsSaveInput, SettingsState } from "../../main/shared/types";
import { Button } from "../components/Button";
import { IconButton } from "../components/IconButton";
import { Input } from "../components/Input";
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
  readonly onEditorChange: (patch: Partial<EditorSettings>) => void;
  readonly onProjectPathChange: (projectPath: string) => void;
  readonly onTestConnection: () => void;
};

const categories: readonly SettingsCategory[] = ["通用", "编辑器", "AI 服务", "提示词预设", "导入导出", "备份与数据", "快捷键"];
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const categoryIcons: Record<SettingsCategory, ReactNode> = {
  通用: <GearSix size={20} />,
  编辑器: <PencilSimpleLine size={20} />,
  "AI 服务": <Robot size={20} />,
  提示词预设: <Sliders size={20} />,
  导入导出: <FileText size={20} />,
  备份与数据: <HardDrives size={20} />,
  快捷键: <Keyboard size={20} />
};

const defaultForm: SettingsFormState = {
  editor: {
    fontSize: 20,
    lineHeight: 2.08,
    autosaveMs: 1000
  },
  aiProvider: {
    providerType: "openrouter",
    baseUrl: OPENROUTER_BASE_URL,
    modelName: "openai/gpt-5.2",
    apiKey: ""
  },
  projectPath: ""
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
      apiKey: ""
    },
    projectPath: settings.projectPath ?? ""
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
      ...(apiKey ? { apiKey } : {})
    },
    ...(form.projectPath.trim() ? { projectPath: form.projectPath.trim() } : {})
  };
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

export function SettingsPage({ activeCategory, onCategoryChange, onWelcome, onClose }: SettingsPageProps) {
  const api = useMemo(getNovelToolApi, []);
  const [form, setForm] = useState<SettingsFormState>(defaultForm);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [modelOptions, setModelOptions] = useState<OpenRouterModelSummary[]>([]);
  const [modelListLoaded, setModelListLoaded] = useState(false);
  const [status, setStatus] = useState<StatusState>({ kind: "loading", message: "正在读取设置" });

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
    setStatus({ kind: "saving", message: "正在保存设置" });
    try {
      const saved = (await api.settings.save(buildSaveInput(form))) as SettingsState;
      applySettings(saved);
      setStatus({ kind: "saved", message: "设置已保存" });
    } catch (reason) {
      setStatus({ kind: "error", message: formatError(reason) });
    }
  };

  const testConnection = async () => {
    setStatus({ kind: "testing", message: "正在测试 AI 连接" });
    try {
      await api.settings.testConnection({ aiProvider: buildSaveInput(form).aiProvider });
      const saved = (await api.settings.save(buildSaveInput(form))) as SettingsState;
      applySettings(saved);
      const models = (await api.settings.listModels({})) as OpenRouterModelSummary[];
      setModelOptions([...models]);
      setModelListLoaded(true);
      setStatus({ kind: "saved", message: `AI 连接测试通过，设置已保存，已获取 ${models.length} 个可用模型` });
    } catch (reason) {
      setStatus({ kind: "error", message: formatError(reason) });
    }
  };

  const updateEditor = (patch: Partial<EditorSettings>) => {
    setForm((current) => ({
      ...current,
      editor: {
        ...current.editor,
        ...patch
      }
    }));
  };

  const updateAiProvider = (patch: Partial<EditableAiProviderSettings>) => {
    setForm((current) => ({
      ...current,
      aiProvider: {
        ...current.aiProvider,
        ...patch
      }
    }));
  };

  return (
    <div className="settings-page">
      <header className="settings-top">
        <button className="brand brand-button" onClick={onWelcome} title="返回开始页" type="button">
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
          {categories.map((category) => (
            <button className={activeCategory === category ? "active" : ""} key={category} onClick={() => onCategoryChange(category)} type="button">
              <span className="nav-icon">{categoryIcons[category]}</span>
              {category}
            </button>
          ))}
        </nav>
        <section className="settings-content">
          <SettingsContent
            apiKeyConfigured={apiKeyConfigured}
            category={activeCategory}
            form={form}
            isBusy={isBusy}
            modelListLoaded={modelListLoaded}
            modelOptions={modelOptions}
            status={status}
            onAiProviderChange={updateAiProvider}
            onEditorChange={updateEditor}
            onProjectPathChange={(projectPath) => setForm((current) => ({ ...current, projectPath }))}
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
  onEditorChange,
  onProjectPathChange,
  onTestConnection
}: SettingsContentProps) {
  if (category === "通用") {
    return (
      <div className="settings-grid">
        <div className="settings-card">
          <h3>启动与项目</h3>
          <p className="muted">管理打开应用后的默认入口和最近项目行为。</p>
          <div className="form-grid">
            <label>启动后</label>
            <select className="input" defaultValue="start" disabled>
              <option value="start">显示开始页</option>
              <option value="last">打开上次项目</option>
            </select>
            <label>最近项目</label>
            <button className="toggle on" type="button" aria-label="最近项目" disabled />
            <label>默认项目目录</label>
            <Input value={form.projectPath} placeholder="未设置" onChange={(event) => onProjectPathChange(event.target.value)} />
          </div>
        </div>
        <div className="settings-card">
          <h3>界面偏好</h3>
          <p className="muted">控制基础界面密度和语言显示。</p>
          <div className="form-grid">
            <label>界面语言</label>
            <select className="input" defaultValue="zh" disabled>
              <option value="zh">简体中文</option>
            </select>
            <label>界面密度</label>
            <select className="input" defaultValue="standard" disabled>
              <option value="standard">标准</option>
              <option value="compact">紧凑</option>
            </select>
            <label>侧栏默认</label>
            <select className="input" defaultValue="closed" disabled>
              <option value="closed">保持关闭</option>
              <option value="task">打开当前任务</option>
              <option value="chat">打开 AI 对话</option>
            </select>
          </div>
        </div>
        <div className="settings-card wide">
          <h3>本地存储</h3>
          <p className="muted">每个项目保存为单独的 .noveltool 文件，章节正文、快照和草稿纸都写入该文件。</p>
          <div className="detected-row simple-row">
            <span>项目目录</span>
            <span>{form.projectPath || "未设置"}</span>
          </div>
          <div className="detected-row simple-row">
            <span>自动保存延迟</span>
            <span className="tag">{form.editor.autosaveMs}ms</span>
          </div>
        </div>
      </div>
    );
  }

  if (category === "AI 服务") {
    const modelSuggestions = filterModelSuggestions(modelOptions, form.aiProvider.modelName);
    const connectionText =
      status.kind === "testing"
        ? "正在测试"
        : status.kind === "error"
          ? status.message ?? "连接失败"
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
                          onAiProviderChange({ modelName: modelId });
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
            </div>
          </div>
          <div className="connection-row">
            <Button variant="ghost" disabled={isBusy} onClick={onTestConnection}>测试并保存</Button>
            <span className={status.kind === "error" ? "settings-message error" : "muted"}>{connectionText}</span>
          </div>
        </div>
        <div className="settings-card">
          <h3>默认 AI 行为</h3>
          <p className="muted">设置 AI 在处理任务时的默认方式和偏好。</p>
          <div className="form-grid">
            <label>默认行动风格</label>
            <select className="input" defaultValue="balanced" disabled>
              <option value="balanced">平衡自然（推荐）</option>
              <option value="detail">细腻描写</option>
              <option value="classic">古风表达</option>
            </select>
            <label>应用前预览</label>
            <button className="toggle on" type="button" aria-label="应用前预览" disabled />
          </div>
          <label className="field-label">任务偏好</label>
          {["润色　提升语言流畅度与表达质量", "扩写　丰富细节，延展内容", "校对　检查错别字、病句和表达问题", "续写　基于上下文生成后续内容"].map((item) => (
            <div className="detected-row task-pref-row" key={item}>
              <input type="checkbox" defaultChecked disabled />
              <span>{item}</span>
              <span>☰</span>
            </div>
          ))}
        </div>
        <div className="settings-card">
          <h3>上下文范围</h3>
          <p className="muted">AI 请求只带入当前章节、选中文本和用户确认的附加上下文。</p>
          <div className="form-grid">
            <label>默认范围</label>
            <select className="input" defaultValue="selection" disabled>
              <option value="selection">当前选区 + 当前章节摘要</option>
              <option value="only">仅当前选区</option>
            </select>
            <label>写回方式</label>
            <select className="input" defaultValue="manual" disabled>
              <option value="manual">预览后手动应用</option>
            </select>
            <label>快照</label>
            <button className="toggle on" type="button" aria-label="快照" disabled />
          </div>
        </div>
      </div>
    );
  }

  if (category === "提示词预设") {
    return (
      <div className="settings-grid">
        <div className="settings-card">
          <h3>内置提示词预设</h3>
          <p className="muted">用于右侧当前任务和 AI 对话的常用写作指令。</p>
          {[
            ["基础润色", "保持事实不变，让语言更顺滑。"],
            ["细节扩写", "补充环境、动作和心理细节。"],
            ["错漏校对", "列出问题并逐条给出建议。"],
            ["自然续写", "承接当前章节语气继续推进。"]
          ].map(([name, desc]) => (
            <div className="detected-row preset-row" key={name}>
              <span>
                <b>{name}</b>
                <br />
                <span className="muted">{desc}</span>
              </span>
              <span className="tag">内置</span>
            </div>
          ))}
        </div>
        <div className="settings-card">
          <h3>任务内自定义</h3>
          <p className="muted">在右侧当前任务中直接编辑自定义要求，生成预览时会使用最新内容。</p>
          <div className="detected-row simple-row">
            <span>自定义要求</span>
            <span className="tag">任务内编辑</span>
          </div>
        </div>
      </div>
    );
  }

  if (category === "编辑器") {
    return (
      <div className="settings-grid">
        <div className="settings-card">
          <h3>编辑器</h3>
          <p className="muted">调整正文书写体验。</p>
          <div className="form-grid">
            <label>字体大小</label>
            <select className="input" value={String(form.editor.fontSize)} onChange={(event) => onEditorChange({ fontSize: Number(event.target.value) })}>
              <option value="16">16px</option>
              <option value="18">18px</option>
              <option value="20">20px</option>
            </select>
            <label>行间距</label>
            <select className="input" value={String(form.editor.lineHeight)} onChange={(event) => onEditorChange({ lineHeight: Number(event.target.value) })}>
              <option value="1.7">1.7</option>
              <option value="1.9">1.9</option>
              <option value="2.08">2.08</option>
              <option value="2">2.0</option>
              <option value="2.2">2.2</option>
            </select>
            <label>正文字体</label>
            <select className="input" defaultValue="system" disabled>
              <option value="system">系统无衬线</option>
              <option value="song">宋体</option>
            </select>
          </div>
        </div>
        <div className="settings-card">
          <h3>自动保存</h3>
          <p className="muted">编辑后自动保存章节内容。</p>
          <div className="form-grid">
            <label>自动保存</label>
            <button className="toggle on" type="button" aria-label="自动保存" disabled />
            <label>延迟</label>
            <select className="input" value={String(form.editor.autosaveMs)} onChange={(event) => onEditorChange({ autosaveMs: Number(event.target.value) })}>
              <option value="800">800ms</option>
              <option value="1000">1000ms</option>
              <option value="1500">1500ms</option>
              <option value="2000">2000ms</option>
            </select>
          </div>
        </div>
      </div>
    );
  }

  if (category === "导入导出") {
    return (
      <div className="settings-grid">
        <div className="settings-card">
          <h3>导入</h3>
          <p className="muted">第一版支持 TXT 导入，导入前可以预览章节并调整识别结果。</p>
          <div className="detected-row simple-row">
            <span>TXT 导入</span>
            <span className="tag">已支持</span>
          </div>
        </div>
      </div>
    );
  }

  if (category === "备份与数据") {
    return (
      <div className="settings-grid">
        <div className="settings-card">
          <h3>备份与数据</h3>
          <p className="muted">本地项目、章节和草稿纸均保存在本机。</p>
          <div className="form-grid">
            <label>自动备份</label>
            <button className="toggle" type="button" aria-label="自动备份" disabled />
            <label>项目路径</label>
            <Input value={form.projectPath} placeholder="未设置" onChange={(event) => onProjectPathChange(event.target.value)} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-grid">
      <div className="settings-card">
        <h3>快捷键</h3>
        <p className="muted">常用写作操作快捷键。</p>
        {[
          ["保存章节", "⌘ S"],
          ["打开 AI 对话", "⌘ J"],
          ["新建章节", "⌘ N"]
        ].map(([name, shortcut]) => (
          <div className="detected-row shortcut-row" key={name}>
            <span>{name}</span>
            <span>{shortcut}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
