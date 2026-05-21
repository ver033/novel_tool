import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  CalendarBlank,
  Check,
  FilePlus,
  FloppyDisk,
  GridFour,
  ListBullets,
  Plus,
  Rows,
  UploadSimple,
  X
} from "@phosphor-icons/react";
import type {
  ChapterSummary,
  OutlineBulkImportPreview,
  OutlineDaySegment,
  OutlineEventRecord,
  OutlineEventStatus,
  OutlineOverview,
  OutlineThreadRecord,
  OutlineViewMode,
  ProjectRecord
} from "../../main/shared/types";
import { Button } from "../components/Button";
import { ProjectModuleRail, type ProjectModule } from "../layout/ProjectModuleRail";
import { TopBar } from "../layout/TopBar";
import { getNovelToolApi } from "../state/app-store";

type OutlinePageProps = {
  readonly currentProject: ProjectRecord | null;
  readonly initialChapterId?: string | null;
  readonly onOpenRelationshipGraph: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenWriting: () => void;
  readonly onOpenWritingGoals: () => void;
  readonly onWelcome: () => void;
};

type EventDraft = {
  readonly id: string | null;
  readonly chapterId: string | null;
  readonly title: string;
  readonly summary: string;
  readonly storyDate: string;
  readonly storyTimeLabel: string;
  readonly weekdayLabel: string;
  readonly storyTimeOrder: string;
  readonly daySegment: OutlineDaySegment;
  readonly customDaySegment: string;
  readonly location: string;
  readonly povCharacter: string;
  readonly charactersText: string;
  readonly goal: string;
  readonly conflict: string;
  readonly outcome: string;
  readonly foreshadowing: string;
  readonly notes: string;
  readonly status: OutlineEventStatus;
  readonly threadIds: readonly string[];
};

const viewOptions: Array<{ readonly value: OutlineViewMode; readonly label: string; readonly icon: ReactNode }> = [
  { value: "timeline", label: "时间线", icon: <CalendarBlank size={17} /> },
  { value: "chapter", label: "章节落点", icon: <ListBullets size={17} /> },
  { value: "plotline", label: "情节线", icon: <GridFour size={17} /> }
];

const statusLabels: Record<OutlineEventStatus, string> = {
  planned: "未写",
  drafting: "写作中",
  written: "已写",
  needs_revision: "待修",
  done: "完成"
};

const daySegmentLabels: Record<OutlineDaySegment, string> = {
  day: "白天",
  night: "晚上",
  custom: "自定义",
  unknown: "未定"
};

function emptyDraft(chapterId: string | null): EventDraft {
  return {
    id: null,
    chapterId,
    title: "",
    summary: "",
    storyDate: "",
    storyTimeLabel: "",
    weekdayLabel: "",
    storyTimeOrder: "",
    daySegment: "unknown",
    customDaySegment: "",
    location: "",
    povCharacter: "",
    charactersText: "",
    goal: "",
    conflict: "",
    outcome: "",
    foreshadowing: "",
    notes: "",
    status: "planned",
    threadIds: []
  };
}

function draftFromEvent(event: OutlineEventRecord): EventDraft {
  return {
    id: event.id,
    chapterId: event.chapterId,
    title: event.title,
    summary: event.summary,
    storyDate: event.storyDate ?? "",
    storyTimeLabel: event.storyTimeLabel,
    weekdayLabel: event.weekdayLabel,
    storyTimeOrder: event.storyTimeOrder == null ? "" : String(event.storyTimeOrder),
    daySegment: event.daySegment,
    customDaySegment: event.customDaySegment ?? "",
    location: event.location,
    povCharacter: event.povCharacter,
    charactersText: event.characters.join("、"),
    goal: event.goal,
    conflict: event.conflict,
    outcome: event.outcome,
    foreshadowing: event.foreshadowing,
    notes: event.notes,
    status: event.status,
    threadIds: event.threadIds
  };
}

function splitList(value: string): string[] {
  return [...new Set(value.split(/[,\s，、]+/).map((item) => item.trim()).filter(Boolean))];
}

function mutableImportRows(preview: OutlineBulkImportPreview) {
  return preview.rows.map((row) => ({
    ...row,
    threadNames: [...row.threadNames],
    characters: [...row.characters],
    warnings: [...row.warnings]
  }));
}

function chapterLabel(chapters: readonly ChapterSummary[], chapterId: string | null): string {
  if (!chapterId) {
    return "未安排章节";
  }
  return chapters.find((chapter) => chapter.id === chapterId)?.title ?? "章节已删除";
}

function eventTimeLabel(event: OutlineEventRecord): string {
  const segment = event.daySegment === "custom" ? event.customDaySegment || "自定义" : daySegmentLabels[event.daySegment];
  return [event.storyTimeLabel || event.storyDate || "未定时间", event.weekdayLabel, segment].filter(Boolean).join(" · ");
}

function sortEventsByOutlineOrder(items: readonly OutlineEventRecord[]): OutlineEventRecord[] {
  return [...items].sort((left, right) => {
    const leftOrder = left.storyTimeOrder ?? left.eventOrder;
    const rightOrder = right.storyTimeOrder ?? right.eventOrder;
    return leftOrder - rightOrder || left.eventOrder - right.eventOrder;
  });
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Array<{ readonly key: string; readonly items: readonly T[] }> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const groupKey = key(item);
    map.set(groupKey, [...(map.get(groupKey) ?? []), item]);
  }
  return [...map.entries()].map(([groupKey, groupItems]) => ({ key: groupKey, items: groupItems }));
}

export function OutlinePage({
  currentProject,
  initialChapterId = null,
  onOpenRelationshipGraph,
  onOpenSettings,
  onOpenWriting,
  onOpenWritingGoals,
  onWelcome
}: OutlinePageProps) {
  const api = useMemo(getNovelToolApi, []);
  const projectId = currentProject?.id ?? null;
  const [overview, setOverview] = useState<OutlineOverview | null>(null);
  const [viewMode, setViewMode] = useState<OutlineViewMode>("timeline");
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(initialChapterId);
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EventDraft>(() => emptyDraft(initialChapterId));
  const [newThreadName, setNewThreadName] = useState("");
  const [query, setQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<OutlineBulkImportPreview | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const chapters = overview?.chapters ?? [];
  const threads = overview?.threads ?? [];
  const events = overview?.events ?? [];
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;
  const filteredEvents = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    return events.filter((event) => {
      if (viewMode === "chapter" && showUnassignedOnly && event.chapterId !== null) {
        return false;
      }
      if (selectedChapterId && viewMode === "chapter" && event.chapterId !== selectedChapterId) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return [event.title, event.summary, event.location, event.povCharacter, event.characters.join(" "), event.notes]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(needle);
    });
  }, [events, query, selectedChapterId, showUnassignedOnly, viewMode]);

  const reload = useCallback(() => {
    if (!projectId) {
      setOverview(null);
      return;
    }
    setLoading(true);
    setError(null);
    void Promise.resolve(api.outline.getOverview({ projectId }))
      .then((result) => {
        const next = result as OutlineOverview;
        setOverview(next);
        setSelectedChapterId((current) => current ?? initialChapterId ?? null);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  }, [api, initialChapterId, projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    setDraft(selectedEvent ? draftFromEvent(selectedEvent) : emptyDraft(selectedChapterId));
  }, [selectedChapterId, selectedEvent]);

  const navigate = useCallback(
    (module: ProjectModule) => {
      if (module === "writing") {
        onOpenWriting();
      } else if (module === "relationshipGraph") {
        onOpenRelationshipGraph();
      } else if (module === "goals") {
        onOpenWritingGoals();
      } else if (module === "settings") {
        onOpenSettings();
      }
    },
    [onOpenRelationshipGraph, onOpenSettings, onOpenWriting, onOpenWritingGoals]
  );

  function startNewEvent(chapterId: string | null = selectedChapterId, threadId: string | null = null): void {
    setSelectedEventId(null);
    setDraft({ ...emptyDraft(chapterId), threadIds: threadId ? [threadId] : [] });
  }

  function updateDraft(patch: Partial<EventDraft>): void {
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function saveDraft(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!projectId) {
      return;
    }
    const summary = draft.summary.trim();
    if (!summary) {
      setError("场景摘要不能为空。");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      chapterId: draft.chapterId,
      title: draft.title.trim() || summary.slice(0, 40),
      summary,
      storyDate: draft.storyDate || null,
      storyTimeLabel: draft.storyTimeLabel,
      weekdayLabel: draft.weekdayLabel,
      storyTimeOrder: draft.storyTimeOrder ? Number(draft.storyTimeOrder) : null,
      daySegment: draft.daySegment,
      customDaySegment: draft.customDaySegment || null,
      location: draft.location,
      povCharacter: draft.povCharacter,
      characters: splitList(draft.charactersText),
      goal: draft.goal,
      conflict: draft.conflict,
      outcome: draft.outcome,
      foreshadowing: draft.foreshadowing,
      notes: draft.notes,
      status: draft.status,
      threadIds: [...draft.threadIds]
    };
    try {
      const saved = draft.id
        ? ((await api.outline.updateEvent({ projectId, eventId: draft.id, patch: payload })) as OutlineEventRecord)
        : ((await api.outline.createEvent({ projectId, ...payload })) as OutlineEventRecord);
      setNotice(draft.id ? "大纲事件已更新。" : "大纲事件已创建。");
      setSelectedEventId(saved.id);
      reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelectedEvent(): Promise<void> {
    if (!projectId || !draft.id) {
      return;
    }
    if (!window.confirm("删除这个大纲事件？正文不会受影响。")) {
      return;
    }
    try {
      setError(null);
      await api.outline.deleteEvent({ projectId, eventId: draft.id });
      setSelectedEventId(null);
      setNotice("大纲事件已删除。");
      reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function createThread(): Promise<void> {
    if (!projectId || !newThreadName.trim()) {
      return;
    }
    try {
      const thread = (await api.outline.createThread({ projectId, name: newThreadName.trim() })) as OutlineThreadRecord;
      setNewThreadName("");
      setDraft((current) => ({ ...current, threadIds: [...current.threadIds, thread.id] }));
      reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function previewPasteImport(): Promise<void> {
    if (!projectId || !importText.trim()) {
      return;
    }
    try {
      setImportError(null);
      const preview = (await api.outline.previewBulkImport({ projectId, rawText: importText })) as OutlineBulkImportPreview;
      setImportPreview(preview);
      setImportFileName("");
      if (preview.rows.length === 0) {
        setImportError("没有识别到可导入的场景。请确认表格包含“场景摘要”，或使用日期/星期/日夜/情节线矩阵格式。");
      }
    } catch (reason) {
      setImportPreview(null);
      setImportError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function previewFileImport(): Promise<void> {
    if (!projectId) {
      return;
    }
    try {
      setImportError(null);
      const selected = (await api.outline.selectImportFile()) as { readonly filePath: string; readonly fileName: string } | null;
      if (!selected) {
        return;
      }
      setImportFileName(selected.fileName);
      const preview = (await api.outline.previewImportFile({ projectId, filePath: selected.filePath })) as OutlineBulkImportPreview;
      setImportPreview(preview);
      if (preview.rows.length === 0) {
        setImportError("没有识别到可导入的场景。请确认表格包含“场景摘要”，或使用日期/星期/日夜/情节线矩阵格式。");
      }
    } catch (reason) {
      setImportPreview(null);
      setImportError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function confirmImport(): Promise<void> {
    if (!projectId || !importPreview) {
      return;
    }
    try {
      setImportError(null);
      await api.outline.confirmBulkImport({ projectId, importBatchId: importPreview.importBatchId, rows: mutableImportRows(importPreview) });
      setNotice(`已导入 ${importPreview.rows.length} 条大纲事件。`);
      setImportOpen(false);
      setImportPreview(null);
      setImportText("");
      setImportFileName("");
      setImportError(null);
      reload();
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  if (!currentProject) {
    return (
      <div className="outline-page">
        <ProjectModuleRail activeModule="outline" onNavigate={navigate} />
        <main className="outline-empty">
          <h1>还没有打开项目</h1>
          <p>打开项目后可以维护全书大纲、故事时间线和情节线。</p>
          <Button onClick={onWelcome}>返回首页</Button>
        </main>
      </div>
    );
  }

  const chapterGroups = chapters.map((chapter) => ({
    chapter,
    count: events.filter((event) => event.chapterId === chapter.id).length
  }));
  const timelineGroups = groupBy(filteredEvents, eventTimeLabel);
  const plotlineGroups = threads.map((thread) => ({
    thread,
    events: sortEventsByOutlineOrder(filteredEvents.filter((event) => event.threadIds.includes(thread.id)))
  }));
  const unthreadedPlotlineEvents = sortEventsByOutlineOrder(filteredEvents.filter((event) => event.threadIds.length === 0));

  return (
    <div className="outline-page">
      <ProjectModuleRail activeModule="outline" onNavigate={navigate} />
      <main className="outline-shell">
        <TopBar
          mode="writing"
          title={currentProject.name}
          subtitle="大纲"
          onSettings={onOpenSettings}
          onWelcome={onWelcome}
          showSearch
          searchValue={query}
          searchPlaceholder="搜索场景、角色、地点、伏笔"
          onSearchChange={setQuery}
        />
        <section className="outline-workspace" aria-busy={loading}>
          <header className="outline-toolbar">
            <div>
              <span className="outline-kicker">作者规划</span>
              <h1>全书大纲</h1>
            </div>
            <div className="outline-toolbar-actions">
              <div className="outline-view-switch" aria-label="大纲视图">
                {viewOptions.map((option) => (
                  <button
                    className={viewMode === option.value ? "active" : ""}
                    key={option.value}
                    onClick={() => setViewMode(option.value)}
                    type="button"
                  >
                    {option.icon}
                    {option.label}
                  </button>
                ))}
              </div>
              <button className="outline-ghost-button" onClick={() => setImportOpen(true)} type="button">
                <UploadSimple size={17} />
                导入
              </button>
              <button className="outline-primary-button" onClick={() => startNewEvent()} type="button">
                <Plus size={17} />
                新增场景
              </button>
            </div>
          </header>

          {(error || notice) && (
            <div className={`outline-message ${error ? "error" : "success"}`}>
              {error || notice}
              <button onClick={() => { setError(null); setNotice(null); }} type="button" aria-label="关闭提示">
                <X size={15} />
              </button>
            </div>
          )}

          <div className="outline-layout">
            <aside className="outline-chapter-nav">
              <div className="outline-side-head">
                <span>章节落点</span>
                <button onClick={() => { setSelectedChapterId(null); setShowUnassignedOnly(false); setViewMode("timeline"); }} type="button">
                  全部
                </button>
              </div>
              <button
                className={showUnassignedOnly && viewMode === "chapter" ? "outline-unassigned-filter active" : "outline-unassigned-filter"}
                onClick={() => {
                  setSelectedChapterId(null);
                  setShowUnassignedOnly(true);
                  setViewMode("chapter");
                }}
                type="button"
              >
                <span>未安排章节</span>
                <b>{events.filter((event) => event.chapterId === null).length}</b>
              </button>
              <div className="outline-chapter-list">
                {chapterGroups.map(({ chapter, count }) => (
                  <button
                    className={selectedChapterId === chapter.id ? "active" : ""}
                    key={chapter.id}
                    onClick={() => {
                      setSelectedChapterId(chapter.id);
                      setShowUnassignedOnly(false);
                      setViewMode("chapter");
                    }}
                    type="button"
                  >
                    <span>{chapter.title}</span>
                    <b>{count}</b>
                  </button>
                ))}
              </div>
            </aside>

            <section className="outline-main-panel">
              {viewMode === "timeline" && (
                <div className="outline-timeline">
                  {timelineGroups.length === 0 ? (
                    <div className="outline-empty-state">
                      <CalendarBlank size={34} />
                      <h2>还没有大纲事件</h2>
                      <p>先新增一个场景，或从 Excel / CSV 里导入已有大纲。</p>
                    </div>
                  ) : (
                    timelineGroups.map((group) => (
                      <section className="outline-time-group" key={group.key}>
                        <div className="outline-time-label">{group.key}</div>
                        <div className="outline-event-stack">
                          {group.items.map((event) => (
                            <button
                              className={selectedEventId === event.id ? "outline-event-card active" : "outline-event-card"}
                              key={event.id}
                              onClick={() => setSelectedEventId(event.id)}
                              type="button"
                            >
                              <span>{chapterLabel(chapters, event.chapterId)}</span>
                              <strong>{event.title}</strong>
                              <p>{event.summary}</p>
                              <small>{statusLabels[event.status]}</small>
                            </button>
                          ))}
                        </div>
                      </section>
                    ))
                  )}
                </div>
              )}

              {viewMode === "chapter" && (
                <div className="outline-table-wrap">
                  <table className="outline-event-table">
                    <thead>
                      <tr>
                        <th>章节落点</th>
                        <th>故事时间</th>
                        <th>时间段</th>
                        <th>情节线</th>
                        <th>场景摘要</th>
                        <th>角色</th>
                        <th>地点</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEvents.map((event) => (
                        <tr className={selectedEventId === event.id ? "active" : ""} key={event.id} onClick={() => setSelectedEventId(event.id)}>
                          <td>{chapterLabel(chapters, event.chapterId)}</td>
                          <td>{event.storyTimeLabel || event.storyDate || "未定"}</td>
                          <td>{event.daySegment === "custom" ? event.customDaySegment : daySegmentLabels[event.daySegment]}</td>
                          <td>{event.threadIds.map((id) => threads.find((thread) => thread.id === id)?.name).filter(Boolean).join("、") || "未分线"}</td>
                          <td>{event.summary}</td>
                          <td>{event.characters.join("、") || "未填"}</td>
                          <td>{event.location || "未填"}</td>
                          <td>{statusLabels[event.status]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {viewMode === "plotline" && (
                <div className="outline-plotline-board">
                  {plotlineGroups.length === 0 && unthreadedPlotlineEvents.length === 0 ? (
                    <div className="outline-empty-state">
                      <GridFour size={34} />
                      <h2>还没有情节线</h2>
                      <p>导入表格里的情节线列，或在场景详情里新增主线、支线、感情线。</p>
                    </div>
                  ) : (
                    <>
                      {plotlineGroups.map(({ thread, events: threadEvents }) => (
                        <section className="outline-plotline-lane" key={thread.id}>
                          <header>
                            <span style={{ backgroundColor: thread.color }} />
                            <strong>{thread.name}</strong>
                            <b>{threadEvents.length}</b>
                          </header>
                          <div className="outline-plotline-lane-events">
                            {threadEvents.length === 0 ? (
                              <button className="outline-plotline-empty-add" onClick={() => startNewEvent(null, thread.id)} type="button">
                                + 场景
                              </button>
                            ) : (
                              threadEvents.map((event) => (
                                <button className={selectedEventId === event.id ? "active" : ""} key={event.id} onClick={() => setSelectedEventId(event.id)} type="button">
                                  <small>{eventTimeLabel(event)}</small>
                                  <strong>{event.title}</strong>
                                  <p>{event.summary}</p>
                                  <span>{chapterLabel(chapters, event.chapterId)}</span>
                                </button>
                              ))
                            )}
                          </div>
                        </section>
                      ))}
                      {unthreadedPlotlineEvents.length > 0 ? (
                        <section className="outline-plotline-lane">
                          <header>
                            <span />
                            <strong>未分线</strong>
                            <b>{unthreadedPlotlineEvents.length}</b>
                          </header>
                          <div className="outline-plotline-lane-events">
                            {unthreadedPlotlineEvents.map((event) => (
                              <button className={selectedEventId === event.id ? "active" : ""} key={event.id} onClick={() => setSelectedEventId(event.id)} type="button">
                                <small>{eventTimeLabel(event)}</small>
                                <strong>{event.title}</strong>
                                <p>{event.summary}</p>
                                <span>{chapterLabel(chapters, event.chapterId)}</span>
                              </button>
                            ))}
                          </div>
                        </section>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </section>

            <aside className="outline-inspector">
              <form onSubmit={(event) => { void saveDraft(event); }}>
                <div className="outline-inspector-head">
                  <div>
                    <span className="outline-kicker">场景详情</span>
                    <h2>{draft.id ? "编辑大纲事件" : "新增大纲事件"}</h2>
                  </div>
                  <button className="outline-icon-button" onClick={() => startNewEvent()} type="button" title="新建">
                    <FilePlus size={18} />
                  </button>
                </div>
                <label>
                  标题
                  <input value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} placeholder="可选，默认取摘要前 40 字" />
                </label>
                <label>
                  场景摘要
                  <textarea value={draft.summary} onChange={(event) => updateDraft({ summary: event.target.value })} placeholder="这一场发生了什么？" />
                </label>
                <div className="outline-form-grid">
                  <label>
                    关联章节（可选）
                    <select value={draft.chapterId ?? ""} onChange={(event) => updateDraft({ chapterId: event.target.value || null })}>
                      <option value="">未安排章节</option>
                      {chapters.map((chapter) => (
                        <option key={chapter.id} value={chapter.id}>{chapter.title}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    状态
                    <select value={draft.status} onChange={(event) => updateDraft({ status: event.target.value as OutlineEventStatus })}>
                      {Object.entries(statusLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    故事时间
                    <input value={draft.storyTimeLabel} onChange={(event) => updateDraft({ storyTimeLabel: event.target.value })} placeholder="案发当晚 / 11月15日" />
                  </label>
                  <label>
                    标准日期
                    <input type="date" value={draft.storyDate} onChange={(event) => updateDraft({ storyDate: event.target.value })} />
                  </label>
                  <label>
                    星期 / 备注
                    <input value={draft.weekdayLabel} onChange={(event) => updateDraft({ weekdayLabel: event.target.value })} placeholder="星期二 / 雨夜" />
                  </label>
                  <label>
                    时间顺序
                    <input type="number" value={draft.storyTimeOrder} onChange={(event) => updateDraft({ storyTimeOrder: event.target.value })} />
                  </label>
                  <label>
                    时间段
                    <select value={draft.daySegment} onChange={(event) => updateDraft({ daySegment: event.target.value as OutlineDaySegment })}>
                      {Object.entries(daySegmentLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    自定义时间段
                    <input value={draft.customDaySegment} onChange={(event) => updateDraft({ customDaySegment: event.target.value })} placeholder="凌晨 / 午后" />
                  </label>
                </div>
                <label>
                  情节线
                  <div className="outline-thread-picker">
                    {threads.map((thread) => (
                      <button
                        className={draft.threadIds.includes(thread.id) ? "active" : ""}
                        key={thread.id}
                        onClick={() =>
                          updateDraft({
                            threadIds: draft.threadIds.includes(thread.id)
                              ? draft.threadIds.filter((id) => id !== thread.id)
                              : [...draft.threadIds, thread.id]
                          })
                        }
                        type="button"
                      >
                        <span style={{ backgroundColor: thread.color }} />
                        {thread.name}
                      </button>
                    ))}
                  </div>
                </label>
                <div className="outline-thread-create">
                  <input value={newThreadName} onChange={(event) => setNewThreadName(event.target.value)} placeholder="新增主线 / 感情线 / 案件线" />
                  <button onClick={() => { void createThread(); }} type="button">添加</button>
                </div>
                <div className="outline-form-grid">
                  <label>
                    角色
                    <input value={draft.charactersText} onChange={(event) => updateDraft({ charactersText: event.target.value })} placeholder="用顿号或逗号分隔" />
                  </label>
                  <label>
                    地点
                    <input value={draft.location} onChange={(event) => updateDraft({ location: event.target.value })} />
                  </label>
                  <label>
                    POV
                    <input value={draft.povCharacter} onChange={(event) => updateDraft({ povCharacter: event.target.value })} />
                  </label>
                </div>
                <label>
                  场景目标
                  <textarea value={draft.goal} onChange={(event) => updateDraft({ goal: event.target.value })} />
                </label>
                <label>
                  冲突 / 阻碍
                  <textarea value={draft.conflict} onChange={(event) => updateDraft({ conflict: event.target.value })} />
                </label>
                <label>
                  结果 / 转折
                  <textarea value={draft.outcome} onChange={(event) => updateDraft({ outcome: event.target.value })} />
                </label>
                <label>
                  伏笔 / 回收
                  <textarea value={draft.foreshadowing} onChange={(event) => updateDraft({ foreshadowing: event.target.value })} />
                </label>
                <label>
                  作者备注
                  <textarea value={draft.notes} onChange={(event) => updateDraft({ notes: event.target.value })} />
                </label>
                <div className="outline-inspector-actions">
                  {draft.id && (
                    <button className="outline-danger-button" onClick={() => { void deleteSelectedEvent(); }} type="button">
                      删除
                    </button>
                  )}
                  <button className="outline-primary-button" disabled={saving} type="submit">
                    <FloppyDisk size={17} />
                    {saving ? "保存中" : "保存"}
                  </button>
                </div>
              </form>
            </aside>
          </div>
        </section>
      </main>

      {importOpen && (
        <div className="outline-modal-backdrop" role="dialog" aria-modal="true" aria-label="导入大纲">
          <section className="outline-import-dialog">
            <header>
              <div>
                <span className="outline-kicker">导入已有大纲</span>
                <h2>从表格导入场景</h2>
              </div>
              <button onClick={() => setImportOpen(false)} type="button" aria-label="关闭">
                <X size={18} />
              </button>
            </header>
            <div className="outline-import-actions">
              <button onClick={() => { void previewFileImport(); }} type="button">
                <UploadSimple size={17} />
                选择 .xlsx / .csv
              </button>
              <button onClick={() => { void previewPasteImport(); }} type="button">
                <Rows size={17} />
                预览粘贴内容
              </button>
            </div>
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder="也可以直接从 Excel 复制表格后粘贴到这里..."
            />
            {importFileName && (
              <p className="outline-import-file">
                <span>已选择</span>
                <strong title={importFileName}>{importFileName}</strong>
              </p>
            )}
            {importError && <div className="outline-import-error">{importError}</div>}
            {importPreview && (
              <div className="outline-import-preview">
                <div className="outline-import-summary">
                  <strong>{importPreview.rows.length} 条可导入</strong>
                  <span>{importPreview.newThreadNames.length} 条新情节线</span>
                </div>
                <div className="outline-import-preview-list">
                  {importPreview.rows.slice(0, 8).map((row) => (
                    <div key={`${row.rowNumber}:${row.summary}`}>
                      <b>{row.chapterTitle || "未安排章节"}</b>
                      <span>{row.summary}</span>
                      {row.warnings.length > 0 && <small>{row.warnings.join("；")}</small>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <footer>
              <Button onClick={() => { setImportOpen(false); setImportError(null); }} variant="secondary">取消</Button>
              <button className="outline-primary-button" disabled={!importPreview || importPreview.rows.length === 0} onClick={() => { void confirmImport(); }} type="button">
                <Check size={17} />
                确认导入
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
