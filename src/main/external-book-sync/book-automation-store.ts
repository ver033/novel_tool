import { createId } from "../shared/ids";
import type { SettingsRepository } from "../db/repositories/settings-repo";

const MAX_STORED_AUTOMATIC_RUNS = 120;

export type ExternalBookSyncAutomaticTrigger = "scheduled" | "startup";
export type ExternalBookSyncAutomaticRunStatus = "running" | "completed" | "skipped" | "failed";

export type ExternalBookSyncAutomaticRunRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly trigger: ExternalBookSyncAutomaticTrigger;
  readonly scheduledSlotKey: string;
  readonly scheduledLocalTime: string;
  readonly status: ExternalBookSyncAutomaticRunStatus;
  readonly candidateCount: number;
  readonly sentMessageCount: number;
  readonly sentChapterCount: number;
  readonly sentMissingChapterCount: number;
  readonly sentLatestProjectChapter: boolean;
  readonly error: string | null;
  readonly requestedAt: string;
  readonly completedAt: string | null;
};

export type ExternalBookSyncAutomaticRunInput = Omit<ExternalBookSyncAutomaticRunRecord, "id"> & {
  readonly id?: string;
};

function automaticRunsKey(projectId: string): string {
  return `externalBookSyncAutomaticRuns:${projectId}`;
}

export class ExternalBookSyncAutomationStore {
  constructor(private readonly settingsRepo: SettingsRepository) {}

  listRuns(projectId: string): ExternalBookSyncAutomaticRunRecord[] {
    return (this.settingsRepo.getJson<ExternalBookSyncAutomaticRunRecord[]>(automaticRunsKey(projectId)) ?? []).map((run) => ({
      ...run,
      sentMissingChapterCount: run.sentMissingChapterCount ?? run.sentChapterCount,
      sentLatestProjectChapter: run.sentLatestProjectChapter ?? false
    }));
  }

  getRunBySlot(projectId: string, scheduledSlotKey: string): ExternalBookSyncAutomaticRunRecord | null {
    return this.listRuns(projectId).find((run) => run.scheduledSlotKey === scheduledSlotKey) ?? null;
  }

  upsertRun(input: ExternalBookSyncAutomaticRunInput): ExternalBookSyncAutomaticRunRecord {
    const existing = this.getRunBySlot(input.projectId, input.scheduledSlotKey);
    const run: ExternalBookSyncAutomaticRunRecord = {
      ...input,
      id: input.id ?? existing?.id ?? createId("external_book_sync_run")
    };
    const next = [
      run,
      ...this.listRuns(input.projectId).filter((item) => item.id !== run.id && item.scheduledSlotKey !== run.scheduledSlotKey)
    ].slice(0, MAX_STORED_AUTOMATIC_RUNS);
    this.settingsRepo.setJson(automaticRunsKey(input.projectId), next);
    return run;
  }
}
