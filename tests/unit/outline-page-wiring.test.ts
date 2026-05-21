import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChapterSummary } from "../../src/main/shared/types";
import { buildOutlineSheetCellPatch, getOutlineSheetThreadText } from "../../src/renderer/routes/OutlinePage";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("author outline page wiring", () => {
  it("exposes the outline module as a real project page", () => {
    const app = readSource("src/renderer/App.tsx");
    const rail = readSource("src/renderer/layout/ProjectModuleRail.tsx");
    const pagePath = join(rootDir, "src/renderer/routes/OutlinePage.tsx");

    expect(existsSync(pagePath)).toBe(true);
    expect(app).toContain('"outline"');
    expect(app).toContain("OutlinePage");
    expect(app).toContain("openOutline");
    expect(rail).toContain('{ id: "outline", label: "大纲"');
    expect(rail).not.toMatch(/id: "outline"[\s\S]{0,120}disabled: true/);
  });

  it("keeps outline UI author-facing with timeline, optional chapter landing, and plotline views", () => {
    const page = readSource("src/renderer/routes/OutlinePage.tsx");
    const css = readSource("src/renderer/styles/globals.css");

    expect(page).toContain("api.outline.getOverview");
    expect(page).toContain("api.outline.createEvent");
    expect(page).toContain("api.outline.updateEvent");
    expect(page).toContain("api.outline.previewBulkImport");
    expect(page).toContain("api.outline.confirmBulkImport");
    expect(page).toContain("api.outline.clearImportedEvents");
    expect(page).toMatch(/async function confirmImport\(\)[\s\S]*try \{[\s\S]*api\.outline\.confirmBulkImport[\s\S]*catch \(reason\)/);
    expect(page).toMatch(/async function deleteSelectedEvent\(\)[\s\S]*try \{[\s\S]*api\.outline\.deleteEvent[\s\S]*catch \(reason\)/);
    expect(page).toContain("title={importFileName}");
    expect(page).toContain("清空导入内容");
    expect(page).toContain("只会删除通过导入创建的大纲场景");
    expect(page).toContain("importPreview.rows.length === 0");
    expect(page).toContain("时间线");
    expect(page).toContain("章节落点");
    expect(page).toContain("未安排章节");
    expect(page).toContain("关联章节（可选）");
    expect(page).toContain("plotlineGroups");
    expect(page).toContain("threadEvents.length === 0");
    expect(page).not.toContain("event.chapterId === chapter.id && event.threadIds.includes(thread.id)");
    expect(page).not.toContain("?? next.chapters[0]?.id");
    expect(page).not.toContain("未绑定章节");
    expect(page).toContain("情节线");
    expect(page).toContain("场景目标");
    expect(page).toContain("伏笔");
    expect(css).toContain(".outline-page");
    expect(css).toContain(".outline-workspace");
    expect(css).toContain(".outline-inspector");
    expect(css).toContain(".outline-import-file strong");
    expect(css).toContain("text-overflow: ellipsis");
    expect(css).toContain(".outline-import-error");
  });

  it("adds an Excel-like outline sheet view with direct cell editing", () => {
    const page = readSource("src/renderer/routes/OutlinePage.tsx");
    const css = readSource("src/renderer/styles/globals.css");
    const event = {
      id: "outline_event_1",
      projectId: "project_1",
      chapterId: "chapter_1",
      title: "初见",
      summary: "主角进入学校",
      storyDate: null,
      storyTimeLabel: "11月15日",
      weekdayLabel: "星期一",
      storyTimeOrder: 1,
      daySegment: "day",
      customDaySegment: null,
      location: "校门口",
      povCharacter: "方承业",
      characters: ["方承业"],
      goal: "",
      conflict: "",
      outcome: "",
      foreshadowing: "",
      notes: "",
      status: "planned",
      eventOrder: 1,
      importBatchId: null,
      threadIds: ["thread_1"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    } as const;
    const chapters: readonly ChapterSummary[] = [
      {
        id: "chapter_1",
        projectId: "project_1",
        title: "第一章",
        volumeTitle: null,
        sortOrder: 1,
        wordCount: 0,
        dailyWordCount: 0,
        dailyWordCountDate: null,
        targetWordCount: null,
        status: "drafting",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ];
    const threads = [
      { id: "thread_1", projectId: "project_1", name: "主线", color: "#2278e7", sortOrder: 0, createdAt: "", updatedAt: "" }
    ] as const;

    expect(page).toContain('{ value: "sheet", label: "表格"');
    expect(page).toContain("async function saveSheetCell");
    expect(page).toContain("startSheetColumnResize");
    expect(page).toContain("startSheetRowResize");
    expect(page).toContain("outlineSheetGridTemplate");
    expect(page).toContain("outline-sheet-column-resizer");
    expect(page).toContain("outline-sheet-row-resizer");
    expect(page).toContain('viewMode === "sheet"');
    expect(page).toContain("outline-layout-sheet");
    expect(page).toContain("outline-sheet-grid");
    expect(page).toContain("onBlur={(inputEvent) => { void saveSheetCell");
    expect(page).toContain("getOutlineSheetThreadText");
    expect(page).toContain("buildOutlineSheetCellPatch");
    expect(css).toContain(".outline-sheet-grid");
    expect(css).toContain(".outline-sheet-cell");
    expect(css).toContain(".outline-layout-sheet");
    expect(css).toContain(".outline-sheet-column-resizer");
    expect(css).toContain(".outline-sheet-row-resizer");
    expect(css).toContain("cursor: col-resize");
    expect(css).toContain("cursor: row-resize");

    expect(getOutlineSheetThreadText(event, threads)).toBe("主线");
    expect(buildOutlineSheetCellPatch("daySegment", "凌晨", event, chapters, threads)).toMatchObject({
      ok: true,
      patch: { daySegment: "custom", customDaySegment: "凌晨" }
    });
    expect(buildOutlineSheetCellPatch("threadNames", "主线、感情线", event, chapters, threads)).toMatchObject({
      ok: true,
      missingThreadNames: ["感情线"],
      patch: { threadIds: ["thread_1"] }
    });
    expect(buildOutlineSheetCellPatch("summary", "   ", event, chapters, threads)).toEqual({
      ok: false,
      error: "场景摘要不能为空。"
    });
  });

  it("treats author outline data as project-authored content in shareable copies", () => {
    const settings = readSource("src/renderer/routes/SettingsPage.tsx");
    const exporter = readSource("src/main/export/shareable-project-exporter.ts");

    expect(settings).toContain("章节正文 / 人物关系设定 / 大纲规划");
    expect(exporter).toContain("\"大纲规划\"");
    expect(exporter).not.toContain("outline_import_file_path");
  });
});
