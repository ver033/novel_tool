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
import { ProjectModuleRail, type ProjectModule } from "../layout/ProjectModuleRail";
import { TopBar } from "../layout/TopBar";
import { getNovelToolApi } from "../state/app-store";
import { animateGoalSaved, animateWritingGoalCalendar, animateWritingGoalDashboard } from "./writing-goal-animations";

type WritingGoalsPageProps = {
  readonly currentProject: ProjectRecord | null;
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

const weekdayOptions = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" }
] as const;

const paceText: Record<WritingGoalOverview["paceStatus"], string> = {
  no_goal: "未设置目标",
  ahead: "进度领先",
  on_track: "节奏正常",
  behind: "需要加速",
  completed: "目标完成",
  overdue: "已超期",
  paused: "目标暂停"
};

const statusText: Record<WritingCalendarDay["status"], string> = {
  "no-data": "未记录",
  rest: "休息",
  missed: "未完成",
  partial: "部分完成",
  done: "完成",
  over: "超额",
  deadline: "截止",
  "system-adjusted": "校准"
};

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

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatShortDate(value: string): string {
  const date = parseLocalDate(value);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatSignedNumber(value: number): string {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function weekdayShortLabel(value: string): string {
  const labels = ["日", "一", "二", "三", "四", "五", "六"];
  return labels[parseLocalDate(value).getDay()] ?? "";
}

function monthTitle(days: readonly WritingCalendarDay[]): string {
  const first = days[0]?.localDate;
  if (!first) {
    return "本月";
  }
  const date = parseLocalDate(first);
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
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

function createDefaultForm(overview: WritingGoalOverview | null): GoalFormState {
  const today = overview?.today.localDate ?? localDateKey();
  const current = overview?.currentTotalWordCount ?? 0;
  return {
    mode: "create",
    name: "全书写作目标",
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

function DayDetailPanel({ detail }: { readonly detail: WritingDayDetail | null }) {
  if (!detail) {
    return (
      <aside className="writing-goal-day-detail writing-goal-animate">
        <span className="writing-goal-panel-kicker">日详情</span>
        <h2>选择日历中的一天</h2>
        <p>查看当天新增、删减和涉及的章节。</p>
      </aside>
    );
  }
  const netWords = detail.stat?.netWords ?? 0;
  return (
    <aside className="writing-goal-day-detail writing-goal-animate">
      <div className="writing-goal-detail-head">
        <div>
          <span className="writing-goal-panel-kicker">日详情</span>
          <h2>{formatShortDate(detail.localDate)}</h2>
        </div>
        <strong className={netWords >= 0 ? "positive" : "negative"}>{netWords >= 0 ? "+" : ""}{formatNumber(netWords)}</strong>
      </div>
      <div className="writing-goal-detail-metrics">
        <span>计划 {formatNumber(detail.plan?.plannedWords ?? 0)}</span>
        <span>新增 {formatNumber(detail.stat?.addedWords ?? 0)}</span>
        <span>删减 {formatNumber(detail.stat?.deletedWords ?? 0)}</span>
      </div>
      <div className="writing-goal-event-list">
        {detail.chapterSummaries.length === 0 ? (
          <p className="writing-goal-muted">这一天还没有写作记录。</p>
        ) : (
          detail.chapterSummaries.map((chapter) => (
            <div className="writing-goal-event-row" key={`${chapter.chapterId ?? chapter.chapterTitle}:${chapter.eventCount}`}>
              <div>
                <strong>{chapter.chapterTitle}</strong>
                <span>{chapter.eventCount} 次保存</span>
              </div>
              <b className={chapter.netWords >= 0 ? "positive" : "negative"}>{chapter.netWords >= 0 ? "+" : ""}{formatNumber(chapter.netWords)}</b>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

export function WritingGoalsPage({
  currentProject,
  onOpenOutline,
  onOpenRelationshipGraph,
  onOpenSettings,
  onOpenWriting,
  onWelcome
}: WritingGoalsPageProps) {
  const api = useMemo(getNovelToolApi, []);
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
    setForm(createDefaultForm(overview));
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
      setError("目标字数至少为 100。");
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
        <TopBar mode="writing" title="写作目标" searchPlaceholder="写作目标和统计" showEditorHistoryControls={false} showSaveStatus={false} showSearch={false} onSettings={onOpenSettings} onWelcome={onWelcome} />
        <main className="writing-goals-shell">
          <ProjectModuleRail activeModule="goals" onNavigate={handleNavigate} />
          <section className="writing-goals-empty">
            <Target size={38} />
            <h1>先打开一个项目</h1>
            <p>写作目标会根据当前项目的章节字数动态计算。</p>
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
        searchPlaceholder="写作目标和统计"
        showEditorHistoryControls={false}
        showSaveStatus={false}
        showSearch={false}
        onSearchChange={undefined}
        onSettings={onOpenSettings}
        onWelcome={onWelcome}
      />
      <main className="writing-goals-shell">
        <ProjectModuleRail activeModule="goals" onNavigate={handleNavigate} />
        <section className="writing-goals-workspace" ref={rootRef} aria-label="写作目标与统计">
          <div className="writing-goals-toolbar writing-goal-animate">
            <div>
              <span className="writing-goal-panel-kicker">写作目标</span>
              <h1>{goal?.name ?? "还没有写作目标"}</h1>
            </div>
            <div className="writing-goal-actions">
              <button className="secondary-button" onClick={reload} disabled={loading} type="button">
                <ArrowClockwise size={18} />刷新
              </button>
              {goal ? (
                <>
                  <button className="secondary-button" onClick={openEditGoal} type="button">
                    <NotePencil size={18} />编辑目标
                  </button>
                  {goal.status === "paused" ? (
                    <button className="primary-button" onClick={() => setGoalStatus("resume")} disabled={saving} type="button">
                      <Play size={18} />继续
                    </button>
                  ) : (
                    <button className="secondary-button" onClick={() => setGoalStatus("pause")} disabled={saving} type="button">
                      <Pause size={18} />暂停
                    </button>
                  )}
                </>
              ) : (
                <button className="primary-button" onClick={openCreateGoal} type="button">
                  <Plus size={18} />新建目标
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
                <span className={`writing-goal-pace ${overview?.paceStatus ?? "no_goal"}`}>{paceText[overview?.paceStatus ?? "no_goal"]}</span>
                <h2>{goal ? `还差 ${formatNumber(overview?.remainingWords ?? 0)} 字` : "用目标把每天该写多少算清楚"}</h2>
                <p>
                  当前全书 {formatNumber(overview?.currentTotalWordCount ?? 0)} 字
                  {goal ? `，截止 ${goal.deadlineDate}` : "，创建目标后会自动生成每日计划。"}
                </p>
              </div>
            </section>

            <section className="writing-goal-stat-card writing-goal-animate">
              <ClockCountdown size={24} />
              <span>今天还需</span>
              <strong>{formatNumber(overview?.today.remainingTodayWords ?? 0)}</strong>
              <small>今日计划 {formatNumber(overview?.today.plannedWords ?? 0)} 字</small>
            </section>
            <section className="writing-goal-stat-card writing-goal-animate">
              <CalendarBlank size={24} />
              <span>剩余写作日</span>
              <strong>{formatNumber(overview?.remainingWritingDays ?? 0)}</strong>
              <small>每天约 {formatNumber(overview?.requiredPerDay ?? 0)} 字</small>
            </section>
            <section className="writing-goal-stat-card writing-goal-animate">
              <TrendUp size={24} />
              <span>预计完成</span>
              <strong>{overview?.estimatedCompletionDate ? formatShortDate(overview.estimatedCompletionDate) : "暂无"}</strong>
              <small>按近 30 天正向写作估算</small>
            </section>
          </div>

          <div className="writing-goals-content">
            <section className="writing-calendar-panel writing-goal-animate">
              <div className="writing-calendar-head">
                <div>
                  <span className="writing-goal-panel-kicker">日历</span>
                  <h2>{monthTitle(overview?.calendarDays ?? [])}</h2>
                </div>
                <div className="writing-calendar-legend">
                  <span className="done">完成</span>
                  <span className="partial">部分</span>
                  <span className="missed">缺口</span>
                </div>
              </div>
              <div className="writing-calendar-weekdays">
                {weekdayOptions.map((day) => <span key={day.value}>周{day.label}</span>)}
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
                      <small>{day.plannedWords > 0 ? `计划 ${day.plannedWords}` : statusText[day.status]}</small>
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
                  <span className="writing-goal-panel-kicker">近期写作</span>
                  <h2>近 14 天写作节奏</h2>
                </div>
                <div className="writing-trend-summary" aria-label="近 14 天概览">
                  <span>净增 <strong className={recentTotal >= 0 ? "positive" : "negative"}>{formatSignedNumber(recentTotal)}</strong></span>
                  <span>活跃 {activeRecentDays} 天</span>
                </div>
              </div>
              <div
                className={`writing-goal-trend-chart ${hasRecentTrendData ? "" : "empty"}`}
                aria-label="近 14 天写作统计"
                style={{ "--target-top": `${targetTop}px` } as CSSProperties}
              >
                {trendTarget > 0 ? (
                  <div className="writing-trend-target-line" aria-hidden="true">
                    <span>今日计划 {formatNumber(trendTarget)}</span>
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
                      title={`${day.localDate} ${formatSignedNumber(day.netWords)} 字，新增 ${formatNumber(day.addedWords)}，删减 ${formatNumber(day.deletedWords)}`}
                      type="button"
                    >
                      <span className="writing-trend-value">{day.netWords !== 0 ? formatSignedNumber(day.netWords) : ""}</span>
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
                        <b>{isToday ? "今" : parseLocalDate(day.localDate).getDate()}</b>
                        <span>周{weekdayShortLabel(day.localDate)}</span>
                      </small>
                    </button>
                    );
                  })}
                </div>
              </div>
              <div className="writing-trend-foot">
                {hasRecentTrendData ? (
                  <>
                    <span>日均 {formatSignedNumber(Math.round(recentTotal / 14))} 字</span>
                    <span>最高 {bestRecentDay ? `${formatShortDate(bestRecentDay.localDate)} ${formatSignedNumber(bestRecentDay.netWords)}` : "暂无"}</span>
                  </>
                ) : (
                  <span>保存章节后，这里会显示连续 14 天的节奏。</span>
                )}
              </div>
            </section>
          </div>
        </section>
        <DayDetailPanel detail={dayDetail} />
      </main>

      {form ? (
        <div className="writing-goal-form-backdrop" role="presentation">
          <form className="writing-goal-form" onSubmit={submitGoal}>
            <div className="writing-goal-form-head">
              <div>
                <span className="writing-goal-panel-kicker">{form.mode === "create" ? "创建目标" : "编辑目标"}</span>
                <h2>{form.mode === "create" ? "让系统开始计算每天该写多少" : "调整未来计划"}</h2>
              </div>
              <button aria-label="关闭" onClick={() => setForm(null)} type="button">×</button>
            </div>
            <label>
              <span>目标名称</span>
              <input value={form.name} onChange={(event) => updateForm({ name: event.target.value })} />
            </label>
            {form.mode === "create" ? (
              <div className="writing-goal-type-switch">
                <button className={form.goalType === "total_words" ? "active" : ""} onClick={() => updateForm({ goalType: "total_words" })} type="button">
                  全书总字数
                </button>
                <button className={form.goalType === "added_words" ? "active" : ""} onClick={() => updateForm({ goalType: "added_words" })} type="button">
                  从今天新增
                </button>
              </div>
            ) : null}
            <label>
              <span>目标字数</span>
              <input min={100} step={100} type="number" value={form.targetWordCount} onChange={(event) => updateForm({ targetWordCount: event.target.value })} />
            </label>
            <div className="writing-goal-form-row">
              <label>
                <span>开始日期</span>
                <input disabled={form.mode === "edit"} type="date" value={form.startDate} onChange={(event) => updateForm({ startDate: event.target.value })} />
              </label>
              <label>
                <span>截止日期</span>
                <input type="date" value={form.deadlineDate} onChange={(event) => updateForm({ deadlineDate: event.target.value })} />
              </label>
            </div>
            <div className="writing-goal-weekdays" aria-label="写作日">
              {weekdayOptions.map((day) => (
                <button
                  className={form.activeWeekdays.includes(day.value) ? "active" : ""}
                  key={day.value}
                  onClick={() => toggleWeekday(day.value)}
                  type="button"
                >
                  周{day.label}
                </button>
              ))}
            </div>
            <label>
              <span>休息日</span>
              <input
                placeholder="可选，例如 2026-05-20, 2026-05-21"
                value={form.restDatesText}
                onChange={(event) => updateForm({ restDatesText: event.target.value })}
              />
            </label>
            <div className="writing-goal-form-actions">
              {form.mode === "edit" ? (
                <button className="danger-button" disabled={saving} onClick={() => setGoalStatus("archive")} type="button">
                  归档目标
                </button>
              ) : <span />}
              <button className="primary-button" disabled={saving} type="submit">
                <CheckCircle size={18} />{saving ? "保存中" : "保存目标"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
