import { createId } from "../../shared/ids";
import type { SqliteDatabase } from "../database";

const SETTINGS_KEY = "usageAnalytics";

export type UsageAnalyticsEventType = "app_opened" | "page_view" | "page_active" | "feature_used" | "error";
export type UsageAnalyticsFeature =
  | "app"
  | "welcome"
  | "writing"
  | "relationshipGraph"
  | "outline"
  | "chapterReview"
  | "writingGoals"
  | "settings"
  | "import"
  | "export"
  | "newProject"
  | "ai_task"
  | "ai_chat"
  | "scratchpad"
  | "summary_cache"
  | "relationship_graph"
  | "external_book_sync"
  | "shareable_export"
  | "txt_import"
  | "txt_export"
  | "error";

export type UsageAnalyticsReportStatus = "running" | "completed" | "failed";
export type UsageAnalyticsReportTrigger = "automatic" | "manual";
export type UsageWritingUpdateSource = "manual" | "ai_apply" | "system";

type UsageEventRow = {
  readonly id: string;
  readonly event_type: UsageAnalyticsEventType;
  readonly feature: UsageAnalyticsFeature;
  readonly duration_ms: number | null;
  readonly occurred_at: string;
  readonly local_date: string;
};

type UsageReportRunRow = {
  readonly id: string;
  readonly trigger_type: UsageAnalyticsReportTrigger;
  readonly scheduled_slot_key: string | null;
  readonly scheduled_local_time: string | null;
  readonly status: UsageAnalyticsReportStatus;
  readonly snapshot_json: string | null;
  readonly report_text: string | null;
  readonly error: string | null;
  readonly requested_at: string;
  readonly completed_at: string | null;
};

type UsageWritingUpdateRow = {
  readonly id: string;
  readonly project_id: string;
  readonly project_name: string;
  readonly chapter_id: string;
  readonly chapter_title: string;
  readonly chapter_sort_order: number;
  readonly source: UsageWritingUpdateSource;
  readonly previous_word_count: number;
  readonly next_word_count: number;
  readonly word_delta: number;
  readonly occurred_at: string;
  readonly local_date: string;
};

type SettingsRow = {
  readonly value_json: string;
};

export type UsageAnalyticsEventInsert = {
  readonly eventType: UsageAnalyticsEventType;
  readonly feature: UsageAnalyticsFeature;
  readonly durationMs: number | null;
  readonly occurredAt: string;
  readonly localDate: string;
};

export type UsageAnalyticsEventRecord = {
  readonly id: string;
  readonly eventType: UsageAnalyticsEventType;
  readonly feature: UsageAnalyticsFeature;
  readonly durationMs: number | null;
  readonly occurredAt: string;
  readonly localDate: string;
};

export type UsageReportRunInsert = {
  readonly trigger: UsageAnalyticsReportTrigger;
  readonly scheduledSlotKey: string | null;
  readonly scheduledLocalTime: string | null;
  readonly status: UsageAnalyticsReportStatus;
  readonly snapshotJson: string | null;
  readonly reportText: string | null;
  readonly error: string | null;
  readonly requestedAt: string;
  readonly completedAt: string | null;
};

export type UsageReportRunRecord = {
  readonly id: string;
  readonly trigger: UsageAnalyticsReportTrigger;
  readonly scheduledSlotKey: string | null;
  readonly scheduledLocalTime: string | null;
  readonly status: UsageAnalyticsReportStatus;
  readonly snapshotJson: string | null;
  readonly reportText: string | null;
  readonly error: string | null;
  readonly requestedAt: string;
  readonly completedAt: string | null;
};

export type UsageWritingUpdateInsert = {
  readonly projectId: string;
  readonly projectName: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly chapterSortOrder: number;
  readonly source: UsageWritingUpdateSource;
  readonly previousWordCount: number;
  readonly nextWordCount: number;
  readonly occurredAt: string;
  readonly localDate: string;
};

export type UsageWritingUpdateRecord = UsageWritingUpdateInsert & {
  readonly id: string;
  readonly wordDelta: number;
};

function mapEvent(row: UsageEventRow): UsageAnalyticsEventRecord {
  return {
    id: row.id,
    eventType: row.event_type,
    feature: row.feature,
    durationMs: row.duration_ms,
    occurredAt: row.occurred_at,
    localDate: row.local_date
  };
}

function mapReportRun(row: UsageReportRunRow): UsageReportRunRecord {
  return {
    id: row.id,
    trigger: row.trigger_type,
    scheduledSlotKey: row.scheduled_slot_key,
    scheduledLocalTime: row.scheduled_local_time,
    status: row.status,
    snapshotJson: row.snapshot_json,
    reportText: row.report_text,
    error: row.error,
    requestedAt: row.requested_at,
    completedAt: row.completed_at
  };
}

function mapWritingUpdate(row: UsageWritingUpdateRow): UsageWritingUpdateRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    chapterSortOrder: row.chapter_sort_order,
    source: row.source,
    previousWordCount: row.previous_word_count,
    nextWordCount: row.next_word_count,
    wordDelta: row.word_delta,
    occurredAt: row.occurred_at,
    localDate: row.local_date
  };
}

export class UsageAnalyticsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getSettings<TValue>(): TValue | null {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key = ?").get(SETTINGS_KEY) as SettingsRow | undefined;
    return row ? JSON.parse(row.value_json) as TValue : null;
  }

  setSettings(value: unknown, updatedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(SETTINGS_KEY, JSON.stringify(value), updatedAt);
  }

  recordEvent(input: UsageAnalyticsEventInsert): UsageAnalyticsEventRecord {
    const id = createId("usage_event");
    this.db
      .prepare(
        `INSERT INTO usage_events
         (id, event_type, feature, duration_ms, occurred_at, local_date)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.eventType, input.feature, input.durationMs, input.occurredAt, input.localDate);
    return {
      id,
      ...input
    };
  }

  listEventsSince(localDate: string): UsageAnalyticsEventRecord[] {
    return (this.db
      .prepare("SELECT * FROM usage_events WHERE local_date >= ? ORDER BY occurred_at ASC")
      .all(localDate) as UsageEventRow[]).map(mapEvent);
  }

  recordWritingUpdate(input: UsageWritingUpdateInsert): UsageWritingUpdateRecord {
    const id = createId("usage_write");
    const wordDelta = input.nextWordCount - input.previousWordCount;
    this.db
      .prepare(
        `INSERT INTO usage_writing_updates
         (id, project_id, project_name, chapter_id, chapter_title, chapter_sort_order, source, previous_word_count, next_word_count, word_delta, occurred_at, local_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.projectId,
        input.projectName,
        input.chapterId,
        input.chapterTitle,
        input.chapterSortOrder,
        input.source,
        input.previousWordCount,
        input.nextWordCount,
        wordDelta,
        input.occurredAt,
        input.localDate
      );
    return {
      id,
      ...input,
      wordDelta
    };
  }

  countWritingUpdatesSince(localDate: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM usage_writing_updates WHERE local_date >= ?").get(localDate) as { readonly count: number };
    return row.count;
  }

  listRecentWritingUpdatesSince(localDate: string, limit: number): UsageWritingUpdateRecord[] {
    return (this.db
      .prepare(
        `SELECT * FROM usage_writing_updates
         WHERE local_date >= ?
         ORDER BY occurred_at DESC, rowid DESC
         LIMIT ?`
      )
      .all(localDate, limit) as UsageWritingUpdateRow[]).map(mapWritingUpdate).reverse();
  }

  createReportRun(input: UsageReportRunInsert): UsageReportRunRecord {
    const id = createId("usage_report");
    this.db
      .prepare(
        `INSERT INTO usage_report_runs
         (id, trigger_type, scheduled_slot_key, scheduled_local_time, status, snapshot_json, report_text, error, requested_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.trigger,
        input.scheduledSlotKey,
        input.scheduledLocalTime,
        input.status,
        input.snapshotJson,
        input.reportText,
        input.error,
        input.requestedAt,
        input.completedAt
      );
    return {
      id,
      ...input
    };
  }

  updateReportRun(input: {
    readonly id: string;
    readonly status: UsageAnalyticsReportStatus;
    readonly snapshotJson: string | null;
    readonly reportText: string | null;
    readonly error: string | null;
    readonly completedAt: string;
  }): UsageReportRunRecord {
    this.db
      .prepare(
        `UPDATE usage_report_runs
         SET status = ?, snapshot_json = ?, report_text = ?, error = ?, completed_at = ?
         WHERE id = ?`
      )
      .run(input.status, input.snapshotJson, input.reportText, input.error, input.completedAt, input.id);
    const row = this.db.prepare("SELECT * FROM usage_report_runs WHERE id = ?").get(input.id) as UsageReportRunRow;
    return mapReportRun(row);
  }

  getReportRunBySlot(scheduledSlotKey: string): UsageReportRunRecord | null {
    const row = this.db.prepare("SELECT * FROM usage_report_runs WHERE scheduled_slot_key = ? LIMIT 1").get(scheduledSlotKey) as UsageReportRunRow | undefined;
    return row ? mapReportRun(row) : null;
  }

  getLatestReportRun(): UsageReportRunRecord | null {
    const row = this.db.prepare("SELECT * FROM usage_report_runs ORDER BY requested_at DESC, rowid DESC LIMIT 1").get() as UsageReportRunRow | undefined;
    return row ? mapReportRun(row) : null;
  }
}
