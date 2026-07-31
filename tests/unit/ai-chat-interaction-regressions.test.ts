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
    expect(chat).toContain("AI Provider 请求被限流");
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
    expect(chat).toContain("getChatSkillSuggestions");
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
    expect(chat).toContain("consumeDraftSeed(draftSeed)");
    expect(css).toContain(".send-to-chat-option");
  });

  it("shares the AI chat input draft across sidebar and floating chat surfaces", () => {
    const chatStore = readSource("src/renderer/state/chat-store.ts");
    const chat = readSource("src/renderer/sidebar/AiChatTab.tsx");

    expect(chatStore).toContain("const [draft, setDraftState]");
    expect(chatStore).toContain("draftRef");
    expect(chatStore).toContain("consumedDraftSeedId");
    expect(chatStore).toContain("consumeDraftSeed");
    expect(chatStore).toContain("draft,");
    expect(chatStore).toContain("setDraft,");
    expect(chat).toContain("const draft = chatStore.draft");
    expect(chat).toContain("const setDraft = chatStore.setDraft");
    expect(chat).not.toContain('const [draft, setDraft] = useState("")');
  });

  it("guards AI chat streams synchronously when two chat surfaces are open", () => {
    const chatStore = readSource("src/renderer/state/chat-store.ts");

    expect(chatStore).toContain("busyRef");
    expect(chatStore).toContain("activeRequestId.current");
    expect(chatStore).toContain("setBusyState");
    expect(chatStore).toContain("busyRef.current = nextBusy");
    expect(chatStore).toContain("busyRef.current || activeRequestId.current");
  });

  it("flushes pending editor saves before AI chat reads the current chapter", () => {
    const chatStore = readSource("src/renderer/state/chat-store.ts");
    const writing = readSource("src/renderer/routes/WritingPage.tsx");
    const sidebar = readSource("src/renderer/layout/RightUtilitySidebar.tsx");

    expect(chatStore).toContain("readonly flushPendingSave");
    expect(chatStore).toContain("await flushPendingSave()");
    expect(chatStore.indexOf("await flushPendingSave()")).toBeLessThan(chatStore.indexOf("api.chapter.getContent"));
    expect(writing).toContain("flushPendingSave: editorStore.flushPendingSave");
    expect(writing).toContain("chatStore={chatStore}");
    expect(sidebar).toContain("chatStore={chatStore}");
  });

  it("keeps the AI chat message list pinned to the newest output", () => {
    const chat = readSource("src/renderer/sidebar/AiChatTab.tsx");

    expect(chat).toContain("messagesEndRef");
    expect(chat).toContain("scrollIntoView");
    expect(chat).toContain("chatStore.streamingText");
    expect(chat).toContain("chatStore.streamingReasoning");
    expect(chat).toContain("AgentActivityTrail");
    expect(chat).not.toContain('<details className="chat-reasoning"');
    expect(chat).toContain("chat-scroll-anchor");
  });

  it("renders real Pi activity events and keeps the model visible in the composer", () => {
    const chat = readSource("src/renderer/sidebar/AiChatTab.tsx");
    const trail = readSource("src/renderer/sidebar/AgentActivityTrail.tsx");
    const runtime = readSource("src/main/ai/agent-runtime/pi-novel-agent-runtime.ts");
    const service = readSource("src/main/ai/ai-task-service.ts");

    expect(chat).toContain("chatStore.agentActivities");
    expect(chat).toContain("chat-runtime-bar");
    expect(chat).toContain("activeModelName");
    expect(chat.indexOf("<textarea")).toBeLessThan(chat.indexOf('className="chat-runtime-bar"'));
    expect(readSource("src/renderer/styles/globals.css")).toContain("grid-template-columns: minmax(112px, 1fr) minmax(0, auto) 38px");
    expect(trail).toContain('item.kind === "tool"');
    expect(trail).toContain('item.kind === "task"');
    expect(trail).toContain("agent-process-toggle");
    expect(trail).toContain("agent-task-progress");
    expect(trail).not.toContain("确认请求");
    expect(trail).not.toContain("工作记录 · 4 项");
    expect(runtime).toContain('event.type === "tool_execution_start"');
    expect(runtime).toContain('event.type === "tool_execution_end"');
    expect(runtime).toContain("toTaskAgentTools");
    expect(runtime).not.toContain("activityTracker.startTurn");
    expect(runtime).not.toContain("activityTracker.startResponse");
    expect(runtime).not.toContain("tool_choice");
    expect(service).not.toContain("inferInlineWritingOperationRequest");
  });

  it("shows icon-only copy controls for AI chat replies and streamed output", () => {
    const chat = readSource("src/renderer/sidebar/AiChatTab.tsx");
    const css = readSource("src/renderer/styles/globals.css");

    expect(chat).toContain("CopySimple");
    expect(chat).toContain("Check");
    expect(chat).toContain("copyChatMessage");
    expect(chat).toContain("copyStreamingReply");
    expect(chat).toContain("label={copy.copyReply}");
    expect(chat).toContain("label={copy.copyStreaming}");
    expect(css).toContain(".message-copy-button");
    expect(css).toContain(".chat-copy-error");
  });
});
