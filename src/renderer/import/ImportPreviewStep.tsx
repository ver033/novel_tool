import type { ImportPreview } from "../../main/shared/types";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";

type ImportPreviewStepProps = {
  readonly preview: ImportPreview | null;
  readonly onMerge: (chapterIndex: number) => void;
  readonly onRedetect: () => void;
  readonly onRename: (chapterIndex: number, title: string) => void;
  readonly onSplit: (chapterIndex: number, lineNumber: number) => void;
};

export function ImportPreviewStep({ preview, onMerge, onRedetect, onRename, onSplit }: ImportPreviewStepProps) {
  const { locale, t } = useI18n();
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const chapterCount = preview?.chapters.length ?? 0;

  useEffect(() => {
    if (activeChapterIndex >= chapterCount) {
      setActiveChapterIndex(Math.max(0, chapterCount - 1));
    }
  }, [activeChapterIndex, chapterCount]);

  if (!preview) {
    return (
      <div className="drop-zone">
        <div>
          <span className="file-icon">TXT</span>
          <h2 className="section-title">{t("noImportPreview")}</h2>
          <p className="muted">{t("selectTxtFirst")}</p>
        </div>
      </div>
    );
  }

  const currentPreview = preview;
  const activeChapter = currentPreview.chapters[activeChapterIndex] ?? currentPreview.chapters[0] ?? null;

  function splitChapter(chapterIndex: number): void {
    const chapter = currentPreview.chapters[chapterIndex];
    if (!chapter) {
      return;
    }
    const lineCount = chapter.text.split("\n").length;
    const lineNumber = Math.max(2, Math.min(lineCount, Math.ceil(lineCount / 2)));
    onSplit(chapterIndex, lineNumber);
  }

  return (
    <>
      <ImportSummary preview={preview} />
      <div className="import-split">
        <div className="detected-list">
          <div className="box-header">
            <span>{t("detectedChapters")}（{preview.chapters.length}）</span>
            <button className="link-button" onClick={onRedetect} type="button">{t("redetect")}</button>
          </div>
          {preview.chapters.map((chapter, index) => (
            <div className={`detected-row ${index === activeChapterIndex ? "active" : ""}`} key={`${chapter.order}-${chapter.title}`}>
              <button className="detected-main" onClick={() => setActiveChapterIndex(index)} type="button">
                <b>{chapter.title}</b>
                <br />
                <span className="muted">{chapter.wordCount.toLocaleString(locale)} {t("words")}</span>
              </button>
              <span className="row-actions">
                <button disabled={index === 0} onClick={() => onMerge(index)} type="button">{t("merge")}</button>
                <button onClick={() => splitChapter(index)} type="button">{t("split")}</button>
                <button onClick={() => onRename(index, chapter.title)} type="button">{t("rename")}</button>
              </span>
            </div>
          ))}
        </div>
        <div className="preview-pane">
          <div className="box-header">
            <span>{t("contentPreview")} · {activeChapter?.title ?? t("noChapterSelected")}（{(activeChapter?.wordCount ?? 0).toLocaleString(locale)} {t("words")}）</span>
            <span className="muted">{t("scrollFullPreview")}</span>
          </div>
          <div className="preview-text">
            {(activeChapter?.text.split(/\n{2,}/) ?? [t("noContent")]).map((paragraph, index) => (
              <p key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph}</p>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export function ImportSummary({ preview }: { readonly preview: ImportPreview }) {
  const { locale, t } = useI18n();
  return (
    <div className="import-summary">
      <div className="file-block">
        <span className="file-icon">TXT</span>
        <span>
          <b>{preview.fileName}</b>
          <br />
          <span className="muted">{preview.encoding}</span>
        </span>
      </div>
      <div>
        <span className="muted">{t("detectedChapters")}</span>
        <br />
        <b>{preview.chapters.length}</b>
      </div>
      <div>
        <span className="muted">{t("totalCharacters")}</span>
        <br />
        <b>{preview.totalWordCount.toLocaleString(locale)} {t("words")}</b>
      </div>
      <div>
        <span className="muted">{t("importFile")}</span>
        <br />
        <b>{preview.fileName}</b>
      </div>
    </div>
  );
}
