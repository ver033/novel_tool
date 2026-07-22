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
import { useI18n } from "../i18n";
import { useLocalizedCopy } from "../i18n/localized-copy";
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

const outlinePageCopy = {
  "zh-CN": {
    title: "大纲",
    heading: "全书大纲",
    kicker: "作者规划",
    search: "搜索场景、角色、地点、伏笔",
    views: { timeline: "时间线", chapter: "章节落点", plotline: "情节线", sheet: "表格" },
    status: { planned: "未写", drafting: "写作中", written: "已写", needs_revision: "待修", done: "完成" },
    daySegment: { day: "白天", night: "晚上", custom: "自定义", unknown: "未定" },
    openProject: "还没有打开项目",
    openProjectHint: "打开项目后可以维护全书大纲、故事时间线和情节线。",
    backHome: "返回首页",
    import: "导入",
    addScene: "新增场景",
    closeNotice: "关闭提示",
    all: "全部",
    unassignedChapter: "未安排章节",
    deletedChapter: "章节已删除",
    unsetTime: "未定时间",
    noEvents: "还没有大纲事件",
    noEventsHint: "先新增一个场景，或从 Excel / CSV 里导入已有大纲。",
    columns: {
      rowNumber: "#",
      chapter: "章节",
      storyTimeLabel: "故事时间",
      weekdayLabel: "星期 / 备注",
      daySegment: "时间段",
      threadNames: "情节线",
      summary: "场景摘要",
      characters: "角色",
      location: "地点",
      status: "状态",
      notes: "作者备注"
    },
    unset: "未定",
    unthreaded: "未分线",
    empty: "未填",
    sheetMode: "表格浏览模式",
    sheetModeHint: "直接修改单元格，离开单元格后自动保存。拖拽表头右侧调整列宽，拖拽行号底部调整行高。",
    saving: "保存中",
    noEditableEvents: "还没有可编辑的大纲事件",
    sheetAria: "大纲表格编辑",
    resizeColumn: (label: string) => `调整${label}列宽`,
    resizeColumnTitle: "拖拽调整列宽",
    resizeRow: (index: number) => `调整第${index}行高度`,
    resizeRowTitle: "拖拽调整行高",
    noThreads: "还没有情节线",
    noThreadsHint: "导入表格里的情节线列，或在场景详情里新增主线、支线、感情线。",
    addToThread: "+ 场景",
    sceneDetail: "场景详情",
    editEvent: "编辑大纲事件",
    newEvent: "新增大纲事件",
    new: "新建",
    eventTitle: "标题",
    titlePlaceholder: "可选，默认取摘要前 40 字",
    summary: "场景摘要",
    summaryPlaceholder: "这一场发生了什么？",
    linkedChapter: "关联章节（可选）",
    storyTime: "故事时间",
    storyTimePlaceholder: "案发当晚 / 11月15日",
    standardDate: "标准日期",
    weekdayNote: "星期 / 备注",
    weekdayPlaceholder: "星期二 / 雨夜",
    timeOrder: "时间顺序",
    customSegment: "自定义时间段",
    customSegmentPlaceholder: "凌晨 / 午后",
    threadPlaceholder: "新增主线 / 感情线 / 案件线",
    add: "添加",
    charactersPlaceholder: "用顿号或逗号分隔",
    sceneGoal: "场景目标",
    conflict: "冲突 / 阻碍",
    outcome: "结果 / 转折",
    foreshadowing: "伏笔 / 回收",
    delete: "删除",
    save: "保存",
    importOutline: "导入大纲",
    importExisting: "导入已有大纲",
    importScenes: "从表格导入场景",
    close: "关闭",
    chooseFile: "选择 .xlsx / .csv",
    previewPaste: "预览粘贴内容",
    pastePlaceholder: "也可以直接从 Excel 复制表格后粘贴到这里...",
    selected: "已选择",
    importable: (count: number) => `${count} 条可导入`,
    newThreads: (count: number) => `${count} 条新情节线`,
    skipped: (count: number) => `${count} 行已跳过`,
    skippedRow: (row: number) => `第 ${row} 行已跳过`,
    clearImported: "清空导入内容",
    cancel: "取消",
    confirmImport: "确认导入"
  },
  "ja-JP": {
    title: "プロット",
    heading: "作品全体のプロット",
    kicker: "構成設計",
    search: "シーン・人物・場所・伏線を検索",
    views: { timeline: "時系列", chapter: "章ごと", plotline: "プロットライン", sheet: "表" },
    status: { planned: "未執筆", drafting: "執筆中", written: "執筆済み", needs_revision: "要修正", done: "完了" },
    daySegment: { day: "昼", night: "夜", custom: "指定", unknown: "未定" },
    openProject: "プロジェクトが開かれていません",
    openProjectHint: "プロジェクトを開くと、全体構成・時系列・プロットラインを管理できます。",
    backHome: "スタート画面へ",
    import: "取り込む",
    addScene: "シーンを追加",
    closeNotice: "通知を閉じる",
    all: "すべて",
    unassignedChapter: "章未設定",
    deletedChapter: "削除された章",
    unsetTime: "時刻未設定",
    noEvents: "プロットイベントはまだありません",
    noEventsHint: "シーンを追加するか、Excel / CSV のプロットを取り込んでください。",
    columns: {
      rowNumber: "#",
      chapter: "章",
      storyTimeLabel: "物語内の時刻",
      weekdayLabel: "曜日 / メモ",
      daySegment: "時間帯",
      threadNames: "プロットライン",
      summary: "シーン概要",
      characters: "登場人物",
      location: "場所",
      status: "状態",
      notes: "作者メモ"
    },
    unset: "未定",
    unthreaded: "ライン未設定",
    empty: "未入力",
    sheetMode: "表形式",
    sheetModeHint: "セルを直接編集すると、フォーカスを外した時に自動保存されます。ヘッダー右端で列幅、行番号の下端で行高を調整できます。",
    saving: "保存中",
    noEditableEvents: "編集できるプロットイベントはありません",
    sheetAria: "プロット表の編集",
    resizeColumn: (label: string) => `${label}列の幅を調整`,
    resizeColumnTitle: "ドラッグして列幅を調整",
    resizeRow: (index: number) => `${index} 行目の高さを調整`,
    resizeRowTitle: "ドラッグして行高を調整",
    noThreads: "プロットラインはまだありません",
    noThreadsHint: "表のプロットライン列を取り込むか、シーン詳細で本筋・支線・恋愛線などを追加してください。",
    addToThread: "+ シーン",
    sceneDetail: "シーン詳細",
    editEvent: "プロットイベントを編集",
    newEvent: "プロットイベントを追加",
    new: "新規",
    eventTitle: "タイトル",
    titlePlaceholder: "任意。未入力の場合は概要の先頭を使用",
    summary: "シーン概要",
    summaryPlaceholder: "このシーンで何が起こりますか？",
    linkedChapter: "関連する章（任意）",
    storyTime: "物語内の時刻",
    storyTimePlaceholder: "事件当日の夜 / 11月15日",
    standardDate: "日付",
    weekdayNote: "曜日 / メモ",
    weekdayPlaceholder: "火曜日 / 雨の夜",
    timeOrder: "時系列順",
    customSegment: "指定時間帯",
    customSegmentPlaceholder: "明け方 / 午後",
    threadPlaceholder: "本筋 / 恋愛線 / 事件線を追加",
    add: "追加",
    charactersPlaceholder: "読点またはカンマで区切る",
    sceneGoal: "シーンの目的",
    conflict: "対立 / 障害",
    outcome: "結果 / 転換",
    foreshadowing: "伏線 / 回収",
    delete: "削除",
    save: "保存",
    importOutline: "プロットを取り込む",
    importExisting: "既存プロットの取り込み",
    importScenes: "表からシーンを取り込む",
    close: "閉じる",
    chooseFile: ".xlsx / .csv を選択",
    previewPaste: "貼り付け内容を確認",
    pastePlaceholder: "Excel の表をコピーして、ここへ貼り付けることもできます...",
    selected: "選択済み",
    importable: (count: number) => `${count} 件を取り込み可能`,
    newThreads: (count: number) => `新しいプロットライン ${count} 件`,
    skipped: (count: number) => `${count} 行をスキップ`,
    skippedRow: (row: number) => `${row} 行目をスキップ`,
    clearImported: "取り込み内容を消去",
    cancel: "キャンセル",
    confirmImport: "取り込みを確定"
  }
} as const;

const statusLabels = outlinePageCopy["zh-CN"].status;
const daySegmentLabels = outlinePageCopy["zh-CN"].daySegment;

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

function chapterLabel(chapters: readonly ChapterSummary[], chapterId: string | null, unassigned: string, deleted: string): string {
  if (!chapterId) {
    return unassigned;
  }
  return chapters.find((chapter) => chapter.id === chapterId)?.title ?? deleted;
}

function eventTimeLabel(
  event: OutlineEventRecord,
  labels: Readonly<Record<OutlineDaySegment, string>>,
  unsetTime: string
): string {
  const segment = event.daySegment === "custom" ? event.customDaySegment || labels.custom : labels[event.daySegment];
  return [event.storyTimeLabel || event.storyDate || unsetTime, event.weekdayLabel, segment].filter(Boolean).join(" · ");
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
  const allLabels = [outlinePageCopy["zh-CN"].status, outlinePageCopy["ja-JP"].status];
  for (const labels of allLabels) {
    const matched = Object.entries(labels).find(([, label]) => label === trimmed)?.[0] as OutlineEventStatus | undefined;
    if (matched) {
      return matched;
    }
  }
  return null;
}

function daySegmentFromSheetValue(value: string): { readonly daySegment: OutlineDaySegment; readonly customDaySegment: string | null } {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "未定" || trimmed === "unknown") {
    return { daySegment: "unknown", customDaySegment: null };
  }
  if (trimmed === "白天" || trimmed === "昼" || trimmed === "day") {
    return { daySegment: "day", customDaySegment: null };
  }
  if (trimmed === "晚上" || trimmed === "夜晚" || trimmed === "夜" || trimmed === "night") {
    return { daySegment: "night", customDaySegment: null };
  }
  if (trimmed === "custom" || trimmed === "自定义" || trimmed === "指定") {
    return { daySegment: "custom", customDaySegment: trimmed };
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
  const { locale } = useI18n();
  const copy = useLocalizedCopy(outlinePageCopy);
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
    const needle = query.trim().toLocaleLowerCase(locale);
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
        .toLocaleLowerCase(locale)
        .includes(needle);
    });
  }, [events, locale, query, selectedChapterId, showUnassignedOnly, viewMode]);

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
          <h1>{copy.openProject}</h1>
          <p>{copy.openProjectHint}</p>
          <Button onClick={onWelcome}>{copy.backHome}</Button>
        </main>
      </div>
    );
  }

  const chapterGroups = chapters.map((chapter) => ({
    chapter,
    count: events.filter((event) => event.chapterId === chapter.id).length
  }));
  const timelineGroups = groupBy(filteredEvents, (event) => eventTimeLabel(event, copy.daySegment, copy.unsetTime));
  const sheetEvents = sortEventsByOutlineOrder(filteredEvents);
  const plotlineGroups = threads.map((thread) => ({
    thread,
    events: sortEventsByOutlineOrder(filteredEvents.filter((event) => event.threadIds.includes(thread.id)))
  }));
  const unthreadedPlotlineEvents = sortEventsByOutlineOrder(filteredEvents.filter((event) => event.threadIds.length === 0));

  return (
    <div className="outline-page">
      <TopBar
        mode="writing"
        title={currentProject.name}
        subtitle={copy.title}
        onSettings={onOpenSettings}
        onWelcome={onWelcome}
        showSearch
        searchValue={query}
        searchPlaceholder={copy.search}
        onSearchChange={setQuery}
      />
      <main className="outline-shell">
        <ProjectModuleRail activeModule="outline" onNavigate={navigate} />
        <section className="outline-workspace" aria-busy={loading}>
          <header className="outline-toolbar">
            <div>
              <span className="outline-kicker">{copy.kicker}</span>
              <h1>{copy.heading}</h1>
            </div>
            <div className="outline-toolbar-actions">
              <div className="outline-view-switch" aria-label={copy.title}>
                {viewOptions.map((option) => (
                  <button
                    className={viewMode === option.value ? "active" : ""}
                    key={option.value}
                    onClick={() => setViewMode(option.value)}
                    type="button"
                  >
                    {option.icon}
                    {copy.views[option.value]}
                  </button>
                ))}
              </div>
              <button className="outline-ghost-button" onClick={() => setImportOpen(true)} type="button">
                <UploadSimple size={17} />
                {copy.import}
              </button>
              <button className="outline-primary-button" onClick={() => startNewEvent()} type="button">
                <Plus size={17} />
                {copy.addScene}
              </button>
            </div>
          </header>

          {(error || notice) && (
            <div className={`outline-message ${error ? "error" : "success"}`}>
              {error || notice}
              <button onClick={() => { setError(null); setNotice(null); }} type="button" aria-label={copy.closeNotice}>
                <X size={15} />
              </button>
            </div>
          )}

          <div className={viewMode === "sheet" ? "outline-layout outline-layout-sheet" : "outline-layout"}>
            <aside className="outline-chapter-nav">
              <div className="outline-side-head">
                <span>{copy.views.chapter}</span>
                <button onClick={() => { setSelectedChapterId(null); setShowUnassignedOnly(false); setViewMode("timeline"); }} type="button">
                  {copy.all}
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
                <span>{copy.unassignedChapter}</span>
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
                      <h2>{copy.noEvents}</h2>
                      <p>{copy.noEventsHint}</p>
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
                              <span>{chapterLabel(chapters, event.chapterId, copy.unassignedChapter, copy.deletedChapter)}</span>
                              <strong>{event.title}</strong>
                              <p>{event.summary}</p>
                              <small>{copy.status[event.status]}</small>
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
                        <th>{copy.columns.chapter}</th>
                        <th>{copy.columns.storyTimeLabel}</th>
                        <th>{copy.columns.daySegment}</th>
                        <th>{copy.columns.threadNames}</th>
                        <th>{copy.columns.summary}</th>
                        <th>{copy.columns.characters}</th>
                        <th>{copy.columns.location}</th>
                        <th>{copy.columns.status}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEvents.map((event) => (
                        <tr className={selectedEventId === event.id ? "active" : ""} key={event.id} onClick={() => setSelectedEventId(event.id)}>
                          <td>{chapterLabel(chapters, event.chapterId, copy.unassignedChapter, copy.deletedChapter)}</td>
                          <td>{event.storyTimeLabel || event.storyDate || copy.unset}</td>
                          <td>{event.daySegment === "custom" ? event.customDaySegment : copy.daySegment[event.daySegment]}</td>
                          <td>{event.threadIds.map((id) => threads.find((thread) => thread.id === id)?.name).filter(Boolean).join("、") || copy.unthreaded}</td>
                          <td>{event.summary}</td>
                          <td>{event.characters.join("、") || copy.empty}</td>
                          <td>{event.location || copy.empty}</td>
                          <td>{copy.status[event.status]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {viewMode === "sheet" && (
                <div className="outline-sheet-wrap">
                  <div className="outline-sheet-note">
                    <strong>{copy.sheetMode}</strong>
                    <span>{copy.sheetModeHint}</span>
                    {saving ? <b>{copy.saving}</b> : null}
                  </div>
                  {sheetEvents.length === 0 ? (
                    <div className="outline-empty-state">
                      <Rows size={34} />
                      <h2>{copy.noEditableEvents}</h2>
                      <p>{copy.noEventsHint}</p>
                    </div>
                  ) : (
                    <div className="outline-sheet-grid" role="grid" aria-label={copy.sheetAria}>
                      <div className="outline-sheet-row outline-sheet-header" role="row" style={{ gridTemplateColumns: outlineSheetGridTemplate }}>
                        {outlineSheetColumns.map((column) => (
                          <div
                            className={column.id === "rowNumber" ? "outline-sheet-row-number" : "outline-sheet-header-cell"}
                            key={column.id}
                          >
                            <span>{copy.columns[column.id]}</span>
                            {column.resizable ? (
                              <span
                                aria-label={copy.resizeColumn(copy.columns[column.id])}
                                className="outline-sheet-column-resizer"
                                onPointerDown={(pointerEvent) => startSheetColumnResize(pointerEvent, column.id)}
                                role="separator"
                                title={copy.resizeColumnTitle}
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
                                aria-label={copy.resizeRow(index + 1)}
                                className="outline-sheet-row-resizer"
                                onPointerDown={(pointerEvent) => startSheetRowResize(pointerEvent, outlineEvent.id)}
                                role="separator"
                                title={copy.resizeRowTitle}
                              />
                            </div>
                            <select
                              className="outline-sheet-cell"
                              defaultValue={outlineEvent.chapterId ?? ""}
                              onChange={(inputEvent) => { void saveSheetCell(outlineEvent, "chapterId", inputEvent.currentTarget.value); }}
                            >
                              <option value="">{copy.unassignedChapter}</option>
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
                              defaultValue={outlineEvent.daySegment === "custom" ? outlineEvent.customDaySegment ?? "" : copy.daySegment[outlineEvent.daySegment]}
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
                              {Object.entries(copy.status).map(([value, label]) => (
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
                      <h2>{copy.noThreads}</h2>
                      <p>{copy.noThreadsHint}</p>
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
                                {copy.addToThread}
                              </button>
                            ) : (
                              threadEvents.map((event) => (
                                <button className={selectedEventId === event.id ? "active" : ""} key={event.id} onClick={() => setSelectedEventId(event.id)} type="button">
                                  <small>{eventTimeLabel(event, copy.daySegment, copy.unsetTime)}</small>
                                  <strong>{event.title}</strong>
                                  <p>{event.summary}</p>
                                  <span>{chapterLabel(chapters, event.chapterId, copy.unassignedChapter, copy.deletedChapter)}</span>
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
                            <strong>{copy.unthreaded}</strong>
                            <b>{unthreadedPlotlineEvents.length}</b>
                          </header>
                          <div className="outline-plotline-lane-events">
                            {unthreadedPlotlineEvents.map((event) => (
                              <button className={selectedEventId === event.id ? "active" : ""} key={event.id} onClick={() => setSelectedEventId(event.id)} type="button">
                                <small>{eventTimeLabel(event, copy.daySegment, copy.unsetTime)}</small>
                                <strong>{event.title}</strong>
                                <p>{event.summary}</p>
                                <span>{chapterLabel(chapters, event.chapterId, copy.unassignedChapter, copy.deletedChapter)}</span>
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
                    <span className="outline-kicker">{copy.sceneDetail}</span>
                    <h2>{draft.id ? copy.editEvent : copy.newEvent}</h2>
                  </div>
                  <button className="outline-icon-button" onClick={() => startNewEvent()} type="button" title={copy.new}>
                    <FilePlus size={18} />
                  </button>
                </div>
                <label>
                  {copy.eventTitle}
                  <input value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} placeholder={copy.titlePlaceholder} />
                </label>
                <label>
                  {copy.summary}
                  <textarea value={draft.summary} onChange={(event) => updateDraft({ summary: event.target.value })} placeholder={copy.summaryPlaceholder} />
                </label>
                <div className="outline-form-grid">
                  <label>
                    {copy.linkedChapter}
                    <select value={draft.chapterId ?? ""} onChange={(event) => updateDraft({ chapterId: event.target.value || null })}>
                      <option value="">{copy.unassignedChapter}</option>
                      {chapters.map((chapter) => (
                        <option key={chapter.id} value={chapter.id}>{chapter.title}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {copy.columns.status}
                    <select value={draft.status} onChange={(event) => updateDraft({ status: event.target.value as OutlineEventStatus })}>
                      {Object.entries(copy.status).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {copy.storyTime}
                    <input value={draft.storyTimeLabel} onChange={(event) => updateDraft({ storyTimeLabel: event.target.value })} placeholder={copy.storyTimePlaceholder} />
                  </label>
                  <label>
                    {copy.standardDate}
                    <input type="date" value={draft.storyDate} onChange={(event) => updateDraft({ storyDate: event.target.value })} />
                  </label>
                  <label>
                    {copy.weekdayNote}
                    <input value={draft.weekdayLabel} onChange={(event) => updateDraft({ weekdayLabel: event.target.value })} placeholder={copy.weekdayPlaceholder} />
                  </label>
                  <label>
                    {copy.timeOrder}
                    <input type="number" value={draft.storyTimeOrder} onChange={(event) => updateDraft({ storyTimeOrder: event.target.value })} />
                  </label>
                  <label>
                    {copy.columns.daySegment}
                    <select value={draft.daySegment} onChange={(event) => updateDraft({ daySegment: event.target.value as OutlineDaySegment })}>
                      {Object.entries(copy.daySegment).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {copy.customSegment}
                    <input value={draft.customDaySegment} onChange={(event) => updateDraft({ customDaySegment: event.target.value })} placeholder={copy.customSegmentPlaceholder} />
                  </label>
                </div>
                <label>
                  {copy.columns.threadNames}
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
                  <input value={newThreadName} onChange={(event) => setNewThreadName(event.target.value)} placeholder={copy.threadPlaceholder} />
                  <button onClick={() => { void createThread(); }} type="button">{copy.add}</button>
                </div>
                <div className="outline-form-grid">
                  <label>
                    {copy.columns.characters}
                    <input value={draft.charactersText} onChange={(event) => updateDraft({ charactersText: event.target.value })} placeholder={copy.charactersPlaceholder} />
                  </label>
                  <label>
                    {copy.columns.location}
                    <input value={draft.location} onChange={(event) => updateDraft({ location: event.target.value })} />
                  </label>
                  <label>
                    POV
                    <input value={draft.povCharacter} onChange={(event) => updateDraft({ povCharacter: event.target.value })} />
                  </label>
                </div>
                <label>
                  {copy.sceneGoal}
                  <textarea value={draft.goal} onChange={(event) => updateDraft({ goal: event.target.value })} />
                </label>
                <label>
                  {copy.conflict}
                  <textarea value={draft.conflict} onChange={(event) => updateDraft({ conflict: event.target.value })} />
                </label>
                <label>
                  {copy.outcome}
                  <textarea value={draft.outcome} onChange={(event) => updateDraft({ outcome: event.target.value })} />
                </label>
                <label>
                  {copy.foreshadowing}
                  <textarea value={draft.foreshadowing} onChange={(event) => updateDraft({ foreshadowing: event.target.value })} />
                </label>
                <label>
                  {copy.columns.notes}
                  <textarea value={draft.notes} onChange={(event) => updateDraft({ notes: event.target.value })} />
                </label>
                <div className="outline-inspector-actions">
                  {draft.id && (
                    <button className="outline-danger-button" onClick={() => { void deleteSelectedEvent(); }} type="button">
                      {copy.delete}
                    </button>
                  )}
                  <button className="outline-primary-button" disabled={saving} type="submit">
                    <FloppyDisk size={17} />
                    {saving ? copy.saving : copy.save}
                  </button>
                </div>
              </form>
            </aside>}
          </div>
        </section>
      </main>

      {importOpen && (
        <div className="outline-modal-backdrop" role="dialog" aria-modal="true" aria-label={copy.importOutline}>
          <section className="outline-import-dialog">
            <header>
              <div>
                <span className="outline-kicker">{copy.importExisting}</span>
                <h2>{copy.importScenes}</h2>
              </div>
              <button onClick={() => setImportOpen(false)} type="button" aria-label={copy.close}>
                <X size={18} />
              </button>
            </header>
            <div className="outline-import-actions">
              <button onClick={() => { void previewFileImport(); }} type="button">
                <UploadSimple size={17} />
                {copy.chooseFile}
              </button>
              <button onClick={() => { void previewPasteImport(); }} type="button">
                <Rows size={17} />
                {copy.previewPaste}
              </button>
            </div>
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder={copy.pastePlaceholder}
            />
            {importFileName && (
              <p className="outline-import-file">
                <span>{copy.selected}</span>
                <strong title={importFileName}>{importFileName}</strong>
              </p>
            )}
            {importError && <div className="outline-import-error">{importError}</div>}
            {importPreview && (
              <div className="outline-import-preview">
                <div className="outline-import-summary">
                  <strong>{copy.importable(importPreview.rows.length)}</strong>
                  <span>{copy.newThreads(importPreview.newThreadNames.length)}</span>
                  {importPreview.skippedRows.length > 0 && <span>{copy.skipped(importPreview.skippedRows.length)}</span>}
                </div>
                <div className="outline-import-preview-list">
                  {importPreview.rows.slice(0, 8).map((row) => (
                    <div key={`${row.rowNumber}:${row.summary}`}>
                      <b>{row.chapterTitle || copy.unassignedChapter}</b>
                      <span>{row.summary}</span>
                      {row.warnings.length > 0 && <small>{row.warnings.join("；")}</small>}
                    </div>
                  ))}
                  {importPreview.skippedRows.slice(0, 3).map((row) => (
                    <div key={`skipped:${row.rowNumber}`}>
                      <b>{copy.skippedRow(row.rowNumber)}</b>
                      <span>{row.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <footer>
              <button className="outline-danger-button" onClick={() => { void clearImportedEvents(); }} type="button">
                {copy.clearImported}
              </button>
              <Button onClick={() => { setImportOpen(false); setImportError(null); }} variant="secondary">{copy.cancel}</Button>
              <button className="outline-primary-button" disabled={!importPreview || importPreview.rows.length === 0} onClick={() => { void confirmImport(); }} type="button">
                <Check size={17} />
                {copy.confirmImport}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
