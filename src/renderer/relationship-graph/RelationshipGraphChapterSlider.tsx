import type { RelationshipGraphAvailableChapter } from "../../main/shared/relationship-graph";
import type { RelationshipGraphChapterCursor } from "./relationship-graph-load";

type RelationshipGraphChapterSliderProps = {
  readonly availableChapters: readonly RelationshipGraphAvailableChapter[];
  readonly chapterCursor: RelationshipGraphChapterCursor;
  readonly loading: boolean;
  readonly onChange: (cursor: RelationshipGraphChapterCursor) => void;
};

function selectedIndex(availableChapters: readonly RelationshipGraphAvailableChapter[], chapterCursor: RelationshipGraphChapterCursor): number {
  if (chapterCursor === "all" || chapterCursor === "latest") {
    return availableChapters.length;
  }
  const index = availableChapters.findIndex((chapter) => chapter.chapterOrder === chapterCursor);
  return index >= 0 ? index : availableChapters.length;
}

function cursorLabel(availableChapters: readonly RelationshipGraphAvailableChapter[], chapterCursor: RelationshipGraphChapterCursor): string {
  if (chapterCursor === "all") {
    return "全书汇总";
  }
  if (chapterCursor === "latest") {
    return "最新缓存";
  }
  const chapter = availableChapters.find((item) => item.chapterOrder === chapterCursor);
  return chapter ? `第${chapter.chapterOrder}章 ${chapter.chapterTitle}` : `第${chapterCursor}章`;
}

export function RelationshipGraphChapterSlider({
  availableChapters,
  chapterCursor,
  loading,
  onChange
}: RelationshipGraphChapterSliderProps) {
  const maxIndex = availableChapters.length;
  const currentIndex = selectedIndex(availableChapters, chapterCursor);

  return (
    <footer className="relationship-chapter-slider" aria-label="章节进展">
      <div className="relationship-chapter-slider-head">
        <span>章节进展</span>
        <strong>{cursorLabel(availableChapters, chapterCursor)}</strong>
        {loading ? <em>读取缓存中</em> : null}
      </div>
      <div className="relationship-chapter-slider-row">
        <input
          aria-label="按章节查看关系图"
          disabled={availableChapters.length === 0}
          max={maxIndex}
          min="0"
          onChange={(event) => {
            const nextIndex = Number(event.target.value);
            if (nextIndex >= availableChapters.length) {
              onChange("all");
              return;
            }
            const chapter = availableChapters[nextIndex];
            if (chapter) {
              onChange(chapter.chapterOrder);
            }
          }}
          step="1"
          type="range"
          value={currentIndex}
        />
        <button onClick={() => onChange("all")} type="button">
          全书汇总
        </button>
      </div>
    </footer>
  );
}
