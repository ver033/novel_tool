import { describe, expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { SettingsRepository } from "../../src/main/db/repositories/settings-repo";
import { ExternalBookSourceStore } from "../../src/main/external-book-sync/book-source-store";

describe("ExternalBookSourceStore", () => {
  it("stores source folder paths under a project-specific app settings key", () => {
    const db = createDatabase(":memory:");
    runMigrations(db);
    const store = new ExternalBookSourceStore(new SettingsRepository(db));

    store.upsertSource({
      projectId: "project_1",
      bookFolderPath: "C:\\Books",
      displayName: "story.Book",
      lastKnownSize: 100,
      lastModifiedAt: "2026-05-18T00:00:00.000Z",
      lastContentHash: "hash",
      lastScanAt: "2026-05-18T00:00:00.000Z",
      confirmedAt: "2026-05-18T00:00:00.000Z"
    });

    expect(store.listSources("project_1")).toHaveLength(1);
    expect(store.listSources("project_1")[0]).toMatchObject({
      bookFolderPath: "C:\\Books",
      displayName: "story.Book"
    });
    expect(store.listSources("project_2")).toEqual([]);
    db.close();
  });

  it("normalizes legacy saved file paths to source folders", () => {
    const db = createDatabase(":memory:");
    runMigrations(db);
    const settings = new SettingsRepository(db);
    settings.setJson("externalBookSyncSources:project_1", [
      {
        id: "source_legacy",
        projectId: "project_1",
        bookFilePath: "C:\\Books\\story.Book",
        displayName: "story.Book",
        lastKnownSize: 100,
        lastModifiedAt: "2026-05-18T00:00:00.000Z",
        lastContentHash: "hash",
        lastScanAt: "2026-05-18T00:00:00.000Z",
        confirmedAt: "2026-05-18T00:00:00.000Z"
      }
    ]);
    const store = new ExternalBookSourceStore(settings);

    expect(store.listSources("project_1")[0]).toMatchObject({
      bookFolderPath: "C:\\Books",
      displayName: "story.Book"
    });
    expect("bookFilePath" in store.listSources("project_1")[0]).toBe(false);
    db.close();
  });
});
