import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
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
  readonly onOpenChapterReview: () => void;
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
  { value: "plotline", label: "情节线", icon: <GridFour size={17} /> },
  { value: "sheet", label: "表格", icon: <Rows size={17} /> }
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

const outlineSheetColumns = [
  { id: "rowNumber", label: "#", defaultWidth: 46, minWidth: 42, maxWidth: 82, resizable: false },
  { id: "chapter", label: "章节", defaultWidth: 150, minWidth: 116, maxWidth: 280, resizable: true },
  { id: "storyTimeLabel", label: "故事时间", defaultWidth: 132, minWidth: 108, maxWidth: 260, resizable: true },
  { id: "weekdayLabel", label: "星期/备注", defaultWidth: 122, minWidth: 100, maxWidth: 240, resizable: true },
  { id: "daySegment", label: "时间段", defaultWidth: 106, minWidth: 88, maxWidth: 180, resizable: true },
  { id: "threadNames", label: "情节线", defaultWidth: 176, minWidth: 124, maxWidth: 320, resizable: true },
  { id: "summary", label: "场景摘要", defaultWidth: 430, minWidth: 260, maxWidth: 760, resizable: true },
  { id: "characters", label: "角色", defaultWidth: 170, minWidth: 120, maxWidth: 360, resizable: true },
  { id: "location", label: "地点", defaultWidth: 150, minWidth: 112, maxWidth: 320, resizable: true },
  { id: "status", label: "状态", defaultWidth: 112, minWidth: 92, maxWidth: 180, resizable: true },
  { id: "notes", label: "作者备注", defaultWidth: 190, minWidth: 130, maxWidth: 480, resizable: true }
] as const;

type OutlineSheetColumnId = (typeof outlineSheetColumns)[number]["id"];
type OutlineSheetColumnWidths = Record<OutlineSheetColumnId, number>;

const defaultOutlineSheetRowHeight = 48;
const minOutlineSheetRowHeight = 40;
const maxOutlineSheetRowHeight = 220;

function clampOutlineSheetSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function getDefaultOutlineSheetColumnWidths(): OutlineSheetColumnWidths {
  return Object.fromEntries(outlineSheetColumns.map((column) => [column.id, column.defaultWidth])) as OutlineSheetColumnWidths;
}

function parseOutlineSheetColumnWidths(raw: string | null): OutlineSheetColumnWidths {
  const defaults = getDefaultOutlineSheetColumnWidths();
  if (!raw) {
    return defaults;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Record<OutlineSheetColumnId, number>>;
    return Object.fromEntries(
      outlineSheetColumns.map((column) => [
        column.id,
        clampOutlineSheetSize(parsed[column.id] ?? column.defaultWidth, column.minWidth, column.maxWidth)
      ])
    ) as OutlineSheetColumnWidths;
  } catch {
    return defaults;
  }
}

function parseOutlineSheetRowHeights(raw: string | null): Record<string, number> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([eventId]) => eventId.trim().length > 0)
        .map(([eventId, height]) => [eventId, clampOutlineSheetSize(height, minOutlineSheetRowHeight, maxOutlineSheetRowHeight)])
    );
  } catch {
    return {};
  }
}

function outlineSheetStorageKey(projectId: string, kind: "columns" | "rows"): string {
  return `novelTool:outlineSheet:${projectId}:${kind}`;
}

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

export type OutlineSheetField =
  | "chapterId"
  | "storyTimeLabel"
  | "weekdayLabel"
  | "daySegment"
  | "threadNames"
  | "summary"
  | "characters"
  | "location"
  | "status"
  | "notes";

type OutlineSheetPatch = Partial<{
  readonly chapterId: string | null;
  readonly storyTimeLabel: string;
  readonly weekdayLabel: string;
  readonly daySegment: OutlineDaySegment;
  readonly customDaySegment: string | null;
  readonly threadIds: string[];
  readonly summary: string;
  readonly characters: string[];
  readonly location: string;
  readonly status: OutlineEventStatus;
  readonly notes: string;
}>;

export type OutlineSheetCellPatchResult =
  | { readonly ok: true; readonly patch: OutlineSheetPatch; readonly missingThreadNames: readonly string[] }
  | { readonly ok: false; readonly error: string };

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function statusFromSheetValue(value: string): OutlineEventStatus | null {
  const trimmed = value.trim();
  if (trimmed in statusLabels) {
    return trimmed as OutlineEventStatus;
  }
  return (Object.entries(statusLabels).find(([, label]) => label === trimmed)?.[0] as OutlineEventStatus | undefined) ?? null;
}

function daySegmentFromSheetValue(value: string): { readonly daySegment: OutlineDaySegment; readonly customDaySegment: string | null } {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "未定" || trimmed === "unknown") {
    return { daySegment: "unknown", customDaySegment: null };
  }
  if (trimmed === "白天" || trimmed === "day") {
    return { daySegment: "day", customDaySegment: null };
  }
  if (trimmed === "晚上" || trimmed === "夜晚" || trimmed === "night") {
    return { daySegment: "night", customDaySegment: null };
  }
  if (trimmed === "custom" || trimmed === "自定义") {
    return { daySegment: "custom", customDaySegment: "自定义" };
  }
  return { daySegment: "custom", customDaySegment: trimmed.slice(0, 80) };
}

export function getOutlineSheetThreadText(event: OutlineEventRecord, threads: readonly OutlineThreadRecord[]): string {
  return event.threadIds
    .map((id) => threads.find((thread) => thread.id === id)?.name)
    .filter((name): name is string => Boolean(name))
    .join("、");
}

export function buildOutlineSheetCellPatch(
  field: OutlineSheetField,
  value: string,
  event: OutlineEventRecord,
  chapters: readonly ChapterSummary[],
  threads: readonly OutlineThreadRecord[]
): OutlineSheetCellPatchResult {
  const trimmed = value.trim();
  if (field === "summary") {
    if (!trimmed) {
      return { ok: false, error: "场景摘要不能为空。" };
    }
    return { ok: true, patch: trimmed === event.summary ? {} : { summary: trimmed }, missingThreadNames: [] };
  }
  if (field === "chapterId") {
    const chapterId = trimmed || null;
    if (chapterId && !chapters.some((chapter) => chapter.id === chapterId)) {
      return { ok: false, error: "章节不存在，无法保存章节落点。" };
    }
    return { ok: true, patch: chapterId === event.chapterId ? {} : { chapterId }, missingThreadNames: [] };
  }
  if (field === "storyTimeLabel") {
    return { ok: true, patch: trimmed === event.storyTimeLabel ? {} : { storyTimeLabel: trimmed }, missingThreadNames: [] };
  }
  if (field === "weekdayLabel") {
    return { ok: true, patch: trimmed === event.weekdayLabel ? {} : { weekdayLabel: trimmed }, missingThreadNames: [] };
  }
  if (field === "daySegment") {
    const parsed = daySegmentFromSheetValue(trimmed);
    const customDaySegment = parsed.daySegment === "custom" ? parsed.customDaySegment : null;
    const unchanged = parsed.daySegment === event.daySegment && customDaySegment === (event.customDaySegment ?? null);
    return { ok: true, patch: unchanged ? {} : { daySegment: parsed.daySegment, customDaySegment }, missingThreadNames: [] };
  }
  if (field === "threadNames") {
    const names = splitList(trimmed);
    const existingThreadIds = names
      .map((name) => threads.find((thread) => thread.name === name)?.id)
      .filter((id): id is string => Boolean(id));
    const missingThreadNames = names.filter((name) => !threads.some((thread) => thread.name === name));
    return {
      ok: true,
      patch: sameStringList(existingThreadIds, event.threadIds) && missingThreadNames.length === 0 ? {} : { threadIds: existingThreadIds },
      missingThreadNames
    };
  }
  if (field === "characters") {
    const characters = splitList(trimmed);
    return { ok: true, patch: sameStringList(characters, event.characters) ? {} : { characters }, missingThreadNames: [] };
  }
  if (field === "location") {
    return { ok: true, patch: trimmed === event.location ? {} : { location: trimmed }, missingThreadNames: [] };
  }
  if (field === "status") {
    const status = statusFromSheetValue(trimmed);
    if (!status) {
      return { ok: false, error: "状态不存在，无法保存。" };
    }
    return { ok: true, patch: status === event.status ? {} : { status }, missingThreadNames: [] };
  }
  return { ok: true, patch: trimmed === event.notes ? {} : { notes: trimmed }, missingThreadNames: [] };
}

export function OutlinePage({
  currentProject,
  initialChapterId = null,
  onOpenChapterReview,
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
  const [outlineSheetColumnWidths, setOutlineSheetColumnWidths] = useState<OutlineSheetColumnWidths>(() => getDefaultOutlineSheetColumnWidths());
  const [outlineSheetRowHeights, setOutlineSheetRowHeights] = useState<Record<string, number>>({});

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

  useEffect(() => {
    if (!projectId) {
      setOutlineSheetColumnWidths(getDefaultOutlineSheetColumnWidths());
      setOutlineSheetRowHeights({});
      return;
    }
    setOutlineSheetColumnWidths(parseOutlineSheetColumnWidths(window.localStorage.getItem(outlineSheetStorageKey(projectId, "columns"))));
    setOutlineSheetRowHeights(parseOutlineSheetRowHeights(window.localStorage.getItem(outlineSheetStorageKey(projectId, "rows"))));
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    window.localStorage.setItem(outlineSheetStorageKey(projectId, "columns"), JSON.stringify(outlineSheetColumnWidths));
  }, [outlineSheetColumnWidths, projectId]);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    window.localStorage.setItem(outlineSheetStorageKey(projectId, "rows"), JSON.stringify(outlineSheetRowHeights));
  }, [outlineSheetRowHeights, projectId]);

  const outlineSheetGridTemplate = useMemo(
    () => outlineSheetColumns.map((column) => `${outlineSheetColumnWidths[column.id]}px`).join(" "),
    [outlineSheetColumnWidths]
  );

  const navigate = useCallback(
    (module: ProjectModule) => {
      if (module === "writing") {
        onOpenWriting();
      } else if (module === "relationshipGraph") {
        onOpenRelationshipGraph();
      } else if (module === "chapterReview") {
        onOpenChapterReview();
      } else if (module === "goals") {
        onOpenWritingGoals();
      } else if (module === "settings") {
        onOpenSettings();
      }
    },
    [onOpenChapterReview, onOpenRelationshipGraph, onOpenSettings, onOpenWriting, onOpenWritingGoals]
  );

  function startNewEvent(chapterId: string | null = selectedChapterId, threadId: string | null = null): void {
    setSelectedEventId(null);
    setDraft({ ...emptyDraft(chapterId), threadIds: threadId ? [threadId] : [] });
  }

  function updateDraft(patch: Partial<EventDraft>): void {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function startSheetColumnResize(event: ReactPointerEvent<HTMLSpanElement>, columnId: OutlineSheetColumnId): void {
    const column = outlineSheetColumns.find((item) => item.id === columnId);
    if (!column?.resizable) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = outlineSheetColumnWidths[columnId] ?? column.defaultWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const move = (moveEvent: PointerEvent) => {
      const nextWidth = clampOutlineSheetSize(startWidth + moveEvent.clientX - startX, column.minWidth, column.maxWidth);
      setOutlineSheetColumnWidths((current) => ({ ...current, [columnId]: nextWidth }));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  }

  function startSheetRowResize(event: ReactPointerEvent<HTMLSpanElement>, outlineEventId: string): void {
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = outlineSheetRowHeights[outlineEventId] ?? defaultOutlineSheetRowHeight;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const move = (moveEvent: PointerEvent) => {
      const nextHeight = clampOutlineSheetSize(startHeight + moveEvent.clientY - startY, minOutlineSheetRowHeight, maxOutlineSheetRowHeight);
      setOutlineSheetRowHeights((current) => ({ ...current, [outlineEventId]: nextHeight }));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
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

  async function saveSheetCell(outlineEvent: OutlineEventRecord, field: OutlineSheetField, value: string): Promise<void> {
    if (!projectId) {
      return;
    }
    const result = buildOutlineSheetCellPatch(field, value, outlineEvent, chapters, threads);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (Object.keys(result.patch).length === 0 && result.missingThreadNames.length === 0) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let patch = result.patch;
      if (result.missingThreadNames.length > 0) {
        const createdThreadIds: string[] = [];
        for (const name of result.missingThreadNames) {
          const thread = (await api.outline.createThread({ projectId, name })) as OutlineThreadRecord;
          createdThreadIds.push(thread.id);
        }
        patch = { ...patch, threadIds: [...(patch.threadIds ?? outlineEvent.threadIds), ...createdThreadIds] };
      }
      await api.outline.updateEvent({ projectId, eventId: outlineEvent.id, patch });
      setSelectedEventId(outlineEvent.id);
      setNotice("表格已保存。");
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

  async function clearImportedEvents(): Promise<void> {
    if (!projectId) {
      return;
    }
    if (!window.confirm("清空导入内容？只会删除通过导入创建的大纲场景，手动创建的大纲不会受影响。")) {
      return;
    }
    try {
      setImportError(null);
      const result = (await api.outline.clearImportedEvents({ projectId })) as { readonly deletedCount: number };
      setNotice(result.deletedCount > 0 ? `已清空 ${result.deletedCount} 条导入的大纲场景。` : "没有需要清空的导入大纲场景。");
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
  const sheetEvents = sortEventsByOutlineOrder(filteredEvents);
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

          <div className={viewMode === "sheet" ? "outline-layout outline-layout-sheet" : "outline-layout"}>
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

              {viewMode === "sheet" && (
                <div className="outline-sheet-wrap">
                  <div className="outline-sheet-note">
                    <strong>表格浏览模式</strong>
                    <span>直接修改单元格，离开单元格后自动保存。拖拽表头右侧调整列宽，拖拽行号底部调整行高。</span>
                    {saving ? <b>保存中</b> : null}
                  </div>
                  {sheetEvents.length === 0 ? (
                    <div className="outline-empty-state">
                      <Rows size={34} />
                      <h2>还没有可编辑的大纲事件</h2>
                      <p>先新增一个场景，或从 Excel / CSV 里导入已有大纲。</p>
                    </div>
                  ) : (
                    <div className="outline-sheet-grid" role="grid" aria-label="大纲表格编辑">
                      <div className="outline-sheet-row outline-sheet-header" role="row" style={{ gridTemplateColumns: outlineSheetGridTemplate }}>
                        {outlineSheetColumns.map((column) => (
                          <div
                            className={column.id === "rowNumber" ? "outline-sheet-row-number" : "outline-sheet-header-cell"}
                            key={column.id}
                          >
                            <span>{column.label}</span>
                            {column.resizable ? (
                              <span
                                aria-label={`调整${column.label}列宽`}
                                className="outline-sheet-column-resizer"
                                onPointerDown={(pointerEvent) => startSheetColumnResize(pointerEvent, column.id)}
                                role="separator"
                                title="拖拽调整列宽"
                              />
                            ) : null}
                          </div>
                        ))}
                      </div>
                      {sheetEvents.map((outlineEvent, index) => {
                        const rowStyle: CSSProperties = {
                          gridTemplateColumns: outlineSheetGridTemplate,
                          height: `${outlineSheetRowHeights[outlineEvent.id] ?? defaultOutlineSheetRowHeight}px`
                        };
                        return (
                          <div
                            className={selectedEventId === outlineEvent.id ? "outline-sheet-row active" : "outline-sheet-row"}
                            key={outlineEvent.id}
                            onClick={() => setSelectedEventId(outlineEvent.id)}
                            role="row"
                            style={rowStyle}
                          >
                            <div className="outline-sheet-row-number">
                              <span>{index + 1}</span>
                              <span
                                aria-label={`调整第${index + 1}行高度`}
                                className="outline-sheet-row-resizer"
                                onPointerDown={(pointerEvent) => startSheetRowResize(pointerEvent, outlineEvent.id)}
                                role="separator"
                                title="拖拽调整行高"
                              />
                            </div>
                            <select
                              className="outline-sheet-cell"
                              defaultValue={outlineEvent.chapterId ?? ""}
                              onChange={(inputEvent) => { void saveSheetCell(outlineEvent, "chapterId", inputEvent.currentTarget.value); }}
                            >
                              <option value="">未安排章节</option>
                              {chapters.map((chapter) => (
                                <option key={chapter.id} value={chapter.id}>{chapter.title}</option>
                              ))}
                            </select>
                            <input
                              className="outline-sheet-cell"
                              defaultValue={outlineEvent.storyTimeLabel}
                              onBlur={(inputEvent) => { void saveSheetCell(outlineEvent, "storyTimeLabel", inputEvent.currentTarget.value); }}
                            />
                            <input
                              className="outline-sheet-cell"
                              defaultValue={outlineEvent.weekdayLabel}
                              onBlur={(inputEvent) => { void saveSheetCell(outlineEvent, "weekdayLabel", inputEvent.currentTarget.value); }}
                            />
                            <input
                              className="outline-sheet-cell"
                              defaultValue={outlineEvent.daySegment === "custom" ? outlineEvent.customDaySegment ?? "" : daySegmentLabels[outlineEvent.daySegment]}
                              onBlur={(inputEvent) => { void saveSheetCell(outlineEvent, "daySegment", inputEvent.currentTarget.value); }}
                            />
                            <input
                              className="outline-sheet-cell"
                              defaultValue={getOutlineSheetThreadText(outlineEvent, threads)}
                              onBlur={(inputEvent) => { void saveSheetCell(outlineEvent, "threadNames", inputEvent.currentTarget.value); }}
                            />
                            <textarea
                              className="outline-sheet-cell outline-sheet-summary-cell"
                              defaultValue={outlineEvent.summary}
                              onBlur={(inputEvent) => { void saveSheetCell(outlineEvent, "summary", inputEvent.currentTarget.value); }}
                            />
                            <input
                              className="outline-sheet-cell"
                              defaultValue={outlineEvent.characters.join("、")}
                              onBlur={(inputEvent) => { void saveSheetCell(outlineEvent, "characters", inputEvent.currentTarget.value); }}
                            />
                            <input
                              className="outline-sheet-cell"
                              defaultValue={outlineEvent.location}
                              onBlur={(inputEvent) => { void saveSheetCell(outlineEvent, "location", inputEvent.currentTarget.value); }}
                            />
                            <select
                              className="outline-sheet-cell"
                              defaultValue={outlineEvent.status}
                              onChange={(inputEvent) => { void saveSheetCell(outlineEvent, "status", inputEvent.currentTarget.value); }}
                            >
                              {Object.entries(statusLabels).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                            </select>
                            <input
                              className="outline-sheet-cell"
                              defaultValue={outlineEvent.notes}
                              onBlur={(inputEvent) => { void saveSheetCell(outlineEvent, "notes", inputEvent.currentTarget.value); }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
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

            {viewMode !== "sheet" && <aside className="outline-inspector">
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
            </aside>}
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
                  {importPreview.skippedRows.length > 0 && <span>{importPreview.skippedRows.length} 行已跳过</span>}
                </div>
                <div className="outline-import-preview-list">
                  {importPreview.rows.slice(0, 8).map((row) => (
                    <div key={`${row.rowNumber}:${row.summary}`}>
                      <b>{row.chapterTitle || "未安排章节"}</b>
                      <span>{row.summary}</span>
                      {row.warnings.length > 0 && <small>{row.warnings.join("；")}</small>}
                    </div>
                  ))}
                  {importPreview.skippedRows.slice(0, 3).map((row) => (
                    <div key={`skipped:${row.rowNumber}`}>
                      <b>第 {row.rowNumber} 行已跳过</b>
                      <span>{row.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <footer>
              <button className="outline-danger-button" onClick={() => { void clearImportedEvents(); }} type="button">
                清空导入内容
              </button>
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
