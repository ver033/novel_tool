import type { ImportPreview, TxtImportEncoding } from "../../main/shared/types";
import { Button } from "../components/Button";
import type { ContentLanguage } from "../../main/shared/language";
import { useI18n } from "../i18n";

type ImportMode = "create_new_project" | "import_into_current_project";

type ImportFileStepProps = {
  readonly busy: boolean;
  readonly currentProjectId: string | null;
  readonly error: string | null;
  readonly mode: ImportMode;
  readonly preview: ImportPreview | null;
  readonly contentLanguage: ContentLanguage;
  readonly encoding: TxtImportEncoding;
  readonly showDropZone?: boolean;
  readonly onSelectFile: () => void;
  readonly onContentLanguageChange: (language: ContentLanguage) => void;
  readonly onEncodingChange: (encoding: TxtImportEncoding) => void;
};

export function ImportFileStep({ busy, currentProjectId, error, mode, preview, contentLanguage, encoding, showDropZone = true, onSelectFile, onContentLanguageChange, onEncodingChange }: ImportFileStepProps) {
  const { t } = useI18n();
  const isAppendingToOpenedProject = mode === "import_into_current_project";

  return (
    <>
      {showDropZone ? (
        <div className="drop-zone">
          <div>
            <span className="file-icon">TXT</span>
            <h2 className="section-title">{t("selectTxtFile")}</h2>
            <p className="muted">{preview ? t("selectedFileSummary", { file: preview.fileName, count: preview.chapters.length }) : t("txtSupportDescription")}</p>
            {error ? <p className="mini-tag orange">{error}</p> : null}
            <Button disabled={busy} onClick={onSelectFile} variant="primary">
              {busy ? t("reading") : preview ? t("reselectFile") : t("selectFile")}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="panel import-options">
        <label className="field-label" htmlFor="import-content-language">{t("workLanguage")}</label>
        <select
          className="input"
          disabled={busy || isAppendingToOpenedProject}
          id="import-content-language"
          value={contentLanguage}
          onChange={(event) => onContentLanguageChange(event.target.value as ContentLanguage)}
        >
          <option value="zh-CN">{t("zhCN")}</option>
          <option value="ja-JP">{t("jaJP")}</option>
        </select>
        <label className="field-label" htmlFor="import-encoding">{t("encoding")}</label>
        <select className="input" disabled={busy} id="import-encoding" value={encoding} onChange={(event) => onEncodingChange(event.target.value as TxtImportEncoding)}>
          <option value="auto">{t("detectAutomatically")}</option>
          <option value="utf8">UTF-8</option>
          <option value="shift_jis">Shift_JIS / CP932</option>
          <option value="euc-jp">EUC-JP</option>
          <option value="gb18030">GB18030</option>
          <option value="big5">Big5</option>
        </select>
        <div className="import-mode-note">
          <b>{isAppendingToOpenedProject ? t("appendToCurrentProject") : t("importAsNewProject")}</b>
          <br />
          <span className="muted">
            {isAppendingToOpenedProject
              ? currentProjectId
                ? t("appendDescription")
                : t("openProjectFirst")
              : t("newProjectImportDescription")}
          </span>
        </div>
      </div>
    </>
  );
}
