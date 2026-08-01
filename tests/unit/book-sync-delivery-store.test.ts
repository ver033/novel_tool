import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { SettingsRepository } from "../../src/main/db/repositories/settings-repo";
import { ExternalBookSyncDeliveryStore } from "../../src/main/external-book-sync/book-sync-delivery-store";

const databases: SqliteDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

describe("ExternalBookSyncDeliveryStore", () => {
  it("persists the original ciphertext and emergency state across service recreation", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    runMigrations(database);
    const firstStore = new ExternalBookSyncDeliveryStore(new SettingsRepository(database));
    firstStore.prepare({
      deliveryId: "external_book_delivery_1",
      projectId: "project_1",
      kind: "missing_chapter",
      chapterIdentity: "ordinal:2",
      sourceContentHash: "source-hash",
      partIndex: 0,
      partCount: 2,
      plaintextHash: "plaintext-hash",
      encryptedMessage: "MOSHU-AES1.persisted-ciphertext",
      updatedAt: "2026-08-01T00:00:00.000Z"
    });
    firstStore.markEmergencyDelivered("project_1", "external_book_delivery_1", "2026-08-01T00:01:00.000Z");

    const reopenedStore = new ExternalBookSyncDeliveryStore(new SettingsRepository(database));

    expect(reopenedStore.get("project_1", "external_book_delivery_1")).toMatchObject({
      encryptedMessage: "MOSHU-AES1.persisted-ciphertext",
      emergencyDeliveredAt: "2026-08-01T00:01:00.000Z",
      observableDeliveredAt: null
    });
  });
});
