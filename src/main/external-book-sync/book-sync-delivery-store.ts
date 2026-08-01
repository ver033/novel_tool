import type { SettingsRepository } from "../db/repositories/settings-repo";
import type { ExternalBookSentChapterKind } from "./book-send-history-store";

const MAX_STORED_DELIVERIES = 4_000;

export type ExternalBookSyncDeliveryRecord = {
  readonly deliveryId: string;
  readonly projectId: string;
  readonly kind: ExternalBookSentChapterKind;
  readonly chapterIdentity: string;
  readonly sourceContentHash: string;
  readonly partIndex: number;
  readonly partCount: number;
  readonly plaintextHash: string;
  readonly encryptedMessage: string;
  readonly emergencyDeliveredAt: string | null;
  readonly observableDeliveredAt: string | null;
  readonly updatedAt: string;
};

export type ExternalBookSyncDeliveryInput = Omit<
  ExternalBookSyncDeliveryRecord,
  "emergencyDeliveredAt" | "observableDeliveredAt"
>;

function deliveryKey(projectId: string): string {
  return `externalBookSyncDeliveries:${projectId}`;
}

export class ExternalBookSyncDeliveryStore {
  constructor(private readonly settingsRepo: SettingsRepository) {}

  list(projectId: string): ExternalBookSyncDeliveryRecord[] {
    return this.settingsRepo.getJson<ExternalBookSyncDeliveryRecord[]>(deliveryKey(projectId)) ?? [];
  }

  get(projectId: string, deliveryId: string): ExternalBookSyncDeliveryRecord | null {
    return this.list(projectId).find((record) => record.deliveryId === deliveryId) ?? null;
  }

  prepare(input: ExternalBookSyncDeliveryInput): ExternalBookSyncDeliveryRecord {
    const existing = this.get(input.projectId, input.deliveryId);
    if (existing && existing.plaintextHash === input.plaintextHash) {
      return existing;
    }
    const record: ExternalBookSyncDeliveryRecord = {
      ...input,
      emergencyDeliveredAt: null,
      observableDeliveredAt: null
    };
    this.save(record);
    return record;
  }

  markEmergencyDelivered(projectId: string, deliveryId: string, deliveredAt: string): ExternalBookSyncDeliveryRecord {
    return this.update(projectId, deliveryId, {
      emergencyDeliveredAt: deliveredAt,
      updatedAt: deliveredAt
    });
  }

  markObservableDelivered(projectId: string, deliveryId: string, deliveredAt: string): ExternalBookSyncDeliveryRecord {
    return this.update(projectId, deliveryId, {
      observableDeliveredAt: deliveredAt,
      updatedAt: deliveredAt
    });
  }

  clearEntry(input: {
    readonly projectId: string;
    readonly kind: ExternalBookSentChapterKind;
    readonly chapterIdentity: string;
    readonly sourceContentHash: string;
  }): number {
    const records = this.list(input.projectId);
    const next = records.filter((record) => (
      record.kind !== input.kind
      || record.chapterIdentity !== input.chapterIdentity
      || record.sourceContentHash !== input.sourceContentHash
    ));
    this.settingsRepo.setJson(deliveryKey(input.projectId), next);
    return records.length - next.length;
  }

  clear(projectId: string): number {
    const count = this.list(projectId).length;
    this.settingsRepo.setJson(deliveryKey(projectId), []);
    return count;
  }

  private update(
    projectId: string,
    deliveryId: string,
    patch: Pick<ExternalBookSyncDeliveryRecord, "updatedAt"> & Partial<ExternalBookSyncDeliveryRecord>
  ): ExternalBookSyncDeliveryRecord {
    const existing = this.get(projectId, deliveryId);
    if (!existing) {
      throw new Error("外部同步投递记录不存在。");
    }
    const record = { ...existing, ...patch };
    this.save(record);
    return record;
  }

  private save(record: ExternalBookSyncDeliveryRecord): void {
    const next = [
      record,
      ...this.list(record.projectId).filter((item) => item.deliveryId !== record.deliveryId)
    ].slice(0, MAX_STORED_DELIVERIES);
    this.settingsRepo.setJson(deliveryKey(record.projectId), next);
  }
}
