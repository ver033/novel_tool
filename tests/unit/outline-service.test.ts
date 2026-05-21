import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { OutlineRepository } from "../../src/main/db/repositories/outline-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { OutlineService } from "../../src/main/outline/outline-service";
import { allowSelectedOutlineImportFilePath } from "../../src/main/security/file-access";
import { outlineConfirmBulkImportInputSchema } from "../../src/main/shared/schemas";
import type { OutlineBulkImportPreview } from "../../src/main/shared/types";

const tempDirs: string[] = [];
let db: SqliteDatabase;
let service: OutlineService;

function mutablePreviewRows(preview: OutlineBulkImportPreview) {
  return preview.rows.map((row) => ({
    ...row,
    threadNames: [...row.threadNames],
    characters: [...row.characters],
    warnings: [...row.warnings]
  }));
}

function createTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-outline-service-"));
  tempDirs.push(dir);
  return join(dir, "novel-tool.sqlite3");
}

function createProject(projectId: string, name = projectId): void {
  db.prepare("INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    projectId,
    name,
    null,
    "2026-05-21T00:00:00.000Z",
    "2026-05-21T00:00:00.000Z"
  );
}

function createChapter(projectId: string, chapterId: string, title: string, sortOrder: number): void {
  db.prepare(
    `INSERT INTO chapters (
      id, project_id, title, volume_title, sort_order, content_json, plain_text,
      word_count, daily_word_count, daily_word_count_date, target_word_count, status, created_at, updated_at, content_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    chapterId,
    projectId,
    title,
    null,
    sortOrder,
    JSON.stringify({ type: "doc", content: [] }),
    "",
    0,
    0,
    null,
    null,
    "draft",
    "2026-05-21T00:00:00.000Z",
    "2026-05-21T00:00:00.000Z",
    "2026-05-21T00:00:00.000Z"
  );
}

beforeEach(() => {
  db = createDatabase(createTempDbPath());
  runMigrations(db);
  service = new OutlineService(new OutlineRepository(db), new ProjectRepository(db), new ChapterRepository(db));
  createProject("project_1", "测试项目");
  createProject("project_2", "另一个项目");
  createChapter("project_1", "chapter_1", "第一章", 1);
  createChapter("project_1", "chapter_2", "第二章", 2);
  createChapter("project_2", "chapter_other", "外部章节", 1);
});

afterEach(() => {
  db.close();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("OutlineService", () => {
  it("rejects events bound to chapters from another project", () => {
    expect(() =>
      service.createEvent({
        projectId: "project_1",
        chapterId: "chapter_other",
        title: "错误章节",
        summary: "不应该写入。",
        storyDate: null,
        storyTimeLabel: "",
        weekdayLabel: "",
        storyTimeOrder: null,
        daySegment: "unknown",
        customDaySegment: null,
        location: "",
        povCharacter: "",
        characters: [],
        goal: "",
        conflict: "",
        outcome: "",
        foreshadowing: "",
        notes: "",
        status: "planned",
        threadIds: []
      })
    ).toThrow("章节不属于当前项目");
  });

  it("previews pasted outline rows without writing, then confirms in one import batch", () => {
    const preview = service.previewBulkImport({
      projectId: "project_1",
      rawText: "章节\t故事时间\t时间段\t情节线\t场景摘要\n第一章\t案发当晚\t晚上\t主线\t主角遇见线人"
    });

    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({ chapterId: "chapter_1", threadNames: ["主线"], summary: "主角遇见线人" });
    expect(service.listEvents({ projectId: "project_1" })).toEqual([]);

    const result = service.confirmBulkImport({
      projectId: "project_1",
      importBatchId: preview.importBatchId,
      rows: mutablePreviewRows(preview)
    });

    expect(result).toEqual({ importedCount: 1, createdThreadCount: 1 });
    expect(service.listEvents({ projectId: "project_1" })[0]).toMatchObject({
      chapterId: "chapter_1",
      importBatchId: preview.importBatchId,
      threadIds: [expect.any(String)]
    });
  });

  it("imports matrix outline rows as unbound full-book events with plotline threads", () => {
    const preview = service.previewBulkImport({
      projectId: "project_1",
      rawText: "日期,星期,白天/晚上,吕老师线,马俊明线\n11月15日,星期二,白天,吕老师第一阶段1,马俊明学校被揍\n,,晚上,吕老师第一阶段2,"
    });

    expect(preview.rows).toHaveLength(3);
    expect(preview.rows.every((row) => row.chapterId === null)).toBe(true);

    const result = service.confirmBulkImport({
      projectId: "project_1",
      importBatchId: preview.importBatchId,
      rows: mutablePreviewRows(preview)
    });
    const events = service.listEvents({ projectId: "project_1" });
    const threads = service.listThreads({ projectId: "project_1" });

    expect(result).toEqual({ importedCount: 3, createdThreadCount: 2 });
    expect(events.map((event) => event.chapterId)).toEqual([null, null, null]);
    expect(events.every((event) => event.threadIds.length === 1)).toBe(true);
    expect(threads.map((thread) => thread.name)).toEqual(["吕老师线", "马俊明线"]);
  });

  it("sanitizes oversized imported cells before the preview is confirmed through IPC", () => {
    const longSummary = "很长的场景摘要".repeat(400);
    const longTime = "非常非常长的故事时间标签".repeat(8);
    const longThread = "非常非常长的情节线名称".repeat(8);
    const longCharacter = "非常非常长的人物称呼".repeat(8);
    const characters = Array.from({ length: 35 }, (_, index) => `${longCharacter}${index}`).join("、");
    const preview = service.previewBulkImport({
      projectId: "project_1",
      rawText: `章节\t故事时间\t星期/备注\t时间段\t情节线\t场景摘要\t角色\t地点\n第一章\t${longTime}\t${longTime}\t${longTime}\t${longThread}\t${longSummary}\t${characters}\t${longSummary}`
    });
    const rows = mutablePreviewRows(preview);

    expect(rows[0].warnings.length).toBeGreaterThan(0);
    expect(outlineConfirmBulkImportInputSchema.safeParse({ projectId: "project_1", importBatchId: preview.importBatchId, rows }).success).toBe(true);
  });

  it("keeps large import previews inside the confirm IPC batch limit", () => {
    const rows = Array.from({ length: 5002 }, (_, index) => `第一章\t导入场景 ${index + 1}`).join("\n");
    const preview = service.previewBulkImport({
      projectId: "project_1",
      rawText: `章节\t场景摘要\n${rows}`
    });
    const confirmRows = mutablePreviewRows(preview);

    expect(confirmRows).toHaveLength(5000);
    expect(preview.skippedRows).toHaveLength(2);
    expect(preview.skippedRows[0]).toMatchObject({ rowNumber: 5002 });
    expect(outlineConfirmBulkImportInputSchema.safeParse({ projectId: "project_1", importBatchId: preview.importBatchId, rows: confirmRows }).success).toBe(true);
  });

  it("reads outline import files only after the user selected the path", () => {
    const filePath = join(tempDirs[0], "outline.csv");
    writeFileSync(filePath, "章节,场景摘要\n第一章,文件导入事件", "utf8");

    expect(() => service.previewImportFile({ projectId: "project_1", filePath })).toThrow("大纲导入文件必须通过选择文件按钮打开");

    allowSelectedOutlineImportFilePath(filePath);
    const preview = service.previewImportFile({ projectId: "project_1", filePath });

    expect(preview.rows[0]).toMatchObject({ chapterId: "chapter_1", summary: "文件导入事件" });
  });

  it("rolls back imported threads when batch import validation fails", () => {
    const preview = service.previewBulkImport({
      projectId: "project_1",
      rawText: "章节\t情节线\t场景摘要\n第一章\t新情节线\t有效事件\n第二章\t新情节线\t无效事件"
    });
    const rows = mutablePreviewRows(preview);
    rows[1] = { ...rows[1], chapterId: "chapter_other" };

    expect(() => service.confirmBulkImport({ projectId: "project_1", importBatchId: preview.importBatchId, rows })).toThrow("章节不属于当前项目");
    expect(service.listThreads({ projectId: "project_1" })).toEqual([]);
    expect(service.listEvents({ projectId: "project_1" })).toEqual([]);
  });

  it("imports legacy chapter notes only when safe", () => {
    const first = service.importLegacyChapterNote({ projectId: "project_1", chapterId: "chapter_1", content: "旧细纲" });
    expect(first.content).toBe("旧细纲");
    expect(() => service.importLegacyChapterNote({ projectId: "project_1", chapterId: "chapter_1", content: "覆盖" })).toThrow("已有章节细纲");

    const overwritten = service.importLegacyChapterNote({ projectId: "project_1", chapterId: "chapter_1", content: "覆盖", overwrite: true });
    expect(overwritten.content).toBe("覆盖");
  });

  it("undoes only the selected import batch", () => {
    const one = service.previewBulkImport({ projectId: "project_1", rawText: "章节\t场景摘要\n第一章\t事件一" });
    const two = service.previewBulkImport({ projectId: "project_1", rawText: "章节\t场景摘要\n第二章\t事件二" });
    service.confirmBulkImport({ projectId: "project_1", importBatchId: one.importBatchId, rows: mutablePreviewRows(one) });
    service.confirmBulkImport({ projectId: "project_1", importBatchId: two.importBatchId, rows: mutablePreviewRows(two) });

    expect(service.undoImportBatch({ projectId: "project_1", importBatchId: one.importBatchId })).toEqual({ deletedCount: 1 });
    expect(service.listEvents({ projectId: "project_1" }).map((event) => event.summary)).toEqual(["事件二"]);
  });

  it("clears all imported outline events without deleting author-created events", () => {
    const one = service.previewBulkImport({ projectId: "project_1", rawText: "章节\t场景摘要\n第一章\t导入事件一" });
    const two = service.previewBulkImport({ projectId: "project_1", rawText: "章节\t场景摘要\n第二章\t导入事件二" });
    service.confirmBulkImport({ projectId: "project_1", importBatchId: one.importBatchId, rows: mutablePreviewRows(one) });
    service.confirmBulkImport({ projectId: "project_1", importBatchId: two.importBatchId, rows: mutablePreviewRows(two) });
    service.createEvent({
      projectId: "project_1",
      chapterId: "chapter_1",
      title: "手动场景",
      summary: "作者手动创建的场景不能被清空。",
      storyDate: null,
      storyTimeLabel: "",
      weekdayLabel: "",
      storyTimeOrder: null,
      daySegment: "unknown",
      customDaySegment: null,
      location: "",
      povCharacter: "",
      characters: [],
      goal: "",
      conflict: "",
      outcome: "",
      foreshadowing: "",
      notes: "",
      status: "planned",
      threadIds: []
    });

    expect(service.clearImportedEvents({ projectId: "project_1" })).toEqual({ deletedCount: 2 });
    expect(service.listEvents({ projectId: "project_1" }).map((event) => event.summary)).toEqual(["作者手动创建的场景不能被清空。"]);
  });
});

const providedOutlineFixturePath = join(process.cwd(), "..", "test_novel", "大纲.xlsx");
const fixtureIt = existsSync(providedOutlineFixturePath) ? it : it.skip;

fixtureIt("imports the provided real outline workbook into events and plotline threads", () => {
  allowSelectedOutlineImportFilePath(providedOutlineFixturePath);
  const preview = service.previewImportFile({ projectId: "project_1", filePath: providedOutlineFixturePath });

  expect(preview.rows.length).toBeGreaterThan(10);
  expect(preview.newThreadNames.length).toBeGreaterThan(0);

  service.confirmBulkImport({
    projectId: "project_1",
    importBatchId: preview.importBatchId,
    rows: mutablePreviewRows(preview)
  });

  const overview = service.getOverview({ projectId: "project_1" });

  expect(overview.events.length).toBe(preview.rows.length);
  expect(overview.threads.length).toBeGreaterThan(0);
  expect(overview.events.some((event) => event.chapterId === null)).toBe(true);
  expect(overview.events.filter((event) => event.threadIds.length > 0).length).toBeGreaterThan(10);
});

fixtureIt("keeps the provided real outline workbook confirm payload valid for IPC", () => {
  allowSelectedOutlineImportFilePath(providedOutlineFixturePath);
  const preview = service.previewImportFile({ projectId: "project_1", filePath: providedOutlineFixturePath });

  const parsed = outlineConfirmBulkImportInputSchema.safeParse({
    projectId: "project_1",
    importBatchId: preview.importBatchId,
    rows: mutablePreviewRows(preview)
  });

  expect(parsed.success).toBe(true);
});
