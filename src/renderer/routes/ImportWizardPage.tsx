import { BookOpen } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ImportConfirmResult, ImportPreview, TxtImportEncoding } from "../../main/shared/types";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Modal } from "../components/Modal";
import { ImportConfirmStep } from "../import/ImportConfirmStep";
import { ImportFileStep } from "../import/ImportFileStep";
import { ImportPreviewStep } from "../import/ImportPreviewStep";
import { getNovelToolApi } from "../state/app-store";
import type { ContentLanguage } from "../../main/shared/language";
import { useI18n } from "../i18n";

type ImportMode = "create_new_project" | "import_into_current_project";

type ImportWizardPageProps = {
  readonly currentProjectId: string | null;
  readonly currentProjectLanguage: ContentLanguage | null;
  readonly step: number;
  readonly onBack: () => void;
  readonly onNext: () => void;
  readonly onStepChange: (step: number) => void;
  readonly onCancel: () => void;
  readonly onFinish: (result: ImportConfirmResult | null) => void;
  readonly initialMode: ImportMode;
};

export function ImportWizardPage({ currentProjectId, currentProjectLanguage, step, onBack, onNext, onStepChange, onCancel, onFinish, initialMode }: ImportWizardPageProps) {
  const { t } = useI18n();
  const api = useMemo(getNovelToolApi, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>(initialMode);
  const [contentLanguage, setContentLanguage] = useState<ContentLanguage>(currentProjectLanguage ?? "zh-CN");
  const [encoding, setEncoding] = useState<TxtImportEncoding>("auto");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportConfirmResult | null>(null);
  const [renameChapterDraft, setRenameChapterDraft] = useState<{ index: number; title: string } | null>(null);
  const [renameChapterTitle, setRenameChapterTitle] = useState("");
  const steps = [
    [t("fileSelection"), t("selectNovelFile")],
    [t("detectChapters"), t("detectChapterStructure")],
    [t("previewAndAdjust"), t("previewAndAdjustDescription")],
    [t("completeImport"), t("importIntoProjectDescription")]
  ] as const;
  const primaryLabel = step === 4 ? t("openProject") : step === 3 ? t("importAndOpen") : step === 2 ? t("viewDetection") : preview ? t("next") : t("selectAndDetect");
  const busyStatus =
    step === 1
      ? t("readingAndDetecting")
      : step === 2
        ? t("updatingDetection")
        : step === 3
          ? t("writingProject")
          : t("processingImport");
  const statusText = error ?? (busy ? busyStatus : null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (initialMode === "import_into_current_project" && currentProjectLanguage) {
      setContentLanguage(currentProjectLanguage);
    }
  }, [currentProjectLanguage, initialMode]);

  async function selectAndPreviewTxt(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const selected = (await api.import.selectTxtFile()) as { filePath: string } | null;
      if (!selected) {
        return;
      }
      const nextPreview = (await api.import.previewTxt({ filePath: selected.filePath, contentLanguage, encoding })) as ImportPreview;
      setPreview(nextPreview);
      setResult(null);
      onStepChange(2);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("readTxtFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function updatePreview(operations: Parameters<typeof api.import.updatePreview>[0]["operations"]): Promise<void> {
    if (!preview) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const nextPreview = (await api.import.updatePreview({
        importJobId: preview.importJobId,
        operations
      })) as ImportPreview;
      setPreview(nextPreview);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("updatePreviewFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport(): Promise<void> {
    if (!preview) {
      setError(t("selectTxtFirst"));
      return;
    }
    if (mode === "import_into_current_project" && !currentProjectId) {
      setError(t("appendRequiresProject"));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const confirmed = (await api.import.confirmTxtImport({
        importJobId: preview.importJobId,
        mode,
        projectId: mode === "import_into_current_project" ? currentProjectId ?? undefined : undefined,
        projectName: mode === "create_new_project" ? preview.fileName.replace(/\.txt$/i, "") : undefined,
        contentLanguage: mode === "create_new_project" ? contentLanguage : undefined
      })) as ImportConfirmResult;
      setResult(confirmed);
      onStepChange(4);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("confirmImportFailed"));
    } finally {
      setBusy(false);
    }
  }

  function handlePrimary(): void {
    if (busy) {
      return;
    }
    if (step === 1) {
      if (preview) {
        onNext();
        return;
      }
      void selectAndPreviewTxt();
      return;
    }
    if (step === 2) {
      onNext();
      return;
    }
    if (step === 3) {
      void confirmImport();
      return;
    }
    onFinish(result);
  }

  function renameChapter(chapterIndex: number, title: string): void {
    setRenameChapterDraft({ index: chapterIndex, title });
    setRenameChapterTitle(title);
  }

  function cancelRenameChapter(): void {
    setRenameChapterDraft(null);
    setRenameChapterTitle("");
  }

  function submitRenameChapter(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const title = renameChapterTitle.trim();
    if (!renameChapterDraft || !title) {
      return;
    }

    if (title !== renameChapterDraft.title) {
      void updatePreview([{ type: "rename_chapter", chapterIndex: renameChapterDraft.index, title }]);
    }

    cancelRenameChapter();
  }

  return (
    <div className="import-shell">
      <header className="settings-top">
        <button className="brand brand-button" onClick={onCancel} title={t("previous")} type="button">
          <span className="line-icon">
            <BookOpen size={24} />
          </span>
          <span>{t("importNovelTitle")}</span>
        </button>
        <div className="top-actions">
          <IconCloseButton onClick={onCancel} label={t("closeImport")} />
        </div>
      </header>

      <main className="import-page">
        <section className="panel wizard">
          <div className="steps" aria-label={t("importSteps")}>
            {steps.map(([title, description], index) => {
              const number = index + 1;
              return (
                <button
                  className={`step ${number === step ? "active" : ""}`}
                  disabled={number > step || busy}
                  key={title}
                  onClick={() => onStepChange(number)}
                  type="button"
                >
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

          {mode === "import_into_current_project" ? (
            <div className="import-mode-banner append" role="status">
              <b>{t("appendMode")}</b>
              <span>{t("appendModeDescription")}</span>
            </div>
          ) : null}

          {step === 1 ? (
            <ImportFileStep
              busy={busy}
              currentProjectId={currentProjectId}
              error={error}
              mode={mode}
              preview={preview}
              contentLanguage={contentLanguage}
              encoding={encoding}
              onContentLanguageChange={setContentLanguage}
              onEncodingChange={setEncoding}
              onSelectFile={selectAndPreviewTxt}
            />
          ) : null}
          {step === 2 ? (
            <>
              {preview ? (
                <ImportPreviewStep
                  preview={preview}
                  onMerge={(chapterIndex) => void updatePreview([{ type: "merge_with_previous", chapterIndex }])}
                  onRedetect={() => void updatePreview([{ type: "redetect" }])}
                  onRename={renameChapter}
                  onSplit={(chapterIndex, lineNumber) => void updatePreview([{ type: "split_from_line", chapterIndex, lineNumber }])}
                />
              ) : null}
              {!preview ? <ImportFileStep busy={busy} currentProjectId={currentProjectId} error={error} mode={mode} preview={preview} contentLanguage={contentLanguage} encoding={encoding} onContentLanguageChange={setContentLanguage} onEncodingChange={setEncoding} onSelectFile={selectAndPreviewTxt} /> : null}
            </>
          ) : null}
          {step === 3 ? (
            <>
              <ImportPreviewStep
                preview={preview}
                onMerge={(chapterIndex) => void updatePreview([{ type: "merge_with_previous", chapterIndex }])}
                onRedetect={() => void updatePreview([{ type: "redetect" }])}
                onRename={renameChapter}
                onSplit={(chapterIndex, lineNumber) => void updatePreview([{ type: "split_from_line", chapterIndex, lineNumber }])}
              />
              <ImportFileStep busy={busy} currentProjectId={currentProjectId} error={error} mode={mode} preview={preview} contentLanguage={contentLanguage} encoding={encoding} onContentLanguageChange={setContentLanguage} onEncodingChange={setEncoding} showDropZone={false} onSelectFile={selectAndPreviewTxt} />
            </>
          ) : null}
          {step === 4 ? <ImportConfirmStep preview={preview} result={result} /> : null}

          {statusText ? (
            <p className={`import-status ${error ? "error" : "loading"}`} role="status">
              {statusText}
            </p>
          ) : null}

          <div className="wizard-actions">
            <Button disabled={busy || step === 1} variant="ghost" onClick={onBack}>{t("previous")}</Button>
            <Button disabled={busy || !preview} variant="ghost" onClick={() => void updatePreview([{ type: "redetect" }])}>
              {t("redetect")}
            </Button>
            <Button disabled={busy || (step > 1 && !preview)} variant="primary" onClick={handlePrimary}>{busy ? t("processing") : primaryLabel}</Button>
          </div>
        </section>
      </main>

      <Modal open={Boolean(renameChapterDraft)} title={t("renameChapter")} onClose={cancelRenameChapter}>
        <form className="rename-form" onSubmit={submitRenameChapter}>
          <label className="field-label" htmlFor="import-chapter-rename-input">
            {t("chapterName")}
          </label>
          <Input
            autoFocus
            id="import-chapter-rename-input"
            value={renameChapterTitle}
            onChange={(event) => setRenameChapterTitle(event.target.value)}
          />
          <div className="modal-actions">
            <Button onClick={cancelRenameChapter} type="button" variant="ghost">
              {t("cancel")}
            </Button>
            <Button disabled={!renameChapterTitle.trim() || renameChapterTitle.trim() === renameChapterDraft?.title} type="submit" variant="primary">
              {t("save")}
            </Button>
          </div>
        </form>
      </Modal>
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
