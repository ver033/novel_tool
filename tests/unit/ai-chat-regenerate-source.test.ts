import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("AI chat regenerate source wiring", () => {
  it("exposes a dedicated streaming IPC method for regenerating a chat answer", () => {
    const schemas = readSource("src/main/shared/schemas.ts");
    const sharedTypes = readSource("src/main/shared/types.ts");
    const aiIpc = readSource("src/main/ipc/ai-ipc.ts");
    const preload = readSource("src/preload/api.ts");

    expect(schemas).toContain("aiRegenerateChatMessageStreamInputSchema");
    expect(sharedTypes).toContain("AiRegenerateChatMessageStreamInput");
    expect(sharedTypes).toContain("regenerateChatMessageStream");
    expect(sharedTypes).toContain('regenerateChatMessageStream: "novelTool:ai:regenerateChatMessageStream"');
    expect(aiIpc).toContain("aiRegenerateChatMessageStreamInputSchema");
    expect(aiIpc).toContain("ipcChannels.ai.regenerateChatMessageStream");
    expect(preload).toContain("AiRegenerateChatMessageStreamInput");
    expect(preload).toContain("regenerateChatMessageStream: (input: AiRegenerateChatMessageStreamInput)");
    expect(preload).toContain("ipcChannels.ai.regenerateChatMessageStream");
  });

  it("renders assistant-message regenerate controls without using duplicate resend retry", () => {
    const chatStore = readSource("src/renderer/state/chat-store.ts");
    const chatTab = readSource("src/renderer/sidebar/AiChatTab.tsx");
    const css = readSource("src/renderer/styles/globals.css");

    expect(chatStore).toContain("regenerateAssistantMessage");
    expect(chatStore).toContain("api.ai.regenerateChatMessageStream");
    expect(chatStore).toContain("regeneratingMessageId");
    expect(chatStore).toContain('createRequestId("chat_regenerate")');
    expect(chatTab).toContain("canRegenerateMessage");
    expect(chatTab).toContain("重新生成 AI 回复");
    expect(chatTab).toContain("<ArrowClockwise");
    expect(chatTab).toContain("chatStore.regenerateAssistantMessage(message.id)");
    expect(chatTab).not.toContain("retryLastMessage");
    expect(css).toContain(".message-action-stack");
    expect(css).toContain(".message-regenerate-button");
  });

  it("hides the old assistant text in place while regeneration is streaming", () => {
    const chatTab = readSource("src/renderer/sidebar/AiChatTab.tsx");
    const css = readSource("src/renderer/styles/globals.css");

    expect(chatTab).toContain("isRegeneratingMessage");
    expect(chatTab).toContain("visibleMessageContent");
    expect(chatTab).toContain("正在重新生成...");
    expect(chatTab).toContain("chatStore.busy && !chatStore.regeneratingMessageId");
    expect(chatTab).toContain('className={`${messageClassName(message)}${isRegeneratingMessage ? " regenerating" : ""}`');
    expect(css).toContain(".message.regenerating");
  });

  it("shares one chat store between the right sidebar and floating AI chat", () => {
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");
    const rightSidebar = readSource("src/renderer/layout/RightUtilitySidebar.tsx");
    const utilityPanel = readSource("src/renderer/layout/UtilityPanelContent.tsx");
    const chatTab = readSource("src/renderer/sidebar/AiChatTab.tsx");

    expect(writingPage).toContain("useChatStore({");
    expect(writingPage).toContain("chatPanelVisible");
    expect(writingPage).toContain("chatStore={chatStore}");
    expect(rightSidebar).toContain("readonly chatStore: ChatStore");
    expect(utilityPanel).toContain("readonly chatStore: ChatStore");
    expect(chatTab).toContain("readonly chatStore: ChatStore");
    expect(chatTab).not.toContain("useChatStore({");
  });

  it("allows sidebar and floating AI chat to coexist without closing either surface", () => {
    const app = readSource("src/renderer/App.tsx");

    expect(app).not.toContain("closeFloatingChatPanels");
    expect(app).not.toContain('panel.kind !== "chat"');
    expect(app).not.toContain('if (tab === "chat")');
    expect(app).not.toContain('if (sidebarTab === "chat")');
    expect(app).toContain("onSidebarTabChange={setSidebarTab}");
  });
});
