import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type TaskCase = {
  readonly label: RegExp;
  readonly name: string;
  readonly input: string;
  readonly expectedText: string;
  readonly startButton: RegExp;
  readonly applyButton: RegExp;
  readonly request?: string;
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
    startButton: /开始润色/,
    applyButton: /应用替换/,
    request: "保持节奏。".repeat(1_000)
  },
  {
    name: "expand",
    label: /扩写/,
    input: "他勒住马缰。",
    expectedText: "他勒住马缰，马蹄在碎石上轻轻一顿，暮色从山口压下来。",
    startButton: /开始扩写/,
    applyButton: /替换原文/
  },
  {
    name: "proofread",
    label: /校对/,
    input: "他勒住马缰。。",
    expectedText: "他勒住马缰。",
    startButton: /开始校对/,
    applyButton: /^应用$/,
    previewText: "E2E 校对建议",
    skipApply: true
  },
  {
    name: "continue",
    label: /续写/,
    input: "他勒住马缰。",
    expectedText: "远处的钟声忽然响起，他意识到追兵已经逼近。",
    startButton: /开始续写/,
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
      NOVEL_TOOL_E2E_AI: "1",
      NOVEL_TOOL_E2E_TASK_DELAY_MS: "350"
    }
  });
}

async function firstPage(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1440, height: 1024 });
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

async function expectTaskPanelToFitViewport(page: Page): Promise<void> {
  const metrics = await page.locator(".task-card").evaluate((taskCard) => {
    const sidebar = taskCard.closest<HTMLElement>(".right-sidebar");
    const taskRect = taskCard.getBoundingClientRect();
    const sidebarRect = sidebar?.getBoundingClientRect() ?? taskRect;
    return {
      horizontalOverflow: taskCard.scrollWidth - taskCard.clientWidth,
      sidebarLeft: sidebarRect.left,
      sidebarRight: sidebarRect.right,
      viewportWidth: window.innerWidth
    };
  });

  expect(metrics.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(metrics.sidebarLeft).toBeGreaterThanOrEqual(0);
  expect(metrics.sidebarRight).toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

async function expectTaskFooterDocked(page: Page): Promise<void> {
  const metrics = await page.locator(".task-actions").evaluate((taskActions) => {
    const scrollContainer = taskActions.closest<HTMLElement>(".sidebar-content-task");
    const actionRect = taskActions.getBoundingClientRect();
    const containerRect = scrollContainer?.getBoundingClientRect() ?? actionRect;
    const primaryButton = taskActions.querySelector<HTMLElement>(".task-primary-start");
    const primaryRect = primaryButton?.getBoundingClientRect() ?? null;
    const style = getComputedStyle(taskActions);
    return {
      bottomGap: Math.abs(containerRect.bottom - actionRect.bottom),
      height: actionRect.height,
      configure: taskActions.classList.contains("state-configure"),
      leftGap: Math.abs(actionRect.left - containerRect.left),
      rightGap: Math.abs(actionRect.right - containerRect.right),
      boxShadow: style.boxShadow,
      backdropFilter: style.backdropFilter,
      primaryHeight: primaryRect?.height ?? null,
      primaryWidth: primaryRect?.width ?? null
    };
  });

  expect(metrics.bottomGap).toBeLessThanOrEqual(20);
  expect(metrics.height).toBeLessThanOrEqual(metrics.configure ? 78 : 96);
  expect(metrics.leftGap).toBeLessThanOrEqual(1);
  expect(metrics.rightGap).toBeLessThanOrEqual(1);
  expect(metrics.boxShadow).toBe("none");
  expect(metrics.backdropFilter).toBe("none");
  if (metrics.configure) {
    expect(metrics.primaryHeight).toBeGreaterThanOrEqual(40);
    expect(metrics.primaryWidth).toBeGreaterThanOrEqual(130);
  }
}

async function runTask(
  page: Page,
  taskCase: TaskCase,
  screenshots?: { readonly configuration: string; readonly running: string; readonly result: string }
): Promise<void> {
  await page.getByRole("button", { name: /Ask AI/ }).click();
  await page.getByRole("button", { name: taskCase.label }).click();
  await expect(page.getByRole("heading", { name: taskCase.label })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ask AI/ })).toHaveCount(0);
  await expect(page.locator(".ai-task-locked-selection")).toContainText(taskCase.input);
  await expect(page.locator(".sidebar-runtime-line")).toContainText("Pi Agent");
  await expect(page.locator(".task-execution-progress")).toHaveCount(0);
  await expect(page.getByText(taskCase.previewText ?? taskCase.expectedText)).toHaveCount(0);
  await expect(page.locator(".tiptap-manuscript")).toContainText(taskCase.input);
  await expectTaskPanelToFitViewport(page);
  await expectTaskFooterDocked(page);
  if (screenshots) {
    await page.screenshot({ path: screenshots.configuration });
  }
  if (taskCase.request) {
    const requestInput = page.getByLabel(/本次要求/);
    await requestInput.fill(taskCase.request);
    await expect(requestInput).toHaveValue(taskCase.request);
    await expectTaskPanelToFitViewport(page);
  }
  await page.getByRole("button", { name: taskCase.startButton }).click();
  if (screenshots) {
    await expect(page.locator(".task-execution-progress.phase-requesting, .task-execution-progress.phase-streaming")).toBeVisible();
    await expect(page.getByRole("button", { name: taskCase.startButton })).toHaveCount(0);
    await expectTaskFooterDocked(page);
    await page.screenshot({ path: screenshots.running });
  }
  await expect(page.getByText(taskCase.previewText ?? taskCase.expectedText)).toBeVisible();
  await expect(page.locator(".task-status-pill")).toHaveClass(/phase-complete/);
  await expect(page.locator(".task-execution-progress")).toHaveClass(/phase-complete/);
  await expect(page.locator(".task-activity-list li.complete")).toHaveCount(3);
  await expect(page.locator(".ai-task-locked-selection")).toContainText(taskCase.input);
  await expectTaskPanelToFitViewport(page);
  await expectTaskFooterDocked(page);
  if (screenshots) {
    await page.screenshot({ path: screenshots.result });
  }
  if (taskCase.skipApply) {
    await expect(page.locator(".tiptap-manuscript")).toContainText(taskCase.input);
    return;
  }
  await page.getByRole("button", { name: taskCase.applyButton }).click();
  await expect(page.locator(".tiptap-manuscript")).toContainText(taskCase.expectedText);
  await expect(page.locator(".ai-task-locked-selection")).toHaveCount(0);
  if (taskCase.absentTextAfterApply) {
    await expect(page.locator(".tiptap-manuscript")).not.toContainText(taskCase.absentTextAfterApply);
  }
}

test.describe("AI task Electron flow", () => {
  test.setTimeout(90_000);

  for (const taskCase of taskCases) {
    test(`${taskCase.name} generates and applies through the Electron UI`, async ({}, testInfo) => {
      const homeDir = mkdtempSync(path.join(tmpdir(), "novel-tool-e2e-home-"));
      let app: ElectronApplication | null = null;
      try {
        app = await launchNovelTool(homeDir);
        const page = await firstPage(app);
        await createProjectWithSelectedText(page, taskCase.input);
        await runTask(
          page,
          taskCase,
          taskCase.name === "polish"
            ? {
                configuration: testInfo.outputPath("ask-ai-configuration.png"),
                running: testInfo.outputPath("ask-ai-running.png"),
                result: testInfo.outputPath("ask-ai-result.png")
              }
            : undefined
        );

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
