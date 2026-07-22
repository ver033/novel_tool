import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type TaskCase = {
  readonly label: RegExp;
  readonly name: string;
  readonly input: string;
  readonly expectedText: string;
  readonly applyButton: RegExp;
  readonly generateButton?: RegExp | string;
  readonly previewText?: RegExp | string;
  readonly absentTextAfterApply?: string;
  readonly skipApply?: boolean;
};

const rootDir = path.resolve(__dirname, "../..");
const selectAllShortcut = process.platform === "darwin" ? "Meta+A" : "Control+A";

const taskCases: readonly TaskCase[] = [
  {
    name: "polish",
    label: /润色/,
    input: "他勒住马缰。",
    expectedText: "他缓缓勒住马缰，望向暮色中的山道。",
    applyButton: /应用替换/
  },
  {
    name: "expand",
    label: /扩写/,
    input: "他勒住马缰。",
    expectedText: "他勒住马缰，马蹄在碎石上轻轻一顿，暮色从山口压下来。",
    applyButton: /替换原文/
  },
  {
    name: "proofread",
    label: /校对/,
    input: "他勒住马缰。。",
    expectedText: "他勒住马缰。",
    applyButton: /^应用$/,
    generateButton: /开始校对/,
    previewText: "E2E 校对建议",
    skipApply: true
  },
  {
    name: "continue",
    label: /续写/,
    input: "他勒住马缰。",
    expectedText: "远处的钟声忽然响起，他意识到追兵已经逼近。",
    applyButton: /插入下方/
  }
];

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

async function createProjectWithSelectedText(page: Page, text: string): Promise<void> {
  await page.getByRole("button", { name: /新建作品\s+从空白开始/ }).click();
  await page.getByPlaceholder("例如：长夜归途").fill("我的小说");
  await page.getByRole("button", { name: "创建并开始写作" }).click();
  await expect(page.locator(".chapter-heading-button")).toContainText("第1章");

  const editor = page.locator(".tiptap-manuscript");
  await editor.click();
  await page.keyboard.insertText(text);
  await page.keyboard.press(selectAllShortcut);
  await expect(page.getByRole("button", { name: /Ask AI/ })).toBeVisible();
}

async function runTask(page: Page, taskCase: TaskCase): Promise<void> {
  await page.getByRole("button", { name: /Ask AI/ }).click();
  await page.getByRole("button", { name: taskCase.label }).click();
  await expect(page.getByRole("heading", { name: /当前任务/ })).toBeVisible();

  await page.getByRole("button", { name: taskCase.generateButton ?? "生成预览" }).click();
  await expect(page.getByText(taskCase.previewText ?? taskCase.expectedText)).toBeVisible();
  if (taskCase.skipApply) {
    await expect(page.locator(".tiptap-manuscript")).toContainText(taskCase.input);
    return;
  }
  await page.getByRole("button", { name: taskCase.applyButton }).click();
  await expect(page.locator(".tiptap-manuscript")).toContainText(taskCase.expectedText);
  if (taskCase.absentTextAfterApply) {
    await expect(page.locator(".tiptap-manuscript")).not.toContainText(taskCase.absentTextAfterApply);
  }
}

test.describe("AI task Electron flow", () => {
  test.setTimeout(90_000);

  for (const taskCase of taskCases) {
    test(`${taskCase.name} generates and applies through the Electron UI`, async () => {
      const homeDir = mkdtempSync(path.join(tmpdir(), "novel-tool-e2e-home-"));
      let app: ElectronApplication | null = null;
      try {
        app = await launchNovelTool(homeDir);
        const page = await firstPage(app);
        await createProjectWithSelectedText(page, taskCase.input);
        await runTask(page, taskCase);

        if (taskCase.name === "polish") {
          await app.close();
          app = await launchNovelTool(homeDir);
          const relaunchedPage = await firstPage(app);
          await expect(relaunchedPage.getByRole("button", { name: /^(打开项目|继续写作)\s/ })).toBeVisible();
          await expect(relaunchedPage.locator(".project-main-button", { hasText: "《我的小说》" })).toHaveCount(1);
          await relaunchedPage.locator(".project-main-button", { hasText: "《我的小说》" }).click();
          await expect(relaunchedPage.locator(".tiptap-manuscript")).toContainText(taskCase.expectedText);
        }
      } finally {
        await app?.close();
        rmSync(homeDir, { force: true, recursive: true });
      }
    });
  }
});
