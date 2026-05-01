import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("author entry flow regressions", () => {
  it("does not create or auto-open a project from the continue-writing entry", () => {
    const appStore = readSource("src/renderer/state/app-store.ts");
    const app = readSource("src/renderer/App.tsx");
    const welcome = readSource("src/renderer/routes/WelcomePage.tsx");
    const preloadApi = readSource("src/preload/api.ts");

    expect(appStore).not.toMatch(/const continueWriting[\s\S]*await createProject\(\)/);
    expect(appStore).toContain("openProjectFile");
    expect(preloadApi).toContain("selectProjectFile");
    expect(preloadApi).toContain("openProjectFile");
    expect(app).toContain("welcomeNotice");
    expect(welcome).toContain("welcomeNotice");
    expect(welcome).toContain("选择项目文件，或从下方最近项目继续写作");
    expect(welcome).not.toContain("点击继续写作会创建默认项目");
  });

  it("refreshes recent projects after import and when returning to welcome", () => {
    const appStore = readSource("src/renderer/state/app-store.ts");
    const app = readSource("src/renderer/App.tsx");

    expect(appStore).toContain("refreshRecentProjects: loadRecentProjects");
    expect(appStore).toMatch(/const acceptImportedProject[\s\S]*void loadRecentProjects\(\)/);
    expect(app).toMatch(/const openWelcome[\s\S]*appStore\.refreshRecentProjects\(\)/);
  });

  it("wires the recent-project overflow menu to real project actions", () => {
    const welcome = readSource("src/renderer/routes/WelcomePage.tsx");
    const appStore = readSource("src/renderer/state/app-store.ts");
    const projectIpc = readSource("src/main/ipc/project-ipc.ts");

    expect(welcome).toContain("project-menu");
    expect(welcome).toContain("renameProjectDraft");
    expect(welcome).toContain("重命名项目");
    expect(welcome).toContain("onRenameProject");
    expect(welcome).toContain("onDeleteProject");
    expect(welcome).not.toContain("<span>•••</span>");
    expect(appStore).toContain("renameProject");
    expect(appStore).not.toContain("window.prompt(\"项目名称\"");
    expect(appStore).toContain("deleteProject");
    expect(projectIpc).toContain("renameProject");
    expect(projectIpc).toContain("deleteProject");
  });

  it("requires explicit project setup before creating a new novel", () => {
    const app = readSource("src/renderer/App.tsx");
    const appStore = readSource("src/renderer/state/app-store.ts");
    const newProject = readSource("src/renderer/routes/NewProjectPage.tsx");
    const welcome = readSource("src/renderer/routes/WelcomePage.tsx");
    const preloadApi = readSource("src/preload/api.ts");
    const projectIpc = readSource("src/main/ipc/project-ipc.ts");

    expect(app).toContain('type Page = "welcome" | "writing" | "settings" | "import" | "export" | "newProject"');
    expect(app).toContain("<NewProjectPage");
    expect(welcome).toContain("onNewProject");
    expect(welcome).not.toContain("newProjectDraft");
    expect(welcome).not.toContain("新建作品\" onClose");
    expect(newProject).toContain("小说名称");
    expect(newProject).toContain("每章目标字数");
    expect(newProject).toContain("项目文件位置");
    expect(newProject).toContain("确认创建");
    expect(newProject).toContain("onSelectProjectSavePath");
    expect(newProject).toContain("onSuggestProjectPath");
    expect(newProject).not.toContain("封面");
    expect(welcome).not.toContain("封面");
    expect(app).toContain("selectProjectSavePath");
    expect(app).toContain("suggestProjectPath");
    expect(appStore).toContain("ProjectCreateInput");
    expect(appStore).toContain("selectProjectSavePath");
    expect(appStore).toContain("suggestProjectPath");
    expect(appStore).not.toContain('createProject({ name: "我的小说" })');
    expect(preloadApi).toContain("selectProjectSavePath");
    expect(preloadApi).toContain("suggestProjectPath");
    expect(projectIpc).toContain("selectProjectSavePath");
    expect(projectIpc).toContain("suggestProjectPath");
  });

  it("does not show an unexplained draft status on recent projects", () => {
    const welcome = readSource("src/renderer/routes/WelcomePage.tsx");

    expect(welcome).not.toContain("草稿中");
  });

  it("uses the previous chapter target as the default for newly created chapters", () => {
    const appStore = readSource("src/renderer/state/app-store.ts");
    const chapterService = readSource("src/main/chapter/chapter-service.ts");

    expect(appStore).toContain("inheritedTargetWordCount");
    expect(appStore).toContain("targetWordCount: inheritedTargetWordCount");
    expect(chapterService).toContain("targetWordCount: input.targetWordCount ?? null");
  });

  it("asks for confirmation before returning from the writing page to welcome", () => {
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");

    expect(writingPage).toContain("confirmWelcomeOpen");
    expect(writingPage).toContain("返回开始页？");
    expect(writingPage).toMatch(/const handleWelcome[\s\S]*setConfirmWelcomeOpen\(true\)/);
    expect(writingPage).toMatch(/const confirmWelcome[\s\S]*flushBeforeNavigation\(onWelcome\)/);
  });

  it("shows save failures instead of swallowing navigation errors", () => {
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");

    expect(writingPage).toContain("navigationError");
    expect(writingPage).toContain("formatIpcErrorMessage");
    expect(writingPage).toContain("保存失败，已留在当前页面。");
    expect(writingPage).toMatch(/setNavigationError\(formatIpcErrorMessage/);
    expect(writingPage).toContain('role="alert"');
    expect(writingPage).not.toContain(".catch(() => undefined)");
  });

  it("returns from settings to the page that opened settings", () => {
    const app = readSource("src/renderer/App.tsx");
    const settingsPage = readSource("src/renderer/routes/SettingsPage.tsx");
    const importWizard = readSource("src/renderer/routes/ImportWizardPage.tsx");

    expect(app).toContain("const returnFromSettings");
    expect(app).toMatch(/<SettingsPage[\s\S]*onWelcome={returnFromSettings}/);
    expect(settingsPage).toContain('title="返回上一页"');
    expect(importWizard).toContain('title="返回上一页"');
    expect(settingsPage).not.toContain("confirmWelcome");
    expect(settingsPage).not.toContain("返回开始页？");
  });

  it("does not use unsupported native prompt dialogs in renderer flows", () => {
    const appStore = readSource("src/renderer/state/app-store.ts");
    const importWizard = readSource("src/renderer/routes/ImportWizardPage.tsx");
    const selectionBubbleMenu = readSource("src/renderer/editor/SelectionBubbleMenu.tsx");

    expect(appStore).not.toContain("window.prompt");
    expect(importWizard).not.toContain("window.prompt");
    expect(selectionBubbleMenu).not.toContain("window.prompt");
  });

  it("uses the selected user-facing product name", () => {
    const packageJson = readSource("package.json");
    const mainIndex = readSource("src/main/index.ts");
    const rendererIndex = readSource("src/renderer/index.html");
    const welcome = readSource("src/renderer/routes/WelcomePage.tsx");
    const projectIpc = readSource("src/main/ipc/project-ipc.ts");

    expect(packageJson).toContain("\"productName\": \"墨枢\"");
    expect(mainIndex).toContain("title: \"墨枢\"");
    expect(rendererIndex).toContain("<title>墨枢</title>");
    expect(welcome).toContain("title=\"墨枢\"");
    expect(projectIpc).toContain("选择墨枢项目文件");
    expect(`${mainIndex}\n${rendererIndex}\n${welcome}`).not.toContain("墨语小说");
  });
});
