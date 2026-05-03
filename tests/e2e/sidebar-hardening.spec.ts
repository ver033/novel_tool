import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const rootDir = path.resolve(__dirname, "../..");

function resolveElectronExecutablePath(): string {
  const platform = process.platform;
  const candidates =
    platform === "darwin"
      ? [path.join(rootDir, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")]
      : platform === "win32"
        ? [path.join(rootDir, "node_modules/electron/dist/electron.exe")]
        : [path.join(rootDir, "node_modules/electron/dist/electron")];

  const executablePath = candidates.find((candidate) => existsSync(candidate));
  if (!executablePath) {
    throw new Error(`Electron executable not found. Run \`npm install\` before \`npm run test:e2e\`. Checked:\n${candidates.join("\n")}`);
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
      NOVEL_TOOL_E2E_AI: "1"
    }
  });
}

async function firstPage(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return page;
}

test.describe("Phase 11 sidebar hardening", () => {
  test("right sidebar starts closed and exposes chat, task, and scratch states", async () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), "novel-tool-e2e-home-"));
    let app: ElectronApplication | null = null;
    try {
      app = await launchNovelTool(homeDir);
      const page = await firstPage(app);
      await page.setViewportSize({ width: 1280, height: 860 });

      await page.getByRole("button", { name: /新建作品\s+从空白开始/ }).click();
      await page.getByPlaceholder("例如：长夜归途").fill("我的小说");
      await page.getByRole("button", { name: "创建并开始写作" }).click();
      await expect(page.locator(".chapter-heading-button")).toContainText("第1章");
      await expect(page.locator(".right-sidebar")).toHaveCount(0);

      await expect(page.getByRole("button", { name: "打开 AI 对话" })).toBeVisible();
      await page.getByRole("button", { name: "打开 AI 对话" }).click();
      await expect(page.locator(".right-sidebar")).toBeVisible();
      await expect(page.getByRole("heading", { name: "AI 对话" })).toBeVisible();

      await page.getByRole("button", { name: "当前任务" }).click();
      await expect(page.getByText("等待选区")).toBeVisible();
      await expect(page.getByText("尚未生成预览。")).toBeVisible();

      await page.getByRole("button", { name: "草稿纸", exact: true }).click();
      await expect(page.getByText(/正在读取草稿纸|暂无草稿/)).toBeVisible();

      await page.getByRole("button", { name: "关闭右侧栏" }).click();
      await expect(page.locator(".right-sidebar")).toHaveCount(0);
    } finally {
      await app?.close();
      rmSync(homeDir, { force: true, recursive: true });
    }
  });
});
