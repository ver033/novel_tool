import { BookOpen, FolderOpen } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ProjectCreateInput } from "../../main/shared/types";
import type { ContentLanguage } from "../../main/shared/language";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { useI18n } from "../i18n";

const DEFAULT_TARGET_WORD_COUNT = "3000";
const MIN_TARGET_WORD_COUNT = 100;
const MAX_TARGET_WORD_COUNT = 500_000;

type NewProjectPageProps = {
  readonly onCancel: () => void;
  readonly onCreate: (input: ProjectCreateInput) => Promise<void> | void;
  readonly onSelectProjectSavePath: (suggestedName: string) => Promise<string | null>;
  readonly onSuggestProjectPath: (suggestedName: string) => Promise<string>;
};

export function NewProjectPage({ onCancel, onCreate, onSelectProjectSavePath, onSuggestProjectPath }: NewProjectPageProps) {
  const { locale, t } = useI18n();
  const [name, setName] = useState("");
  const [targetWordCount, setTargetWordCount] = useState(DEFAULT_TARGET_WORD_COUNT);
  const [contentLanguage, setContentLanguage] = useState<ContentLanguage>("zh-CN");
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
  const statusText = error ?? (busy ? t("creatingProject") : null);
  const steps = [
    [t("projectInfo"), t("projectInfoDescription")],
    [t("saveLocation"), t("saveLocationDescription")],
    [t("confirmCreation"), t("startWriting")]
  ] as const;

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
      return t("customLocation");
    }
    if (suggestedRootPath) {
      return t("defaultLocation");
    }
    return t("waitingForNovelName");
  }, [customRootPath, suggestedRootPath, t]);

  async function chooseProjectPath(): Promise<void> {
    if (!trimmedName) {
      setError(t("enterNovelNameFirst"));
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
      setError(t("enterNovelName"));
      return;
    }
    if (!targetValid) {
      setError(t("invalidTargetCount"));
      return;
    }
    if (!resolvedRootPath) {
      setError(t("confirmProjectLocation"));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onCreate({
        name: trimmedName,
        targetWordCount: targetValue,
        contentLanguage,
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
        <button className="brand brand-button" onClick={onCancel} title={t("backToStart")} type="button">
          <span className="line-icon">
            <BookOpen size={24} />
          </span>
          <span>{t("newProjectTitle")}</span>
        </button>
        <div className="top-actions">
          <IconCloseButton onClick={onCancel} label={t("closeNewProject")} />
        </div>
      </header>

      <main className="import-page">
        <section className="panel wizard new-project-wizard">
          <div className="steps" aria-label={t("newProjectSteps")}>
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
                <h2>{t("projectInfo")}</h2>
                <p className="muted">{t("basicWritingGoal")}</p>
              </div>
              <div className="new-project-fields">
                <label className="field-label" htmlFor="new-project-name">
                  {t("novelName")}
                </label>
                <Input
                  autoFocus
                  id="new-project-name"
                  placeholder={t("novelNameExample")}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setCustomRootPath(null);
                    setError(null);
                  }}
                />

                <label className="field-label" htmlFor="new-project-target">
                  {t("targetCharactersPerChapter")}
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

                <label className="field-label" htmlFor="new-project-language">
                  {t("workLanguage")}
                </label>
                <select
                  className="input"
                  id="new-project-language"
                  value={contentLanguage}
                  onChange={(event) => setContentLanguage(event.target.value as ContentLanguage)}
                >
                  <option value="zh-CN">{t("zhCN")}</option>
                  <option value="ja-JP">{t("jaJP")}</option>
                </select>
              </div>
            </section>

            <section className="new-project-section">
              <div>
                <h2>{t("projectFileLocation")}</h2>
                <p className="muted">{t("projectFileDescription")}</p>
              </div>
              <div className="new-project-location">
                <span className="mini-tag">{pathModeLabel}</span>
                <div className={`path-value ${resolvedRootPath ? "" : "empty"}`}>
                  {resolvedRootPath ?? t("generatedPathHint")}
                </div>
                <Button disabled={!trimmedName || busy} onClick={chooseProjectPath} type="button" variant="ghost">
                  <FolderOpen size={18} />
                  {t("chooseAnotherLocation")}
                </Button>
              </div>
            </section>

            <section className="new-project-section">
              <div>
                <h2>{t("confirmCreation")}</h2>
                <p className="muted">{t("duplicateFileHint")}</p>
              </div>
              <div className="new-project-confirm">
                <SummaryRow label={t("novelName")} value={trimmedName || t("notEntered")} />
                <SummaryRow label={t("perChapterTarget")} value={targetValid ? `${targetValue.toLocaleString(locale)} ${t("words")}` : t("notSet")} />
                <SummaryRow label={t("workLanguage")} value={contentLanguage === "ja-JP" ? t("jaJP") : t("zhCN")} />
                <SummaryRow label={t("projectFile")} value={resolvedRootPath ?? t("notConfirmed")} />
              </div>
            </section>

            {statusText ? (
              <p className={`import-status ${error ? "error" : "loading"}`} role="status">
                {statusText}
              </p>
            ) : null}

            <div className="wizard-actions">
              <Button disabled={busy} onClick={onCancel} type="button" variant="ghost">
                {t("back")}
              </Button>
              <Button disabled={!canCreate} type="submit" variant="primary">
                {busy ? t("creating") : t("createAndStart")}
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
