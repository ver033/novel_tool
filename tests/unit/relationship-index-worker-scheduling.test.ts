import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("relationship index worker scheduling", () => {
  it("does not schedule a standalone relationship LLM worker after summary worker checks", () => {
    const source = readSource("src/main/ipc/register-ipc.ts");

    expect(source).not.toContain('import { RelationshipIndexWorker } from "../relationships/relationship-index-worker"');
    expect(source).not.toContain("let activeRelationshipWorker");
    expect(source).toContain("if (activeSummaryWorker)");
    expect(source).toContain("summaryService.enqueueEligibleStaleChapterSummaries(currentProject.id, now)");
    expect(source).toContain("const hasRunnableSummaryJob = Boolean(summaryRepo.peekNextSummaryJob(currentProject.id, now))");
    expect(source).toContain("if (hasRunnableSummaryJob)");
    expect(source).toContain("summaryService.materializeEligibleRelationshipIndexes(currentProject.id, now)");
    expect(source).not.toContain("relationshipService.enqueueEligibleStableChapters(currentProject.id, now)");
    expect(source).not.toContain("relationshipService.peekNextRelationshipJob(currentProject.id, now)");
    expect(source).not.toContain("new RelationshipIndexWorker");
  });

  it("keeps relationship cache piggybacked on summary cache instead of recovering standalone jobs", () => {
    const source = readSource("src/main/ipc/register-ipc.ts");

    expect(source).not.toContain("const recoveredRelationshipJobProjects = new Set<string>()");
    expect(source).not.toContain("relationshipIndexRepo.resetRunningJobs(currentProject.id, now)");
    expect(source.match(/isForegroundAiActive: \(\) => aiTaskService\.hasActiveStreams\(\)/g)?.length).toBe(1);
    expect(source).toContain("relationshipIndexRepo: resolveRelationshipIndexRepo(projectId)");
  });
});
