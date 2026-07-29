import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  await page.setViewportSize({ width: 1366, height: 850 });
  return page;
}

async function createProject(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: /新建作品\s+从空白开始/ }).click();
  await page.getByPlaceholder("例如：长夜归途").fill(name);
  await page.getByRole("button", { name: "创建并开始写作" }).click();
  await expect(page.locator(".chapter-heading-button")).toContainText("第1章");
}

async function assertPageFitsViewport(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - window.innerWidth,
    document: document.documentElement.scrollWidth - window.innerWidth
  }));
  expect(overflow.body).toBeLessThanOrEqual(1);
  expect(overflow.document).toBeLessThanOrEqual(1);
}

async function mockOpenDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, selectedPath) => {
    Object.defineProperty(dialog, "showOpenDialog", {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [selectedPath] })
    });
  }, filePath);
}

async function mockSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, selectedPath) => {
    Object.defineProperty(dialog, "showSaveDialog", {
      configurable: true,
      value: async () => ({ canceled: false, filePath: selectedPath })
    });
  }, filePath);
}

test.describe("all user-facing pages", () => {
  test("writing, relationship graph, outline, review, and goals complete real workflows", async () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), "novel-tool-pages-"));
    let app: ElectronApplication | null = null;
    try {
      app = await launchNovelTool(homeDir);
      const page = await firstPage(app);
      await createProject(page, "全页面回归");

      const editor = page.locator(".tiptap-manuscript");
      await editor.click();
      await page.keyboard.insertText("雨声沿着旧窗落下。林澈发现桌上的信封已经被人移动过。");
      await expect(page.locator(".topbar .status-pill", { hasText: "已自动保存" })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("button", { name: "资料" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "统计" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "回收站" })).toBeDisabled();
      await assertPageFitsViewport(page);

      await page.getByRole("button", { name: "人物关系图" }).click();
      await expect(page.locator("section[aria-label='人物关系图']")).toBeVisible();
      await page.getByRole("button", { name: "作者设定图谱" }).click();
      await page.getByRole("button", { name: "添加人物" }).click();
      await page.getByPlaceholder("例如：白嘉轩").fill("林澈");
      await page.getByRole("dialog", { name: "添加人物" }).getByRole("button", { name: "添加", exact: true }).click();
      await page.getByRole("button", { name: "添加人物" }).click();
      await expect(page.getByRole("dialog", { name: "添加人物" }).getByText("林澈", { exact: true })).toBeVisible();
      await page.getByRole("dialog", { name: "添加人物" }).getByRole("button", { name: "关闭" }).click();
      await assertPageFitsViewport(page);

      await page.getByRole("button", { name: "大纲" }).click();
      await expect(page.getByRole("heading", { name: "全书大纲" })).toBeVisible();
      await page.getByRole("button", { name: "新增场景" }).click();
      await page.getByPlaceholder("这一场发生了什么？").fill("林澈在雨夜发现信封被移动，决定检查门锁。");
      await page.locator(".outline-inspector-actions .outline-primary-button").click();
      await expect(page.getByText("大纲事件已创建。")).toBeVisible();
      await expect(page.locator(".outline-event-card, .outline-timeline-card").filter({ hasText: "林澈在雨夜发现信封被移动" }).first()).toBeVisible();
      await assertPageFitsViewport(page);

      await page.getByRole("button", { name: "AI审稿" }).click();
      await expect(page.getByRole("heading", { name: "章节审稿" })).toBeVisible();
      await page.getByRole("button", { name: "全选" }).click();
      await page.getByRole("button", { name: "开始审稿" }).click();
      await expect(page.locator(".chapter-review-result")).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(".chapter-review-run-summary")).toContainText("完成");
      await assertPageFitsViewport(page);

      await page.getByRole("button", { name: "写作目标" }).click();
      await expect(page.getByRole("heading", { name: "还没有写作目标" })).toBeVisible();
      await page.getByRole("button", { name: "新建目标" }).click();
      await page.getByRole("textbox", { name: "目标名称" }).fill("七月冲刺");
      await page.getByRole("spinbutton", { name: "目标字数" }).fill("120000");
      await page.getByRole("button", { name: "保存目标" }).click();
      await expect(page.locator(".writing-goals-toolbar h1")).toHaveText("七月冲刺");
      await expect(page.getByRole("button", { name: "编辑目标" })).toBeVisible();
      await assertPageFitsViewport(page);

      await page.getByRole("button", { name: "正文" }).click();
      await expect(page.locator(".tiptap-manuscript")).toContainText("雨声沿着旧窗落下");
    } finally {
      await app?.close();
      rmSync(homeDir, { force: true, recursive: true });
    }
  });

  test("import, export, settings, welcome, and new-project pages preserve navigation and data", async () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), "novel-tool-aux-pages-"));
    const importPath = path.join(homeDir, "待导入小说.txt");
    const exportPath = path.join(homeDir, "完整导出.txt");
    const shareablePath = path.join(homeDir, "可分享副本.noveltool");
    writeFileSync(importPath, "第一章 雨夜\n雨落在空站台上。\n\n第二章 回声\n林澈听见远处的钟声。", "utf8");

    let app: ElectronApplication | null = null;
    try {
      app = await launchNovelTool(homeDir);
      const page = await firstPage(app);
      await createProject(page, "导入导出回归");

      await mockOpenDialog(app, importPath);
      await page.getByRole("button", { name: "导入 TXT" }).click();
      await expect(page.getByText("当前为追加模式")).toBeVisible();
      await expect(page.locator("#import-content-language")).toBeDisabled();
      await page.getByRole("button", { name: "选择文件", exact: true }).click();
      await expect(page.getByText("识别到的章节（2）")).toBeVisible();
      await page.getByRole("button", { name: "查看识别结果" }).click();
      await page.getByRole("button", { name: "导入并打开" }).click();
      await expect(page.getByRole("heading", { name: "导入完成" })).toBeVisible();
      await expect(page.getByText(/共 2 个章节/)).toBeVisible();
      await page.getByRole("button", { name: "打开项目" }).click();
      await expect(page.locator(".chapter-name")).toHaveCount(3);
      await expect(page.locator(".chapter-name")).toContainText(["第1章", "第一章 雨夜", "第二章 回声"]);
      await assertPageFitsViewport(page);

      await mockSaveDialog(app, exportPath);
      await page.getByRole("button", { name: "导出 TXT" }).click();
      await expect(page.getByRole("heading", { name: "导出 TXT" })).toBeVisible();
      await expect(page.getByRole("button", { name: "导出 TXT" })).toBeDisabled();
      await page.getByRole("button", { name: "选择位置" }).click();
      await page.getByRole("button", { name: "导出 TXT" }).click();
      await expect(page.getByRole("status")).toContainText("已导出 3 章");
      expect(readFileSync(exportPath, "utf8")).toContain("第二章 回声");
      await page.getByRole("button", { name: "返回写作" }).click();

      await page.getByLabel("项目模块").getByRole("button", { name: "设置" }).click();
      await expect(page.getByRole("heading", { name: "AI 服务连接" })).toBeVisible();
      await assertPageFitsViewport(page);

      await page.getByRole("button", { name: "语言" }).click();
      await expect(page.getByRole("heading", { name: "显示语言" })).toBeVisible();
      await page.getByRole("button", { name: "AI 服务" }).click();
      await page.getByRole("button", { name: "提示词预设" }).click();
      await expect(page.getByRole("heading", { name: "内置任务" })).toBeVisible();
      await page.getByLabel("新预设名称").fill("冷静叙事");
      await page.getByLabel("新预设要求").fill("保持事实不变，减少夸张形容。");
      await page.getByRole("button", { name: "添加预设" }).click();
      await page.getByRole("button", { name: "保存设置" }).click();
      await expect(page.getByText("设置已保存")).toBeVisible();

      await page.getByRole("button", { name: "章节索引缓存" }).click();
      await expect(page.getByRole("heading", { name: "缓存总览" })).toBeVisible();
      await expect(page.getByText("后台索引已关闭。新章节和过期章节不会自动缓存，点击“继续建立索引”会重新开启。")).toBeVisible();

      await mockSaveDialog(app, shareablePath);
      await page.getByRole("button", { name: "导入导出" }).click();
      await expect(page.getByRole("heading", { name: "导出可分享副本" })).toBeVisible();
      const scratchOption = page.getByRole("checkbox", { name: /草稿纸\/素材/ });
      await expect(scratchOption).not.toBeChecked();
      await scratchOption.check();
      await page.getByRole("button", { name: "选择位置" }).click();
      await page.getByRole("button", { name: "导出可分享副本" }).click();
      await expect(page.getByRole("status")).toContainText("可分享副本已生成");
      expect(existsSync(shareablePath)).toBe(true);

      await page.getByRole("button", { name: "实验功能" }).click();
      await expect(page.getByRole("heading", { name: "产品使用分析" })).toBeVisible();
      await expect(page.getByRole("button", { name: "开机自启动（强制开启）" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "外部 .Book 自动同步" })).toBeDisabled();
      const quickScan = page.getByRole("button", { name: "查找 .Book" });
      await quickScan.click();
      await expect(quickScan).toBeEnabled({ timeout: 15_000 });
      await assertPageFitsViewport(page);

      await page.getByRole("button", { name: "关闭设置" }).click();
      await expect(page.locator(".tiptap-manuscript")).toBeVisible();
      await page.locator(".topbar .brand-button").click();
      await expect(page.getByRole("heading", { name: "返回开始页？" })).toBeVisible();
      await page.getByRole("button", { name: "返回开始页" }).click();
      await expect(page.getByRole("heading", { name: "开始创作" })).toBeVisible();
      await expect(page.locator(".project-main-button", { hasText: "《导入导出回归》" })).toBeVisible();
      await assertPageFitsViewport(page);

      await page.getByRole("button", { name: /新建作品\s+从空白开始/ }).click();
      await expect(page.getByRole("heading", { name: "项目信息" })).toBeVisible();
      await page.getByRole("button", { name: "关闭新建作品" }).click();
      await expect(page.getByRole("heading", { name: "开始创作" })).toBeVisible();
    } finally {
      await app?.close();
      rmSync(homeDir, { force: true, recursive: true });
    }
  });
});
