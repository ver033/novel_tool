import type { ImportPreview } from "../../main/shared/types";
import { Button } from "../components/Button";

type ImportMode = "create_new_project" | "import_into_current_project";

type ImportFileStepProps = {
  readonly busy: boolean;
  readonly currentProjectId: string | null;
  readonly error: string | null;
  readonly mode: ImportMode;
  readonly preview: ImportPreview | null;
  readonly showDropZone?: boolean;
  readonly onModeChange: (mode: ImportMode) => void;
  readonly onSelectFile: () => void;
};

export function ImportFileStep({ busy, currentProjectId, error, mode, preview, showDropZone = true, onModeChange, onSelectFile }: ImportFileStepProps) {
  return (
    <>
      {showDropZone ? (
        <div className="drop-zone">
          <div>
            <span className="file-icon">TXT</span>
            <h2 className="section-title">拖入 TXT 文件，或点击选择</h2>
            <p className="muted">{preview ? `已选择 ${preview.fileName}，识别到 ${preview.chapters.length} 章。` : "当前版本支持纯文本文件，会自动识别章节并进入预览。"}</p>
            {error ? <p className="mini-tag orange">{error}</p> : null}
            <Button disabled={busy} onClick={onSelectFile} variant="primary">
              {busy ? "读取中" : preview ? "重新选择文件" : "选择文件"}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="panel import-options">
        <label className={`radio ${mode === "create_new_project" ? "active" : ""}`}>
          <input checked={mode === "create_new_project"} onChange={() => onModeChange("create_new_project")} type="radio" />
          <span className="radio-mark" />
          <span>
            <b>作为新项目导入</b>
            <br />
            <span className="muted">将文件导入为一个新的小说项目</span>
          </span>
        </label>
        <label className={`radio ${mode === "import_into_current_project" ? "active" : ""} ${currentProjectId ? "" : "disabled"}`}>
          <input checked={mode === "import_into_current_project"} disabled={!currentProjectId} onChange={() => onModeChange("import_into_current_project")} type="radio" />
          <span className="radio-mark" />
          <span>
            <b>导入到当前项目</b>
            <br />
            <span className="muted">{currentProjectId ? "将内容追加到当前项目末尾" : "需要先打开一个项目"}</span>
          </span>
        </label>
      </div>
    </>
  );
}
