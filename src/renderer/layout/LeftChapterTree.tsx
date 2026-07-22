import { useEffect, useRef } from "react";
import { BookOpen, CaretLeft, FileText, PencilSimple, Plus, SidebarSimple, Trash } from "@phosphor-icons/react";
import { IconButton } from "../components/IconButton";
import type { ChapterSummary } from "../../main/shared/types";
import { useI18n } from "../i18n";

export type ChapterAuxiliaryInfo = {
  readonly hasOutline: boolean;
  readonly scratchCount: number;
  readonly scratchNoteIds: readonly string[];
};

type LeftChapterTreeProps = {
  readonly activeChapterId: string | null;
  readonly auxiliaryInfoByChapterId?: Readonly<Record<string, ChapterAuxiliaryInfo>>;
  readonly chapters: readonly ChapterSummary[];
  readonly projectTitle: string;
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
  projectTitle,
  onCreateChapter,
  onCreateChapterAfter,
  onDeleteChapter,
  onHideChapters,
  onRenameChapter,
  onSelectChapter
}: LeftChapterTreeProps) {
  const { t } = useI18n();
  const activeItemRef = useRef<HTMLDivElement | null>(null);
  const lastChapterId = chapters.length > 0 ? chapters[chapters.length - 1]?.id ?? null : null;

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeChapterId, chapters.length]);

  return (
    <aside className="chapter-tree">
      <div className="chapter-project-block">
        <span className="chapter-project-eyebrow">{t("work")}</span>
        <div className="chapter-project-row">
          <strong title={projectTitle}>{projectTitle}</strong>
          <IconButton className="chapter-collapse-button" label={t("collapseChapterList")} onClick={onHideChapters}>
            <SidebarSimple size={19} />
            <CaretLeft className="chapter-collapse-caret" size={11} />
          </IconButton>
        </div>
      </div>
      <div className="chapter-title-row">
        <span className="tree-title">{t("structure")}</span>
        <div className="chapter-title-actions">
          <IconButton className="chapter-add-button" label={t("addChapter")} onClick={onCreateChapter}>
            <Plus size={18} />
          </IconButton>
        </div>
      </div>
      <div className="volume">
        <BookOpen size={20} />
        <span>{t("firstVolume")}</span>
      </div>
      <div className="chapter-list">
        {chapters.length === 0 ? <p className="empty-chapters muted">{t("noChapterHint")}</p> : null}
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
                    {auxiliaryInfo.hasOutline ? <span className="chapter-aux-chip">{t("detailedOutline")}</span> : null}
                    {auxiliaryInfo.scratchCount > 0 ? <span className="chapter-aux-chip">{t("draft")} {auxiliaryInfo.scratchCount}</span> : null}
                    {!hasAuxiliaryInfo ? <span className="chapter-aux-empty">{t("noSupportingInfo")}</span> : null}
                  </span>
                </span>
              </button>
              <div className="chapter-actions" aria-label={`${chapter.title} · ${t("chapterActions")}`}>
                {chapter.id === lastChapterId ? (
                  <button
                    className="chapter-action"
                    onClick={() => onCreateChapterAfter(chapter.id)}
                    type="button"
                    aria-label={`${chapter.title} · ${t("addAfterChapter")}`}
                    title={t("addAfterLastChapter")}
                  >
                    <Plus size={15} />
                  </button>
                ) : null}
                <button
                  className="chapter-action"
                  onClick={() => onRenameChapter(chapter.id, chapter.title)}
                  type="button"
                  aria-label={`${t("rename")} · ${chapter.title}`}
                  title={t("rename")}
                >
                  <PencilSimple size={15} />
                </button>
                <button
                  className="chapter-action danger"
                  onClick={() => onDeleteChapter(chapter.id)}
                  type="button"
                  aria-label={`${t("delete")} · ${chapter.title}`}
                  title={t("delete")}
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
