import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  outlineConfirmBulkImportInputSchema,
  outlineCreateEventInputSchema,
  outlinePreviewBulkImportInputSchema,
  outlinePreviewImportFileInputSchema
} from "../../src/main/shared/schemas";
import { ipcChannels } from "../../src/main/shared/types";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("outline IPC schemas and channels", () => {
  it("exposes outline channel names", () => {
    expect(ipcChannels.outline).toMatchObject({
      getOverview: "novelTool:outline:getOverview",
      listEvents: "novelTool:outline:listEvents",
      createEvent: "novelTool:outline:createEvent",
      updateEvent: "novelTool:outline:updateEvent",
      deleteEvent: "novelTool:outline:deleteEvent",
      reorderEvents: "novelTool:outline:reorderEvents",
      listThreads: "novelTool:outline:listThreads",
      createThread: "novelTool:outline:createThread",
      updateThread: "novelTool:outline:updateThread",
      deleteThread: "novelTool:outline:deleteThread",
      getChapterNote: "novelTool:outline:getChapterNote",
      saveChapterNote: "novelTool:outline:saveChapterNote",
      importLegacyChapterNote: "novelTool:outline:importLegacyChapterNote",
      selectImportFile: "novelTool:outline:selectImportFile",
      previewImportFile: "novelTool:outline:previewImportFile",
      previewBulkImport: "novelTool:outline:previewBulkImport",
      confirmBulkImport: "novelTool:outline:confirmBulkImport",
      undoImportBatch: "novelTool:outline:undoImportBatch"
    });
  });

  it("validates outline event input shape", () => {
    const parsed = outlineCreateEventInputSchema.parse({
      projectId: "project_1",
      chapterId: "chapter_1",
      title: "相遇",
      summary: "主角在雨夜遇见线人。",
      storyDate: null,
      storyTimeLabel: "案发当晚",
      weekdayLabel: "雨夜",
      storyTimeOrder: 10,
      daySegment: "night",
      customDaySegment: null,
      location: "旧码头",
      povCharacter: "林砚",
      characters: ["林砚", "线人"],
      goal: "拿到证据",
      conflict: "对方不信任他",
      outcome: "线人留下地址",
      foreshadowing: "红伞",
      notes: "压低节奏",
      status: "planned",
      threadIds: ["thread_1"]
    });

    expect(parsed.storyTimeLabel).toBe("案发当晚");
    expect(parsed.daySegment).toBe("night");
  });

  it("rejects unsupported outline import files", () => {
    expect(() =>
      outlinePreviewImportFileInputSchema.parse({
        projectId: "project_1",
        filePath: "/tmp/outline.numbers",
        mapping: {}
      })
    ).toThrow();
  });

  it("accepts paste import preview and confirm payloads", () => {
    expect(
      outlinePreviewBulkImportInputSchema.parse({
        projectId: "project_1",
        rawText: "章节\t故事时间\t场景摘要\n第一章\t案发当晚\t主角遇见线人"
      }).rawText
    ).toContain("主角");

    expect(
      outlineConfirmBulkImportInputSchema.parse({
        projectId: "project_1",
        importBatchId: "outline_import_1",
        rows: [
          {
            rowNumber: 2,
            chapterTitle: "第一章",
            chapterId: "chapter_1",
            storyDate: null,
            storyTimeLabel: "案发当晚",
            weekdayLabel: "",
            storyTimeOrder: 1,
            daySegment: "night",
            customDaySegment: null,
            threadNames: ["主线"],
            summary: "主角遇见线人",
            characters: ["主角", "线人"],
            location: "",
            status: "planned",
            warnings: []
          }
        ]
      }).rows
    ).toHaveLength(1);
  });

  it("wires outline service through main IPC and preload API", () => {
    const preload = readSource("src/preload/api.ts");
    const registerIpc = readSource("src/main/ipc/register-ipc.ts");
    const outlineIpc = readSource("src/main/ipc/outline-ipc.ts");

    expect(preload).toContain("readonly outline");
    expect(preload).toContain("selectImportFile: ()");
    expect(preload).toContain("getOverview: (input: OutlineGetOverviewInput)");
    expect(preload).toContain("previewImportFile: (input: OutlinePreviewImportFileInput)");
    expect(preload).toContain("confirmBulkImport: (input: OutlineConfirmBulkImportInput)");
    expect(preload).toContain("ipcChannels.outline.getOverview");
    expect(preload).toContain("ipcChannels.outline.selectImportFile");
    expect(preload).toContain("ipcChannels.outline.undoImportBatch");
    expect(registerIpc).toContain("registerOutlineIpc");
    expect(registerIpc).toContain("OutlineRepository");
    expect(registerIpc).toContain("OutlineService");
    expect(outlineIpc).toContain("allowSelectedOutlineImportFilePath");
    expect(outlineIpc).toContain("dialog.showOpenDialog");
    expect(outlineIpc).toContain("filters: [{ name: \"大纲文件\", extensions: [\"xlsx\", \"csv\"] }]");
    expect(outlineIpc).toContain("outlineGetOverviewInputSchema");
    expect(outlineIpc).toContain("outlineConfirmBulkImportInputSchema");
    expect(outlineIpc).toMatch(/ipcChannels\.outline\.previewImportFile[\s\S]*createValidatedIpcHandler/);
  });
});
