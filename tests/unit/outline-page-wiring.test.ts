import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
    expect(page).toMatch(/async function confirmImport\(\)[\s\S]*try \{[\s\S]*api\.outline\.confirmBulkImport[\s\S]*catch \(reason\)/);
    expect(page).toMatch(/async function deleteSelectedEvent\(\)[\s\S]*try \{[\s\S]*api\.outline\.deleteEvent[\s\S]*catch \(reason\)/);
    expect(page).toContain("title={importFileName}");
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

  it("treats author outline data as project-authored content in shareable copies", () => {
    const settings = readSource("src/renderer/routes/SettingsPage.tsx");
    const exporter = readSource("src/main/export/shareable-project-exporter.ts");

    expect(settings).toContain("章节正文 / 人物关系设定 / 大纲规划");
    expect(exporter).toContain("\"大纲规划\"");
    expect(exporter).not.toContain("outline_import_file_path");
  });
});
