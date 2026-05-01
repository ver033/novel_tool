import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("AI chat author interaction regressions", () => {
  it("surfaces provider failures as actionable chat errors with retry and settings actions", () => {
    const chat = readSource("src/renderer/sidebar/AiChatTab.tsx");
    const sidebar = readSource("src/renderer/layout/RightUtilitySidebar.tsx");

    expect(chat).toContain("chat-error-panel");
    expect(chat).toContain("chatErrorTitle");
    expect(chat).toContain("OpenRouter 请求被限流");
    expect(chat).toContain("重试上一条");
    expect(chat).toContain("打开 AI 服务设置");
    expect(sidebar).toContain("onOpenSettings={onOpenSettings}");
  });

  it("shows explicit context and skill command suggestions in the chat input", () => {
    const chat = readSource("src/renderer/sidebar/AiChatTab.tsx");
    const sidebar = readSource("src/renderer/layout/RightUtilitySidebar.tsx");
    const writing = readSource("src/renderer/routes/WritingPage.tsx");
    const css = readSource("src/renderer/styles/globals.css");

    expect(chat).toContain("chat-command-menu");
    expect(chat).toContain("chatMentionSuggestions");
    expect(chat).toContain("chatSkillSuggestions");
    expect(chat).toContain("@选区");
    expect(chat).toContain("@全部章节");
    expect(chat).toContain("/润色");
    expect(chat).toContain("/校对");
    expect(sidebar).toContain("chapters={chapters}");
    expect(writing).toContain("chapters={chapters}");
    expect(css).toContain(".chat-command-menu");
  });

  it("lets authors send selected editor text into the AI chat draft", () => {
    const app = readSource("src/renderer/App.tsx");
    const writing = readSource("src/renderer/routes/WritingPage.tsx");
    const editor = readSource("src/renderer/editor/NovelEditor.tsx");
    const bubble = readSource("src/renderer/editor/SelectionBubbleMenu.tsx");
    const sidebar = readSource("src/renderer/layout/RightUtilitySidebar.tsx");
    const chat = readSource("src/renderer/sidebar/AiChatTab.tsx");
    const css = readSource("src/renderer/styles/globals.css");

    expect(bubble).toContain("onSelectionToChat");
    expect(bubble).toContain("sendSelectionToChat");
    expect(bubble).toContain("送到 AI Chat");
    expect(editor).toContain("onSelectionToChat={onSelectionToChat}");
    expect(writing).toContain("onSelectionToChat");
    expect(app).toContain("sendSelectionToChat");
    expect(app).toContain('setSidebarTab("chat")');
    expect(app).toContain("setAiChatDraftSeed");
    expect(sidebar).toContain("draftSeed={aiChatDraftSeed}");
    expect(chat).toContain("draftSeed");
    expect(chat).toContain("setDraft((current)");
    expect(css).toContain(".send-to-chat-option");
  });
});
