import type { SqliteDatabase } from "../database";
import type {
  WritingDailyPlan,
  WritingDailyStat,
  WritingGoalRecord,
  WritingGoalStatus,
  WritingGoalType,
  WritingWordEventRecord,
  WritingWordEventSource
} from "../../shared/types";

type WritingGoalRow = {
  readonly id: string;
  readonly project_id: string;
  readonly name: string;
  readonly goal_type: WritingGoalType;
  readonly target_word_count: number;
  readonly baseline_word_count: number;
  readonly start_date: string;
  readonly deadline_date: string;
  readonly active_weekdays_json: string;
  readonly rest_dates_json: string;
  readonly status: WritingGoalStatus;
  readonly completed_at: string | null;
  readonly archived_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

type WritingWordEventRow = {
  readonly id: string;
  readonly project_id: string;
  readonly goal_id: string | null;
  readonly chapter_id: string | null;
  readonly chapter_title: string | null;
  readonly chapter_sort_order: number | null;
  readonly local_date: string;
  readonly delta_words: number;
  readonly added_words: number;
  readonly deleted_words: number;
  readonly previous_word_count: number;
  readonly next_word_count: number;
  readonly previous_project_word_count: number;
  readonly next_project_word_count: number;
  readonly source: WritingWordEventSource;
  readonly created_at: string;
};

type WritingDailyStatRow = {
  readonly project_id: string;
  readonly local_date: string;
  readonly added_words: number;
  readonly deleted_words: number;
  readonly net_words: number;
  readonly event_count: number;
  readonly starting_total_word_count: number;
  readonly ending_total_word_count: number;
  readonly first_write_at: string | null;
  readonly last_write_at: string | null;
  readonly updated_at: string;
};

type WritingDailyPlanRow = {
  readonly goal_id: string;
  readonly project_id: string;
  readonly local_date: string;
  readonly planned_words: number;
  readonly is_writing_day: number;
  readonly is_rest_day: number;
  readonly generated_at: string;
  readonly updated_at: string;
};

export type WritingGoalInsert = Omit<WritingGoalRecord, "activeWeekdays" | "restDates"> & {
  readonly activeWeekdays: readonly number[];
  readonly restDates: readonly string[];
};

export type WritingGoalUpdatePatch = {
  readonly name?: string;
  readonly targetWordCount?: number;
  readonly deadlineDate?: string;
  readonly activeWeekdays?: readonly number[];
  readonly restDates?: readonly string[];
  readonly updatedAt: string;
};

export type WritingWordEventInsert = Omit<WritingWordEventRecord, "goalId" | "chapterId" | "chapterTitle" | "chapterSortOrder"> & {
  readonly goalId?: string | null;
  readonly chapterId?: string | null;
  readonly chapterTitle?: string | null;
  readonly chapterSortOrder?: number | null;
};

export type WritingDailyPlanInsert = WritingDailyPlan;

function parseJsonArray<T>(value: string, fallback: readonly T[]): readonly T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function mapGoal(row: WritingGoalRow): WritingGoalRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    goalType: row.goal_type,
    targetWordCount: row.target_word_count,
    baselineWordCount: row.baseline_word_count,
    startDate: row.start_date,
    deadlineDate: row.deadline_date,
    activeWeekdays: parseJsonArray<number>(row.active_weekdays_json, []),
    restDates: parseJsonArray<string>(row.rest_dates_json, []),
    status: row.status,
    completedAt: row.completed_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEvent(row: WritingWordEventRow): WritingWordEventRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    goalId: row.goal_id,
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    chapterSortOrder: row.chapter_sort_order,
    localDate: row.local_date,
    deltaWords: row.delta_words,
    addedWords: row.added_words,
    deletedWords: row.deleted_words,
    previousWordCount: row.previous_word_count,
    nextWordCount: row.next_word_count,
    previousProjectWordCount: row.previous_project_word_count,
    nextProjectWordCount: row.next_project_word_count,
    source: row.source,
    createdAt: row.created_at
  };
}

function mapStat(row: WritingDailyStatRow): WritingDailyStat {
  return {
    projectId: row.project_id,
    localDate: row.local_date,
    addedWords: row.added_words,
    deletedWords: row.deleted_words,
    netWords: row.net_words,
    eventCount: row.event_count,
    startingTotalWordCount: row.starting_total_word_count,
    endingTotalWordCount: row.ending_total_word_count,
    firstWriteAt: row.first_write_at,
    lastWriteAt: row.last_write_at,
    updatedAt: row.updated_at
  };
}

function mapPlan(row: WritingDailyPlanRow): WritingDailyPlan {
  return {
    goalId: row.goal_id,
    projectId: row.project_id,
    localDate: row.local_date,
    plannedWords: row.planned_words,
    isWritingDay: row.is_writing_day === 1,
    isRestDay: row.is_rest_day === 1,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at
  };
}

export class WritingGoalRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getActiveOrPausedGoal(projectId: string): WritingGoalRecord | null {
    const row = this.db
      .prepare("SELECT * FROM writing_goals WHERE project_id = ? AND status IN ('active', 'paused') ORDER BY updated_at DESC LIMIT 1")
      .get(projectId) as WritingGoalRow | undefined;
    return row ? mapGoal(row) : null;
  }

  getGoal(projectId: string, goalId: string): WritingGoalRecord | null {
    const row = this.db.prepare("SELECT * FROM writing_goals WHERE project_id = ? AND id = ?").get(projectId, goalId) as WritingGoalRow | undefined;
    return row ? mapGoal(row) : null;
  }

  listGoals(projectId: string): WritingGoalRecord[] {
    return (this.db.prepare("SELECT * FROM writing_goals WHERE project_id = ? ORDER BY updated_at DESC").all(projectId) as WritingGoalRow[]).map(mapGoal);
  }

  createGoal(goal: WritingGoalInsert): WritingGoalRecord {
    this.db
      .prepare(
        `INSERT INTO writing_goals (
          id, project_id, name, goal_type, target_word_count, baseline_word_count,
          start_date, deadline_date, active_weekdays_json, rest_dates_json, status,
          completed_at, archived_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        goal.id,
        goal.projectId,
        goal.name,
        goal.goalType,
        goal.targetWordCount,
        goal.baselineWordCount,
        goal.startDate,
        goal.deadlineDate,
        JSON.stringify([...goal.activeWeekdays]),
        JSON.stringify([...goal.restDates]),
        goal.status,
        goal.completedAt,
        goal.archivedAt,
        goal.createdAt,
        goal.updatedAt
      );
    const created = this.getGoal(goal.projectId, goal.id);
    if (!created) {
      throw new Error("写作目标创建失败。");
    }
    return created;
  }

  updateGoal(projectId: string, goalId: string, patch: WritingGoalUpdatePatch): WritingGoalRecord {
    const goal = this.getGoal(projectId, goalId);
    if (!goal) {
      throw new Error("写作目标不存在。");
    }
    this.db
      .prepare(
        `UPDATE writing_goals
         SET name = ?, target_word_count = ?, deadline_date = ?, active_weekdays_json = ?, rest_dates_json = ?, updated_at = ?
         WHERE project_id = ? AND id = ?`
      )
      .run(
        patch.name ?? goal.name,
        patch.targetWordCount ?? goal.targetWordCount,
        patch.deadlineDate ?? goal.deadlineDate,
        JSON.stringify([...(patch.activeWeekdays ?? goal.activeWeekdays)]),
        JSON.stringify([...(patch.restDates ?? goal.restDates)]),
        patch.updatedAt,
        projectId,
        goalId
      );
    const updated = this.getGoal(projectId, goalId);
    if (!updated) {
      throw new Error("写作目标更新失败。");
    }
    return updated;
  }

  setGoalStatus(projectId: string, goalId: string, status: WritingGoalStatus, now: string): WritingGoalRecord {
    const completedAt = status === "completed" ? now : null;
    const archivedAt = status === "archived" ? now : null;
    this.db
      .prepare("UPDATE writing_goals SET status = ?, completed_at = COALESCE(?, completed_at), archived_at = COALESCE(?, archived_at), updated_at = ? WHERE project_id = ? AND id = ?")
      .run(status, completedAt, archivedAt, now, projectId, goalId);
    const updated = this.getGoal(projectId, goalId);
    if (!updated) {
      throw new Error("写作目标不存在。");
    }
    return updated;
  }

  archiveActiveGoal(projectId: string, now: string): WritingGoalRecord | null {
    const active = this.getActiveOrPausedGoal(projectId);
    if (!active) {
      return null;
    }
    return this.setGoalStatus(projectId, active.id, "archived", now);
  }

  insertWordEvent(event: WritingWordEventInsert): WritingWordEventRecord {
    return this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO writing_word_events (
            id, project_id, goal_id, chapter_id, chapter_title, chapter_sort_order,
            local_date, delta_words, added_words, deleted_words,
            previous_word_count, next_word_count, previous_project_word_count, next_project_word_count,
            source, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          event.id,
          event.projectId,
          event.goalId ?? null,
          event.chapterId ?? null,
          event.chapterTitle ?? null,
          event.chapterSortOrder ?? null,
          event.localDate,
          event.deltaWords,
          event.addedWords,
          event.deletedWords,
          event.previousWordCount,
          event.nextWordCount,
          event.previousProjectWordCount,
          event.nextProjectWordCount,
          event.source,
          event.createdAt
        );
      this.upsertDailyStatForEvent(event);
      return this.getWordEvent(event.id);
    })();
  }

  listDailyStats(projectId: string, from: string, to: string): WritingDailyStat[] {
    return (
      this.db
        .prepare("SELECT * FROM writing_daily_stats WHERE project_id = ? AND local_date BETWEEN ? AND ? ORDER BY local_date ASC")
        .all(projectId, from, to) as WritingDailyStatRow[]
    ).map(mapStat);
  }

  listDailyPlans(projectId: string, from: string, to: string): WritingDailyPlan[] {
    return (
      this.db
        .prepare("SELECT * FROM writing_goal_daily_plans WHERE project_id = ? AND local_date BETWEEN ? AND ? ORDER BY local_date ASC")
        .all(projectId, from, to) as WritingDailyPlanRow[]
    ).map(mapPlan);
  }

  getDailyPlan(projectId: string, goalId: string, localDate: string): WritingDailyPlan | null {
    const row = this.db
      .prepare("SELECT * FROM writing_goal_daily_plans WHERE project_id = ? AND goal_id = ? AND local_date = ?")
      .get(projectId, goalId, localDate) as WritingDailyPlanRow | undefined;
    return row ? mapPlan(row) : null;
  }

  getDailyStat(projectId: string, localDate: string): WritingDailyStat | null {
    const row = this.db.prepare("SELECT * FROM writing_daily_stats WHERE project_id = ? AND local_date = ?").get(projectId, localDate) as
      | WritingDailyStatRow
      | undefined;
    return row ? mapStat(row) : null;
  }

  getDayEvents(projectId: string, date: string): WritingWordEventRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM writing_word_events WHERE project_id = ? AND local_date = ? ORDER BY created_at ASC, rowid ASC")
        .all(projectId, date) as WritingWordEventRow[]
    ).map(mapEvent);
  }

  getLatestEvent(projectId: string): WritingWordEventRecord | null {
    const row = this.db
      .prepare("SELECT * FROM writing_word_events WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(projectId) as WritingWordEventRow | undefined;
    return row ? mapEvent(row) : null;
  }

  getProjectWordCount(projectId: string): number {
    const row = this.db.prepare("SELECT COALESCE(SUM(word_count), 0) AS wordCount FROM chapters WHERE project_id = ?").get(projectId) as
      | { readonly wordCount: number }
      | undefined;
    return row?.wordCount ?? 0;
  }

  replaceDailyPlansFrom(projectId: string, goalId: string, fromDate: string, plans: readonly WritingDailyPlanInsert[]): void {
    this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM writing_goal_daily_plans WHERE project_id = ? AND goal_id = ? AND local_date >= ?")
        .run(projectId, goalId, fromDate);
      const insert = this.db.prepare(
        `INSERT INTO writing_goal_daily_plans (
          goal_id, project_id, local_date, planned_words, is_writing_day, is_rest_day, generated_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const plan of plans) {
        insert.run(
          plan.goalId,
          plan.projectId,
          plan.localDate,
          plan.plannedWords,
          plan.isWritingDay ? 1 : 0,
          plan.isRestDay ? 1 : 0,
          plan.generatedAt,
          plan.updatedAt
        );
      }
    })();
  }

  rebuildDailyStats(projectId: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM writing_daily_stats WHERE project_id = ?").run(projectId);
      const events = (
        this.db.prepare("SELECT * FROM writing_word_events WHERE project_id = ? ORDER BY created_at ASC, rowid ASC").all(projectId) as WritingWordEventRow[]
      ).map(mapEvent);
      for (const event of events) {
        this.upsertDailyStatForEvent(event);
      }
    })();
  }

  transact<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  private getWordEvent(eventId: string): WritingWordEventRecord {
    const row = this.db.prepare("SELECT * FROM writing_word_events WHERE id = ?").get(eventId) as WritingWordEventRow | undefined;
    if (!row) {
      throw new Error("写作事件不存在。");
    }
    return mapEvent(row);
  }

  private upsertDailyStatForEvent(event: Pick<WritingWordEventRecord, "projectId" | "localDate" | "addedWords" | "deletedWords" | "deltaWords" | "previousProjectWordCount" | "nextProjectWordCount" | "createdAt">): void {
    const existing = this.getDailyStat(event.projectId, event.localDate);
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO writing_daily_stats (
            project_id, local_date, added_words, deleted_words, net_words, event_count,
            starting_total_word_count, ending_total_word_count, first_write_at, last_write_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          event.projectId,
          event.localDate,
          event.addedWords,
          event.deletedWords,
          event.deltaWords,
          1,
          event.previousProjectWordCount,
          event.nextProjectWordCount,
          event.createdAt,
          event.createdAt,
          event.createdAt
        );
      return;
    }

    this.db
      .prepare(
        `UPDATE writing_daily_stats
         SET added_words = added_words + ?,
             deleted_words = deleted_words + ?,
             net_words = net_words + ?,
             event_count = event_count + 1,
             ending_total_word_count = ?,
             first_write_at = CASE WHEN first_write_at IS NULL OR first_write_at > ? THEN ? ELSE first_write_at END,
             last_write_at = CASE WHEN last_write_at IS NULL OR last_write_at < ? THEN ? ELSE last_write_at END,
             updated_at = ?
         WHERE project_id = ? AND local_date = ?`
      )
      .run(
        event.addedWords,
        event.deletedWords,
        event.deltaWords,
        event.nextProjectWordCount,
        event.createdAt,
        event.createdAt,
        event.createdAt,
        event.createdAt,
        event.createdAt,
        event.projectId,
        event.localDate
      );
  }
}
