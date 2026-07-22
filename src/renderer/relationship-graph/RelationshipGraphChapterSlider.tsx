import type { RelationshipGraphAvailableChapter } from "../../main/shared/relationship-graph";
import type { AppLocale } from "../../main/shared/language";
import { useI18n } from "../i18n";
import { useLocalizedCopy } from "../i18n/localized-copy";
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

function cursorLabel(availableChapters: readonly RelationshipGraphAvailableChapter[], chapterCursor: RelationshipGraphChapterCursor, locale: AppLocale): string {
  if (chapterCursor === "all") {
    return locale === "ja-JP" ? "作品全体" : "全书汇总";
  }
  if (chapterCursor === "latest") {
    return locale === "ja-JP" ? "最新キャッシュ" : "最新缓存";
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
  const { locale } = useI18n();
  const copy = useLocalizedCopy({
    "zh-CN": { progress: "章节进展", loading: "读取缓存中", select: "按章节查看关系图", all: "全书汇总" },
    "ja-JP": { progress: "章の進行", loading: "キャッシュを読み込み中", select: "章ごとの関係図を表示", all: "作品全体" }
  });
  const maxIndex = availableChapters.length;
  const currentIndex = selectedIndex(availableChapters, chapterCursor);

  return (
    <footer className="relationship-chapter-slider" aria-label={copy.progress}>
      <div className="relationship-chapter-slider-head">
        <span>{copy.progress}</span>
        <strong>{cursorLabel(availableChapters, chapterCursor, locale)}</strong>
        {loading ? <em>{copy.loading}</em> : null}
      </div>
      <div className="relationship-chapter-slider-row">
        <input
          aria-label={copy.select}
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
          {copy.all}
        </button>
      </div>
    </footer>
  );
}
