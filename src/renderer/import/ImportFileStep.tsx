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
  readonly onSelectFile: () => void;
};

export function ImportFileStep({ busy, currentProjectId, error, mode, preview, showDropZone = true, onSelectFile }: ImportFileStepProps) {
  const isAppendingToOpenedProject = mode === "import_into_current_project";

  return (
    <>
      {showDropZone ? (
        <div className="drop-zone">
          <div>
            <span className="file-icon">TXT</span>
            <h2 className="section-title">选择 TXT 文件</h2>
            <p className="muted">{preview ? `已选择 ${preview.fileName}，识别到 ${preview.chapters.length} 章。` : "当前版本支持纯文本文件，会自动识别章节并进入预览。"}</p>
            {error ? <p className="mini-tag orange">{error}</p> : null}
            <Button disabled={busy} onClick={onSelectFile} variant="primary">
              {busy ? "读取中" : preview ? "重新选择文件" : "选择文件"}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="panel import-options">
        <div className="import-mode-note">
          <b>{isAppendingToOpenedProject ? "追加到当前项目" : "作为新项目导入"}</b>
          <br />
          <span className="muted">
            {isAppendingToOpenedProject
              ? currentProjectId
                ? "会把识别到的章节追加到当前作品末尾。"
                : "需要先打开一个项目。"
              : "会把 TXT 创建为一个新的本地小说项目。"}
          </span>
        </div>
      </div>
    </>
  );
}
