import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("summary worker runtime settings", () => {
  it("polls background summary jobs frequently enough to avoid per-chapter idle gaps", () => {
    const source = readSource("src/main/ipc/register-ipc.ts");

    expect(source).toContain("const SUMMARY_WORKER_INTERVAL_MS = 3_000");
    expect(source).toContain("}, SUMMARY_WORKER_INTERVAL_MS)");
    expect(source).not.toContain("}, 30_000)");
  });

  it("does not restart automatic background indexing while the project switch is disabled", () => {
    const source = readSource("src/main/ipc/register-ipc.ts");
    const repository = readSource("src/main/db/repositories/summary-repo.ts");
    const sharedDefaults = readSource("src/main/shared/summary-index-settings.ts");
    const settingsPage = readSource("src/renderer/routes/SettingsPage.tsx");

    expect(source).toContain("summaryRepo.getBackgroundIndexEnabled(currentProject.id)");
    expect(source).toContain("return createSummaryService(input.projectId).setBackgroundIndexEnabled");
    expect(source).toContain("setBackgroundIndexEnabled(input.projectId, false");
    expect(sharedDefaults).toContain("DEFAULT_BACKGROUND_INDEX_ENABLED = false");
    expect(repository).toContain("return DEFAULT_BACKGROUND_INDEX_ENABLED");
    expect(settingsPage).toContain("indexStatus?.backgroundEnabled ?? DEFAULT_BACKGROUND_INDEX_ENABLED");
  });
});
