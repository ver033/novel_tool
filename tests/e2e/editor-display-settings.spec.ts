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

async function createWritingProject(
  page: Page,
  viewport: { readonly width: number; readonly height: number } = { width: 1440, height: 900 }
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.getByRole("button", { name: /新建作品\s+从空白开始/ }).click();
  await page.getByPlaceholder("例如：长夜归途").fill("排版回归测试");
  await page.getByRole("button", { name: "创建并开始写作" }).click();
  await expect(page.locator(".chapter-heading-button")).toContainText("第1章");
  const editor = page.locator(".tiptap-manuscript");
  await editor.click();
  await page.keyboard.insertText("第一段正文。\n\n第二段正文。");
  await page.getByRole("button", { name: "页面与排版" }).click();
  await expect(page.locator(".global-style-panel")).toBeVisible();
}

async function clickStyleOption(page: Page, setting: string, value: string): Promise<void> {
  const option = page.locator(`[data-editor-style="${setting}"][data-editor-style-value="${value}"]`);
  await option.click();
  await expect(option).toHaveClass(/active/);
}

test.describe("editor display settings", () => {
  test("ruled paper, theme, padding, and page width remain visible through the writing-page skin", async () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), "novel-tool-editor-style-"));
    let app: ElectronApplication | null = null;
    try {
      app = await launchNovelTool(homeDir);
      const page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await createWritingProject(page);

      await clickStyleOption(page, "ruledPaperIntensity", "standard");
      const ruledBackground = await page.locator(".tiptap-manuscript").evaluate((element) =>
        getComputedStyle(element).backgroundImage
      );

      await clickStyleOption(page, "theme", "eye");
      const eyeBackground = await page.locator(".editor-scroll").evaluate((element) =>
        getComputedStyle(element).backgroundColor
      );

      await clickStyleOption(page, "theme", "night");
      const nightBackground = await page.locator(".editor-scroll").evaluate((element) =>
        getComputedStyle(element).backgroundColor
      );

      await clickStyleOption(page, "editorPadding", "compact");
      const compactPadding = await page.locator(".editor-scroll").evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).paddingLeft)
      );
      await clickStyleOption(page, "editorPadding", "standard");
      const standardPadding = await page.locator(".editor-scroll").evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).paddingLeft)
      );

      await clickStyleOption(page, "pageWidth", "narrow");
      const narrowWidth = await page.locator(".editor-inner").evaluate((element) =>
        element.getBoundingClientRect().width
      );
      await clickStyleOption(page, "pageWidth", "wide");
      const wideWidth = await page.locator(".editor-inner").evaluate((element) =>
        element.getBoundingClientRect().width
      );

      expect({
        compactPadding,
        eyeBackground,
        nightBackground,
        ruledPaperVisible: ruledBackground !== "none",
        standardPadding,
        wideIsWider: wideWidth > narrowWidth + 100
      }).toEqual({
        compactPadding: 16,
        eyeBackground: "rgb(251, 251, 239)",
        nightBackground: "rgb(18, 24, 38)",
        ruledPaperVisible: true,
        standardPadding: 28,
        wideIsWider: true
      });
    } finally {
      await app?.close();
      rmSync(homeDir, { force: true, recursive: true });
    }
  });

  test("all typography controls apply immediately, persist, and keep the panel interaction predictable", async ({}, testInfo) => {
    const homeDir = mkdtempSync(path.join(tmpdir(), "novel-tool-editor-controls-"));
    let app: ElectronApplication | null = null;
    try {
      app = await launchNovelTool(homeDir);
      let page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await createWritingProject(page);

      await page.locator('[data-editor-style="fontSize"]').selectOption("24");
      await clickStyleOption(page, "fontFamily", "hei");
      await clickStyleOption(page, "lineHeight", "2.32");
      await clickStyleOption(page, "paragraphSpacing", "loose");
      await clickStyleOption(page, "firstLineIndent", "two");

      const paragraphStyle = await page.locator(".tiptap-manuscript p").first().evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          firstLineIndent: Number.parseFloat(style.textIndent),
          lineHeightSetting: style.getPropertyValue("--editor-line-height").trim(),
          paragraphSpacing: Number.parseFloat(style.marginBottom)
        };
      });
      expect(paragraphStyle.fontFamily).toContain("PingFang SC");
      expect(paragraphStyle.fontFamily).not.toContain("Yu Mincho");
      expect(paragraphStyle.fontSize).toBe("24px");
      expect(paragraphStyle.firstLineIndent).toBe(48);
      expect(paragraphStyle.lineHeightSetting).toBe("2.32");
      expect(paragraphStyle.paragraphSpacing).toBeGreaterThan(100);

      const readingPreset = page.locator('[data-editor-preset="reading"]');
      await readingPreset.click();
      await expect(readingPreset).toHaveClass(/active/);
      await expect(page.getByText("显示设置已保存")).toBeVisible();
      await expect(page.locator(".workspace")).toHaveClass(/theme-eye/);
      await expect(page.locator(".novel-editor-content")).toHaveClass(/ruled-paper-standard/);

      await page.screenshot({
        path: testInfo.outputPath("editor-settings-reading.png"),
        scale: "css"
      });

      await page.keyboard.press("Escape");
      await expect(page.locator(".global-style-panel")).toHaveCount(0);
      await page.getByRole("button", { name: "页面与排版" }).click();
      await page.locator(".tiptap-manuscript").click();
      await expect(page.locator(".global-style-panel")).toHaveCount(0);

      await page.getByRole("button", { name: "专注模式" }).click();
      await expect(page.locator(".workspace")).toHaveClass(/focus-mode/);
      await page.getByRole("button", { name: "页面与排版" }).click();
      await expect(page.locator('[data-editor-style="pageWidth"]')).toHaveCount(0);
      await expect(page.getByText("专注模式下正文区域自动铺满")).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "退出专注" }).click();

      await app.close();
      app = await launchNovelTool(homeDir);
      page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await page.locator(".project-main-button", { hasText: "《排版回归测试》" }).click();
      await expect(page.locator(".chapter-heading-button")).toContainText("第1章");

      const persisted = await page.locator(".tiptap-manuscript").evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          backgroundImage: style.backgroundImage,
          fontSizeSetting: style.getPropertyValue("--editor-font-size").trim(),
          lineHeightSetting: style.getPropertyValue("--editor-line-height").trim()
        };
      });
      expect(persisted).toMatchObject({
        fontSizeSetting: "22px",
        lineHeightSetting: "2.32"
      });
      expect(persisted.backgroundImage).not.toBe("none");
      await expect(page.locator(".workspace")).toHaveClass(/theme-eye/);
      await expect(page.locator(".editor-inner")).toHaveCSS("max-width", "860px");
    } finally {
      await app?.close();
      rmSync(homeDir, { force: true, recursive: true });
    }
  });

  test("every display control has a distinct effect instead of acting like a decorative option", async () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), "novel-tool-editor-matrix-"));
    let app: ElectronApplication | null = null;
    try {
      app = await launchNovelTool(homeDir);
      const page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await createWritingProject(page);

      const pageWidths: Record<string, string> = {};
      for (const value of ["narrow", "medium", "wide", "screen"]) {
        await clickStyleOption(page, "pageWidth", value);
        pageWidths[value] = await page.locator(".editor-inner").evaluate((element) => getComputedStyle(element).maxWidth);
      }
      expect(pageWidths).toEqual({
        medium: "1120px",
        narrow: "860px",
        screen: "none",
        wide: "1320px"
      });

      const themeBackgrounds: Record<string, string> = {};
      for (const value of ["light", "eye", "night"]) {
        await clickStyleOption(page, "theme", value);
        themeBackgrounds[value] = await page.locator(".editor-scroll").evaluate((element) => getComputedStyle(element).backgroundColor);
      }
      expect(themeBackgrounds).toEqual({
        eye: "rgb(251, 251, 239)",
        light: "rgb(255, 254, 250)",
        night: "rgb(18, 24, 38)"
      });

      const horizontalPadding: Record<string, number> = {};
      for (const value of ["compact", "standard", "relaxed"]) {
        await clickStyleOption(page, "editorPadding", value);
        horizontalPadding[value] = await page.locator(".editor-scroll").evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).paddingLeft)
        );
      }
      expect(horizontalPadding).toEqual({ compact: 16, relaxed: 48, standard: 28 });

      const fontFamilies: Record<string, string> = {};
      for (const value of ["system", "song", "hei", "fangsong", "kai"]) {
        await clickStyleOption(page, "fontFamily", value);
        fontFamilies[value] = await page.locator(".tiptap-manuscript").evaluate((element) =>
          getComputedStyle(element).getPropertyValue("--editor-font-family")
        );
      }
      expect(fontFamilies.system).toMatch(/system-ui|BlinkMacSystemFont/);
      expect(fontFamilies.song).toContain("Yu Mincho");
      expect(fontFamilies.hei).toContain("PingFang SC");
      expect(fontFamilies.fangsong).toContain("FangSong");
      expect(fontFamilies.kai).toContain("Kaiti SC");
      expect(new Set(Object.values(fontFamilies)).size).toBe(5);

      const fontSizeSelect = page.locator('[data-editor-style="fontSize"]');
      for (const value of ["12", "24", "36"]) {
        await fontSizeSelect.selectOption(value);
        await expect(page.locator(".tiptap-manuscript")).toHaveCSS("font-size", `${value}px`);
      }

      const lineHeights: Record<string, string> = {};
      for (const value of ["1.6", "1.82", "2.08", "2.32", "2.6"]) {
        await clickStyleOption(page, "lineHeight", value);
        lineHeights[value] = await page.locator(".tiptap-manuscript").evaluate((element) =>
          getComputedStyle(element).getPropertyValue("--editor-line-height").trim()
        );
      }
      expect(lineHeights).toEqual({
        "1.6": "1.6",
        "1.82": "1.82",
        "2.08": "2.08",
        "2.32": "2.32",
        "2.6": "2.6"
      });

      await fontSizeSelect.selectOption("20");
      await clickStyleOption(page, "lineHeight", "2.08");
      const paragraphSpacing: Record<string, number> = {};
      for (const value of ["compact", "standard", "loose"]) {
        await clickStyleOption(page, "paragraphSpacing", value);
        paragraphSpacing[value] = await page.locator(".tiptap-manuscript p").first().evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).marginBottom)
        );
      }
      expect(paragraphSpacing.compact).toBe(0);
      expect(paragraphSpacing.standard).toBeCloseTo(41.6, 1);
      expect(paragraphSpacing.loose).toBeCloseTo(83.2, 1);

      const firstLineIndent: Record<string, number> = {};
      for (const value of ["none", "two", "four"]) {
        await clickStyleOption(page, "firstLineIndent", value);
        firstLineIndent[value] = await page.locator(".tiptap-manuscript p").first().evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).textIndent)
        );
      }
      expect(firstLineIndent).toEqual({ four: 80, none: 0, two: 40 });

      const ruledPaperBackgrounds: Record<string, string> = {};
      for (const value of ["off", "soft", "standard", "strong"]) {
        await clickStyleOption(page, "ruledPaperIntensity", value);
        ruledPaperBackgrounds[value] = await page.locator(".tiptap-manuscript").evaluate((element) =>
          getComputedStyle(element).backgroundImage
        );
      }
      expect(ruledPaperBackgrounds.off).toBe("none");
      expect(ruledPaperBackgrounds.soft).not.toBe("none");
      expect(ruledPaperBackgrounds.standard).not.toBe("none");
      expect(ruledPaperBackgrounds.strong).not.toBe("none");
      expect(new Set([
        ruledPaperBackgrounds.soft,
        ruledPaperBackgrounds.standard,
        ruledPaperBackgrounds.strong
      ]).size).toBe(3);

      await expect(page.getByText("显示设置已保存")).toBeVisible();
    } finally {
      await app?.close();
      rmSync(homeDir, { force: true, recursive: true });
    }
  });

  test("the typography panel remains usable without overflowing a compact desktop window", async () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), "novel-tool-editor-compact-"));
    let app: ElectronApplication | null = null;
    try {
      app = await launchNovelTool(homeDir);
      const page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await createWritingProject(page, { width: 1024, height: 720 });

      const panel = page.locator(".global-style-panel");
      const panelBox = await panel.boundingBox();
      expect(panelBox).not.toBeNull();
      expect(panelBox!.x).toBeGreaterThanOrEqual(0);
      expect(panelBox!.y).toBeGreaterThanOrEqual(0);
      expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(1024);
      expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(720);

      await clickStyleOption(page, "ruledPaperIntensity", "strong");
      await expect(page.getByText("显示设置已保存")).toBeVisible();
      await expect(page.locator(".novel-editor-content")).toHaveClass(/ruled-paper-strong/);
      await expect(page.locator(".tiptap-manuscript")).toBeVisible();
      await expect(page.getByRole("button", { name: "页面与排版", exact: true })).toBeVisible();

      const viewportMetrics = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth
      }));
      expect(viewportMetrics.documentWidth).toBeLessThanOrEqual(viewportMetrics.viewportWidth);
    } finally {
      await app?.close();
      rmSync(homeDir, { force: true, recursive: true });
    }
  });
});
