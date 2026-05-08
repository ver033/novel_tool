import { useEffect, useMemo, useState } from "react";
import { Button } from "../components/Button";

type OutlinePanelProps = {
  readonly chapterId: string | null;
  readonly currentChapterTitle: string | null;
  readonly onAuxiliaryChanged?: () => void;
  readonly projectId: string | null;
};

export function outlineStorageKey(projectId: string, chapterId: string): string {
  return `moshu:chapter-outline:${projectId}:${chapterId}`;
}

export function OutlinePanel({ chapterId, currentChapterTitle, onAuxiliaryChanged, projectId }: OutlinePanelProps) {
  const storageKey = useMemo(() => {
    if (!projectId || !chapterId) {
      return null;
    }
    return outlineStorageKey(projectId, chapterId);
  }, [chapterId, projectId]);
  const [content, setContent] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!storageKey) {
      setContent("");
      setNotice("");
      return;
    }
    setContent(window.localStorage.getItem(storageKey) ?? "");
    setNotice("");
  }, [storageKey]);

  function saveOutline(): void {
    if (!storageKey) {
      setNotice("当前没有可绑定的章节。");
      return;
    }
    window.localStorage.setItem(storageKey, content);
    onAuxiliaryChanged?.();
    setNotice("细纲已保存到本章。");
  }

  return (
    <section className="outline-panel outline-editor-page aux-editor-page">
      <div className="outline-head aux-editor-head">
        <div>
          <h2 className="task-title">{currentChapterTitle ? `${currentChapterTitle} · 细纲` : "本章细纲"}</h2>
          <p className="muted">绑定当前章节，用于写作参考，不会进入正文导出。</p>
        </div>
      </div>
      <textarea
        className="outline-editor ruled-aux-editor"
        disabled={!storageKey}
        onChange={(event) => {
          setContent(event.target.value);
          setNotice("");
        }}
        placeholder="记录本章要点、场景顺序、人物情绪和伏笔..."
        value={content}
      />
      <div className="outline-footer aux-editor-footer">
        <span className="muted">{notice || "第一版先作为本地章节辅助资料保存。"}</span>
        <Button disabled={!storageKey} onClick={saveOutline} variant="secondary">
          保存细纲
        </Button>
      </div>
    </section>
  );
}
