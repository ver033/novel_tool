import type { ImportPreview } from "../../main/shared/types";

type ImportPreviewStepProps = {
  readonly preview: ImportPreview | null;
  readonly onMerge: (chapterIndex: number) => void;
  readonly onRedetect: () => void;
  readonly onRename: (chapterIndex: number, title: string) => void;
  readonly onSplit: (chapterIndex: number) => void;
};

export function ImportPreviewStep({ preview, onMerge, onRedetect, onRename, onSplit }: ImportPreviewStepProps) {
  if (!preview) {
    return (
      <div className="drop-zone">
        <div>
          <span className="file-icon">TXT</span>
          <h2 className="section-title">还没有导入预览</h2>
          <p className="muted">请先选择 TXT 文件。</p>
        </div>
      </div>
    );
  }

  const activeChapter = preview.chapters[0] ?? null;

  return (
    <>
      <ImportSummary preview={preview} />
      <div className="import-split">
        <div className="detected-list">
          <div className="box-header">
            <span>识别到的章节（{preview.chapters.length} 章）</span>
            <button className="link-button" onClick={onRedetect} type="button">重新识别</button>
          </div>
          {preview.chapters.map((chapter, index) => (
            <div className={`detected-row ${index === 0 ? "active" : ""}`} key={`${chapter.order}-${chapter.title}`}>
              <span>
                <b>{chapter.title}</b>
                <br />
                <span className="muted">{chapter.wordCount.toLocaleString("zh-CN")} 字</span>
              </span>
              <span className="row-actions">
                <button disabled={index === 0} onClick={() => onMerge(index)} type="button">合并</button>
                <button onClick={() => onSplit(index)} type="button">拆分</button>
                <button onClick={() => onRename(index, chapter.title)} type="button">重命名</button>
              </span>
            </div>
          ))}
        </div>
        <div className="preview-pane">
          <div className="box-header">
            <span>内容预览 · {activeChapter?.title ?? "未选择章节"}（{(activeChapter?.wordCount ?? 0).toLocaleString("zh-CN")} 字）</span>
            <span className="muted">显示前 10 段</span>
          </div>
          <div className="preview-text">
            {(activeChapter?.text.split(/\n{2,}/).slice(0, 10) ?? ["暂无内容"]).map((paragraph, index) => (
              <p key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph}</p>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export function ImportSummary({ preview }: { readonly preview: ImportPreview }) {
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
        <span className="muted">识别章节</span>
        <br />
        <b>{preview.chapters.length} 章</b>
      </div>
      <div>
        <span className="muted">总字数</span>
        <br />
        <b>{preview.totalWordCount.toLocaleString("zh-CN")} 字</b>
      </div>
      <div>
        <span className="muted">导入文件</span>
        <br />
        <b>{preview.fileName}</b>
      </div>
    </div>
  );
}
