import { BookOpen } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ImportConfirmResult, ImportPreview } from "../../main/shared/types";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Modal } from "../components/Modal";
import { ImportConfirmStep } from "../import/ImportConfirmStep";
import { ImportFileStep } from "../import/ImportFileStep";
import { ImportPreviewStep } from "../import/ImportPreviewStep";
import { getNovelToolApi } from "../state/app-store";

type ImportMode = "create_new_project" | "import_into_current_project";

type ImportWizardPageProps = {
  readonly currentProjectId: string | null;
  readonly step: number;
  readonly onBack: () => void;
  readonly onNext: () => void;
  readonly onStepChange: (step: number) => void;
  readonly onCancel: () => void;
  readonly onFinish: (result: ImportConfirmResult | null) => void;
  readonly initialMode: ImportMode;
};

const steps = [
  ["选择文件", "选择要导入的小说文件"],
  ["识别章节", "自动识别章节结构"],
  ["预览与调整", "预览内容并调整章节"],
  ["完成导入", "开始导入到项目中"]
] as const;

export function ImportWizardPage({ currentProjectId, step, onBack, onNext, onStepChange, onCancel, onFinish, initialMode }: ImportWizardPageProps) {
  const api = useMemo(getNovelToolApi, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>(initialMode);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportConfirmResult | null>(null);
  const [renameChapterDraft, setRenameChapterDraft] = useState<{ index: number; title: string } | null>(null);
  const [renameChapterTitle, setRenameChapterTitle] = useState("");
  const primaryLabel = step === 4 ? "打开项目" : step === 3 ? "导入并打开" : step === 2 ? "查看识别结果" : preview ? "下一步" : "选择并识别";
  const busyStatus =
    step === 1
      ? "正在读取并识别 TXT 文件"
      : step === 2
        ? "正在更新章节识别结果"
        : step === 3
          ? "正在写入项目"
          : "正在处理导入结果";
  const statusText = error ?? (busy ? busyStatus : null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  async function selectAndPreviewTxt(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const selected = (await api.import.selectTxtFile()) as { filePath: string } | null;
      if (!selected) {
        return;
      }
      const nextPreview = (await api.import.previewTxt({ filePath: selected.filePath })) as ImportPreview;
      setPreview(nextPreview);
      setResult(null);
      onStepChange(2);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取 TXT 文件失败");
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
      setError(reason instanceof Error ? reason.message : "更新导入预览失败");
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport(): Promise<void> {
    if (!preview) {
      setError("请先选择 TXT 文件");
      return;
    }
    if (mode === "import_into_current_project" && !currentProjectId) {
      setError("需要先从编辑器打开导入入口，才能追加到当前作品");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const confirmed = (await api.import.confirmTxtImport({
        importJobId: preview.importJobId,
        mode,
        projectId: mode === "import_into_current_project" ? currentProjectId ?? undefined : undefined,
        projectName: mode === "create_new_project" ? preview.fileName.replace(/\.txt$/i, "") : undefined
      })) as ImportConfirmResult;
      setResult(confirmed);
      onStepChange(4);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "确认导入失败");
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
        <button className="brand brand-button" onClick={onCancel} title="返回上一页" type="button">
          <span className="line-icon">
            <BookOpen size={24} />
          </span>
          <span>导入小说</span>
        </button>
        <div className="top-actions">
          <IconCloseButton onClick={onCancel} label="关闭导入" />
        </div>
      </header>

      <main className="import-page">
        <section className="panel wizard">
          <div className="steps" aria-label="导入步骤">
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
              <b>当前为追加模式</b>
              <span>识别到的章节会追加到当前作品末尾，不会新建项目。</span>
            </div>
          ) : null}

          {step === 1 ? (
            <ImportFileStep
              busy={busy}
              currentProjectId={currentProjectId}
              error={error}
              mode={mode}
              preview={preview}
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
              {!preview ? <ImportFileStep busy={busy} currentProjectId={currentProjectId} error={error} mode={mode} preview={preview} onSelectFile={selectAndPreviewTxt} /> : null}
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
              <ImportFileStep busy={busy} currentProjectId={currentProjectId} error={error} mode={mode} preview={preview} showDropZone={false} onSelectFile={selectAndPreviewTxt} />
            </>
          ) : null}
          {step === 4 ? <ImportConfirmStep preview={preview} result={result} /> : null}

          {statusText ? (
            <p className={`import-status ${error ? "error" : "loading"}`} role="status">
              {statusText}
            </p>
          ) : null}

          <div className="wizard-actions">
            <Button disabled={busy || step === 1} variant="ghost" onClick={onBack}>上一步</Button>
            <Button disabled={busy || !preview} variant="ghost" onClick={() => void updatePreview([{ type: "redetect" }])}>
              重新识别
            </Button>
            <Button disabled={busy || (step > 1 && !preview)} variant="primary" onClick={handlePrimary}>{busy ? "处理中" : primaryLabel}</Button>
          </div>
        </section>
      </main>

      <Modal open={Boolean(renameChapterDraft)} title="重命名章节" onClose={cancelRenameChapter}>
        <form className="rename-form" onSubmit={submitRenameChapter}>
          <label className="field-label" htmlFor="import-chapter-rename-input">
            章节名称
          </label>
          <Input
            autoFocus
            id="import-chapter-rename-input"
            value={renameChapterTitle}
            onChange={(event) => setRenameChapterTitle(event.target.value)}
          />
          <div className="modal-actions">
            <Button onClick={cancelRenameChapter} type="button" variant="ghost">
              取消
            </Button>
            <Button disabled={!renameChapterTitle.trim() || renameChapterTitle.trim() === renameChapterDraft?.title} type="submit" variant="primary">
              保存
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
