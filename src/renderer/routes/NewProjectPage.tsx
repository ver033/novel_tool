import { BookOpen, FolderOpen } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ProjectCreateInput } from "../../main/shared/types";
import { Button } from "../components/Button";
import { Input } from "../components/Input";

const DEFAULT_TARGET_WORD_COUNT = "3000";
const MIN_TARGET_WORD_COUNT = 100;
const MAX_TARGET_WORD_COUNT = 500_000;

type NewProjectPageProps = {
  readonly onCancel: () => void;
  readonly onCreate: (input: ProjectCreateInput) => Promise<void> | void;
  readonly onSelectProjectSavePath: (suggestedName: string) => Promise<string | null>;
  readonly onSuggestProjectPath: (suggestedName: string) => Promise<string>;
};

const steps = [
  ["项目信息", "小说名称和目标字数"],
  ["保存位置", "确认项目文件"],
  ["确认创建", "开始写作"]
] as const;

export function NewProjectPage({ onCancel, onCreate, onSelectProjectSavePath, onSuggestProjectPath }: NewProjectPageProps) {
  const [name, setName] = useState("");
  const [targetWordCount, setTargetWordCount] = useState(DEFAULT_TARGET_WORD_COUNT);
  const [customRootPath, setCustomRootPath] = useState<string | null>(null);
  const [suggestedRootPath, setSuggestedRootPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmedName = name.trim();
  const resolvedRootPath = customRootPath ?? suggestedRootPath;
  const targetValue = Number(targetWordCount);
  const targetValid = Number.isInteger(targetValue) && targetValue >= MIN_TARGET_WORD_COUNT && targetValue <= MAX_TARGET_WORD_COUNT;
  const activeStep = !trimmedName || !targetValid ? 1 : !resolvedRootPath ? 2 : 3;
  const canCreate = Boolean(trimmedName && targetValid && resolvedRootPath && !busy);
  const statusText = error ?? (busy ? "正在创建项目" : null);

  useEffect(() => {
    if (!trimmedName) {
      setSuggestedRootPath(null);
      return undefined;
    }

    let cancelled = false;
    void onSuggestProjectPath(trimmedName)
      .then((filePath) => {
        if (!cancelled) {
          setSuggestedRootPath(filePath);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setSuggestedRootPath(null);
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onSuggestProjectPath, trimmedName]);

  const pathModeLabel = useMemo(() => {
    if (customRootPath) {
      return "自定义位置";
    }
    if (suggestedRootPath) {
      return "默认位置";
    }
    return "等待小说名称";
  }, [customRootPath, suggestedRootPath]);

  async function chooseProjectPath(): Promise<void> {
    if (!trimmedName) {
      setError("请先输入小说名称。");
      return;
    }

    setError(null);
    try {
      const filePath = await onSelectProjectSavePath(trimmedName);
      if (filePath) {
        setCustomRootPath(filePath);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function submitProject(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!trimmedName) {
      setError("请输入小说名称。");
      return;
    }
    if (!targetValid) {
      setError("每章目标字数需要在 100 到 500000 之间。");
      return;
    }
    if (!resolvedRootPath) {
      setError("请确认项目文件保存位置。");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onCreate({
        name: trimmedName,
        targetWordCount: targetValue,
        ...(customRootPath ? { rootPath: customRootPath } : {})
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="import-shell">
      <header className="settings-top">
        <button className="brand brand-button" onClick={onCancel} title="返回开始页" type="button">
          <span className="line-icon">
            <BookOpen size={24} />
          </span>
          <span>新建作品</span>
        </button>
        <div className="top-actions">
          <IconCloseButton onClick={onCancel} label="关闭新建作品" />
        </div>
      </header>

      <main className="import-page">
        <section className="panel wizard new-project-wizard">
          <div className="steps" aria-label="新建项目步骤">
            {steps.map(([title, description], index) => {
              const number = index + 1;
              return (
                <button className={`step ${number === activeStep ? "active" : ""}`} disabled key={title} type="button">
                  <span className="step-no">{number}</span>
                  <span>
                    <b>{title}</b>
                    <br />
                    <span>{description}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <form className="new-project-page-form" onSubmit={submitProject}>
            <section className="new-project-section">
              <div>
                <h2>项目信息</h2>
                <p className="muted">先确定这本小说的基础写作目标。</p>
              </div>
              <div className="new-project-fields">
                <label className="field-label" htmlFor="new-project-name">
                  小说名称
                </label>
                <Input
                  autoFocus
                  id="new-project-name"
                  placeholder="例如：长夜归途"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setCustomRootPath(null);
                    setError(null);
                  }}
                />

                <label className="field-label" htmlFor="new-project-target">
                  每章目标字数
                </label>
                <Input
                  id="new-project-target"
                  inputMode="numeric"
                  max={MAX_TARGET_WORD_COUNT}
                  min={MIN_TARGET_WORD_COUNT}
                  step={100}
                  type="number"
                  value={targetWordCount}
                  onChange={(event) => {
                    setTargetWordCount(event.target.value);
                    setError(null);
                  }}
                />
              </div>
            </section>

            <section className="new-project-section">
              <div>
                <h2>项目文件位置</h2>
                <p className="muted">项目文件会保存章节、草稿纸和 AI 记录。</p>
              </div>
              <div className="new-project-location">
                <span className="mini-tag">{pathModeLabel}</span>
                <div className={`path-value ${resolvedRootPath ? "" : "empty"}`}>
                  {resolvedRootPath ?? "输入小说名称后生成默认项目文件路径"}
                </div>
                <Button disabled={!trimmedName || busy} onClick={chooseProjectPath} type="button" variant="ghost">
                  <FolderOpen size={18} />
                  选择其他位置
                </Button>
              </div>
            </section>

            <section className="new-project-section">
              <div>
                <h2>确认创建</h2>
                <p className="muted">同名默认项目会自动使用新的文件名。</p>
              </div>
              <div className="new-project-confirm">
                <SummaryRow label="小说名称" value={trimmedName || "未填写"} />
                <SummaryRow label="每章目标" value={targetValid ? `${targetValue.toLocaleString("zh-CN")} 字` : "未设置"} />
                <SummaryRow label="项目文件" value={resolvedRootPath ?? "未确认"} />
              </div>
            </section>

            {statusText ? (
              <p className={`import-status ${error ? "error" : "loading"}`} role="status">
                {statusText}
              </p>
            ) : null}

            <div className="wizard-actions">
              <Button disabled={busy} onClick={onCancel} type="button" variant="ghost">
                返回
              </Button>
              <Button disabled={!canCreate} type="submit" variant="primary">
                {busy ? "创建中" : "创建并开始写作"}
              </Button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}

function SummaryRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="new-project-summary-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function IconCloseButton({ onClick, label }: { readonly onClick: () => void; readonly label: string }) {
  return (
    <button className="icon-button" onClick={onClick} type="button" aria-label={label} title={label}>
      ×
    </button>
  );
}
