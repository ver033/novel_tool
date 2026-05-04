import { useEffect, useRef } from "react";
import { BookOpen, FileText, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { Button } from "../components/Button";
import type { ChapterSummary } from "../../main/shared/types";

type LeftChapterTreeProps = {
  readonly activeChapterId: string | null;
  readonly chapters: readonly ChapterSummary[];
  readonly onCreateChapter: () => void;
  readonly onCreateChapterAfter: (chapterId: string) => void;
  readonly onDeleteChapter: (chapterId: string) => void;
  readonly onRenameChapter: (chapterId: string, currentTitle: string) => void;
  readonly onSelectChapter: (chapterId: string) => void;
};

export function LeftChapterTree({
  activeChapterId,
  chapters,
  onCreateChapter,
  onCreateChapterAfter,
  onDeleteChapter,
  onRenameChapter,
  onSelectChapter
}: LeftChapterTreeProps) {
  const activeItemRef = useRef<HTMLDivElement | null>(null);
  const lastChapterId = chapters.length > 0 ? chapters[chapters.length - 1]?.id ?? null : null;

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeChapterId, chapters.length]);

  return (
    <aside className="chapter-tree">
      <div className="chapter-title-row">
        <span className="tree-title">正文</span>
        <Button onClick={onCreateChapter} variant="secondary">
          <Plus size={18} />
          新建章节
        </Button>
      </div>
      <div className="volume">
        <BookOpen size={20} />
        <span>第一卷</span>
      </div>
      <div className="chapter-list">
        {chapters.length === 0 ? <p className="empty-chapters muted">暂无章节，点击上方按钮新建。</p> : null}
        {chapters.map((chapter) => (
          <div
            className={`chapter-item ${chapter.id === activeChapterId ? "active" : ""}`}
            key={chapter.id}
            ref={chapter.id === activeChapterId ? activeItemRef : null}
          >
            <button className="chapter-select" onClick={() => onSelectChapter(chapter.id)} type="button">
              <FileText size={18} />
              <span className="chapter-name">{chapter.title}</span>
            </button>
            <div className="chapter-actions" aria-label={`${chapter.title} 操作`}>
              {chapter.id === lastChapterId ? (
                <button
                  className="chapter-action"
                  onClick={() => onCreateChapterAfter(chapter.id)}
                  type="button"
                  aria-label={`在 ${chapter.title} 后新建章节`}
                  title="在最后一章后新建"
                >
                  <Plus size={15} />
                </button>
              ) : null}
              <button
                className="chapter-action"
                onClick={() => onRenameChapter(chapter.id, chapter.title)}
                type="button"
                aria-label={`重命名 ${chapter.title}`}
                title="重命名"
              >
                <PencilSimple size={15} />
              </button>
              <button
                className="chapter-action danger"
                onClick={() => onDeleteChapter(chapter.id)}
                type="button"
                aria-label={`删除 ${chapter.title}`}
                title="删除"
              >
                <Trash size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
