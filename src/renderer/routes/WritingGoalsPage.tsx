import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  ArrowClockwise,
  CalendarBlank,
  CaretRight,
  CheckCircle,
  ClockCountdown,
  NotePencil,
  Pause,
  Play,
  Plus,
  Target,
  TrendUp
} from "@phosphor-icons/react";
import type {
  ProjectRecord,
  WritingCalendarDay,
  WritingDayDetail,
  WritingGoalOverview,
  WritingGoalRecord,
  WritingGoalType
} from "../../main/shared/types";
import type { AppLocale } from "../../main/shared/language";
import { useI18n } from "../i18n";
import { useLocalizedCopy } from "../i18n/localized-copy";
import { ProjectModuleRail, type ProjectModule } from "../layout/ProjectModuleRail";
import { TopBar } from "../layout/TopBar";
import { getNovelToolApi } from "../state/app-store";
import { animateGoalSaved, animateWritingGoalCalendar, animateWritingGoalDashboard } from "./writing-goal-animations";

type WritingGoalsPageProps = {
  readonly currentProject: ProjectRecord | null;
  readonly onOpenChapterReview: () => void;
  readonly onOpenOutline: () => void;
  readonly onOpenRelationshipGraph: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenWriting: () => void;
  readonly onWelcome: () => void;
};

type GoalFormState = {
  readonly mode: "create" | "edit";
  readonly name: string;
  readonly goalType: WritingGoalType;
  readonly targetWordCount: string;
  readonly startDate: string;
  readonly deadlineDate: string;
  readonly activeWeekdays: readonly number[];
  readonly restDatesText: string;
};

const goalPageCopy = {
  "zh-CN": {
    weekdays: ["日", "一", "二", "三", "四", "五", "六"],
    pace: {
      no_goal: "未设置目标",
      ahead: "进度领先",
      on_track: "节奏正常",
      behind: "需要加速",
      completed: "目标完成",
      overdue: "已超期",
      paused: "目标暂停"
    },
    status: {
      "no-data": "未记录",
      rest: "休息",
      missed: "未完成",
      partial: "部分完成",
      done: "完成",
      over: "超额",
      deadline: "截止",
      "system-adjusted": "校准"
    },
    defaultGoalName: "全书写作目标",
    title: "写作目标",
    subtitle: "写作目标和统计",
    openProject: "先打开一个项目",
    openProjectHint: "写作目标会根据当前项目的章节字数动态计算。",
    noGoal: "还没有写作目标",
    refresh: "刷新",
    editGoal: "编辑目标",
    resume: "继续",
    pause: "暂停",
    createGoal: "新建目标",
    remaining: (count: string) => `还差 ${count} 字`,
    noGoalLead: "用目标把每天该写多少算清楚",
    currentTotal: (count: string) => `当前全书 ${count} 字`,
    deadline: (date: string) => `，截止 ${date}`,
    noGoalHint: "，创建目标后会自动生成每日计划。",
    neededToday: "今天还需",
    todayPlan: (count: string) => `今日计划 ${count} 字`,
    remainingDays: "剩余写作日",
    perDay: (count: string) => `每天约 ${count} 字`,
    estimated: "预计完成",
    estimateHint: "按近 30 天正向写作估算",
    none: "暂无",
    calendar: "日历",
    done: "完成",
    partial: "部分",
    gap: "缺口",
    plan: (count: number | string) => `计划 ${count}`,
    recentWriting: "近期写作",
    recentPace: "近 14 天写作节奏",
    recentOverview: "近 14 天概览",
    netAdded: "净增",
    activeDays: (count: number) => `活跃 ${count} 天`,
    recentStats: "近 14 天写作统计",
    today: "今",
    dailyAverage: "日均",
    best: "最高",
    noRecentData: "保存章节后，这里会显示连续 14 天的节奏。",
    dayDetail: "日详情",
    selectDay: "选择日历中的一天",
    selectDayHint: "查看当天新增、删减和涉及的章节。",
    planned: "计划",
    added: "新增",
    deleted: "删减",
    noDayRecord: "这一天还没有写作记录。",
    saveCount: (count: number) => `${count} 次保存`,
    createGoalKicker: "创建目标",
    editGoalKicker: "编辑目标",
    createGoalHeading: "让系统开始计算每天该写多少",
    editGoalHeading: "调整未来计划",
    close: "关闭",
    goalName: "目标名称",
    totalWords: "全书总字数",
    addFromToday: "从今天新增",
    targetWords: "目标字数",
    startDate: "开始日期",
    deadlineDate: "截止日期",
    writingDays: "写作日",
    restDays: "休息日",
    restPlaceholder: "可选，例如 2026-05-20, 2026-05-21",
    archive: "归档目标",
    saving: "保存中",
    saveGoal: "保存目标",
    invalidTarget: "目标字数至少为 100。",
    chars: "字",
    monthFallback: "本月"
  },
  "ja-JP": {
    weekdays: ["日", "月", "火", "水", "木", "金", "土"],
    pace: {
      no_goal: "目標未設定",
      ahead: "予定より先行",
      on_track: "順調",
      behind: "ペースアップが必要",
      completed: "目標達成",
      overdue: "期限超過",
      paused: "一時停止中"
    },
    status: {
      "no-data": "記録なし",
      rest: "休み",
      missed: "未達成",
      partial: "一部達成",
      done: "達成",
      over: "超過達成",
      deadline: "締切",
      "system-adjusted": "調整済み"
    },
    defaultGoalName: "作品全体の執筆目標",
    title: "執筆目標",
    subtitle: "執筆目標と統計",
    openProject: "先にプロジェクトを開いてください",
    openProjectHint: "現在のプロジェクトの文字数を基に執筆目標を計算します。",
    noGoal: "執筆目標はまだありません",
    refresh: "更新",
    editGoal: "目標を編集",
    resume: "再開",
    pause: "一時停止",
    createGoal: "目標を作成",
    remaining: (count: string) => `残り ${count} 文字`,
    noGoalLead: "毎日の執筆量を目標から計算します",
    currentTotal: (count: string) => `現在 ${count} 文字`,
    deadline: (date: string) => `、締切 ${date}`,
    noGoalHint: "。目標を作成すると日別の計画が生成されます。",
    neededToday: "今日の残り",
    todayPlan: (count: string) => `今日の予定 ${count} 文字`,
    remainingDays: "残りの執筆日",
    perDay: (count: string) => `1 日約 ${count} 文字`,
    estimated: "完了見込み",
    estimateHint: "直近 30 日の執筆ペースから推定",
    none: "未定",
    calendar: "カレンダー",
    done: "達成",
    partial: "一部",
    gap: "未達",
    plan: (count: number | string) => `予定 ${count}`,
    recentWriting: "最近の執筆",
    recentPace: "直近 14 日の執筆ペース",
    recentOverview: "直近 14 日の概要",
    netAdded: "純増",
    activeDays: (count: number) => `執筆 ${count} 日`,
    recentStats: "直近 14 日の執筆統計",
    today: "今",
    dailyAverage: "日平均",
    best: "最多",
    noRecentData: "章を保存すると、直近 14 日のペースがここに表示されます。",
    dayDetail: "日の詳細",
    selectDay: "カレンダーの日付を選択",
    selectDayHint: "その日の追加・削除文字数と対象の章を確認できます。",
    planned: "予定",
    added: "追加",
    deleted: "削除",
    noDayRecord: "この日の執筆記録はありません。",
    saveCount: (count: number) => `${count} 回保存`,
    createGoalKicker: "目標を作成",
    editGoalKicker: "目標を編集",
    createGoalHeading: "毎日の執筆量を計算します",
    editGoalHeading: "今後の計画を調整します",
    close: "閉じる",
    goalName: "目標名",
    totalWords: "作品全体の文字数",
    addFromToday: "今日からの追加分",
    targetWords: "目標文字数",
    startDate: "開始日",
    deadlineDate: "締切日",
    writingDays: "執筆する曜日",
    restDays: "休みの日",
    restPlaceholder: "任意：2026-05-20, 2026-05-21",
    archive: "目標をアーカイブ",
    saving: "保存中",
    saveGoal: "目標を保存",
    invalidTarget: "目標文字数は 100 文字以上にしてください。",
    chars: "文字",
    monthFallback: "今月"
  }
} as const;

type GoalPageCopy = (typeof goalPageCopy)[AppLocale];

function localDateKey(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function addDays(value: string, days: number): string {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function formatNumber(value: number, locale: AppLocale): string {
  return new Intl.NumberFormat(locale).format(value);
}

function formatShortDate(value: string, locale: AppLocale): string {
  const date = parseLocalDate(value);
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date);
}

function formatSignedNumber(value: number, locale: AppLocale): string {
  return `${value > 0 ? "+" : ""}${formatNumber(value, locale)}`;
}

function weekdayShortLabel(value: string, copy: GoalPageCopy): string {
  return copy.weekdays[parseLocalDate(value).getDay()] ?? "";
}

function monthTitle(days: readonly WritingCalendarDay[], locale: AppLocale, copy: GoalPageCopy): string {
  const first = days[0]?.localDate;
  if (!first) {
    return copy.monthFallback;
  }
  const date = parseLocalDate(first);
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(date);
}

function buildCalendarCells(days: readonly WritingCalendarDay[]): Array<WritingCalendarDay | null> {
  const first = days[0]?.localDate;
  const leading = first ? (parseLocalDate(first).getDay() + 6) % 7 : 0;
  return [...Array.from({ length: leading }, () => null), ...days];
}

function buildRecentTrendDays(stats: readonly WritingGoalOverview["recentStats"][number][], today: string) {
  const statsByDate = new Map(stats.map((stat) => [stat.localDate, stat]));
  return Array.from({ length: 14 }, (_, index) => {
    const localDate = addDays(today, index - 13);
    const stat = statsByDate.get(localDate);
    return {
      localDate,
      addedWords: stat?.addedWords ?? 0,
      deletedWords: stat?.deletedWords ?? 0,
      netWords: stat?.netWords ?? 0,
      eventCount: stat?.eventCount ?? 0
    };
  });
}

function parseRestDates(value: string): string[] {
  return [...new Set(value.split(/[,\s，、]+/).map((item) => item.trim()).filter(Boolean))];
}

function createDefaultForm(overview: WritingGoalOverview | null, defaultName: string): GoalFormState {
  const today = overview?.today.localDate ?? localDateKey();
  const current = overview?.currentTotalWordCount ?? 0;
  return {
    mode: "create",
    name: defaultName,
    goalType: "total_words",
    targetWordCount: String(Math.max(current + 50_000, 100_000)),
    startDate: today,
    deadlineDate: addDays(today, 30),
    activeWeekdays: [1, 2, 3, 4, 5, 6, 0],
    restDatesText: ""
  };
}

function createEditForm(goal: WritingGoalRecord): GoalFormState {
  return {
    mode: "edit",
    name: goal.name,
    goalType: goal.goalType,
    targetWordCount: String(goal.targetWordCount),
    startDate: goal.startDate,
    deadlineDate: goal.deadlineDate,
    activeWeekdays: goal.activeWeekdays,
    restDatesText: goal.restDates.join(", ")
  };
}

function DayDetailPanel({
  copy,
  detail,
  locale
}: {
  readonly copy: GoalPageCopy;
  readonly detail: WritingDayDetail | null;
  readonly locale: AppLocale;
}) {
  if (!detail) {
    return (
      <aside className="writing-goal-day-detail writing-goal-animate">
        <span className="writing-goal-panel-kicker">{copy.dayDetail}</span>
        <h2>{copy.selectDay}</h2>
        <p>{copy.selectDayHint}</p>
      </aside>
    );
  }
  const netWords = detail.stat?.netWords ?? 0;
  return (
    <aside className="writing-goal-day-detail writing-goal-animate">
      <div className="writing-goal-detail-head">
        <div>
          <span className="writing-goal-panel-kicker">{copy.dayDetail}</span>
          <h2>{formatShortDate(detail.localDate, locale)}</h2>
        </div>
        <strong className={netWords >= 0 ? "positive" : "negative"}>{netWords >= 0 ? "+" : ""}{formatNumber(netWords, locale)}</strong>
      </div>
      <div className="writing-goal-detail-metrics">
        <span>{copy.planned} {formatNumber(detail.plan?.plannedWords ?? 0, locale)}</span>
        <span>{copy.added} {formatNumber(detail.stat?.addedWords ?? 0, locale)}</span>
        <span>{copy.deleted} {formatNumber(detail.stat?.deletedWords ?? 0, locale)}</span>
      </div>
      <div className="writing-goal-event-list">
        {detail.chapterSummaries.length === 0 ? (
          <p className="writing-goal-muted">{copy.noDayRecord}</p>
        ) : (
          detail.chapterSummaries.map((chapter) => (
            <div className="writing-goal-event-row" key={`${chapter.chapterId ?? chapter.chapterTitle}:${chapter.eventCount}`}>
              <div>
                <strong>{chapter.chapterTitle}</strong>
                <span>{copy.saveCount(chapter.eventCount)}</span>
              </div>
              <b className={chapter.netWords >= 0 ? "positive" : "negative"}>{chapter.netWords >= 0 ? "+" : ""}{formatNumber(chapter.netWords, locale)}</b>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

export function WritingGoalsPage({
  currentProject,
  onOpenChapterReview,
  onOpenOutline,
  onOpenRelationshipGraph,
  onOpenSettings,
  onOpenWriting,
  onWelcome
}: WritingGoalsPageProps) {
  const api = useMemo(getNovelToolApi, []);
  const { locale } = useI18n();
  const copy = useLocalizedCopy(goalPageCopy);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const calendarRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const [overview, setOverview] = useState<WritingGoalOverview | null>(null);
  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [dayDetail, setDayDetail] = useState<WritingDayDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<GoalFormState | null>(null);

  const projectId = currentProject?.id ?? null;
  const calendarCells = useMemo(() => buildCalendarCells(overview?.calendarDays ?? []), [overview]);
  const recentTrendDays = useMemo(
    () => buildRecentTrendDays(overview?.recentStats ?? [], overview?.today.localDate ?? localDateKey()),
    [overview?.recentStats, overview?.today.localDate]
  );
  const trendTarget = Math.max(0, overview?.today.plannedWords ?? overview?.requiredPerDay ?? 0);
  const trendMax = Math.max(1, trendTarget, ...recentTrendDays.map((day) => Math.abs(day.netWords)));
  const targetTop = Math.round(18 + (1 - Math.min(1, trendTarget / trendMax)) * 112);
  const recentTotal = recentTrendDays.reduce((sum, day) => sum + day.netWords, 0);
  const activeRecentDays = recentTrendDays.filter((day) => day.eventCount > 0 || day.netWords !== 0).length;
  const bestRecentDay = recentTrendDays.reduce((best, day) => (day.netWords > best.netWords ? day : best), recentTrendDays[0] ?? null);
  const hasRecentTrendData = activeRecentDays > 0;

  const reload = useCallback(() => {
    if (!projectId) {
      setOverview(null);
      return;
    }
    setLoading(true);
    setError(null);
    void Promise.resolve(api.writingGoals.getOverview({ projectId }))
      .then((result) => {
        const nextOverview = result as WritingGoalOverview;
        setOverview(nextOverview);
        setSelectedDate((current) => current || nextOverview.today.localDate);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  }, [api, projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!projectId || !selectedDate) {
      setDayDetail(null);
      return;
    }
    void Promise.resolve(api.writingGoals.getDayDetail({ projectId, date: selectedDate }))
      .then((result) => setDayDetail(result as WritingDayDetail))
      .catch(() => setDayDetail(null));
  }, [api, projectId, selectedDate]);

  useEffect(() => {
    animateWritingGoalDashboard(rootRef.current);
  }, [overview?.goal?.id, overview?.currentTotalWordCount]);

  useEffect(() => {
    animateWritingGoalCalendar(calendarRef.current);
  }, [overview?.calendarDays]);

  function handleNavigate(module: ProjectModule): void {
    if (module === "writing") {
      onOpenWriting();
      return;
    }
    if (module === "relationshipGraph") {
      onOpenRelationshipGraph();
      return;
    }
    if (module === "outline") {
      onOpenOutline();
      return;
    }
    if (module === "chapterReview") {
      onOpenChapterReview();
      return;
    }
    if (module === "settings") {
      onOpenSettings();
    }
  }

  function updateForm(patch: Partial<GoalFormState>): void {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  function toggleWeekday(value: number): void {
    setForm((current) => {
      if (!current) {
        return current;
      }
      const exists = current.activeWeekdays.includes(value);
      const next = exists ? current.activeWeekdays.filter((item) => item !== value) : [...current.activeWeekdays, value];
      return {
        ...current,
        activeWeekdays: next.length > 0 ? next : current.activeWeekdays
      };
    });
  }

  function openCreateGoal(): void {
    setForm(createDefaultForm(overview, copy.defaultGoalName));
  }

  function openEditGoal(): void {
    if (overview?.goal) {
      setForm(createEditForm(overview.goal));
    }
  }

  function submitGoal(event: FormEvent): void {
    event.preventDefault();
    if (!projectId || !form) {
      return;
    }
    const targetWordCount = Number.parseInt(form.targetWordCount, 10);
    if (!Number.isFinite(targetWordCount) || targetWordCount < 100) {
      setError(copy.invalidTarget);
      return;
    }
    setSaving(true);
    setError(null);
    const restDates = parseRestDates(form.restDatesText);
    const action =
      form.mode === "create"
        ? api.writingGoals.createGoal({
            projectId,
            name: form.name,
            goalType: form.goalType,
            targetWordCount,
            startDate: form.startDate,
            deadlineDate: form.deadlineDate,
            activeWeekdays: [...form.activeWeekdays],
            restDates
          })
        : api.writingGoals.updateGoal({
            projectId,
            goalId: overview?.goal?.id ?? "",
            patch: {
              name: form.name,
              targetWordCount,
              deadlineDate: form.deadlineDate,
              activeWeekdays: [...form.activeWeekdays],
              restDates
            }
          });
    void Promise.resolve(action)
      .then(() => {
        setForm(null);
        reload();
        window.setTimeout(() => animateGoalSaved(progressRef.current), 80);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setSaving(false));
  }

  function setGoalStatus(action: "pause" | "resume" | "archive"): void {
    if (!projectId || !overview?.goal) {
      return;
    }
    setSaving(true);
    const input = { projectId, goalId: overview.goal.id };
    const request =
      action === "pause" ? api.writingGoals.pauseGoal(input) : action === "resume" ? api.writingGoals.resumeGoal(input) : api.writingGoals.archiveGoal(input);
    void Promise.resolve(request)
      .then(() => {
        if (action === "archive") {
          setForm(null);
        }
        reload();
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setSaving(false));
  }

  if (!currentProject) {
    return (
      <div className="writing-goals-page">
        <TopBar mode="writing" title={copy.title} searchPlaceholder={copy.subtitle} showEditorHistoryControls={false} showSaveStatus={false} showSearch={false} onSettings={onOpenSettings} onWelcome={onWelcome} />
        <main className="writing-goals-shell">
          <ProjectModuleRail activeModule="goals" onNavigate={handleNavigate} />
          <section className="writing-goals-empty">
            <Target size={38} />
            <h1>{copy.openProject}</h1>
            <p>{copy.openProjectHint}</p>
          </section>
        </main>
      </div>
    );
  }

  const goal = overview?.goal ?? null;
  const ratio = Math.round((overview?.completionRatio ?? 0) * 100);
  const progressStyle = { "--goal-progress": `${Math.min(100, ratio) * 3.6}deg` } as CSSProperties;

  return (
    <div className="writing-goals-page">
      <TopBar
        mode="writing"
        title={currentProject.name}
        searchValue=""
        searchPlaceholder={copy.subtitle}
        showEditorHistoryControls={false}
        showSaveStatus={false}
        showSearch={false}
        onSearchChange={undefined}
        onSettings={onOpenSettings}
        onWelcome={onWelcome}
      />
      <main className="writing-goals-shell">
        <ProjectModuleRail activeModule="goals" onNavigate={handleNavigate} />
        <section className="writing-goals-workspace" ref={rootRef} aria-label={copy.subtitle}>
          <div className="writing-goals-toolbar writing-goal-animate">
            <div>
              <span className="writing-goal-panel-kicker">{copy.title}</span>
              <h1>{goal?.name ?? copy.noGoal}</h1>
            </div>
            <div className="writing-goal-actions">
              <button className="secondary-button" onClick={reload} disabled={loading} type="button">
                <ArrowClockwise size={18} />{copy.refresh}
              </button>
              {goal ? (
                <>
                  <button className="secondary-button" onClick={openEditGoal} type="button">
                    <NotePencil size={18} />{copy.editGoal}
                  </button>
                  {goal.status === "paused" ? (
                    <button className="primary-button" onClick={() => setGoalStatus("resume")} disabled={saving} type="button">
                      <Play size={18} />{copy.resume}
                    </button>
                  ) : (
                    <button className="secondary-button" onClick={() => setGoalStatus("pause")} disabled={saving} type="button">
                      <Pause size={18} />{copy.pause}
                    </button>
                  )}
                </>
              ) : (
                <button className="primary-button" onClick={openCreateGoal} type="button">
                  <Plus size={18} />{copy.createGoal}
                </button>
              )}
            </div>
          </div>

          {error ? <div className="writing-goal-error">{error}</div> : null}
          {overview?.warning ? <div className="writing-goal-warning">{overview.warning}</div> : null}

          <div className="writing-goals-grid">
            <section className="writing-goal-overview-card writing-goal-animate" ref={progressRef}>
              <div className="writing-goal-ring" style={progressStyle}>
                <span>{ratio}%</span>
              </div>
              <div className="writing-goal-overview-copy">
                <span className={`writing-goal-pace ${overview?.paceStatus ?? "no_goal"}`}>{copy.pace[overview?.paceStatus ?? "no_goal"]}</span>
                <h2>{goal ? copy.remaining(formatNumber(overview?.remainingWords ?? 0, locale)) : copy.noGoalLead}</h2>
                <p>
                  {copy.currentTotal(formatNumber(overview?.currentTotalWordCount ?? 0, locale))}
                  {goal ? copy.deadline(goal.deadlineDate) : copy.noGoalHint}
                </p>
              </div>
            </section>

            <section className="writing-goal-stat-card writing-goal-animate">
              <ClockCountdown size={24} />
              <span>{copy.neededToday}</span>
              <strong>{formatNumber(overview?.today.remainingTodayWords ?? 0, locale)}</strong>
              <small>{copy.todayPlan(formatNumber(overview?.today.plannedWords ?? 0, locale))}</small>
            </section>
            <section className="writing-goal-stat-card writing-goal-animate">
              <CalendarBlank size={24} />
              <span>{copy.remainingDays}</span>
              <strong>{formatNumber(overview?.remainingWritingDays ?? 0, locale)}</strong>
              <small>{copy.perDay(formatNumber(overview?.requiredPerDay ?? 0, locale))}</small>
            </section>
            <section className="writing-goal-stat-card writing-goal-animate">
              <TrendUp size={24} />
              <span>{copy.estimated}</span>
              <strong>{overview?.estimatedCompletionDate ? formatShortDate(overview.estimatedCompletionDate, locale) : copy.none}</strong>
              <small>{copy.estimateHint}</small>
            </section>
          </div>

          <div className="writing-goals-content">
            <section className="writing-calendar-panel writing-goal-animate">
              <div className="writing-calendar-head">
                <div>
                  <span className="writing-goal-panel-kicker">{copy.calendar}</span>
                  <h2>{monthTitle(overview?.calendarDays ?? [], locale, copy)}</h2>
                </div>
                <div className="writing-calendar-legend">
                  <span className="done">{copy.done}</span>
                  <span className="partial">{copy.partial}</span>
                  <span className="missed">{copy.gap}</span>
                </div>
              </div>
              <div className="writing-calendar-weekdays">
                {[1, 2, 3, 4, 5, 6, 0].map((day) => <span key={day}>{copy.weekdays[day]}</span>)}
              </div>
              <div className="writing-calendar-grid" ref={calendarRef}>
                {calendarCells.map((day, index) =>
                  day ? (
                    <button
                      className={`writing-calendar-day ${day.status} ${day.localDate === selectedDate ? "selected" : ""}`}
                      key={day.localDate}
                      onClick={() => setSelectedDate(day.localDate)}
                      type="button"
                    >
                      <span className="writing-calendar-date">{parseLocalDate(day.localDate).getDate()}</span>
                      <b>{day.netWords > 0 ? "+" : ""}{day.netWords}</b>
                      <small>{day.plannedWords > 0 ? copy.plan(day.plannedWords) : copy.status[day.status]}</small>
                    </button>
                  ) : (
                    <span className="writing-calendar-day blank" key={`blank-${index}`} />
                  )
                )}
              </div>
            </section>

            <section className="writing-goal-trend-panel writing-goal-animate">
              <div className="writing-calendar-head">
                <div>
                  <span className="writing-goal-panel-kicker">{copy.recentWriting}</span>
                  <h2>{copy.recentPace}</h2>
                </div>
                <div className="writing-trend-summary" aria-label={copy.recentOverview}>
                  <span>{copy.netAdded} <strong className={recentTotal >= 0 ? "positive" : "negative"}>{formatSignedNumber(recentTotal, locale)}</strong></span>
                  <span>{copy.activeDays(activeRecentDays)}</span>
                </div>
              </div>
              <div
                className={`writing-goal-trend-chart ${hasRecentTrendData ? "" : "empty"}`}
                aria-label={copy.recentStats}
                style={{ "--target-top": `${targetTop}px` } as CSSProperties}
              >
                {trendTarget > 0 ? (
                  <div className="writing-trend-target-line" aria-hidden="true">
                    <span>{copy.todayPlan(formatNumber(trendTarget, locale))}</span>
                  </div>
                ) : null}
                <div className="writing-trend-zero-line" aria-hidden="true" />
                <div className="writing-trend-days">
                  {recentTrendDays.map((day) => {
                    const positiveHeight = day.netWords > 0 ? Math.max(8, Math.round((day.netWords / trendMax) * 100)) : 0;
                    const negativeHeight = day.netWords < 0 ? Math.max(8, Math.round((Math.abs(day.netWords) / trendMax) * 100)) : 0;
                    const status =
                      day.netWords < 0 ? "negative" : trendTarget > 0 && day.netWords >= trendTarget ? "hit" : day.netWords > 0 ? "partial" : "quiet";
                    const isSelected = day.localDate === selectedDate;
                    const isToday = day.localDate === overview?.today.localDate;
                    return (
                    <button
                      className={`writing-trend-day ${status} ${isSelected ? "selected" : ""} ${isToday ? "today" : ""}`}
                      key={day.localDate}
                      onClick={() => setSelectedDate(day.localDate)}
                      style={{
                        "--positive-height": `${positiveHeight}%`,
                        "--negative-height": `${negativeHeight}%`
                      } as CSSProperties}
                      title={`${day.localDate} ${formatSignedNumber(day.netWords, locale)} ${copy.chars}，${copy.added} ${formatNumber(day.addedWords, locale)}，${copy.deleted} ${formatNumber(day.deletedWords, locale)}`}
                      type="button"
                    >
                      <span className="writing-trend-value">{day.netWords !== 0 ? formatSignedNumber(day.netWords, locale) : ""}</span>
                      <span className="writing-trend-bar-stack" aria-hidden="true">
                        <span className="writing-trend-positive-zone">
                          <span className="writing-trend-positive-bar" />
                        </span>
                        <span className="writing-trend-baseline-dot" />
                        <span className="writing-trend-negative-zone">
                          <span className="writing-trend-negative-bar" />
                        </span>
                      </span>
                      <small>
                        <b>{isToday ? copy.today : parseLocalDate(day.localDate).getDate()}</b>
                        <span>{weekdayShortLabel(day.localDate, copy)}</span>
                      </small>
                    </button>
                    );
                  })}
                </div>
              </div>
              <div className="writing-trend-foot">
                {hasRecentTrendData ? (
                  <>
                    <span>{copy.dailyAverage} {formatSignedNumber(Math.round(recentTotal / 14), locale)} {copy.chars}</span>
                    <span>{copy.best} {bestRecentDay ? `${formatShortDate(bestRecentDay.localDate, locale)} ${formatSignedNumber(bestRecentDay.netWords, locale)}` : copy.none}</span>
                  </>
                ) : (
                  <span>{copy.noRecentData}</span>
                )}
              </div>
            </section>
          </div>
        </section>
        <DayDetailPanel copy={copy} detail={dayDetail} locale={locale} />
      </main>

      {form ? (
        <div className="writing-goal-form-backdrop" role="presentation">
          <form className="writing-goal-form" onSubmit={submitGoal}>
            <div className="writing-goal-form-head">
              <div>
                <span className="writing-goal-panel-kicker">{form.mode === "create" ? copy.createGoalKicker : copy.editGoalKicker}</span>
                <h2>{form.mode === "create" ? copy.createGoalHeading : copy.editGoalHeading}</h2>
              </div>
              <button aria-label={copy.close} onClick={() => setForm(null)} type="button">×</button>
            </div>
            <label>
              <span>{copy.goalName}</span>
              <input value={form.name} onChange={(event) => updateForm({ name: event.target.value })} />
            </label>
            {form.mode === "create" ? (
              <div className="writing-goal-type-switch">
                <button className={form.goalType === "total_words" ? "active" : ""} onClick={() => updateForm({ goalType: "total_words" })} type="button">
                  {copy.totalWords}
                </button>
                <button className={form.goalType === "added_words" ? "active" : ""} onClick={() => updateForm({ goalType: "added_words" })} type="button">
                  {copy.addFromToday}
                </button>
              </div>
            ) : null}
            <label>
              <span>{copy.targetWords}</span>
              <input min={100} step={100} type="number" value={form.targetWordCount} onChange={(event) => updateForm({ targetWordCount: event.target.value })} />
            </label>
            <div className="writing-goal-form-row">
              <label>
                <span>{copy.startDate}</span>
                <input disabled={form.mode === "edit"} type="date" value={form.startDate} onChange={(event) => updateForm({ startDate: event.target.value })} />
              </label>
              <label>
                <span>{copy.deadlineDate}</span>
                <input type="date" value={form.deadlineDate} onChange={(event) => updateForm({ deadlineDate: event.target.value })} />
              </label>
            </div>
            <div className="writing-goal-weekdays" aria-label={copy.writingDays}>
              {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                <button
                  className={form.activeWeekdays.includes(day) ? "active" : ""}
                  key={day}
                  onClick={() => toggleWeekday(day)}
                  type="button"
                >
                  {copy.weekdays[day]}
                </button>
              ))}
            </div>
            <label>
              <span>{copy.restDays}</span>
              <input
                placeholder={copy.restPlaceholder}
                value={form.restDatesText}
                onChange={(event) => updateForm({ restDatesText: event.target.value })}
              />
            </label>
            <div className="writing-goal-form-actions">
              {form.mode === "edit" ? (
                <button className="danger-button" disabled={saving} onClick={() => setGoalStatus("archive")} type="button">
                  {copy.archive}
                </button>
              ) : <span />}
              <button className="primary-button" disabled={saving} type="submit">
                <CheckCircle size={18} />{saving ? copy.saving : copy.saveGoal}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
