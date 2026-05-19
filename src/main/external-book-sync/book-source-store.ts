import path from "node:path";
import { createId } from "../shared/ids";
import type { SettingsRepository } from "../db/repositories/settings-repo";

export type ExternalBookSyncSource = {
  readonly id: string;
  readonly projectId: string;
  readonly bookFolderPath: string;
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

type StoredExternalBookSyncSource = ExternalBookSyncSource & {
  readonly bookFilePath?: string;
};

function sourceKey(projectId: string): string {
  return `externalBookSyncSources:${projectId}`;
}

function usesWindowsSeparators(value: string): boolean {
  return value.includes("\\");
}

function dirnameForStoredPath(filePath: string): string {
  return usesWindowsSeparators(filePath) ? path.win32.dirname(filePath) : path.dirname(filePath);
}

function basenameForStoredPath(filePath: string): string {
  return usesWindowsSeparators(filePath) ? path.win32.basename(filePath) : path.basename(filePath);
}

export class ExternalBookSourceStore {
  constructor(private readonly settingsRepo: SettingsRepository) {}

  private normalizeSource(source: StoredExternalBookSyncSource): ExternalBookSyncSource {
    const legacyFilePath = source.bookFilePath;
    const bookFolderPath = source.bookFolderPath ?? (legacyFilePath ? dirnameForStoredPath(legacyFilePath) : "");
    const displayName = source.displayName || (legacyFilePath ? basenameForStoredPath(legacyFilePath) : "外部 .Book");
    const { bookFilePath: _legacyBookFilePath, ...withoutLegacyPath } = source;
    return {
      ...withoutLegacyPath,
      bookFolderPath,
      displayName
    };
  }

  listSources(projectId: string): ExternalBookSyncSource[] {
    return (this.settingsRepo.getJson<StoredExternalBookSyncSource[]>(sourceKey(projectId)) ?? []).map((source) => this.normalizeSource(source));
  }

  upsertSource(input: ExternalBookSyncSourceInput): ExternalBookSyncSource {
    const source: ExternalBookSyncSource = {
      ...input,
      id: input.id ?? createId("external_book_source")
    };
    const sources = this.listSources(input.projectId);
    const next = [
      source,
      ...sources.filter((item) => item.id !== source.id && (item.bookFolderPath !== source.bookFolderPath || item.displayName !== source.displayName))
    ];
    this.settingsRepo.setJson(sourceKey(input.projectId), next);
    return source;
  }

  forgetSource(projectId: string, sourceId: string): void {
    const sources = this.listSources(projectId).filter((source) => source.id !== sourceId);
    this.settingsRepo.setJson(sourceKey(projectId), sources);
  }
}
