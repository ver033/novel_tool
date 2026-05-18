import { createId } from "../shared/ids";
import type { SettingsRepository } from "../db/repositories/settings-repo";

export type ExternalBookSyncSource = {
  readonly id: string;
  readonly projectId: string;
  readonly bookFilePath: string;
  readonly displayName: string;
  readonly lastKnownSize: number;
  readonly lastModifiedAt: string | null;
  readonly lastContentHash: string | null;
  readonly lastScanAt: string;
  readonly confirmedAt: string | null;
};

export type ExternalBookSyncSourceInput = Omit<ExternalBookSyncSource, "id"> & {
  readonly id?: string;
};

function sourceKey(projectId: string): string {
  return `externalBookSyncSources:${projectId}`;
}

export class ExternalBookSourceStore {
  constructor(private readonly settingsRepo: SettingsRepository) {}

  listSources(projectId: string): ExternalBookSyncSource[] {
    return this.settingsRepo.getJson<ExternalBookSyncSource[]>(sourceKey(projectId)) ?? [];
  }

  upsertSource(input: ExternalBookSyncSourceInput): ExternalBookSyncSource {
    const source: ExternalBookSyncSource = {
      ...input,
      id: input.id ?? createId("external_book_source")
    };
    const sources = this.listSources(input.projectId);
    const next = [source, ...sources.filter((item) => item.id !== source.id && item.bookFilePath !== source.bookFilePath)];
    this.settingsRepo.setJson(sourceKey(input.projectId), next);
    return source;
  }

  forgetSource(projectId: string, sourceId: string): void {
    const sources = this.listSources(projectId).filter((source) => source.id !== sourceId);
    this.settingsRepo.setJson(sourceKey(projectId), sources);
  }
}
