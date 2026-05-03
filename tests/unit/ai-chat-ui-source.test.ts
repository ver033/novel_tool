import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("AI chat summary index UI source", () => {
  it("loads and exposes summary index status from the chat store", () => {
    const chatStore = readSource("src/renderer/state/chat-store.ts");

    expect(chatStore).toContain("SUMMARY_INDEX_POLL_MS");
    expect(chatStore).toContain("SummaryIndexStatus");
    expect(chatStore).toContain("summaryIndexStatus");
    expect(chatStore).toContain("summaryIndexLoading");
    expect(chatStore).toContain("summaryIndexNotice");
    expect(chatStore).toContain("refreshSummaryIndexStatus");
    expect(chatStore).toContain("rebuildSummaryIndex");
    expect(chatStore).toContain("cancelSummaryIndexJob");
    expect(chatStore).toContain("api.summary.getIndexStatus");
    expect(chatStore).toContain("api.summary.rebuildProjectIndex");
    expect(chatStore).toContain("force: true");
    expect(chatStore).toContain("api.summary.cancelCurrentJob");
    expect(chatStore).toContain("summaryIndexStatus.queuedJobCount");
    expect(chatStore).toContain("summaryIndexStatus.runningJobLabel");
    expect(chatStore).toContain("setInterval");
    expect(chatStore).toContain("clearInterval");
    expect(chatStore).toContain("streamTextBuffer");
    expect(chatStore).toContain("streamReasoningBuffer");
    expect(chatStore).toContain("requestAnimationFrame");
    expect(chatStore).toContain("flushStreamBuffers");
  });

  it("renders compact summary index status in the AI chat tab only", () => {
    const chatTab = readSource("src/renderer/sidebar/AiChatTab.tsx");
    const rightSidebar = readSource("src/renderer/layout/RightUtilitySidebar.tsx");
    const css = readSource("src/renderer/styles/globals.css");

    expect(chatTab).toContain("buildSummaryIndexBanner");
    expect(chatTab).toContain("全书索引：");
    expect(chatTab).toContain("正在摘要：");
    expect(chatTab).toContain("索引已暂停：AI 正在回答");
    expect(chatTab).toContain("AI 服务未配置，索引暂停");
    expect(chatTab).toContain("索引过期：");
    expect(chatTab).toContain("开始建立索引");
    expect(chatTab).toContain("继续建立索引");
    expect(chatTab).toContain("停止后台索引");
    expect(chatTab).toContain("打开缓存设置");
    expect(chatTab).toContain('onOpenSettings("章节索引缓存")');
    expect(chatTab).not.toContain("void chatStore.rebuildSummaryIndex({ force: true })");
    expect(chatTab).toContain("后台索引已停止");
    expect(chatTab).toContain("后台索引已关闭");
    expect(chatTab).toContain("自动重试");
    expect(chatTab).toContain("retryingJobs");
    expect(chatTab).toContain("recentFailedJobs");
    expect(chatTab).toContain("failureCategory");
    expect(chatTab).toContain("actionHint");
    expect(chatTab).toContain("summary-index-notice");
    expect(chatTab).toContain("summary-index-banner");
    expect(css).toContain(".summary-index-banner");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(css).toContain(".summary-index-banner .small-button");
    expect(css).toContain("white-space: nowrap");
    expect(css).toContain(".summary-index-notice");
    expect(css).toContain("grid-column: 1 / -1");
    expect(rightSidebar).not.toContain("summary-index-banner");
  });

  it("surfaces context source and coverage in the context meter", () => {
    const chatTab = readSource("src/renderer/sidebar/AiChatTab.tsx");
    const contextDisplay = readSource("src/renderer/sidebar/chat-context-display.ts");

    expect(contextDisplay).toContain("sourceLabel");
    expect(contextDisplay).toContain("coverageLabel");
    expect(contextDisplay).toContain("全文摘要索引");
    expect(contextDisplay).toContain("索引缺失");
    expect(chatTab).toContain("contextDisplay.sourceLabel");
    expect(chatTab).toContain("contextDisplay.coverageLabel");
    expect(chatTab).toContain("上下文 {contextDisplay.sourceLabel}");
  });
});
