import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { WritingGoalRepository } from "../../src/main/db/repositories/writing-goal-repo";
import { countWritingUnits } from "../../src/main/shared/text";
import { WritingGoalService } from "../../src/main/writing-goals/writing-goal-service";
import { createTiptapDocumentFromPlainText } from "../../src/renderer/editor/tiptap/converters";

const tempDirs: string[] = [];
const databases: SqliteDatabase[] = [];

function createTestDatabase() {
  const dir = mkdtempSync(join(tmpdir(), "moshu-writing-goals-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "test.sqlite3"));
  databases.push(db);
  runMigrations(db);
  return db;
}

function createProject(projectRepo: ProjectRepository, projectId = "project_1") {
  return projectRepo.create({
    id: projectId,
    name: projectId,
    rootPath: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  });
}

function createChapter(
  chapterRepo: ChapterRepository,
  input: {
    readonly projectId: string;
    readonly chapterId: string;
    readonly title: string;
    readonly text: string;
  }
) {
  const createdAt = "2026-05-01T00:00:00.000Z";
  const wordCount = countWritingUnits(input.text);
  return chapterRepo.create({
    id: input.chapterId,
    projectId: input.projectId,
    title: input.title,
    volumeTitle: "第一卷",
    sortOrder: chapterRepo.nextSortOrder(input.projectId),
    contentJson: createTiptapDocumentFromPlainText(input.text),
    plainText: input.text,
    wordCount,
    dailyWordCount: 0,
    dailyWordCountDate: null,
    targetWordCount: null,
    status: "draft",
    createdAt,
    updatedAt: createdAt,
    contentUpdatedAt: createdAt
  });
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("WritingGoalService", () => {
  it("creates a total-word goal from the current project word count and generates daily plans", () => {
    const db = createTestDatabase();
    const projectId = "project_1";
    createProject(new ProjectRepository(db), projectId);
    const chapterRepo = new ChapterRepository(db);
    createChapter(chapterRepo, { projectId, chapterId: "chapter_1", title: "第一章", text: "一".repeat(400) });
    createChapter(chapterRepo, { projectId, chapterId: "chapter_2", title: "第二章", text: "二".repeat(200) });
    const repo = new WritingGoalRepository(db);
    const service = new WritingGoalService(repo);

    const goal = service.createGoal({
      projectId,
      name: "完稿目标",
      goalType: "total_words",
      targetWordCount: 2_000,
      startDate: "2026-05-01",
      deadlineDate: "2026-05-07",
      activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
      restDates: []
    });
    const overview = service.getOverview(projectId, "2026-05-01");
    const plans = repo.listDailyPlans(projectId, "2026-05-01", "2026-05-07");

    expect(goal.baselineWordCount).toBe(600);
    expect(overview.currentTotalWordCount).toBe(600);
    expect(overview.progressWords).toBe(600);
    expect(overview.remainingWords).toBe(1_400);
    expect(overview.requiredPerDay).toBe(200);
    expect(plans).toHaveLength(7);
    expect(plans.every((plan) => plan.plannedWords === 200 && plan.isWritingDay)).toBe(true);
  });

  it("does not generate daily plans before a future goal start date when the goal changes", () => {
    const db = createTestDatabase();
    const projectId = "project_1";
    createProject(new ProjectRepository(db), projectId);
    createChapter(new ChapterRepository(db), { projectId, chapterId: "chapter_1", title: "第一章", text: "字".repeat(500) });
    const repo = new WritingGoalRepository(db);
    const service = new WritingGoalService(repo);
    const goal = service.createGoal({
      projectId,
      name: "未来目标",
      goalType: "total_words",
      targetWordCount: 2_000,
      startDate: "2099-01-01",
      deadlineDate: "2099-01-03",
      activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
      restDates: []
    });

    service.updateGoal({
      projectId,
      goalId: goal.id,
      patch: {
        targetWordCount: 2_400
      }
    });
    service.pauseGoal({ projectId, goalId: goal.id });
    service.resumeGoal({ projectId, goalId: goal.id });

    expect(repo.listDailyPlans(projectId, "2000-01-01", "2098-12-31")).toHaveLength(0);
    expect(repo.listDailyPlans(projectId, "2099-01-01", "2099-01-03")).toHaveLength(3);
  });

  it("supports added-word goals with rest days excluded from required daily output", () => {
    const db = createTestDatabase();
    const projectId = "project_1";
    createProject(new ProjectRepository(db), projectId);
    const chapterRepo = new ChapterRepository(db);
    createChapter(chapterRepo, { projectId, chapterId: "chapter_1", title: "第一章", text: "字".repeat(1_000) });
    const repo = new WritingGoalRepository(db);
    const service = new WritingGoalService(repo);

    service.createGoal({
      projectId,
      name: "本周新增",
      goalType: "added_words",
      targetWordCount: 900,
      startDate: "2026-05-01",
      deadlineDate: "2026-05-05",
      activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
      restDates: ["2026-05-03"]
    });
    const overview = service.getOverview(projectId, "2026-05-01");
    const plans = repo.listDailyPlans(projectId, "2026-05-01", "2026-05-05");

    expect(overview.progressWords).toBe(0);
    expect(overview.remainingWords).toBe(900);
    expect(overview.requiredPerDay).toBe(225);
    expect(plans.find((plan) => plan.localDate === "2026-05-03")).toMatchObject({
      plannedWords: 0,
      isRestDay: true,
      isWritingDay: false
    });
  });

  it("records word deltas, updates daily stats, and recalculates current and future plans", () => {
    const db = createTestDatabase();
    const projectId = "project_1";
    createProject(new ProjectRepository(db), projectId);
    const chapterRepo = new ChapterRepository(db);
    const chapter = createChapter(chapterRepo, { projectId, chapterId: "chapter_1", title: "第一章", text: "旧".repeat(1_000) });
    const repo = new WritingGoalRepository(db);
    const service = new WritingGoalService(repo);
    service.createGoal({
      projectId,
      name: "四日目标",
      goalType: "total_words",
      targetWordCount: 1_600,
      startDate: "2026-05-01",
      deadlineDate: "2026-05-04",
      activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
      restDates: []
    });
    const beforePlan = repo.getDailyPlan(projectId, repo.getActiveOrPausedGoal(projectId)?.id ?? "", "2026-05-02");

    const nextText = "新".repeat(1_250);
    chapterRepo.saveContent(
      chapter.id,
      createTiptapDocumentFromPlainText(nextText),
      nextText,
      countWritingUnits(nextText),
      250,
      "2026-05-02",
      "2026-05-02T09:00:00.000Z"
    );
    const event = service.recordWordDelta({
      projectId,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      chapterSortOrder: chapter.sortOrder,
      previousWordCount: 1_000,
      nextWordCount: 1_250,
      previousProjectWordCount: 1_000,
      nextProjectWordCount: 1_250,
      now: "2026-05-02T09:00:00.000Z"
    });

    expect(event).toMatchObject({ deltaWords: 250, localDate: "2026-05-02", source: "manual" });
    expect(repo.getDailyStat(projectId, "2026-05-02")).toMatchObject({
      addedWords: 250,
      deletedWords: 0,
      netWords: 250,
      eventCount: 1
    });
    expect(beforePlan?.plannedWords).toBe(150);
    expect(repo.getDailyPlan(projectId, event?.goalId ?? "", "2026-05-02")?.plannedWords).toBe(117);
    expect(repo.getDailyPlan(projectId, event?.goalId ?? "", "2026-05-03")?.plannedWords).toBe(117);
  });

  it("reverts today's recommendation when newly written words are deleted on the same day", () => {
    const db = createTestDatabase();
    const projectId = "project_1";
    createProject(new ProjectRepository(db), projectId);
    const chapterRepo = new ChapterRepository(db);
    const chapter = createChapter(chapterRepo, { projectId, chapterId: "chapter_1", title: "第一章", text: "旧".repeat(1_000) });
    const repo = new WritingGoalRepository(db);
    const service = new WritingGoalService(repo);
    const goal = service.createGoal({
      projectId,
      name: "四日目标",
      goalType: "total_words",
      targetWordCount: 1_600,
      startDate: "2026-05-01",
      deadlineDate: "2026-05-04",
      activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
      restDates: []
    });

    const writtenText = "新".repeat(1_250);
    chapterRepo.saveContent(
      chapter.id,
      createTiptapDocumentFromPlainText(writtenText),
      writtenText,
      countWritingUnits(writtenText),
      250,
      "2026-05-02",
      "2026-05-02T09:00:00.000Z"
    );
    service.recordWordDelta({
      projectId,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      chapterSortOrder: chapter.sortOrder,
      previousWordCount: 1_000,
      nextWordCount: 1_250,
      previousProjectWordCount: 1_000,
      nextProjectWordCount: 1_250,
      now: "2026-05-02T09:00:00.000Z"
    });

    const revertedText = "旧".repeat(1_000);
    chapterRepo.saveContent(
      chapter.id,
      createTiptapDocumentFromPlainText(revertedText),
      revertedText,
      countWritingUnits(revertedText),
      -250,
      "2026-05-02",
      "2026-05-02T10:00:00.000Z"
    );
    service.recordWordDelta({
      projectId,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      chapterSortOrder: chapter.sortOrder,
      previousWordCount: 1_250,
      nextWordCount: 1_000,
      previousProjectWordCount: 1_250,
      nextProjectWordCount: 1_000,
      now: "2026-05-02T10:00:00.000Z"
    });

    const overview = service.getOverview(projectId, "2026-05-02");

    expect(repo.getDailyStat(projectId, "2026-05-02")).toMatchObject({
      addedWords: 250,
      deletedWords: 250,
      netWords: 0,
      eventCount: 2
    });
    expect(repo.getDailyPlan(projectId, goal.id, "2026-05-02")?.plannedWords).toBe(200);
    expect(overview.today.plannedWords).toBe(200);
    expect(overview.today.remainingTodayWords).toBe(200);
  });

  it("refreshes today's plan when a later day opens without a new writing event", () => {
    const db = createTestDatabase();
    const projectId = "project_1";
    createProject(new ProjectRepository(db), projectId);
    const chapterRepo = new ChapterRepository(db);
    createChapter(chapterRepo, { projectId, chapterId: "chapter_1", title: "第一章", text: "旧".repeat(1_000) });
    const repo = new WritingGoalRepository(db);
    const service = new WritingGoalService(repo);
    const goal = service.createGoal({
      projectId,
      name: "四日目标",
      goalType: "total_words",
      targetWordCount: 1_600,
      startDate: "2026-05-01",
      deadlineDate: "2026-05-04",
      activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
      restDates: []
    });

    const overview = service.getOverview(projectId, "2026-05-02");

    expect(repo.getDailyPlan(projectId, goal.id, "2026-05-01")?.plannedWords).toBe(150);
    expect(overview.requiredPerDay).toBe(200);
    expect(overview.today.plannedWords).toBe(200);
    expect(repo.getDailyPlan(projectId, goal.id, "2026-05-02")?.plannedWords).toBe(200);
    expect(repo.getDailyPlan(projectId, goal.id, "2026-05-03")?.plannedWords).toBe(200);
  });

  it("creates a system adjustment event when chapter totals drift outside tracked writing events", () => {
    const db = createTestDatabase();
    const projectId = "project_1";
    createProject(new ProjectRepository(db), projectId);
    const chapterRepo = new ChapterRepository(db);
    const chapter = createChapter(chapterRepo, { projectId, chapterId: "chapter_1", title: "第一章", text: "旧".repeat(300) });
    const repo = new WritingGoalRepository(db);
    const service = new WritingGoalService(repo);
    service.createGoal({
      projectId,
      name: "校准目标",
      goalType: "total_words",
      targetWordCount: 1_000,
      startDate: "2026-05-01",
      deadlineDate: "2026-05-05",
      activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
      restDates: []
    });

    const nextText = "补".repeat(500);
    chapterRepo.saveContent(
      chapter.id,
      createTiptapDocumentFromPlainText(nextText),
      nextText,
      countWritingUnits(nextText),
      200,
      "2026-05-02",
      "2026-05-02T09:00:00.000Z"
    );
    const overview = service.getOverview(projectId, "2026-05-02");
    const events = repo.getDayEvents(projectId, "2026-05-02");

    expect(overview.warning).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: "system",
      deltaWords: 200,
      previousProjectWordCount: 300,
      nextProjectWordCount: 500
    });
    expect(repo.getDailyStat(projectId, "2026-05-02")?.netWords).toBe(200);
    expect(repo.getDailyPlan(projectId, events[0].goalId ?? "", "2026-05-02")?.plannedWords).toBe(125);
  });

  it("keeps writing events available even before the author creates a goal", () => {
    const db = createTestDatabase();
    const projectId = "project_1";
    createProject(new ProjectRepository(db), projectId);
    createChapter(new ChapterRepository(db), { projectId, chapterId: "chapter_1", title: "第一章", text: "" });
    const repo = new WritingGoalRepository(db);
    const service = new WritingGoalService(repo);

    const event = service.recordWordDelta({
      projectId,
      chapterId: "chapter_1",
      chapterTitle: "第一章",
      chapterSortOrder: 0,
      previousWordCount: 0,
      nextWordCount: 120,
      previousProjectWordCount: 0,
      nextProjectWordCount: 120,
      now: "2026-05-02T09:00:00.000Z"
    });

    expect(event).toMatchObject({ goalId: null, deltaWords: 120 });
    expect(repo.getDailyStat(projectId, "2026-05-02")?.netWords).toBe(120);
  });
});
