import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("phase 7 import wizard wiring", () => {
  it("extracts import wizard steps into data-capable components", () => {
    for (const file of [
      "src/renderer/import/ImportFileStep.tsx",
      "src/renderer/import/ImportPreviewStep.tsx",
      "src/renderer/import/ImportConfirmStep.tsx"
    ]) {
      expect(existsSync(join(rootDir, file)), `${file} should exist`).toBe(true);
    }

    const page = readSource("src/renderer/routes/ImportWizardPage.tsx");
    expect(page).toContain("../import/ImportFileStep");
    expect(page).toContain("../import/ImportPreviewStep");
    expect(page).toContain("../import/ImportConfirmStep");
  });

  it("uses the typed preload import API instead of static import data", () => {
    const page = readSource("src/renderer/routes/ImportWizardPage.tsx");
    const fileStep = readSource("src/renderer/import/ImportFileStep.tsx");
    const previewStep = readSource("src/renderer/import/ImportPreviewStep.tsx");

    expect(page).toContain("api.import.selectTxtFile");
    expect(page).toContain("api.import.previewTxt");
    expect(page).toContain("api.import.updatePreview");
    expect(page).toContain("api.import.confirmTxtImport");
    expect(fileStep).toContain("作为新项目导入");
    expect(fileStep).toContain("导入到当前项目");
    expect(`${page}\n${previewStep}`).toContain("merge_with_previous");
    expect(`${page}\n${previewStep}`).toContain("split_from_line");
    expect(`${page}\n${previewStep}`).toContain("rename_chapter");
  });

  it("keeps import accessible from the active writing project and returns to the caller", () => {
    const app = readSource("src/renderer/App.tsx");
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");
    const topBar = readSource("src/renderer/layout/TopBar.tsx");

    expect(app).toContain("importReturnPage");
    expect(app).toContain("returnFromImport");
    expect(app).toContain("onImport={openImport}");
    expect(writingPage).toContain("readonly onImport: () => void");
    expect(writingPage).toContain("handleImport");
    expect(writingPage).toContain("onImport={handleImport}");
    expect(writingPage).toContain("flushBeforeNavigation(onImport)");
    expect(topBar).toContain("UploadSimple");
    expect(topBar).toContain("导入 TXT");
  });

  it("requires the Electron preload API instead of a renderer fallback import implementation", () => {
    const appStore = readSource("src/renderer/state/app-store.ts");
    const renderer = readSource("src/renderer/renderer.tsx");

    expect(appStore).toContain("Electron preload API 未加载");
    expect(appStore).not.toContain("createPreviewApi");
    expect(appStore).not.toContain("chooseBrowserTxtFile");
    expect(appStore).not.toContain("browser-file://");
    expect(appStore).not.toContain('selectTxtFile: async () => ({ filePath: "/tmp/归途示例.txt" })');
    expect(renderer).toContain("ErrorBoundary");
  });
});
