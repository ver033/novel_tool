import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const rootDir = path.resolve(__dirname, "../..");

function resolveElectronExecutablePath(): string {
  const executablePath = process.platform === "darwin"
    ? path.join(rootDir, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
    : process.platform === "win32"
      ? path.join(rootDir, "node_modules/electron/dist/electron.exe")
      : path.join(rootDir, "node_modules/electron/dist/electron");
  if (!existsSync(executablePath)) {
    throw new Error(`Electron executable not found: ${executablePath}`);
  }
  return executablePath;
}

async function launchNovelTool(homeDir: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: resolveElectronExecutablePath(),
    args: [rootDir, `--user-data-dir=${path.join(homeDir, "user-data")}`],
    env: {
      ...process.env,
      HOME: homeDir,
      NODE_ENV: "test",
      NOVEL_TOOL_E2E_AI: "1",
      NOVEL_TOOL_E2E_USER_DATA_DIR: path.join(homeDir, "app-data")
    }
  });
}

async function firstPage(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1440, height: 900 });
  return page;
}

async function createProject(page: Page): Promise<void> {
  await page.getByRole("button", { name: /新建作品\s+从空白开始/ }).click();
  await page.getByPlaceholder("例如：长夜归途").fill("草稿纸交互回归");
  await page.getByRole("button", { name: "创建并开始写作" }).click();
  await expect(page.locator(".chapter-heading-button")).toContainText("第1章");
}

async function openScratchpadSidebar(page: Page): Promise<void> {
  if (await page.locator(".right-sidebar").count() === 0) {
    await page.getByRole("button", { name: "打开 AI 对话" }).click();
  }
  await page.getByRole("button", { name: "草稿纸", exact: true }).click();
  await expect(page.getByRole("heading", { name: "草稿纸汇总" })).toBeVisible();
}

test.describe("scratchpad workflow", () => {
  test("keeps an unfinished quick note when the sidebar is closed and reopened", async () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), "novel-tool-scratch-draft-"));
    let app: ElectronApplication | null = null;
    try {
      app = await launchNovelTool(homeDir);
      const page = await firstPage(app);
      await createProject(page);
      await openScratchpadSidebar(page);

      const composer = page.getByPlaceholder("快速记录灵感、场景或细节...");
      await composer.fill("这条内容还没有点记录，不应因关闭侧栏而消失。");
      await page.getByRole("button", { name: "关闭右侧栏" }).click();
      await openScratchpadSidebar(page);

      await expect(composer).toHaveValue("这条内容还没有点记录，不应因关闭侧栏而消失。");
    } finally {
      await app?.close();
      rmSync(homeDir, { force: true, recursive: true });
    }
  });

  test("creates, pins, filters, persists, and deletes a chapter scratch note", async () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), "novel-tool-scratch-crud-"));
    let app: ElectronApplication | null = null;
    try {
      app = await launchNovelTool(homeDir);
      let page = await firstPage(app);
      await createProject(page);
      await openScratchpadSidebar(page);

      await page.getByPlaceholder("快速记录灵感、场景或细节...").fill("第一章结尾保留雨伞伏笔。");
      await page.getByRole("button", { name: "记录", exact: true }).click();
      await expect(page.locator(".scratch .count-pill")).toHaveText("1 条");
      await expect(page.locator(".scratch .note-body")).toHaveText("第一章结尾保留雨伞伏笔。");
      await expect(page.locator(".scratch .note-chapter-tag")).toContainText("第1章");
      await expect(page.locator(".chapter-aux-chip")).toHaveText("草稿 1");

      await page.locator(".scratch .note-action", { hasText: "置顶" }).click();
      await expect(page.locator(".scratch .note .mini-tag.orange")).toHaveText("置顶");
      await page.locator(".scratch-filter .filter-chip", { hasText: "置顶" }).click();
      await expect(page.locator(".scratch .note-body")).toHaveText("第一章结尾保留雨伞伏笔。");

      await app.close();
      app = await launchNovelTool(homeDir);
      page = await firstPage(app);
      await page.locator(".project-main-button", { hasText: "《草稿纸交互回归》" }).click();
      await expect(page.locator(".chapter-heading-button")).toContainText("第1章");
      await openScratchpadSidebar(page);
      await expect(page.locator(".scratch .note-body")).toHaveText("第一章结尾保留雨伞伏笔。");
      await expect(page.locator(".chapter-aux-chip")).toHaveText("草稿 1");

      page.once("dialog", (dialog) => void dialog.accept());
      await page.locator(".scratch .note-action", { hasText: "删除" }).click();
      await expect(page.locator(".scratch .count-pill")).toHaveText("0 条");
      await expect(page.getByText("暂无草稿。记录灵感后会随项目保存。")).toBeVisible();
      await expect(page.locator(".chapter-aux-chip")).toHaveCount(0);
    } finally {
      await app?.close();
      rmSync(homeDir, { force: true, recursive: true });
    }
  });

  test("keeps a floating scratch draft and supports save followed by update", async () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), "novel-tool-floating-scratch-"));
    let app: ElectronApplication | null = null;
    try {
      app = await launchNovelTool(homeDir);
      const page = await firstPage(app);
      await createProject(page);

      const editor = page.locator(".tiptap-manuscript");
      await editor.click({ button: "right" });
      await page.getByRole("menuitem", { name: "创建当前章节草稿纸" }).click();
      const floatingEditor = page.getByPlaceholder("写下本章备用段落、灵感、废稿或临时想法...");
      await floatingEditor.fill("浮窗里尚未保存的场景草稿。");
      await page.getByRole("button", { name: "关闭浮窗" }).click();

      await editor.click({ button: "right" });
      await page.getByRole("menuitem", { name: "创建当前章节草稿纸" }).click();
      await expect(floatingEditor).toHaveValue("浮窗里尚未保存的场景草稿。");
      await page.getByRole("button", { name: "保存草稿" }).click();
      await expect(page.locator(".scratchpad-editor-page .aux-editor-footer")).toContainText("草稿已保存到右栏汇总。");

      await floatingEditor.fill("浮窗草稿已经补上了场景结尾。");
      await page.getByRole("button", { name: "更新草稿" }).click();
      await expect(page.getByText("草稿已更新。")).toBeVisible();

      await openScratchpadSidebar(page);
      await expect(page.locator(".scratch .note-body")).toHaveText("浮窗草稿已经补上了场景结尾。");
      await expect(page.locator(".chapter-aux-chip")).toHaveText("草稿 1");
    } finally {
      await app?.close();
      rmSync(homeDir, { force: true, recursive: true });
    }
  });
});
