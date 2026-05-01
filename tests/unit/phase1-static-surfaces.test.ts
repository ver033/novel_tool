import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("phase 1 static product surfaces", () => {
  it("defines the required route, layout, and base component files", () => {
    const files = [
      "src/renderer/routes/WelcomePage.tsx",
      "src/renderer/routes/NewProjectPage.tsx",
      "src/renderer/routes/WritingPage.tsx",
      "src/renderer/routes/SettingsPage.tsx",
      "src/renderer/routes/ImportWizardPage.tsx",
      "src/renderer/layout/AppShell.tsx",
      "src/renderer/layout/TopBar.tsx",
      "src/renderer/layout/LeftChapterTree.tsx",
      "src/renderer/layout/RightUtilitySidebar.tsx",
      "src/renderer/components/Button.tsx",
      "src/renderer/components/IconButton.tsx",
      "src/renderer/components/Input.tsx",
      "src/renderer/components/Textarea.tsx",
      "src/renderer/components/Tabs.tsx",
      "src/renderer/components/Modal.tsx",
      "src/renderer/components/EmptyState.tsx",
    ];

    expect(files.filter((file) => !existsSync(join(rootDir, file)))).toEqual([]);
  });

  it("keeps the welcome page focused on project entry without supported-format cards", () => {
    const welcome = readSource("src/renderer/routes/WelcomePage.tsx");

    expect(welcome).toContain("开始创作");
    expect(welcome).toContain("继续写作");
    expect(welcome).toContain("新建作品");
    expect(welcome).toContain("导入小说");
    expect(welcome).toContain("最近项目");
    expect(welcome).not.toContain("支持格式");
  });

  it("keeps writing page AI entry points and author metrics in place", () => {
    const app = readSource("src/renderer/App.tsx");
    const writing = readSource("src/renderer/routes/WritingPage.tsx");
    const bubbleMenu = readSource("src/renderer/editor/SelectionBubbleMenu.tsx");
    const editorStore = readSource("src/renderer/state/editor-store.ts");
    const floatingAiButton = readSource("src/renderer/editor/FloatingAiButton.tsx");
    const sidebar = readSource("src/renderer/layout/RightUtilitySidebar.tsx");

    expect(app).toContain("const [sidebarOpen, setSidebarOpen] = useState(false);");
    expect(app).toContain("setSidebarOpen(false);");
    expect(app).toContain("setSidebarOpen(true);");
    expect(floatingAiButton).toContain("Sparkle");
    expect(`${writing}\n${floatingAiButton}`).not.toContain("ChatCircleText");
    for (const label of ["润色", "扩写", "校对", "续写"]) {
      expect(bubbleMenu).toContain(label);
    }
    for (const label of ["AI 对话", "当前任务", "草稿纸"]) {
      expect(sidebar).toContain(label);
    }
    for (const metric of ["字数", "今日", "本章目标", "已保存"]) {
      expect(`${writing}\n${editorStore}`).toContain(metric);
    }
    expect(writing).not.toContain("中文⌄");
    expect(writing).toContain("openTargetWordCountModal");
    expect(writing).not.toContain("预计阅读时间");
  });

  it("keeps settings and import wizard categories aligned with the V1 spec", () => {
    const settings = readSource("src/renderer/routes/SettingsPage.tsx");
    const importWizard = readSource("src/renderer/routes/ImportWizardPage.tsx");

    for (const category of ["AI 服务", "提示词预设"]) {
      expect(settings).toContain(category);
    }
    expect(settings).toContain("visibleCategories.map");
    for (const step of ["选择文件", "识别章节", "预览与调整", "完成导入"]) {
      expect(importWizard).toContain(step);
    }
  });

  it("keeps completed import wizard steps genuinely navigable", () => {
    const app = readSource("src/renderer/App.tsx");
    const importWizard = readSource("src/renderer/routes/ImportWizardPage.tsx");

    expect(app).toContain("onStepChange={setImportStep}");
    expect(importWizard).toContain("onStepChange: (step: number) => void");
    expect(importWizard).toContain("disabled={number > step || busy}");
    expect(importWizard).toContain("onClick={() => onStepChange(number)}");
  });
});
