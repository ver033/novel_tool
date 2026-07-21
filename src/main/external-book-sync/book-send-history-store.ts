import { createId } from "../shared/ids";
import type { SettingsRepository } from "../db/repositories/settings-repo";

const MAX_STORED_SENT_CHAPTERS = 2_000;

export type ExternalBookSentChapterKind = "latest_project_chapter" | "missing_chapter";

export type ExternalBookSentChapterRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly chapterIdentity: string;
  readonly kind: ExternalBookSentChapterKind;
  readonly title: string;
  readonly ordinal: number | null;
  readonly sourceContentHash: string;
  readonly sentAt: string;
};

export type ExternalBookSentChapterInput = Omit<ExternalBookSentChapterRecord, "id"> & {
  readonly id?: string;
};

function sentChaptersKey(projectId: string): string {
  return `externalBookSyncSentChapters:${projectId}`;
}

function normalizeRecordTitle(title: string): string {
  return title.replace(/\s+/gu, "").trim().toLocaleLowerCase("zh-CN");
}

export class ExternalBookSentChapterStore {
  constructor(private readonly settingsRepo: SettingsRepository) {}

  list(projectId: string): ExternalBookSentChapterRecord[] {
    return this.settingsRepo.getJson<ExternalBookSentChapterRecord[]>(sentChaptersKey(projectId)) ?? [];
  }

  hasSentUnchanged(input: {
    readonly projectId: string;
    readonly kind: ExternalBookSentChapterKind;
    readonly chapterIdentity: string;
    readonly title: string;
    readonly sourceContentHash: string;
  }): boolean {
    return this.list(input.projectId).some(
      (record) =>
        record.kind === input.kind &&
        record.chapterIdentity === input.chapterIdentity &&
        normalizeRecordTitle(record.title) === normalizeRecordTitle(input.title) &&
        record.sourceContentHash === input.sourceContentHash
    );
  }

  markSent(input: ExternalBookSentChapterInput): ExternalBookSentChapterRecord {
    const existing = this.list(input.projectId).find(
      (record) =>
        record.kind === input.kind &&
        record.chapterIdentity === input.chapterIdentity &&
        normalizeRecordTitle(record.title) === normalizeRecordTitle(input.title) &&
        record.sourceContentHash === input.sourceContentHash
    );
    const record: ExternalBookSentChapterRecord = {
      ...input,
      id: input.id ?? existing?.id ?? createId("external_book_sent_chapter")
    };
    const next = [
      record,
      ...this.list(input.projectId).filter(
        (item) =>
          item.id !== record.id &&
          (item.kind !== record.kind ||
            item.chapterIdentity !== record.chapterIdentity ||
            normalizeRecordTitle(item.title) !== normalizeRecordTitle(record.title) ||
            item.sourceContentHash !== record.sourceContentHash)
      )
    ].slice(0, MAX_STORED_SENT_CHAPTERS);
    this.settingsRepo.setJson(sentChaptersKey(input.projectId), next);
    return record;
  }

  clear(projectId: string): number {
    const count = this.list(projectId).length;
    this.settingsRepo.setJson(sentChaptersKey(projectId), []);
    return count;
  }
}
