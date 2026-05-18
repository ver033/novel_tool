import { describe, expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { SettingsRepository } from "../../src/main/db/repositories/settings-repo";
import { ExternalBookSourceStore } from "../../src/main/external-book-sync/book-source-store";

describe("ExternalBookSourceStore", () => {
  it("stores source paths under a project-specific app settings key", () => {
    const db = createDatabase(":memory:");
    runMigrations(db);
    const store = new ExternalBookSourceStore(new SettingsRepository(db));

    store.upsertSource({
      projectId: "project_1",
      bookFilePath: "C:\\Books\\story.Book",
      displayName: "story.Book",
      lastKnownSize: 100,
      lastModifiedAt: "2026-05-18T00:00:00.000Z",
      lastContentHash: "hash",
      lastScanAt: "2026-05-18T00:00:00.000Z",
      confirmedAt: "2026-05-18T00:00:00.000Z"
    });

    expect(store.listSources("project_1")).toHaveLength(1);
    expect(store.listSources("project_2")).toEqual([]);
    db.close();
  });
});
