import { useEffect, useMemo, useState } from "react";
import type { OutlineChapterNoteRecord, OutlineEventRecord, OutlineOverview } from "../../main/shared/types";
import { Button } from "../components/Button";
import { getNovelToolApi } from "../state/app-store";

type OutlinePanelTab = "chapter" | "book";

type OutlinePanelProps = {
  readonly chapterId: string | null;
  readonly currentChapterTitle: string | null;
  readonly initialTab?: OutlinePanelTab;
  readonly onAuxiliaryChanged?: () => void;
  readonly projectId: string | null;
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

function timeLabel(event: OutlineEventRecord): string {
  return [event.storyTimeLabel || event.storyDate || "未定时间", event.weekdayLabel].filter(Boolean).join(" · ");
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

export function OutlinePanel({ chapterId, currentChapterTitle, initialTab = "chapter", onAuxiliaryChanged, projectId }: OutlinePanelProps) {
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

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

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

  const chapterEvents = useMemo(() => {
    if (!overview || !chapterId) {
      return [];
    }
    const chapterIndex = overview.chapters.findIndex((chapter) => chapter.id === chapterId);
    const nearbyChapterIds = new Set(
      [overview.chapters[chapterIndex - 1]?.id, chapterId, overview.chapters[chapterIndex + 1]?.id].filter((id): id is string => Boolean(id))
    );
    return sortOutlineEvents(overview.events.filter((event) => event.chapterId && nearbyChapterIds.has(event.chapterId)));
  }, [chapterId, overview]);

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
          <p className="muted">{activeTab === "book" ? "查看作者规划表里的全局时间线、情节线和未安排章节。" : "绑定当前章节，用于写作参考，不会进入正文导出。"}</p>
        </div>
        <div className="outline-panel-tabs" role="tablist" aria-label="大纲类型">
          <button className={activeTab === "chapter" ? "active" : ""} onClick={() => setActiveTab("chapter")} role="tab" type="button">
            本章细纲
          </button>
          <button className={activeTab === "book" ? "active" : ""} onClick={() => setActiveTab("book")} role="tab" type="button">
            全书大纲
          </button>
        </div>
      </div>

      {activeTab === "book" ? (
        <div className="outline-panel-book">
          <div className="outline-panel-stat-row">
            <span><b>{bookEvents.length}</b> 场景</span>
            <span><b>{unassignedCount}</b> 未安排章节</span>
            <span><b>{assignedCount}</b> 已落章</span>
          </div>
          {bookEvents.length === 0 ? (
            <div className="outline-panel-empty">
              <strong>还没有全书大纲</strong>
              <span>可以在大纲页导入 Excel，或先录入日期、日夜、情节线和场景摘要。</span>
            </div>
          ) : (
            <div className="outline-panel-events outline-panel-book-events">
              {bookEvents.slice(0, 24).map((event) => (
                <article key={event.id}>
                  <div>
                    <strong>{event.title}</strong>
                    <span>{chapterLabel(overview, event)}</span>
                  </div>
                  <p>{event.summary}</p>
                  <small>{[timeLabel(event), threadLabel(overview, event)].filter(Boolean).join(" · ")}</small>
                </article>
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
          {chapterEvents.length > 0 ? (
            <div className="outline-panel-events">
              <span className="muted">本章前后大纲事件</span>
              {chapterEvents.map((event) => (
                <article key={event.id}>
                  <strong>{event.title}</strong>
                  <p>{event.summary}</p>
                </article>
              ))}
            </div>
          ) : null}
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
