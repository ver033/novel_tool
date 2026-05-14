import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("settings page scope", () => {
  it("only exposes implemented settings sections in the navigation", () => {
    const settings = readSource("src/renderer/routes/SettingsPage.tsx");
    const app = readSource("src/renderer/App.tsx");

    expect(settings).toContain('const visibleCategories = ["AI 服务", "提示词预设", "章节索引缓存"] as const satisfies readonly SettingsCategory[];');
    expect(settings).toContain("visibleCategories.map");
    expect(settings).toContain("activeVisibleCategory");
    expect(app).toContain('useState<SettingsCategory>("AI 服务")');
  });

  it("does not show disabled placeholder AI behavior controls in the visible AI settings", () => {
    const settings = readSource("src/renderer/routes/SettingsPage.tsx");

    expect(settings).not.toContain("默认 AI 行为");
    expect(settings).not.toContain("默认行动风格");
    expect(settings).not.toContain("上下文范围");
  });

  it("keeps OpenRouter connection testing separate from saving the selected model", () => {
    const settings = readSource("src/renderer/routes/SettingsPage.tsx");

    expect(settings).toContain("测试连接");
    expect(settings).toContain("保存 AI 设置");
    expect(settings).toContain("onSaveSettings");
    expect(settings).not.toContain("测试并保存");
    expect(settings).toContain("测试连接成功，已获取");
    expect(settings).toContain("请选择模型后保存");
  });

  it("exposes chapter summary cache management without manual cache editing", () => {
    const settings = readSource("src/renderer/routes/SettingsPage.tsx");
    const chatTab = readSource("src/renderer/sidebar/AiChatTab.tsx");
    const app = readSource("src/renderer/App.tsx");

    expect(settings).toContain("章节索引缓存");
    expect(settings).toContain("完整缓存信息");
    expect(settings).toContain("人物关系缓存结果");
    expect(settings).toContain("RelationshipGraphCachePanel");
    expect(settings).toContain("api.relationshipGraph.getStatus");
    expect(settings).toContain("api.relationshipGraph.getGraph");
    expect(settings).toContain("点击查看完整缓存");
    expect(settings).toContain("getChapterCacheActionLabel");
    expect(settings).toContain("生成本章缓存");
    expect(settings).toContain("重新缓存");
    expect(settings).toContain("重试本章缓存");
    expect(settings).toContain("继续建立索引");
    expect(settings).toContain("强制重建全书索引");
    expect(settings).toContain("停止后台索引");
    expect(settings).toContain("api.summary.listCacheEntries");
    expect(settings).toContain("api.summary.getChapterCache");
    expect(settings).toContain("api.summary.clearAndRetryChapterCache");
    expect(settings).not.toContain("api.project.getCurrentProject");
    expect(settings).toContain("currentProject: ProjectRecord | null");
    expect(settings).toContain("<SummaryCacheSettingsPane currentProject={currentProject} />");
    expect(app).toContain('type SettingsReturnPage = "welcome" | "writing" | "relationshipGraph"');
    expect(app).toContain('currentProject={settingsReturnPage === "welcome" ? null : appStore.currentProject}');
    expect(settings).not.toContain("pendingChapterId");
    expect(settings).not.toContain("选择章节缓存");
    expect(settings).not.toContain("保存缓存编辑");
    expect(settings).not.toContain("updateChapterCache");
    expect(chatTab).toContain("打开缓存设置");
    expect(chatTab).not.toContain("void chatStore.rebuildSummaryIndex({ force: true })");
  });
});
