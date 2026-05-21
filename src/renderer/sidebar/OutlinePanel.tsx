import { useEffect, useMemo, useState } from "react";
import type { OutlineChapterNoteRecord, OutlineDaySegment, OutlineEventRecord, OutlineOverview } from "../../main/shared/types";
import { Button } from "../components/Button";
import { getNovelToolApi } from "../state/app-store";

type OutlinePanelTab = "chapter" | "book";
type OutlineBookFilter = "all" | "current" | "unassigned";

type OutlineEventGroup = {
  readonly key: string;
  readonly title: string;
  readonly subtitle: string;
  readonly events: readonly OutlineEventRecord[];
};

type OutlinePanelProps = {
  readonly chapterId: string | null;
  readonly currentChapterTitle: string | null;
  readonly initialTab?: OutlinePanelTab;
  readonly onAuxiliaryChanged?: () => void;
  readonly onOpenOutline?: () => void;
  readonly projectId: string | null;
};

const daySegmentLabels: Record<OutlineDaySegment, string> = {
  day: "白天",
  night: "晚上",
  custom: "自定义",
  unknown: "未定"
};

export function outlineStorageKey(projectId: string, chapterId: string): string {
  return `moshu:chapter-outline:${projectId}:${chapterId}`;
}

function sortOutlineEvents(events: readonly OutlineEventRecord[]): OutlineEventRecord[] {
  return [...events].sort((left, right) => {
    const leftOrder = left.storyTimeOrder ?? left.eventOrder;
    const rightOrder = right.storyTimeOrder ?? right.eventOrder;
    return leftOrder - rightOrder || left.eventOrder - right.eventOrder;
  });
}

function chapterLabel(overview: OutlineOverview | null, event: OutlineEventRecord): string {
  if (event.chapterId === null) {
    return "未安排章节";
  }
  return overview?.chapters.find((chapter) => chapter.id === event.chapterId)?.title ?? "章节已删除";
}

function daySegmentLabel(event: OutlineEventRecord): string {
  if (event.daySegment === "custom") {
    return event.customDaySegment || "自定义";
  }
  return daySegmentLabels[event.daySegment];
}

function timeLabel(event: OutlineEventRecord): string {
  return [event.storyTimeLabel || event.storyDate || "未定时间", event.weekdayLabel, daySegmentLabel(event)].filter(Boolean).join(" · ");
}

function threadLabel(overview: OutlineOverview | null, event: OutlineEventRecord): string {
  if (!overview) {
    return "";
  }
  return event.threadIds
    .map((id) => overview.threads.find((thread) => thread.id === id)?.name)
    .filter((name): name is string => Boolean(name))
    .join("、");
}

function eventSummaryText(event: OutlineEventRecord): string {
  return event.summary || event.goal || event.conflict || event.outcome || event.notes || "未填写场景摘要。";
}

function eventMetaLabel(overview: OutlineOverview | null, event: OutlineEventRecord): string {
  return [
    chapterLabel(overview, event),
    threadLabel(overview, event),
    event.location,
    event.povCharacter ? `视角：${event.povCharacter}` : ""
  ].filter(Boolean).join(" · ");
}

function eventSearchText(overview: OutlineOverview | null, event: OutlineEventRecord): string {
  return [
    event.title,
    event.summary,
    event.goal,
    event.conflict,
    event.outcome,
    event.foreshadowing,
    event.notes,
    event.location,
    event.povCharacter,
    event.characters.join("、"),
    chapterLabel(overview, event),
    threadLabel(overview, event),
    timeLabel(event)
  ].join("\n").toLowerCase();
}

export function groupBookEvents(events: readonly OutlineEventRecord[]): OutlineEventGroup[] {
  const groups = new Map<string, OutlineEventRecord[]>();
  for (const event of events) {
    const title = timeLabel(event);
    const groupEvents = groups.get(title) ?? [];
    groupEvents.push(event);
    groups.set(title, groupEvents);
  }
  return [...groups.entries()].map(([title, items]) => ({
    key: title,
    title,
    subtitle: `${items.length} 个场景`,
    events: items
  }));
}

function chapterEventGroups(overview: OutlineOverview | null, chapterId: string | null): OutlineEventGroup[] {
  if (!overview || !chapterId) {
    return [];
  }
  const chapterIndex = overview.chapters.findIndex((chapter) => chapter.id === chapterId);
  if (chapterIndex < 0) {
    return [];
  }
  const groupForChapter = (key: string, title: string, targetChapterId: string | undefined): OutlineEventGroup | null => {
    if (!targetChapterId) {
      return null;
    }
    const targetChapter = overview.chapters.find((chapter) => chapter.id === targetChapterId);
    const events = sortOutlineEvents(overview.events.filter((event) => event.chapterId === targetChapterId));
    if (events.length === 0) {
      return null;
    }
    return {
      key,
      title,
      subtitle: targetChapter?.title ?? "章节已删除",
      events
    };
  };
  return [
    groupForChapter("current", "当前章节", chapterId),
    groupForChapter("previous", "上一章", overview.chapters[chapterIndex - 1]?.id),
    groupForChapter("next", "下一章", overview.chapters[chapterIndex + 1]?.id)
  ].filter((group): group is OutlineEventGroup => Boolean(group));
}

export function OutlinePanel({
  chapterId,
  currentChapterTitle,
  initialTab = "chapter",
  onAuxiliaryChanged,
  onOpenOutline,
  projectId
}: OutlinePanelProps) {
  const api = useMemo(getNovelToolApi, []);
  const storageKey = useMemo(() => {
    if (!projectId || !chapterId) {
      return null;
    }
    return outlineStorageKey(projectId, chapterId);
  }, [chapterId, projectId]);
  const [activeTab, setActiveTab] = useState<OutlinePanelTab>(initialTab);
  const [content, setContent] = useState("");
  const [overview, setOverview] = useState<OutlineOverview | null>(null);
  const [legacyContent, setLegacyContent] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [bookQuery, setBookQuery] = useState("");
  const [bookFilter, setBookFilter] = useState<OutlineBookFilter>("all");

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!chapterId && bookFilter === "current") {
      setBookFilter("all");
    }
  }, [bookFilter, chapterId]);

  useEffect(() => {
    if (!projectId) {
      setContent("");
      setOverview(null);
      setLegacyContent("");
      setNotice("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNotice("");
    const chapterNotePromise = chapterId
      ? (api.outline.getChapterNote({ projectId, chapterId }) as Promise<OutlineChapterNoteRecord | null>)
      : Promise.resolve(null);
    void Promise.all([chapterNotePromise, api.outline.getOverview({ projectId }) as Promise<OutlineOverview>])
      .then(([note, nextOverview]) => {
        if (cancelled) {
          return;
        }
        setOverview(nextOverview);
        setContent(note?.content ?? "");
        try {
          const legacy = storageKey ? window.localStorage.getItem(storageKey)?.trim() ?? "" : "";
          setLegacyContent(legacy && legacy !== (note?.content ?? "").trim() ? legacy : "");
        } catch {
          setLegacyContent("");
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setNotice(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, chapterId, projectId, storageKey]);

  const chapterGroups = useMemo(() => chapterEventGroups(overview, chapterId), [chapterId, overview]);

  const bookEvents = useMemo(() => {
    if (!overview) {
      return [];
    }
    const sortedEvents = sortOutlineEvents(overview.events);
    const unassignedEvents = sortedEvents.filter((event) => event.chapterId === null);
    const assignedEvents = sortedEvents.filter((event) => event.chapterId !== null);
    return [...unassignedEvents, ...assignedEvents];
  }, [overview]);

  const unassignedCount = bookEvents.filter((event) => event.chapterId === null).length;
  const assignedCount = bookEvents.length - unassignedCount;
  const currentChapterEventCount = chapterId ? bookEvents.filter((event) => event.chapterId === chapterId).length : 0;
  const filteredBookEvents = useMemo(() => {
    const query = bookQuery.trim().toLowerCase();
    return bookEvents.filter((event) => {
      if (bookFilter === "current" && event.chapterId !== chapterId) {
        return false;
      }
      if (bookFilter === "unassigned" && event.chapterId !== null) {
        return false;
      }
      return !query || eventSearchText(overview, event).includes(query);
    });
  }, [bookEvents, bookFilter, bookQuery, chapterId, overview]);
  const groupedBookEvents = useMemo(() => groupBookEvents(filteredBookEvents), [filteredBookEvents]);

  async function saveOutline(): Promise<void> {
    if (!projectId || !chapterId) {
      setNotice("当前没有可绑定的章节。");
      return;
    }
    try {
      await api.outline.saveChapterNote({ projectId, chapterId, content });
      onAuxiliaryChanged?.();
      setNotice("细纲已保存到项目文件。");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function importLegacyOutline(): Promise<void> {
    if (!projectId || !chapterId || !legacyContent) {
      return;
    }
    const overwrite = Boolean(content.trim());
    if (overwrite && !window.confirm("当前数据库细纲已有内容，确认用旧细纲覆盖？")) {
      return;
    }
    try {
      const imported = (await api.outline.importLegacyChapterNote({ projectId, chapterId, content: legacyContent, overwrite })) as OutlineChapterNoteRecord;
      setContent(imported.content);
      setLegacyContent("");
      onAuxiliaryChanged?.();
      setNotice("旧细纲已导入项目文件。");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <section className="outline-panel outline-editor-page aux-editor-page">
      <div className="outline-head aux-editor-head">
        <div>
          <h2 className="task-title">{activeTab === "book" ? "全书大纲速览" : currentChapterTitle ? `${currentChapterTitle} · 细纲` : "本章细纲"}</h2>
          <p className="muted">{activeTab === "book" ? "检索全局计划，确认情节线、时间和未落章场景。" : "写作时查看本章计划、前后章事件和本章备注。"}</p>
        </div>
        <div className="outline-head-actions">
          <div className="outline-panel-tabs" role="tablist" aria-label="大纲类型">
            <button className={activeTab === "chapter" ? "active" : ""} onClick={() => setActiveTab("chapter")} role="tab" type="button">
              本章细纲
            </button>
            <button className={activeTab === "book" ? "active" : ""} onClick={() => setActiveTab("book")} role="tab" type="button">
              全书大纲
            </button>
          </div>
          {onOpenOutline ? (
            <button className="outline-panel-open-button" onClick={onOpenOutline} type="button">
              打开大纲页
            </button>
          ) : null}
        </div>
      </div>

      {activeTab === "book" ? (
        <div className="outline-panel-book">
          <div className="outline-panel-stat-row">
            <span><b>{bookEvents.length}</b> 场景</span>
            <span><b>{unassignedCount}</b> 未安排章节</span>
            <span><b>{chapterId ? currentChapterEventCount : assignedCount}</b> {chapterId ? "本章相关" : "已落章"}</span>
          </div>
          <div className="outline-panel-book-toolbar">
            <input
              aria-label="搜索全书大纲"
              onChange={(event) => setBookQuery(event.target.value)}
              placeholder="搜索场景、人物、地点、情节线..."
              type="search"
              value={bookQuery}
            />
            <div className="outline-panel-filter-row" role="group" aria-label="筛选全书大纲">
              <button className={`outline-filter-pill${bookFilter === "all" ? " active" : ""}`} onClick={() => setBookFilter("all")} type="button">
                全部
              </button>
              <button
                className={`outline-filter-pill${bookFilter === "current" ? " active" : ""}`}
                disabled={!chapterId}
                onClick={() => setBookFilter("current")}
                type="button"
              >
                当前章节
              </button>
              <button className={`outline-filter-pill${bookFilter === "unassigned" ? " active" : ""}`} onClick={() => setBookFilter("unassigned")} type="button">
                未落章
              </button>
            </div>
          </div>
          {bookEvents.length === 0 ? (
            <div className="outline-panel-empty">
              <strong>还没有全书大纲</strong>
              <span>可以在大纲页导入 Excel，或先录入日期、日夜、情节线和场景摘要。</span>
            </div>
          ) : groupedBookEvents.length === 0 ? (
            <div className="outline-panel-empty">
              <strong>没有匹配的大纲事件</strong>
              <span>换一个关键词，或切回全部范围继续浏览。</span>
            </div>
          ) : (
            <div className="outline-panel-events outline-panel-grouped-events">
              {groupedBookEvents.map((group) => (
                <section className="outline-panel-event-group" key={group.key}>
                  <header>
                    <strong>{group.title}</strong>
                    <span>{group.subtitle}</span>
                  </header>
                  <div className="outline-panel-book-events">
                    {group.events.map((event) => (
                      <article key={event.id}>
                        <div>
                          <strong>{event.title}</strong>
                          <span>{chapterLabel(overview, event)}</span>
                        </div>
                        <p>{eventSummaryText(event)}</p>
                        <small>{eventMetaLabel(overview, event)}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="outline-panel-body">
          {legacyContent ? (
            <div className="outline-legacy-import">
              <strong>发现旧细纲</strong>
              <span>可以手动导入到项目文件；不会自动覆盖当前内容。</span>
              <button onClick={() => { void importLegacyOutline(); }} type="button">导入旧细纲</button>
            </div>
          ) : null}
          {chapterGroups.length > 0 ? (
            <div className="outline-panel-events outline-panel-chapter-events">
              <span className="muted">本章前后大纲事件</span>
              {chapterGroups.map((group) => (
                <section className="outline-panel-event-group" key={group.key}>
                  <header>
                    <strong>{group.title}</strong>
                    <span>{group.subtitle}</span>
                  </header>
                  <div className="outline-panel-book-events">
                    {group.events.map((event) => (
                      <article key={event.id}>
                        <div>
                          <strong>{event.title}</strong>
                          <span>{timeLabel(event)}</span>
                        </div>
                        <p>{eventSummaryText(event)}</p>
                        <small>{eventMetaLabel(overview, event)}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="outline-panel-empty outline-panel-compact-empty">
              <strong>当前章节附近还没有大纲事件</strong>
              <span>可以先写本章细纲，或打开大纲页补充全书计划。</span>
            </div>
          )}
          <textarea
            className="outline-editor ruled-aux-editor"
            disabled={!projectId || !chapterId || loading}
            onChange={(event) => {
              setContent(event.target.value);
              setNotice("");
            }}
            placeholder="记录本章要点、场景顺序、人物情绪和伏笔..."
            value={content}
          />
        </div>
      )}

      <div className="outline-footer aux-editor-footer">
        <span className="muted">{notice || (activeTab === "book" ? "全书大纲来自项目文件；编辑请前往大纲页。" : "保存到项目文件，可随 .noveltool 一起保留。")}</span>
        {activeTab === "chapter" ? (
          <Button disabled={!projectId || !chapterId || loading} onClick={() => { void saveOutline(); }} variant="secondary">
            保存细纲
          </Button>
        ) : null}
      </div>
    </section>
  );
}
