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
    expect(chatStore).toContain("refreshSummaryIndexStatus");
    expect(chatStore).toContain("rebuildSummaryIndex");
    expect(chatStore).toContain("api.summary.getIndexStatus");
    expect(chatStore).toContain("api.summary.rebuildProjectIndex");
    expect(chatStore).toContain("summaryIndexStatus.queuedJobCount");
    expect(chatStore).toContain("summaryIndexStatus.runningJobLabel");
    expect(chatStore).toContain("setInterval");
    expect(chatStore).toContain("clearInterval");
  });

  it("renders compact summary index status in the AI chat tab only", () => {
    const chatTab = readSource("src/renderer/sidebar/AiChatTab.tsx");
    const rightSidebar = readSource("src/renderer/layout/RightUtilitySidebar.tsx");
    const css = readSource("src/renderer/styles/globals.css");

    expect(chatTab).toContain("buildSummaryIndexBanner");
    expect(chatTab).toContain("全书索引已完成");
    expect(chatTab).toContain("全书索引正在建立");
    expect(chatTab).toContain("全书索引缺失");
    expect(chatTab).toContain("AI 服务未配置，索引暂停");
    expect(chatTab).toContain("章摘要已过期");
    expect(chatTab).toContain("开始建立索引");
    expect(chatTab).toContain("重建全书索引");
    expect(chatTab).toContain("summary-index-banner");
    expect(css).toContain(".summary-index-banner");
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
  });
});
