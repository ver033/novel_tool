import { useEffect, useRef } from "react";
import { BookOpen, CaretLeft, FileText, PencilSimple, Plus, SidebarSimple, Trash } from "@phosphor-icons/react";
import { Button } from "../components/Button";
import { IconButton } from "../components/IconButton";
import type { ChapterSummary } from "../../main/shared/types";

export type ChapterAuxiliaryInfo = {
  readonly hasOutline: boolean;
  readonly scratchCount: number;
  readonly scratchNoteIds: readonly string[];
};

type LeftChapterTreeProps = {
  readonly activeChapterId: string | null;
  readonly auxiliaryInfoByChapterId?: Readonly<Record<string, ChapterAuxiliaryInfo>>;
  readonly chapters: readonly ChapterSummary[];
  readonly onCreateChapter: () => void;
  readonly onCreateChapterAfter: (chapterId: string) => void;
  readonly onDeleteChapter: (chapterId: string) => void;
  readonly onHideChapters: () => void;
  readonly onRenameChapter: (chapterId: string, currentTitle: string) => void;
  readonly onSelectChapter: (chapterId: string) => void;
};

export function LeftChapterTree({
  activeChapterId,
  auxiliaryInfoByChapterId = {},
  chapters,
  onCreateChapter,
  onCreateChapterAfter,
  onDeleteChapter,
  onHideChapters,
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
        <div className="chapter-title-actions">
          <IconButton className="chapter-collapse-button" label="折叠章节列表" onClick={onHideChapters}>
            <SidebarSimple size={20} />
            <CaretLeft className="chapter-collapse-caret" size={13} />
          </IconButton>
          <Button onClick={onCreateChapter} variant="secondary">
            <Plus size={18} />
            新建章节
          </Button>
        </div>
      </div>
      <div className="volume">
        <BookOpen size={20} />
        <span>第一卷</span>
      </div>
      <div className="chapter-list">
        {chapters.length === 0 ? <p className="empty-chapters muted">暂无章节，点击上方按钮新建。</p> : null}
        {chapters.map((chapter) => {
          const auxiliaryInfo = auxiliaryInfoByChapterId[chapter.id] ?? { hasOutline: false, scratchCount: 0, scratchNoteIds: [] };
          const hasAuxiliaryInfo = auxiliaryInfo.hasOutline || auxiliaryInfo.scratchCount > 0;
          return (
            <div
              className={`chapter-item ${chapter.id === activeChapterId ? "active" : ""}`}
              key={chapter.id}
              ref={chapter.id === activeChapterId ? activeItemRef : null}
            >
              <button className="chapter-select" onClick={() => onSelectChapter(chapter.id)} type="button">
                <FileText size={18} />
                <span className="chapter-select-text">
                  <span className="chapter-name">{chapter.title}</span>
                  <span className={`chapter-aux-meta ${hasAuxiliaryInfo ? "" : "empty"}`}>
                    {auxiliaryInfo.hasOutline ? <span className="chapter-aux-chip">细纲</span> : null}
                    {auxiliaryInfo.scratchCount > 0 ? <span className="chapter-aux-chip">草稿 {auxiliaryInfo.scratchCount}</span> : null}
                    {!hasAuxiliaryInfo ? <span className="chapter-aux-empty">无辅助资料</span> : null}
                  </span>
                </span>
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
          );
        })}
      </div>
    </aside>
  );
}
