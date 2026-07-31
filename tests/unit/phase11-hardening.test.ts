import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("phase 11 V1 hardening", () => {
  it("documents the V1 run commands and core workflows", () => {
    const packageJson = readSource("package.json");
    const importWizard = readSource("src/renderer/routes/ImportWizardPage.tsx");
    const currentTask = readSource("src/renderer/sidebar/CurrentTaskTab.tsx");
    const settingsPage = readSource("src/renderer/routes/SettingsPage.tsx");

    expect(packageJson).toContain('"dev": "electron-forge start"');
    expect(packageJson).toContain('"build": "electron-forge package"');
    expect(importWizard).toContain("api.import.selectTxtFile");
    expect(currentTask).toContain("polish");
    expect(currentTask).toContain("expand");
    expect(currentTask).toContain("proofread");
    expect(currentTask).toContain("continue");
    expect(settingsPage).toContain("OpenRouter");
  });

  it("does not expose incomplete V1 affordances or internal runtime terms in user-facing source", () => {
    const runtimeUi = [
      "src/renderer/routes/WelcomePage.tsx",
      "src/renderer/routes/SettingsPage.tsx",
      "src/renderer/routes/ImportWizardPage.tsx",
      "src/renderer/sidebar/AiChatTab.tsx",
      "src/main/ai/ai-task-service.ts"
    ].map(readSource).join("\n");

    expect(runtimeUi).not.toContain("EPUB");
    expect(runtimeUi).not.toContain("Markdown");
    expect(runtimeUi).not.toContain("后续</button>");
    expect(runtimeUi).not.toContain("后续</span>");
    expect(runtimeUi).not.toContain("添加上下文");
    expect(runtimeUi).not.toContain("本地占位");
    expect(runtimeUi).not.toContain("artifact");
    expect(runtimeUi).not.toContain("agent run");
    expect(runtimeUi).not.toContain("context package");
    expect(runtimeUi).not.toContain("token budget");
    expect(runtimeUi).not.toContain("pipeline");
  });

  it("keeps import errors and busy states visible outside a single step body", () => {
    const importWizard = readSource("src/renderer/routes/ImportWizardPage.tsx");

    expect(importWizard).toContain("const statusText");
    expect(importWizard).toContain("const busyStatus");
    expect(importWizard).toContain("className={`import-status");
    expect(importWizard).toContain('role="status"');
    expect(importWizard).not.toContain("onMerge={() => undefined}");
  });

  it("shows AI chat busy/error states without future placeholder controls", () => {
    const chat = readSource("src/renderer/sidebar/AiChatTab.tsx");

    expect(chat).toContain("copy.aiThinking");
    expect(chat).not.toContain("AI 正在回复");
    expect(chat).toContain("copy.analyzing");
    expect(chat).toContain('aria-live="polite"');
    expect(chat).toContain("message pending");
    expect(chat).toContain("chat-bottom-meta");
    expect(chat).toContain("contextDisplay.usedLabel");
    expect(chat).toContain("chatStore.contextUsagePending");
    expect(chat.indexOf("chat-context-status")).toBeGreaterThan(chat.indexOf("chat-bottom-meta"));
    expect(chat.indexOf("chat-context-status")).toBeLessThan(chat.indexOf('aria-label={t("send")}'));
    expect(chat).not.toContain("添加上下文");
  });

  it("persists and streams AI chat through a dedicated store", () => {
    const chat = readSource("src/renderer/sidebar/AiChatTab.tsx");
    const chatStore = readSource("src/renderer/state/chat-store.ts");
    const rightSidebar = readSource("src/renderer/layout/RightUtilitySidebar.tsx");
    const writing = readSource("src/renderer/routes/WritingPage.tsx");

    expect(writing).toContain("useChatStore");
    expect(rightSidebar).toContain("chatStore={chatStore}");
    expect(chat).toContain("deleteCurrentSession");
    expect(chat).toContain("chatStore.loading || !chatStore.session");
    expect(chatStore).toContain("getChatSession");
    expect(chatStore).toContain("listChatMessages");
    expect(chatStore).toContain("sendChatMessageStream");
    expect(chatStore).toContain("subscribeAiStream");
    expect(chatStore).toContain("setContextUsagePending(true)");
    expect(chatStore).toContain("setContextUsagePending(false)");
    expect(chatStore).toContain("deleteCurrentSession");
    expect(rightSidebar).toContain("currentProjectId={currentProjectId}");
  });

  it("keeps the previous context meter visible while the next chat request is preparing", () => {
    const chat = readSource("src/renderer/sidebar/AiChatTab.tsx");
    const chatStore = readSource("src/renderer/state/chat-store.ts");
    const sendStart = chatStore.indexOf('const requestId = createRequestId("chat_stream")');
    const subscribeStart = chatStore.indexOf("unsubscribe = api.ai.subscribeAiStream", sendStart);
    const sendPreamble = chatStore.slice(sendStart, subscribeStart);

    expect(sendPreamble).toContain("setContextUsagePending(true)");
    expect(sendPreamble).not.toContain("setContextUsage(null)");
    expect(chatStore).toContain("onContext(event)");
    expect(chatStore).toContain("setContextUsage(event)");
    expect(chatStore).toContain("setContextUsagePending(false)");
    expect(chat).toContain("<strong>{contextDisplay?.percentText ?? copy.analyzingShort}</strong>");
    expect(chat).not.toContain('chatStore.contextUsagePending ? "分析中"');
    expect(chat).toContain("context-updating");
    expect(chat).toContain("copy.contextPending");
  });

  it("restores the persisted chat context meter from the active session", () => {
    const chatStore = readSource("src/renderer/state/chat-store.ts");

    expect(chatStore).toContain("getSessionContextUsage");
    expect(chatStore).toContain("nextSession");
    expect(chatStore).toContain("getSessionContextUsage(nextSession) ?? idleContextUsage");
    expect(chatStore).toContain("getSessionContextUsage(selectedSession) ?? idleContextUsage");
    expect(chatStore).toContain("setIdleContextUsage(idleContextUsage)");
  });

  it("sends AI chat with Enter while preserving Shift Enter for new lines", () => {
    const chat = readSource("src/renderer/sidebar/AiChatTab.tsx");

    expect(chat).toContain("handleDraftKeyDown");
    expect(chat).toContain('event.key === "Enter"');
    expect(chat).toContain("!event.shiftKey");
    expect(chat).toContain("!event.nativeEvent.isComposing");
    expect(chat).toContain("event.preventDefault()");
    expect(chat).toContain("void sendMessage()");
    expect(chat).toContain("onKeyDown={handleDraftKeyDown}");
  });

  it("lets the user stop an in-flight AI chat response without hiding the chat controls", () => {
    const chat = readSource("src/renderer/sidebar/AiChatTab.tsx");
    const chatStore = readSource("src/renderer/state/chat-store.ts");

    expect(chat).toContain("aria-label={copy.stopAi}");
    expect(chat).toContain("chatStore.cancelActiveStream");
    expect(chatStore).toContain("cancelActiveStream");
    expect(chatStore).toContain("setBusy(false)");
    expect(chatStore).toContain("isCanceledIpcError(reason)");
  });

  it("supports multiple persisted AI chat sessions from the sidebar", () => {
    const chat = readSource("src/renderer/sidebar/AiChatTab.tsx");
    const chatStore = readSource("src/renderer/state/chat-store.ts");
    const aiIpc = readSource("src/main/ipc/ai-ipc.ts");
    const preload = readSource("src/preload/api.ts");

    expect(chat).toContain("新对话");
    expect(chat).toContain("chat-session-select");
    expect(chat).toContain("createSession");
    expect(chat).toContain("deleteCurrentSession");
    expect(chatStore).toContain("listChatSessions");
    expect(chatStore).toContain("createChatSession");
    expect(chatStore).toContain("deleteChatSession");
    expect(aiIpc).toContain("ipcChannels.ai.listChatSessions");
    expect(aiIpc).toContain("ipcChannels.ai.createChatSession");
    expect(aiIpc).toContain("ipcChannels.ai.deleteChatSession");
    expect(aiIpc).toContain("ipcChannels.ai.renameChatSession");
    expect(preload).toContain("listChatSessions");
    expect(preload).toContain("createChatSession");
    expect(preload).toContain("renameChatSession");
  });

  it("has explicit writing and scratchpad empty/loading states", () => {
    const writing = readSource("src/renderer/routes/WritingPage.tsx");
    const scratchpad = readSource("src/renderer/sidebar/ScratchpadTab.tsx");

    expect(writing).toContain("empty-editor-state");
    expect(writing).toContain('t("chooseOrCreateChapter")');
    expect(scratchpad).toContain("const [loading");
    expect(scratchpad).toContain("正在读取草稿纸");
    expect(scratchpad).toContain("scratch-empty");
  });

  it("keeps save and AI generation states explicit in the UI labels", () => {
    const topBar = readSource("src/renderer/layout/TopBar.tsx");
    const sidebarStore = readSource("src/renderer/state/sidebar-store.ts");
    const currentTask = readSource("src/renderer/sidebar/CurrentTaskTab.tsx");

    for (const label of ["编辑中", "保存中", "已自动保存", "保存失败"]) {
      expect(topBar).toContain(label);
    }
    for (const label of ["已配置", "生成中", "预览完成", "生成失败"]) {
      expect(sidebarStore).toContain(label);
    }
    expect(currentTask).toContain("处理中");
    expect(currentTask).toContain("尚未生成预览");
  });

  it("surfaces AI task errors as prominent actionable alerts", () => {
    const currentTask = readSource("src/renderer/sidebar/CurrentTaskTab.tsx");
    const rightSidebar = readSource("src/renderer/layout/RightUtilitySidebar.tsx");
    const writing = readSource("src/renderer/routes/WritingPage.tsx");
    const css = readSource("src/renderer/styles/globals.css");

    expect(currentTask).toContain("task-error-panel");
    expect(currentTask).toContain('role="alert"');
    expect(currentTask).toContain("打开 AI 服务设置");
    expect(rightSidebar).toContain("onOpenSettings");
    expect(writing).toContain("onOpenSettings={handleSettings}");
    expect(css).toContain(".task-error-panel");
  });

  it("does not classify provider generation failures as missing AI configuration", () => {
    const currentTask = readSource("src/renderer/sidebar/CurrentTaskTab.tsx");

    expect(currentTask).not.toContain("/OpenRouter|API Key|模型/");
    expect(currentTask).toContain("taskErrorTitle");
    expect(currentTask).toContain("OpenRouter API Key 未配置");
    expect(currentTask).toContain("OpenRouter 模型名称未配置");
    expect(currentTask).toContain("OpenRouter 服务未初始化");
    expect(currentTask).toContain("校对结果被截断");
  });

  it("classifies OpenRouter rate limits separately from generic task failures", () => {
    const currentTask = readSource("src/renderer/sidebar/CurrentTaskTab.tsx");

    expect(currentTask).toContain("isAiProviderRateLimitError");
    expect(currentTask).toContain("AI Provider 请求被限流");
    expect(currentTask).toContain("换用其他模型");
  });

  it("shows a dedicated clean state when proofread finds no issue", () => {
    const currentTask = readSource("src/renderer/sidebar/CurrentTaskTab.tsx");
    const css = readSource("src/renderer/styles/globals.css");

    expect(currentTask).toContain("proofreadIssues.length === 0");
    expect(currentTask).toContain("proofread-clean-state");
    expect(currentTask).toContain("未发现明显问题");
    expect(currentTask).toContain("重新校对");
    expect(css).toContain(".proofread-clean-state");
  });

  it("shows proofread as manual diagnostic suggestions instead of an auto-apply preview", () => {
    const currentTask = readSource("src/renderer/sidebar/CurrentTaskTab.tsx");

    expect(currentTask).toContain("校对发现");
    expect(currentTask).toContain("复制这条校对建议");
    expect(currentTask).toContain("formatProofreadIssueDraft");
    expect(currentTask).not.toContain("应用建议");
    expect(currentTask).not.toContain("apply_proofread_suggestion");
  });

  it("streams AI task preview text and disables writeback while streaming", () => {
    const taskStore = readSource("src/renderer/state/task-store.ts");
    const currentTask = readSource("src/renderer/sidebar/CurrentTaskTab.tsx");

    expect(taskStore).toContain("streamingText");
    expect(taskStore).toContain("subscribeAiStream");
    expect(taskStore).toContain("generatePreviewStream");
    expect(taskStore).toContain("continuePreviewStream");
    expect(currentTask).toContain("streamingText");
    expect(currentTask).toContain("AI 正在生成");
    expect(currentTask).toContain("继续生成");
    expect(currentTask).toContain("taskStore.busy");
  });

  it("lets the user stop in-flight selected-text AI task generation", () => {
    const taskStore = readSource("src/renderer/state/task-store.ts");
    const currentTask = readSource("src/renderer/sidebar/CurrentTaskTab.tsx");

    expect(taskStore).toContain("cancelActiveStream");
    expect(taskStore).toContain("isCanceledIpcError(reason)");
    expect(currentTask).toContain("停止生成");
    expect(currentTask).toContain("taskStore.cancelActiveStream");
  });

  it("registers streaming AI task and persistent chat IPC handlers", () => {
    const aiIpc = readSource("src/main/ipc/ai-ipc.ts");

    expect(aiIpc).toContain("aiGeneratePreviewStreamInputSchema");
    expect(aiIpc).toContain("ipcChannels.ai.generatePreviewStream");
    expect(aiIpc).toContain("ipcChannels.ai.continuePreviewStream");
    expect(aiIpc).toContain("ipcChannels.ai.streamChunk");
    expect(aiIpc).toContain("ipcChannels.ai.getChatSession");
    expect(aiIpc).toContain("ipcChannels.ai.listChatMessages");
    expect(aiIpc).toContain("ipcChannels.ai.clearChat");
    expect(aiIpc).toContain("ipcChannels.ai.sendChatMessageStream");
  });

  it("does not expose legacy non-streaming AI chat IPC", () => {
    const aiIpc = readSource("src/main/ipc/ai-ipc.ts");
    const preload = readSource("src/preload/api.ts");
    const sharedTypes = readSource("src/main/shared/types.ts");

    expect(aiIpc).not.toContain("ipcChannels.ai.sendChatMessage,");
    expect(preload).not.toContain("sendChatMessage:");
    expect(sharedTypes).not.toContain('sendChatMessage: "novelTool:ai:sendChatMessage"');
  });

  it("does not expose legacy non-streaming selected-text AI preview IPC", () => {
    const aiIpc = readSource("src/main/ipc/ai-ipc.ts");
    const preload = readSource("src/preload/api.ts");
    const sharedTypes = readSource("src/main/shared/types.ts");
    const aiTaskService = readSource("src/main/ai/ai-task-service.ts");

    expect(aiIpc).not.toContain("ipcChannels.ai.generatePreview,");
    expect(preload).not.toContain("generatePreview:");
    expect(sharedTypes).not.toContain('generatePreview: "novelTool:ai:generatePreview"');
    expect(aiTaskService).not.toContain("async generatePreview(");
  });

  it("keeps stream subscription cleanup separate from explicit cancellation", () => {
    const preload = readSource("src/preload/api.ts");
    const subscribeBody = preload.slice(preload.lastIndexOf("subscribeAiStream:"), preload.lastIndexOf("rejectCandidate:"));

    expect(subscribeBody).toContain("ipcRenderer.off(ipcChannels.ai.streamChunk");
    expect(subscribeBody).not.toContain("cancelStream");
  });

  it("uses a dedicated longer timeout for OpenRouter streaming requests", () => {
    const openRouterClient = readSource("src/main/ai/openrouter-client.ts");

    expect(openRouterClient).toContain("const OPENROUTER_STREAM_TIMEOUT_MS = 300_000;");
    expect(openRouterClient).toContain("timeout: OPENROUTER_STREAM_TIMEOUT_MS");
  });

  it("clears AI chat sessions inside one database transaction", () => {
    const aiChatRepo = readSource("src/main/db/repositories/ai-chat-repo.ts");
    const clearSessionBody = aiChatRepo.slice(aiChatRepo.indexOf("clearSession("), aiChatRepo.indexOf("deleteSession("));

    expect(clearSessionBody).toContain("this.db.transaction");
    expect(clearSessionBody).toContain("transaction();");
  });

  it("contains the CSS hooks for hardened status and responsive states", () => {
    const css = readSource("src/renderer/styles/globals.css");

    expect(css).toContain(".import-status");
    expect(css).toContain(".message.pending");
    expect(css).toContain(".empty-editor-state");
    expect(css).toContain(".scratch-empty");
    expect(css).toContain("@media (max-width: 1280px)");
    expect(css).toContain("@media (max-width: 760px)");
  });

  it("keeps local-only docs out of the versioned test contract while allowing user manuals", () => {
    const gitignore = readSource(".gitignore");

    expect(gitignore).toContain("docs/*");
    expect(gitignore).toContain("!docs/USER_GUIDE_V1.md");
    expect(gitignore).toContain("!docs/USER_MANUAL.md");
    expect(gitignore).not.toContain("!docs/*.md");
  });
});
