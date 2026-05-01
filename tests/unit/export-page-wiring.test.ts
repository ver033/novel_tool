import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("TXT export page wiring", () => {
  it("exposes export through IPC and the typed preload API", () => {
    const types = readSource("src/main/shared/types.ts");
    const schemas = readSource("src/main/shared/schemas.ts");
    const registerIpc = readSource("src/main/ipc/register-ipc.ts");
    const preload = readSource("src/preload/api.ts");

    expect(types).toContain("ExportTxtInput");
    expect(types).toContain("novelTool:export:selectTxtFilePath");
    expect(types).toContain("novelTool:export:exportTxt");
    expect(schemas).toContain("exportTxtInputSchema");
    expect(registerIpc).toContain("registerExportIpc");
    expect(preload).toContain("readonly export");
    expect(preload).toContain("selectTxtFilePath");
    expect(preload).toContain("exportTxt");
  });

  it("keeps export as a project-level writing action with its own real page", () => {
    const app = readSource("src/renderer/App.tsx");
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");
    const topBar = readSource("src/renderer/layout/TopBar.tsx");

    expect(existsSync(join(rootDir, "src/renderer/routes/ExportPage.tsx"))).toBe(true);
    expect(app).toContain('"export"');
    expect(app).toContain("returnFromExport");
    expect(app).toContain("onExport={openExport}");
    expect(writingPage).toContain("readonly onExport: () => void");
    expect(writingPage).toContain("handleExport");
    expect(writingPage).toContain("flushBeforeNavigation(onExport)");
    expect(topBar).toContain("DownloadSimple");
    expect(topBar).toContain("导出 TXT");
  });

  it("documents the V1 export boundary without AI or scratchpad content", () => {
    const exportPage = readSource("src/renderer/routes/ExportPage.tsx");

    expect(exportPage).toContain("api.export.selectTxtFilePath");
    expect(exportPage).toContain("api.export.exportTxt");
    expect(exportPage).toContain("草稿纸和 AI 记录不会进入正文导出");
    expect(exportPage).not.toContain("RightUtilitySidebar");
  });
});
