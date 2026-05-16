import { WritingGoalRepository, type WritingDailyPlanInsert, type WritingWordEventInsert } from "../db/repositories/writing-goal-repo";
import { createId } from "../shared/ids";
import type {
  WritingCalendarDay,
  WritingDailyPlan,
  WritingDailyStat,
  WritingDayDetail,
  WritingGoalCreateInput,
  WritingGoalOverview,
  WritingGoalRecord,
  WritingGoalStatusInput,
  WritingGoalUpdateInput,
  WritingWordEventRecord,
  WritingWordEventSource
} from "../shared/types";

export type WritingGoalRecordDeltaInput = {
  readonly projectId: string;
  readonly chapterId?: string | null;
  readonly chapterTitle?: string | null;
  readonly chapterSortOrder?: number | null;
  readonly previousWordCount: number;
  readonly nextWordCount: number;
  readonly previousProjectWordCount: number;
  readonly nextProjectWordCount: number;
  readonly source?: WritingWordEventSource;
  readonly now?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function localDateKey(value: Date = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function formatLocalDate(value: Date): string {
  return localDateKey(value);
}

function addDays(value: string, days: number): string {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}

function listDates(from: string, to: string): string[] {
  if (from > to) {
    return [];
  }
  const dates: string[] = [];
  const current = parseLocalDate(from);
  const end = parseLocalDate(to);
  while (current <= end) {
    dates.push(formatLocalDate(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function getWeekday(localDate: string): number {
  return parseLocalDate(localDate).getDay();
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function calculateProgress(goal: WritingGoalRecord | null, currentTotalWordCount: number) {
  if (!goal) {
    return {
      progressWords: currentTotalWordCount,
      remainingWords: 0,
      completionRatio: 0
    };
  }
  const progressWords =
    goal.goalType === "added_words" ? Math.max(0, currentTotalWordCount - goal.baselineWordCount) : currentTotalWordCount;
  const remainingWords = Math.max(0, goal.targetWordCount - progressWords);
  return {
    progressWords,
    remainingWords,
    completionRatio: clampRatio(progressWords / Math.max(1, goal.targetWordCount))
  };
}

function isPlannedWritingDate(goal: WritingGoalRecord, localDate: string): { readonly isWritingDay: boolean; readonly isRestDay: boolean } {
  const isRestDay = goal.restDates.includes(localDate);
  return {
    isWritingDay: !isRestDay && goal.activeWeekdays.includes(getWeekday(localDate)),
    isRestDay
  };
}

function countWritingPlanDays(goal: WritingGoalRecord, from: string, to: string): number {
  return listDates(from, to).filter((date) => isPlannedWritingDate(goal, date).isWritingDay).length;
}

function mapStatsByDate(stats: readonly WritingDailyStat[]): Map<string, WritingDailyStat> {
  return new Map(stats.map((stat) => [stat.localDate, stat]));
}

function mapPlansByDate(plans: readonly WritingDailyPlan[]): Map<string, WritingDailyPlan> {
  return new Map(plans.map((plan) => [plan.localDate, plan]));
}

function calendarStatus(input: {
  readonly localDate: string;
  readonly today: string;
  readonly plan: WritingDailyPlan | null;
  readonly stat: WritingDailyStat | null;
  readonly isDeadline: boolean;
  readonly hasSystemEvent: boolean;
}): WritingCalendarDay["status"] {
  if (input.hasSystemEvent) {
    return "system-adjusted";
  }
  if (input.isDeadline) {
    return "deadline";
  }
  if (input.plan?.isRestDay) {
    return "rest";
  }
  if (!input.plan?.isWritingDay) {
    return input.stat && input.stat.netWords !== 0 ? "done" : "no-data";
  }
  if (input.localDate > input.today) {
    return "no-data";
  }
  const planned = input.plan.plannedWords;
  const net = input.stat?.netWords ?? 0;
  if (net === 0) {
    return "missed";
  }
  if (planned > 0 && net >= planned * 1.5) {
    return "over";
  }
  if (planned > 0 && net >= planned) {
    return "done";
  }
  return "partial";
}

export class WritingGoalService {
  constructor(private readonly repo: WritingGoalRepository) {}

  getOverview(projectId: string, today = localDateKey()): WritingGoalOverview {
    let warning: string | null = null;
    try {
      this.ensureStatsReconciled(projectId, today);
    } catch (error) {
      warning = error instanceof Error ? error.message : String(error);
    }

    const currentTotalWordCount = this.repo.getProjectWordCount(projectId);
    const goal = this.repo.getActiveOrPausedGoal(projectId);
    if (goal?.status === "active") {
      const refreshFrom = today < goal.startDate ? goal.startDate : today;
      if (refreshFrom <= goal.deadlineDate) {
        this.rebuildPlans(goal, refreshFrom, nowIso());
      }
    }
    const { progressWords, remainingWords, completionRatio } = calculateProgress(goal, currentTotalWordCount);
    const monthStart = `${today.slice(0, 8)}01`;
    const monthEnd = formatLocalDate(new Date(parseLocalDate(monthStart).getFullYear(), parseLocalDate(monthStart).getMonth() + 1, 0));
    const recentStart = addDays(today, -29);
    const stats = this.repo.listDailyStats(projectId, recentStart, monthEnd > today ? monthEnd : today);
    const plans = goal ? this.repo.listDailyPlans(projectId, monthStart < recentStart ? monthStart : recentStart, monthEnd) : [];
    const statsByDate = mapStatsByDate(stats);
    const plansByDate = mapPlansByDate(plans);
    const todayStat = statsByDate.get(today);
    const todayPlan = goal ? this.repo.getDailyPlan(projectId, goal.id, today) : null;
    const remainingWritingDays = goal?.status === "active" ? countWritingPlanDays(goal, today, goal.deadlineDate) : 0;
    const futureWritingDays = goal?.status === "active" ? countWritingPlanDays(goal, addDays(today, 1), goal.deadlineDate) : 0;
    const requiredPerDay = remainingWritingDays > 0 ? Math.ceil(remainingWords / remainingWritingDays) : remainingWords;
    const futureRequiredPerDay = futureWritingDays > 0 ? Math.ceil(remainingWords / futureWritingDays) : remainingWords;
    const todayNet = todayStat?.netWords ?? 0;
    const todayPlanned = todayPlan?.plannedWords ?? 0;
    const recentStats = this.repo.listDailyStats(projectId, recentStart, today);
    const calendarDays = this.buildCalendarDays(projectId, goal, monthStart, monthEnd, today, statsByDate, plansByDate);
    const estimatedCompletionDate = this.estimateCompletionDate(recentStats, remainingWords, today);
    const paceStatus = this.getPaceStatus(goal, remainingWords, today, todayNet, todayPlanned, remainingWritingDays);

    return {
      projectId,
      currentTotalWordCount,
      goal,
      progressWords,
      remainingWords,
      completionRatio,
      today: {
        localDate: today,
        plannedWords: todayPlanned,
        netWords: todayNet,
        addedWords: todayStat?.addedWords ?? 0,
        deletedWords: todayStat?.deletedWords ?? 0,
        remainingTodayWords: Math.max(0, todayPlanned - todayNet)
      },
      remainingWritingDays,
      requiredPerDay,
      futureRequiredPerDay,
      paceStatus,
      estimatedCompletionDate,
      recentStats,
      calendarDays,
      warning
    };
  }

  createGoal(input: WritingGoalCreateInput): WritingGoalRecord {
    const existing = this.repo.getActiveOrPausedGoal(input.projectId);
    if (existing) {
      throw new Error("已有进行中的写作目标，请先归档或编辑当前目标。");
    }
    const now = nowIso();
    const currentTotalWordCount = this.repo.getProjectWordCount(input.projectId);
    const goal = this.repo.createGoal({
      id: createId("writing_goal"),
      projectId: input.projectId,
      name: input.name?.trim() || "全书写作目标",
      goalType: input.goalType,
      targetWordCount: input.targetWordCount,
      baselineWordCount: currentTotalWordCount,
      startDate: input.startDate,
      deadlineDate: input.deadlineDate,
      activeWeekdays: uniqueNumbers(input.activeWeekdays),
      restDates: uniqueStrings(input.restDates ?? []),
      status: "active",
      completedAt: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now
    });
    this.rebuildPlans(goal, goal.startDate, now);
    return goal;
  }

  updateGoal(input: WritingGoalUpdateInput): WritingGoalRecord {
    const current = this.repo.getGoal(input.projectId, input.goalId);
    if (!current) {
      throw new Error("写作目标不存在。");
    }
    if (current.status !== "active" && current.status !== "paused") {
      throw new Error("只能编辑进行中或暂停中的写作目标。");
    }
    const deadlineDate = input.patch.deadlineDate ?? current.deadlineDate;
    if (deadlineDate < current.startDate) {
      throw new Error("截止日期不能早于开始日期。");
    }
    const now = nowIso();
    const goal = this.repo.updateGoal(input.projectId, input.goalId, {
      name: input.patch.name,
      targetWordCount: input.patch.targetWordCount,
      deadlineDate: input.patch.deadlineDate,
      activeWeekdays: input.patch.activeWeekdays ? uniqueNumbers(input.patch.activeWeekdays) : undefined,
      restDates: input.patch.restDates ? uniqueStrings(input.patch.restDates) : undefined,
      updatedAt: now
    });
    this.rebuildPlans(goal, localDateKey(), now);
    return goal;
  }

  pauseGoal(input: WritingGoalStatusInput): WritingGoalRecord {
    const now = nowIso();
    const goal = this.repo.setGoalStatus(input.projectId, input.goalId, "paused", now);
    this.rebuildPlans(goal, localDateKey(), now);
    return goal;
  }

  resumeGoal(input: WritingGoalStatusInput): WritingGoalRecord {
    const now = nowIso();
    const goal = this.repo.setGoalStatus(input.projectId, input.goalId, "active", now);
    this.rebuildPlans(goal, localDateKey(), now);
    return goal;
  }

  archiveGoal(input: WritingGoalStatusInput): WritingGoalRecord {
    return this.repo.setGoalStatus(input.projectId, input.goalId, "archived", nowIso());
  }

  listDailyStats(input: { readonly projectId: string; readonly from: string; readonly to: string }): readonly WritingDailyStat[] {
    return this.repo.listDailyStats(input.projectId, input.from, input.to);
  }

  getDayDetail(input: { readonly projectId: string; readonly date: string }): WritingDayDetail {
    const goal = this.repo.getActiveOrPausedGoal(input.projectId);
    const plan = goal ? this.repo.getDailyPlan(input.projectId, goal.id, input.date) : null;
    const stat = this.repo.getDailyStat(input.projectId, input.date);
    const events = this.repo.getDayEvents(input.projectId, input.date);
    return {
      projectId: input.projectId,
      localDate: input.date,
      plan,
      stat,
      events,
      chapterSummaries: groupEventsByChapter(events)
    };
  }

  recordWordDelta(input: WritingGoalRecordDeltaInput): WritingWordEventRecord | null {
    const deltaWords = input.nextWordCount - input.previousWordCount;
    if (deltaWords === 0) {
      return null;
    }
    const now = input.now ?? nowIso();
    const activeGoal = this.repo.getActiveOrPausedGoal(input.projectId);
    const event: WritingWordEventInsert = {
      id: createId("writing_event"),
      projectId: input.projectId,
      goalId: activeGoal?.id ?? null,
      chapterId: input.chapterId ?? null,
      chapterTitle: input.chapterTitle ?? null,
      chapterSortOrder: input.chapterSortOrder ?? null,
      localDate: localDateKey(new Date(now)),
      deltaWords,
      addedWords: Math.max(0, deltaWords),
      deletedWords: Math.max(0, -deltaWords),
      previousWordCount: input.previousWordCount,
      nextWordCount: input.nextWordCount,
      previousProjectWordCount: input.previousProjectWordCount,
      nextProjectWordCount: input.nextProjectWordCount,
      source: input.source ?? "manual",
      createdAt: now
    };
    const inserted = this.repo.insertWordEvent(event);
    if (activeGoal?.status === "active") {
      this.rebuildPlans(activeGoal, event.localDate, now);
    }
    return inserted;
  }

  ensureStatsReconciled(projectId: string, today = localDateKey()): void {
    const currentTotalWordCount = this.repo.getProjectWordCount(projectId);
    const latestEvent = this.repo.getLatestEvent(projectId);
    const goal = this.repo.getActiveOrPausedGoal(projectId);
    const baseline = latestEvent?.nextProjectWordCount ?? goal?.baselineWordCount;
    if (baseline === undefined || baseline === currentTotalWordCount) {
      return;
    }
    const now = nowIso();
    const deltaWords = currentTotalWordCount - baseline;
    this.repo.insertWordEvent({
      id: createId("writing_event"),
      projectId,
      goalId: goal?.id ?? null,
      chapterId: null,
      chapterTitle: "系统校准",
      chapterSortOrder: null,
      localDate: today,
      deltaWords,
      addedWords: Math.max(0, deltaWords),
      deletedWords: Math.max(0, -deltaWords),
      previousWordCount: baseline,
      nextWordCount: currentTotalWordCount,
      previousProjectWordCount: baseline,
      nextProjectWordCount: currentTotalWordCount,
      source: "system",
      createdAt: now
    });
    if (goal?.status === "active") {
      this.rebuildPlans(goal, today, now);
    }
  }

  private buildCalendarDays(
    projectId: string,
    goal: WritingGoalRecord | null,
    from: string,
    to: string,
    today: string,
    statsByDate: Map<string, WritingDailyStat>,
    plansByDate: Map<string, WritingDailyPlan>
  ): WritingCalendarDay[] {
    return listDates(from, to).map((date) => {
      const stat = statsByDate.get(date) ?? null;
      const plan = plansByDate.get(date) ?? null;
      const hasSystemEvent = this.repo.getDayEvents(projectId, date).some((event) => event.source === "system");
      return {
        localDate: date,
        plannedWords: plan?.plannedWords ?? 0,
        netWords: stat?.netWords ?? 0,
        addedWords: stat?.addedWords ?? 0,
        deletedWords: stat?.deletedWords ?? 0,
        eventCount: stat?.eventCount ?? 0,
        isWritingDay: plan?.isWritingDay ?? false,
        isRestDay: plan?.isRestDay ?? false,
        status: calendarStatus({
          localDate: date,
          today,
          plan,
          stat,
          isDeadline: goal?.deadlineDate === date,
          hasSystemEvent
        })
      };
    });
  }

  private getPaceStatus(
    goal: WritingGoalRecord | null,
    remainingWords: number,
    today: string,
    todayNet: number,
    todayPlanned: number,
    remainingWritingDays: number
  ): WritingGoalOverview["paceStatus"] {
    if (!goal) {
      return "no_goal";
    }
    if (goal.status === "paused") {
      return "paused";
    }
    if (remainingWords === 0) {
      return "completed";
    }
    if (goal.deadlineDate < today || remainingWritingDays === 0) {
      return "overdue";
    }
    if (todayPlanned > 0 && todayNet >= todayPlanned) {
      return todayNet >= todayPlanned * 1.5 ? "ahead" : "on_track";
    }
    return "behind";
  }

  private estimateCompletionDate(stats: readonly WritingDailyStat[], remainingWords: number, today: string): string | null {
    const positiveDays = stats.filter((stat) => stat.netWords > 0);
    if (remainingWords <= 0) {
      return today;
    }
    if (positiveDays.length < 3) {
      return null;
    }
    const average = positiveDays.reduce((sum, stat) => sum + stat.netWords, 0) / positiveDays.length;
    if (average <= 0) {
      return null;
    }
    return addDays(today, Math.ceil(remainingWords / average));
  }

  private rebuildPlans(goal: WritingGoalRecord, fromDate: string, now: string): void {
    const effectiveFromDate = fromDate < goal.startDate ? goal.startDate : fromDate;
    const deleteFromDate = fromDate < goal.startDate ? fromDate : effectiveFromDate;
    if (effectiveFromDate > goal.deadlineDate) {
      this.repo.replaceDailyPlansFrom(goal.projectId, goal.id, deleteFromDate, []);
      return;
    }
    const currentTotalWordCount = this.repo.getProjectWordCount(goal.projectId);
    const { remainingWords } = calculateProgress(goal, currentTotalWordCount);
    const dates = listDates(effectiveFromDate, goal.deadlineDate);
    const writableCount = goal.status === "active" ? dates.filter((date) => isPlannedWritingDate(goal, date).isWritingDay).length : 0;
    const required = writableCount > 0 ? Math.ceil(remainingWords / writableCount) : 0;
    const plans: WritingDailyPlanInsert[] = dates.map((date) => {
      const writing = goal.status === "active" ? isPlannedWritingDate(goal, date) : { isWritingDay: false, isRestDay: goal.restDates.includes(date) };
      return {
        goalId: goal.id,
        projectId: goal.projectId,
        localDate: date,
        plannedWords: writing.isWritingDay ? required : 0,
        isWritingDay: writing.isWritingDay,
        isRestDay: writing.isRestDay,
        generatedAt: now,
        updatedAt: now
      };
    });
    this.repo.replaceDailyPlansFrom(goal.projectId, goal.id, deleteFromDate, plans);
  }
}

function uniqueNumbers(values: readonly number[]): readonly number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function groupEventsByChapter(events: readonly WritingWordEventRecord[]): WritingDayDetail["chapterSummaries"] {
  const groups = new Map<string, {
    chapterId: string | null;
    chapterTitle: string;
    addedWords: number;
    deletedWords: number;
    netWords: number;
    eventCount: number;
    sources: Set<WritingWordEventSource>;
  }>();
  for (const event of events) {
    const key = event.chapterId ?? event.chapterTitle ?? event.id;
    const existing =
      groups.get(key) ??
      {
        chapterId: event.chapterId,
        chapterTitle: event.chapterTitle ?? "未命名章节",
        addedWords: 0,
        deletedWords: 0,
        netWords: 0,
        eventCount: 0,
        sources: new Set<WritingWordEventSource>()
      };
    existing.addedWords += event.addedWords;
    existing.deletedWords += event.deletedWords;
    existing.netWords += event.deltaWords;
    existing.eventCount += 1;
    existing.sources.add(event.source);
    groups.set(key, existing);
  }
  return [...groups.values()].map((group) => ({
    chapterId: group.chapterId,
    chapterTitle: group.chapterTitle,
    addedWords: group.addedWords,
    deletedWords: group.deletedWords,
    netWords: group.netWords,
    eventCount: group.eventCount,
    sources: [...group.sources]
  }));
}
