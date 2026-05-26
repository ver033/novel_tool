import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

function readFunctionBlock(source: string, functionName: string): string {
  const start = source.indexOf(`function ${functionName}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe("settings page scope", () => {
  it("only exposes implemented settings sections in the navigation", () => {
    const settings = readSource("src/renderer/routes/SettingsPage.tsx");
    const app = readSource("src/renderer/App.tsx");

    expect(settings).toContain('const visibleCategories = ["AI 服务", "提示词预设", "章节索引缓存", "导入导出", "实验功能"] as const satisfies readonly SettingsCategory[];');
    expect(settings).toContain("visibleCategories.map");
    expect(settings).toContain("activeVisibleCategory");
    expect(app).toContain('useState<SettingsCategory>("AI 服务")');
  });

  it("exposes Windows startup launch on the experimental settings page with a dedicated IPC surface", () => {
    const settings = readSource("src/renderer/routes/SettingsPage.tsx");
    const preload = readSource("src/preload/api.ts");
    const ipcTypes = readSource("src/main/shared/types.ts");
    const settingsIpc = readSource("src/main/ipc/settings-ipc.ts");
    const registerIpc = readSource("src/main/ipc/register-ipc.ts");
    const experimentalPane = readFunctionBlock(settings, "ExperimentalSettingsPane");

    expect(settings).toContain("开机自启动");
    expect(settings).not.toContain("Windows 登录后自动启动");
    expect(settings).toContain("StartupLaunchSettingsPane");
    expect(experimentalPane).toContain("<StartupLaunchSettingsPane />");
    expect(settings).toContain("api.startupLaunch.getStatus");
    expect(settings).toContain("api.startupLaunch.updateSettings");
    expect(preload).toContain("startupLaunch");
    expect(preload).toContain("ipcChannels.startupLaunch.getStatus");
    expect(preload).toContain("ipcChannels.startupLaunch.updateSettings");
    expect(ipcTypes).toContain("novelTool:startupLaunch:getStatus");
    expect(ipcTypes).toContain("novelTool:startupLaunch:updateSettings");
    expect(settingsIpc).toContain("startupLaunchService.getStatus");
    expect(settingsIpc).toContain("startupLaunchService.setEnabled");
    expect(registerIpc).toContain("startupLaunchService.ensureDefaultEnabled");
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

  it("keeps product analysis status and OpenRouter rate-limit errors readable", () => {
    const settings = readSource("src/renderer/routes/SettingsPage.tsx");
    const styles = readSource("src/renderer/styles/globals.css");

    expect(settings).toContain('className="summary-cache-status-grid usage-analytics-status-grid"');
    expect(settings).toContain("UsageAnalyticsErrorNotice");
    expect(settings).toContain("OpenRouter 请求被限流");
    expect(settings).toContain("查看原始错误");
    expect(settings).not.toContain("自动把聚合使用统计");
    expect(settings).not.toContain("生成产品优化报告");
    expect(settings).not.toContain("最近一次分析");
    expect(settings).not.toContain("latestReportText ? (");
    expect(styles).toContain(".usage-analytics-status-grid");
    expect(styles).toContain(".usage-analytics-error-card");
    expect(styles).toContain("overflow-wrap: anywhere");
  });

  it("keeps prototype and product analysis tools on the experimental settings page", () => {
    const settings = readSource("src/renderer/routes/SettingsPage.tsx");
    const aiBranch = settings.slice(settings.indexOf('if (category === "AI 服务")'), settings.indexOf('if (category === "提示词预设")'));
    const importExportPane = readFunctionBlock(settings, "ImportExportSettingsPane");
    const experimentalPane = readFunctionBlock(settings, "ExperimentalSettingsPane");

    expect(settings).toContain("实验功能");
    expect(settings).toContain('if (category === "实验功能")');
    expect(settings).toContain("<ExperimentalSettingsPane apiKeyConfigured={apiKeyConfigured} currentProject={currentProject} />");
    expect(settings).toContain('activeVisibleCategory !== "章节索引缓存" && activeVisibleCategory !== "导入导出" && activeVisibleCategory !== "实验功能"');
    expect(aiBranch).not.toContain("UsageAnalyticsSettingsPane");
    expect(importExportPane).not.toContain("ExternalBookSyncPane");
    expect(experimentalPane).toContain("<UsageAnalyticsSettingsPane apiKeyConfigured={apiKeyConfigured} />");
    expect(experimentalPane).toContain("<StartupLaunchSettingsPane />");
    expect(experimentalPane).toContain("<ExternalBookSyncPane currentProject={currentProject} />");
    expect(settings).toContain("<h3>同步检查</h3>");
    expect(settings).not.toContain("外部 .Book 同步检查");
    expect(settings).not.toContain("只读取项目同名文件夹下的 .Book 文件");
    expect(settings).not.toContain("查看保存路径");
    expect(settings).not.toContain("{source.bookFolderPath}");
    expect(settings).not.toContain("status?.search.isRunning");
    expect(settings).not.toContain("正在自动搜索 .Book");
    expect(settings).not.toContain("status?.latestAutomaticRun");
    expect(settings).not.toContain("最近自动同步");
    expect(settings).not.toContain("发给 LLM");
    expect(settings).toContain("选择检查目录");
    expect(settings).not.toContain("选择同步目录");
    expect(settings).toContain("api.externalBookSync.scan");
    expect(settings).not.toContain("api.externalBookSync.sendMissingChaptersToAi");
    expect(settings).toContain("api.externalBookSync.selectDirectory");
    expect(settings).toContain("api.externalBookSync.cancelScan");
    expect(settings).toContain("停止扫描");
    expect(settings).not.toContain("高可信");
    expect(settings).not.toContain("需确认");
    expect(settings).not.toContain("低可信");
  });

  it("exposes chapter summary cache management without manual cache editing", () => {
    const settings = readSource("src/renderer/routes/SettingsPage.tsx");
    const chatTab = readSource("src/renderer/sidebar/AiChatTab.tsx");
    const app = readSource("src/renderer/App.tsx");

    expect(settings).toContain("章节索引缓存");
    expect(settings).toContain("完整缓存信息");
    expect(settings).toContain("人物关系图结果");
    expect(settings).toContain("缓存总览");
    expect(settings).toContain("章节缓存");
    expect(settings).toContain("人物关系图");
    expect(settings).toContain("阶段摘要");
    expect(settings).toContain("全书摘要");
    expect(settings).toContain("失败重试");
    expect(settings).toContain("摘要图谱字段缺失");
    expect(settings).toContain("人物关系图来源");
    expect(settings).toContain("不再额外维护逐章图谱任务或独立融合任务");
    expect(settings).toContain("RelationshipGraphCachePanel");
    expect(settings).toContain("api.relationshipGraph.getGraph");
    expect(settings).toContain("api.relationshipGraph.getSourceStatus");
    expect(settings).not.toContain("api.relationshipGraph.refreshCacheStatus");
    expect(settings).not.toContain("api.relationshipGraph.getCacheSettingsStatus");
    expect(settings).not.toContain("api.relationshipGraph.upgradeMissingFromOriginalText");
    expect(settings).not.toContain("api.relationshipGraph.retryIdentityResolution");
    expect(settings).toContain("relationshipGraphSourceStatusPromise");
    expect(settings).toContain(".catch(() => null)");
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
    expect(settings).toContain("<SummaryCacheSettingsPane cache={form.cache} currentProject={currentProject} onCacheSettingsChange={onCacheSettingsChange} />");
    expect(app).toContain('type SettingsReturnPage = "welcome" | "writing" | "relationshipGraph"');
    expect(app).toContain('currentProject={settingsReturnPage === "welcome" ? null : appStore.currentProject}');
    expect(settings).not.toContain("pendingChapterId");
    expect(settings).not.toContain("选择章节缓存");
    expect(settings).not.toContain("保存缓存编辑");
    expect(settings).not.toContain("updateChapterCache");
    expect(settings).not.toContain("已登记章节");
    expect(chatTab).toContain("打开缓存设置");
    expect(chatTab).not.toContain("void chatStore.rebuildSummaryIndex({ force: true })");
  });

  it("shows unified cache controls before detailed cache browsers", () => {
    const settings = readSource("src/renderer/routes/SettingsPage.tsx");

    expect(settings).toContain("章节缓存顺序");
    expect(settings).toContain("最近章节优先");
    expect(settings).toContain("从第 1 章开始");
    expect(settings).toContain("chapterCacheBuildOrder");
    expect(settings).toContain("api.settings.save({ cache:");
    expect(settings).toContain("人物关系图来源");
    expect(settings).toContain("阶段图谱");
    expect(settings).toContain("全书图谱");
    expect(settings.indexOf("缓存总览")).toBeLessThan(settings.indexOf("章节缓存详情"));
    expect(settings.indexOf("<RelationshipGraphCacheSettingsBlock")).toBeGreaterThan(settings.indexOf("summary-cache-overview"));
    expect(settings.indexOf("<RelationshipGraphCacheSettingsBlock")).toBeLessThan(settings.indexOf("summary-cache-browser"));
  });

  it("puts the shareable copy export in settings with strict privacy copy", () => {
    const settings = readSource("src/renderer/routes/SettingsPage.tsx");
    const importExportPane = readFunctionBlock(settings, "ImportExportSettingsPane");

    expect(settings).toContain("导入导出");
    expect(settings).toContain("ImportExportSettingsPane");
    expect(importExportPane).not.toContain("ExternalBookSyncPane");
    expect(settings).toContain("ShareableProjectExportPane");
    expect(settings).toContain("导出可分享副本");
    expect(settings).toContain("严格隐私清理");
    expect(settings).toContain("api.export.selectShareableProjectFilePath");
    expect(settings).toContain("api.export.exportShareableProjectCopy");
    expect(settings).toContain("AI 聊天记录、AI 改写任务记录、章节快照和导入记录会始终移除");
  });
});
