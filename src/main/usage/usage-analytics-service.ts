import { OpenRouterClient, type OpenRouterMessage } from "../ai/openrouter-client";
import type {
  UsageAnalyticsEventRecord,
  UsageAnalyticsEventType,
  UsageAnalyticsFeature,
  UsageAnalyticsReportTrigger,
  UsageAnalyticsRepository,
  UsageWritingUpdateSource,
  UsageReportRunRecord
} from "../db/repositories/usage-analytics-repo";
import type { SettingsService } from "../settings/settings-service";

const DEFAULT_SCHEDULE_LOCAL_TIMES = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);
const PREVIOUS_DEFAULT_SCHEDULE_LOCAL_TIME_SETS = [
  ["00:00", "09:00"],
  ["00:00", "09:00", "12:00"]
] as const;
const DEFAULT_RANGE_DAYS = 14;
const MAX_CHAPTER_UPDATES_PER_REPORT = 120;

const excludedFields = [
  "local_file_path",
  "ai_prompt",
  "ai_response",
  "api_key",
  "device_unique_id",
  "raw_timeline"
] as const;

export type UsageAnalyticsSettings = {
  readonly automaticReportsEnabled: boolean;
  readonly scheduleLocalTimes: readonly string[];
  readonly reportRangeDays: number;
};

export type UsageAnalyticsRecordEventInput = {
  readonly eventType: UsageAnalyticsEventType;
  readonly feature: UsageAnalyticsFeature;
  readonly durationMs?: number | null;
  readonly occurredAt?: Date;
};

export type UsageAnalyticsProjectContext = {
  readonly projectName: string;
  readonly latestChapterTitle: string | null;
  readonly latestChapterText: string;
  readonly latestChapterWordCount: number;
};

export type UsageAnalyticsRecordWritingUpdateInput = {
  readonly projectId: string;
  readonly projectName: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly chapterSortOrder: number;
  readonly source: UsageWritingUpdateSource;
  readonly previousWordCount: number;
  readonly nextWordCount: number;
  readonly occurredAt?: Date;
};

export type UsageAnalyticsChapterUpdateSnapshot = {
  readonly projectName: string;
  readonly chapterTitle: string;
  readonly chapterOrder: number;
  readonly source: UsageWritingUpdateSource;
  readonly occurredAt: string;
  readonly previousWordCount: number;
  readonly nextWordCount: number;
  readonly wordDelta: number;
};

export type UsageAnalyticsWritingUpdateSummary = {
  readonly range: "range_days";
  readonly sentUpdateCount: number;
  readonly omittedUpdateCount: number;
  readonly totalUpdateCount: number;
  readonly maxSentUpdateCount: number;
};

export type UsageAnalyticsSnapshot = {
  readonly appVersion: string;
  readonly platform: string;
  readonly generatedAt: string;
  readonly rangeDays: number;
  readonly fromLocalDate: string;
  readonly toLocalDate: string;
  readonly activeDays: number;
  readonly totalActiveMinutes: number;
  readonly eventCounts: Record<string, number>;
  readonly pageViews: Record<string, number>;
  readonly pageActiveMinutes: Record<string, number>;
  readonly featureCounts: Record<string, number>;
  readonly errorCounts: Record<string, number>;
  readonly latestProjectContext: UsageAnalyticsProjectContext | null;
  readonly writingUpdateSummary: UsageAnalyticsWritingUpdateSummary;
  readonly chapterUpdates: readonly UsageAnalyticsChapterUpdateSnapshot[];
  readonly scheduleLocalTimes: readonly string[];
  readonly privacy: {
    readonly anonymized: true;
    readonly excludedFields: readonly string[];
  };
};

export type UsageAnalyticsStatus = {
  readonly automaticReportsEnabled: boolean;
  readonly scheduleLocalTimes: readonly string[];
  readonly reportRangeDays: number;
  readonly nextScheduledAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastError: string | null;
  readonly latestReportText: string | null;
};

export type UsageAnalyticsReporter = {
  readonly generateReport: (snapshot: UsageAnalyticsSnapshot) => Promise<string>;
};

export type UsageAnalyticsServiceDeps = {
  readonly repo: UsageAnalyticsRepository;
  readonly reporter: UsageAnalyticsReporter;
  readonly appVersion: string;
  readonly platform: string;
  readonly getProjectContext?: () => UsageAnalyticsProjectContext | null;
};

export type OpenRouterUsageAnalyticsReporterDeps = {
  readonly settingsService: SettingsService;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

function localTime(value: Date): string {
  return `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
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

function parseScheduleMinutes(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(value);
  if (!match) {
    throw new Error(`自动使用分析时间无效：${value}`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToLocalTime(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

function normalizeSettings(settings: Partial<UsageAnalyticsSettings> | null): UsageAnalyticsSettings {
  const schedule = settings?.scheduleLocalTimes?.length ? [...settings.scheduleLocalTimes] : [...DEFAULT_SCHEDULE_LOCAL_TIMES];
  const scheduleLocalTimes = [...new Set(schedule)].map((item) => minutesToLocalTime(parseScheduleMinutes(item))).sort();
  const isPreviousDefaultSchedule = PREVIOUS_DEFAULT_SCHEDULE_LOCAL_TIME_SETS.some(
    (previous) => scheduleLocalTimes.length === previous.length && previous.every((item, index) => scheduleLocalTimes[index] === item)
  );
  return {
    automaticReportsEnabled: settings?.automaticReportsEnabled ?? true,
    scheduleLocalTimes: isPreviousDefaultSchedule ? [...DEFAULT_SCHEDULE_LOCAL_TIMES] : scheduleLocalTimes,
    reportRangeDays: Math.min(90, Math.max(1, Math.round(settings?.reportRangeDays ?? DEFAULT_RANGE_DAYS)))
  };
}

function roundMinutes(durationMs: number): number {
  return Math.max(0, Math.round(durationMs / 60_000));
}

function increment(target: Record<string, number>, key: string, by = 1): void {
  target[key] = (target[key] ?? 0) + by;
}

function latestDueSlot(now: Date, scheduleLocalTimes: readonly string[]): string | null {
  const current = now.getHours() * 60 + now.getMinutes();
  const due = scheduleLocalTimes.map(parseScheduleMinutes).filter((minutes) => minutes <= current).sort((a, b) => a - b).at(-1);
  return due === undefined ? null : minutesToLocalTime(due);
}

function nextScheduledAt(now: Date, scheduleLocalTimes: readonly string[]): string | null {
  if (scheduleLocalTimes.length === 0) {
    return null;
  }
  const current = now.getHours() * 60 + now.getMinutes();
  const sorted = scheduleLocalTimes.map(parseScheduleMinutes).sort((a, b) => a - b);
  const next = sorted.find((minutes) => minutes > current) ?? sorted[0];
  const nextDate = new Date(now);
  if (next <= current) {
    nextDate.setDate(nextDate.getDate() + 1);
  }
  nextDate.setHours(Math.floor(next / 60), next % 60, 0, 0);
  return nextDate.toISOString();
}

function scheduledSlotKey(now: Date, localTimeValue: string): string {
  return `${localDateKey(now)}T${localTimeValue}`;
}

function eventMatchesPage(event: UsageAnalyticsEventRecord): boolean {
  return ["welcome", "writing", "relationshipGraph", "outline", "writingGoals", "settings", "import", "export", "newProject"].includes(event.feature);
}

function resolveProjectContext(provider?: () => UsageAnalyticsProjectContext | null): UsageAnalyticsProjectContext | null {
  if (!provider) {
    return null;
  }
  try {
    return provider();
  } catch {
    return null;
  }
}

export function buildUsageAnalyticsMessages(snapshot: UsageAnalyticsSnapshot): OpenRouterMessage[] {
  const compactSnapshot = {
    v: snapshot.appVersion,
    p: snapshot.platform,
    at: snapshot.generatedAt,
    d: snapshot.rangeDays,
    activeDays: snapshot.activeDays,
    activeMin: snapshot.totalActiveMinutes,
    events: snapshot.eventCounts,
    views: snapshot.pageViews,
    pageMin: snapshot.pageActiveMinutes,
    features: snapshot.featureCounts,
    errors: snapshot.errorCounts,
    writing: snapshot.writingUpdateSummary,
    latest: snapshot.latestProjectContext
      ? {
          project: snapshot.latestProjectContext.projectName,
          chapter: snapshot.latestProjectContext.latestChapterTitle,
          words: snapshot.latestProjectContext.latestChapterWordCount,
          textChars: snapshot.latestProjectContext.latestChapterText.length
        }
      : null
  };
  return [
    {
      role: "system",
      content: "墨枢匿名产品分析。只基于JSON给3条短建议，勿推测身份、路径或API。"
    },
    {
      role: "user",
      content: [
        "用中文输出极简产品使用分析：概览、异常/阻塞、建议。",
        JSON.stringify(compactSnapshot)
      ].join("\n")
    }
  ];
}

export class OpenRouterUsageAnalyticsReporter implements UsageAnalyticsReporter {
  constructor(private readonly deps: OpenRouterUsageAnalyticsReporterDeps) {}

  async generateReport(snapshot: UsageAnalyticsSnapshot): Promise<string> {
    const config = this.deps.settingsService.getOpenRouterConfig();
    const client = new OpenRouterClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      modelName: config.modelName
    });
    const result = await client.createChatCompletion({
      messages: buildUsageAnalyticsMessages(snapshot),
      maxCompletionTokens: 600,
      temperature: 0.2
    });
    return result.content.trim();
  }
}

export class UsageAnalyticsService {
  constructor(private readonly deps: UsageAnalyticsServiceDeps) {}

  getSettings(): UsageAnalyticsSettings {
    return normalizeSettings(this.deps.repo.getSettings<Partial<UsageAnalyticsSettings>>());
  }

  updateSettings(patch: Partial<UsageAnalyticsSettings>, now = new Date()): UsageAnalyticsSettings {
    const next = normalizeSettings({
      ...this.getSettings(),
      ...patch
    });
    this.deps.repo.setSettings(next, now.toISOString());
    return next;
  }

  getStatus(now = new Date()): UsageAnalyticsStatus {
    const settings = this.getSettings();
    const latest = this.deps.repo.getLatestReportRun();
    return {
      automaticReportsEnabled: settings.automaticReportsEnabled,
      scheduleLocalTimes: settings.scheduleLocalTimes,
      reportRangeDays: settings.reportRangeDays,
      nextScheduledAt: nextScheduledAt(now, settings.scheduleLocalTimes),
      lastAttemptAt: latest?.requestedAt ?? null,
      lastSuccessAt: latest?.status === "completed" ? latest.completedAt : null,
      lastError: latest?.status === "failed" ? latest.error : null,
      latestReportText: latest?.status === "completed" ? latest.reportText : null
    };
  }

  recordEvent(input: UsageAnalyticsRecordEventInput) {
    const occurredAt = input.occurredAt ?? new Date();
    const durationMs = input.durationMs === undefined || input.durationMs === null ? null : Math.max(0, Math.round(input.durationMs));
    return this.deps.repo.recordEvent({
      eventType: input.eventType,
      feature: input.feature,
      durationMs,
      occurredAt: occurredAt.toISOString(),
      localDate: localDateKey(occurredAt)
    });
  }

  recordWritingUpdate(input: UsageAnalyticsRecordWritingUpdateInput) {
    const occurredAt = input.occurredAt ?? new Date();
    const previousWordCount = Math.max(0, Math.round(input.previousWordCount));
    const nextWordCount = Math.max(0, Math.round(input.nextWordCount));
    return this.deps.repo.recordWritingUpdate({
      projectId: input.projectId,
      projectName: input.projectName,
      chapterId: input.chapterId,
      chapterTitle: input.chapterTitle,
      chapterSortOrder: Math.max(0, Math.round(input.chapterSortOrder)),
      source: input.source,
      previousWordCount,
      nextWordCount,
      occurredAt: occurredAt.toISOString(),
      localDate: localDateKey(occurredAt)
    });
  }

  buildSnapshot(input: { readonly now?: Date; readonly rangeDays?: number } = {}): UsageAnalyticsSnapshot {
    const settings = this.getSettings();
    const now = input.now ?? new Date();
    const rangeDays = input.rangeDays ?? settings.reportRangeDays;
    const toLocalDate = localDateKey(now);
    const fromLocalDate = addDays(toLocalDate, -(rangeDays - 1));
    const events = this.deps.repo.listEventsSince(fromLocalDate);
    const activeDates = new Set<string>();
    const eventCounts: Record<string, number> = {};
    const pageViews: Record<string, number> = {};
    const pageActiveMinutes: Record<string, number> = {};
    const featureCounts: Record<string, number> = {};
    const errorCounts: Record<string, number> = {};
    const totalWritingUpdateCount = this.deps.repo.countWritingUpdatesSince(fromLocalDate);
    const chapterUpdates = this.deps.repo.listRecentWritingUpdatesSince(fromLocalDate, MAX_CHAPTER_UPDATES_PER_REPORT).map((update) => ({
      projectName: update.projectName,
      chapterTitle: update.chapterTitle,
      chapterOrder: update.chapterSortOrder + 1,
      source: update.source,
      occurredAt: update.occurredAt,
      previousWordCount: update.previousWordCount,
      nextWordCount: update.nextWordCount,
      wordDelta: update.wordDelta
    }));

    for (const event of events) {
      activeDates.add(event.localDate);
      increment(eventCounts, event.eventType);
      if (event.eventType === "page_view" && eventMatchesPage(event)) {
        increment(pageViews, event.feature);
      }
      if (event.eventType === "page_active" && eventMatchesPage(event)) {
        increment(pageActiveMinutes, event.feature, roundMinutes(event.durationMs ?? 0));
      }
      if (event.eventType === "feature_used") {
        increment(featureCounts, event.feature);
      }
      if (event.eventType === "error") {
        increment(errorCounts, event.feature);
      }
    }

    return {
      appVersion: this.deps.appVersion,
      platform: this.deps.platform,
      generatedAt: now.toISOString(),
      rangeDays,
      fromLocalDate,
      toLocalDate,
      activeDays: activeDates.size,
      totalActiveMinutes: Object.values(pageActiveMinutes).reduce((sum, value) => sum + value, 0),
      eventCounts,
      pageViews,
      pageActiveMinutes,
      featureCounts,
      errorCounts,
      latestProjectContext: resolveProjectContext(this.deps.getProjectContext),
      writingUpdateSummary: {
        range: "range_days",
        sentUpdateCount: chapterUpdates.length,
        omittedUpdateCount: Math.max(0, totalWritingUpdateCount - chapterUpdates.length),
        totalUpdateCount: totalWritingUpdateCount,
        maxSentUpdateCount: MAX_CHAPTER_UPDATES_PER_REPORT
      },
      chapterUpdates,
      scheduleLocalTimes: settings.scheduleLocalTimes,
      privacy: {
        anonymized: true,
        excludedFields: [...excludedFields]
      }
    };
  }

  async runDueAutomaticReport(now = new Date()): Promise<UsageReportRunRecord | null> {
    const settings = this.getSettings();
    if (!settings.automaticReportsEnabled) {
      return null;
    }
    const dueSlot = latestDueSlot(now, settings.scheduleLocalTimes);
    if (!dueSlot) {
      return null;
    }
    const slotKey = scheduledSlotKey(now, dueSlot);
    if (this.deps.repo.getReportRunBySlot(slotKey)) {
      return null;
    }
    return this.runReport("automatic", dueSlot, slotKey, now);
  }

  runStartupCatchUpReport(now = new Date()): Promise<UsageReportRunRecord | null> {
    return this.runDueAutomaticReport(now);
  }

  sendReportNow(now = new Date()): Promise<UsageReportRunRecord> {
    return this.runReport("manual", null, `manual:${now.toISOString()}`, now);
  }

  private async runReport(
    trigger: UsageAnalyticsReportTrigger,
    scheduledLocalTime: string | null,
    scheduledSlotKeyValue: string | null,
    now: Date
  ): Promise<UsageReportRunRecord> {
    const startedAt = now.toISOString();
    const run = this.deps.repo.createReportRun({
      trigger,
      scheduledSlotKey: scheduledSlotKeyValue,
      scheduledLocalTime,
      status: "running",
      snapshotJson: null,
      reportText: null,
      error: null,
      requestedAt: startedAt,
      completedAt: null
    });
    const snapshot = this.buildSnapshot({ now });
    try {
      const reportText = await this.deps.reporter.generateReport(snapshot);
      return this.deps.repo.updateReportRun({
        id: run.id,
        status: "completed",
        snapshotJson: JSON.stringify(snapshot),
        reportText,
        error: null,
        completedAt: new Date().toISOString()
      });
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason);
      return this.deps.repo.updateReportRun({
        id: run.id,
        status: "failed",
        snapshotJson: JSON.stringify(snapshot),
        reportText: null,
        error,
        completedAt: new Date().toISOString()
      });
    }
  }
}
