import { ArrowClockwise, Check, CopySimple, PaperPlaneRight, Plus, Stop, Trash } from "@phosphor-icons/react";
import { type CSSProperties, type KeyboardEvent, type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AiChatMessageRecord, ChapterSummary, SelectionSnapshot, SummaryIndexStatus } from "../../main/shared/types";
import { Button } from "../components/Button";
import { IconButton } from "../components/IconButton";
import { Modal } from "../components/Modal";
import type { SettingsCategory } from "../routes/SettingsPage";
import type { ChatStore } from "../state/chat-store";
import { ChatMessageContent } from "./ChatMessageContent";
import { buildChatContextUsageDisplay } from "./chat-context-display";
import type { AiChatDraftSeed } from "./chat-draft";

type AiChatTabProps = {
  readonly chapters: readonly ChapterSummary[];
  readonly chatStore: ChatStore;
  readonly currentChapterTitle: string | null;
  readonly currentProjectId: string | null;
  readonly draftSeed: AiChatDraftSeed | null;
  readonly selectionSnapshot: SelectionSnapshot | null;
  readonly onOpenSettings: (category?: SettingsCategory) => void;
};

type ChatCommandSuggestion = {
  readonly label: string;
  readonly detail: string;
  readonly insertText: string;
};

type ActiveCommand = {
  readonly trigger: "@" | "/";
  readonly query: string;
  readonly start: number;
  readonly end: number;
};

type SummaryIndexBanner = {
  readonly title: string;
  readonly detail: string;
  readonly variant: "ready" | "building" | "warning" | "paused";
  readonly actionLabel: "开始建立索引" | "继续建立索引" | "停止后台索引" | "打开缓存设置" | "打开 AI 服务设置" | "重试" | null;
};

const chatSkillSuggestions: readonly ChatCommandSuggestion[] = [
  { label: "/润色", detail: "调用润色 skill，只返回候选正文", insertText: "/润色" },
  { label: "/扩写", detail: "调用扩写 skill，补足动作、心理和承接", insertText: "/扩写" },
  { label: "/校对", detail: "调用校对 skill，只列出问题和建议", insertText: "/校对" },
  { label: "/续写", detail: "调用续写 skill，延续当前上下文", insertText: "/续写" }
];

const aiSettingsErrorMarkers = [
  "OpenRouter API Key 未配置",
  "OpenRouter 模型名称未配置",
  "OpenRouter 对话服务未初始化",
  "OpenRouter 连接测试未初始化",
  "安全存储未初始化",
  "safeStorage 不可用"
];

function messageClassName(message: AiChatMessageRecord): string {
  if (message.role === "user") {
    return "message user";
  }
  if (message.role === "tool") {
    return "message tool";
  }
  if (message.role === "error") {
    return "message error-message";
  }
  return "message";
}

function isAiSettingsError(error: string): boolean {
  return aiSettingsErrorMarkers.some((marker) => error.includes(marker));
}

function isOpenRouterRateLimitError(error: string): boolean {
  return (
    error.includes("OpenRouter 请求失败 (429)") ||
    error.includes("rate limited") ||
    error.includes("Rate limit") ||
    error.includes("Resource has been exhausted") ||
    error.includes("限流")
  );
}

function isMissingChapterError(error: string): boolean {
  return error.includes("找不到第") && error.includes("章");
}

function isChatInputTooLongError(error: string): boolean {
  return error.includes("AI 对话上下文太长") || error.includes("选区太长") || error.includes("目标文本太长");
}

function chatErrorTitle(error: string): string {
  if (isAiSettingsError(error)) {
    return "AI 服务未配置";
  }
  if (isOpenRouterRateLimitError(error)) {
    return "OpenRouter 请求被限流";
  }
  if (isMissingChapterError(error)) {
    return "找不到章节";
  }
  if (isChatInputTooLongError(error)) {
    return "对话上下文过长";
  }
  return "AI 对话失败";
}

function chatErrorHint(error: string): string | null {
  if (isAiSettingsError(error)) {
    return "请先填写 OpenRouter API Key 和模型名称，并测试保存。";
  }
  if (isOpenRouterRateLimitError(error)) {
    return "当前模型或上游 Provider 正在限流。可以稍后重试，或在 AI 服务设置中换用其他模型。";
  }
  if (isMissingChapterError(error)) {
    return "请检查章节编号是否存在；如果刚导入或重排章节，先确认左侧章节列表。";
  }
  if (isChatInputTooLongError(error)) {
    return "请缩短问题、取消过长选区，或改成分章/分段提问。";
  }
  return null;
}

function buildSummaryIndexBanner(
  status: SummaryIndexStatus | null,
  loading: boolean,
  error: string | null
): SummaryIndexBanner | null {
  if (error) {
    return {
      title: "全书索引状态读取失败",
      detail: error,
      variant: "warning",
      actionLabel: "重试"
    };
  }
  if (!status) {
    return loading
      ? {
          title: "正在读取全书索引状态",
          detail: "墨枢正在检查当前项目是否已有可复用的章节摘要。",
          variant: "building",
          actionLabel: null
        }
      : null;
  }
  if (status.totalChapterCount === 0) {
    return null;
  }

  const indexedCount = status.readyChapterCount + status.skippedTooShortChapterCount;
  const failedPreview = status.recentFailedJobs[0];
  const retryPreview = status.retryingJobs[0];
  const issueParts = [
    status.failedJobCount > 0 ? `失败 ${status.failedJobCount}` : "",
    status.cancelledJobCount > 0 ? `已停止 ${status.cancelledJobCount}` : "",
    status.queuedJobCount > 0 ? `排队 ${status.queuedJobCount}` : ""
  ].filter(Boolean);
  const issueSuffix = issueParts.length > 0 ? `；${issueParts.join("；")}` : "";
  const retrySuffix = retryPreview?.nextRunAt
    ? `；${retryPreview.label} 将在 ${formatSummaryIndexRetryTime(retryPreview.nextRunAt)} 自动重试`
    : "";
  const failedSummary = failedPreview?.failureCategory ?? failedPreview?.error ?? null;
  const failedSuffix = failedSummary ? `；最近失败：${failedPreview?.label}（${failedSummary}${failedPreview?.actionHint ? `：${failedPreview.actionHint}` : ""}）` : "";
  const queuedOrRunning = status.queuedJobCount > 0 || Boolean(status.runningJobLabel);
  if (status.pausedReason === "background_disabled" || !status.backgroundEnabled) {
    return {
      title: "后台索引已关闭",
      detail: `全书索引：${indexedCount} / ${status.totalChapterCount} 章${issueSuffix}${failedSuffix}。新章节和过期章节不会自动缓存。`,
      variant: "paused",
      actionLabel: "继续建立索引"
    };
  }
  if (status.pausedReason === "ai_not_configured") {
    return {
      title: "AI 服务未配置，索引暂停",
      detail: `全书索引：${indexedCount} / ${status.totalChapterCount} 章。配置 OpenRouter 后会继续后台建立。`,
      variant: "paused",
      actionLabel: "打开 AI 服务设置"
    };
  }
  if (status.pausedReason === "foreground_ai_active") {
    return {
      title: "索引已暂停：AI 正在回答",
      detail: `全书索引：${indexedCount} / ${status.totalChapterCount} 章。后台索引会等前台 AI 结束后继续。`,
      variant: "paused",
      actionLabel: null
    };
  }
  if (status.staleChapterCount > 0) {
    return {
      title: `索引过期：${status.staleChapterCount} 章需要更新`,
      detail: `全书索引：${indexedCount} / ${status.totalChapterCount} 章${issueSuffix}${failedSuffix}。最近编辑过的章节需要重新摘要。`,
      variant: "warning",
      actionLabel: "打开缓存设置"
    };
  }
  if (queuedOrRunning) {
    return {
      title: `全书索引：${indexedCount} / ${status.totalChapterCount} 章`,
      detail: status.runningJobLabel
        ? `正在摘要：${status.runningJobLabel.replace(/^正在摘要：/, "")}${issueSuffix}${retrySuffix}${failedSuffix}`
        : `后台摘要任务已排队，会在不影响当前 AI 对话时继续${issueSuffix}${retrySuffix}${failedSuffix}。`,
      variant: "building",
      actionLabel: "停止后台索引"
    };
  }
  if (status.cancelledJobCount > 0 && status.missingChapterCount > 0) {
    const stoppedIssueParts = [
      `已停止 ${status.cancelledJobCount} 个任务`,
      status.failedJobCount > 0 ? `失败 ${status.failedJobCount} 个任务` : ""
    ].filter(Boolean);
    return {
      title: "后台索引已停止",
      detail: `全书索引：${indexedCount} / ${status.totalChapterCount} 章；${stoppedIssueParts.join("；")}${failedSuffix}。`,
      variant: "paused",
      actionLabel: "继续建立索引"
    };
  }
  if (status.missingChapterCount > 0) {
    return {
      title: `全书索引：${indexedCount} / ${status.totalChapterCount} 章`,
      detail: `当前只有 ${indexedCount} / ${status.totalChapterCount} 章可用于全文摘要索引${issueSuffix}${retrySuffix}${failedSuffix}。`,
      variant: "warning",
      actionLabel: "开始建立索引"
    };
  }
  return {
    title: `全书索引：${indexedCount} / ${status.totalChapterCount} 章`,
    detail: "全文总结和跨章节提问会优先使用摘要索引，避免临时读取整本书。",
    variant: "ready",
    actionLabel: "打开缓存设置"
  };
}

function formatSummaryIndexRetryTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getLastUserMessage(messages: readonly AiChatMessageRecord[]): AiChatMessageRecord | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      return message;
    }
  }
  return null;
}

function canRegenerateMessage(messages: readonly AiChatMessageRecord[], message: AiChatMessageRecord, index: number): boolean {
  return message.role === "assistant" && message.content.trim().length > 0 && index === messages.length - 1;
}

function getActiveCommand(value: string, cursorIndex: number): ActiveCommand | null {
  const beforeCursor = value.slice(0, cursorIndex);
  const match = /(^|\s)([@/][^\s@/]*)$/.exec(beforeCursor);
  if (!match) {
    return null;
  }

  const token = match[2];
  const trigger = token[0] as "@" | "/";
  return {
    trigger,
    query: token.slice(1),
    start: beforeCursor.length - token.length,
    end: cursorIndex
  };
}

function filterCommandSuggestions(suggestions: readonly ChatCommandSuggestion[], query: string): readonly ChatCommandSuggestion[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  if (!normalizedQuery) {
    return suggestions.slice(0, 8);
  }

  return suggestions
    .filter((item) => `${item.label} ${item.detail}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery))
    .slice(0, 8);
}

export function AiChatTab({
  chapters,
  chatStore,
  currentChapterTitle,
  currentProjectId,
  draftSeed,
  selectionSnapshot,
  onOpenSettings
}: AiChatTabProps) {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copiedStreaming, setCopiedStreaming] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [cursorIndex, setCursorIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const draft = chatStore.draft;
  const setDraft = chatStore.setDraft;
  const consumeDraftSeed = chatStore.consumeDraftSeed;

  useEffect(() => {
    const animationFrame = requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    });

    return () => cancelAnimationFrame(animationFrame);
  }, [chatStore.busy, chatStore.error, chatStore.loading, chatStore.messages, chatStore.streamingReasoning, chatStore.streamingText]);

  useEffect(() => {
    const nextCursorIndex = consumeDraftSeed(draftSeed);
    if (nextCursorIndex === null) {
      return;
    }

    setCursorIndex(nextCursorIndex);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursorIndex, nextCursorIndex);
    });
  }, [consumeDraftSeed, draftSeed]);
  const chatMentionSuggestions = useMemo(() => {
    const suggestions: ChatCommandSuggestion[] = [];
    if (selectionSnapshot?.text) {
      suggestions.push({
        label: "@选区",
        detail: "使用当前选中的正文",
        insertText: "@选区"
      });
    }
    if (currentChapterTitle) {
      suggestions.push({
        label: "@当前章节",
        detail: currentChapterTitle,
        insertText: "@当前章节"
      });
    }
    suggestions.push({
      label: "@全部章节",
      detail: "读取当前项目所有章节",
      insertText: "@全部章节"
    });
    for (const [index, chapter] of chapters.entries()) {
      suggestions.push({
        label: `@第${index + 1}章`,
        detail: chapter.title,
        insertText: `@第${index + 1}章`
      });
    }
    return suggestions;
  }, [chapters, currentChapterTitle, selectionSnapshot?.text]);

  const activeCommand = getActiveCommand(draft, cursorIndex);
  const commandSuggestions = activeCommand
    ? filterCommandSuggestions(activeCommand.trigger === "@" ? chatMentionSuggestions : chatSkillSuggestions, activeCommand.query)
    : [];
  const showCommandSuggestions = commandSuggestions.length > 0 && !chatStore.busy && !chatStore.loading;

  async function sendMessage(): Promise<void> {
    const message = draft.trim();
    if (!message || chatStore.busy || chatStore.loading || !chatStore.session) {
      return;
    }

    setDraft("");
    await chatStore.sendMessage(message);
  }

  function handleDraftChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    setDraft(event.target.value);
    setCursorIndex(event.currentTarget.selectionStart ?? event.target.value.length);
  }

  function insertCommandSuggestion(suggestion: ChatCommandSuggestion): void {
    if (!activeCommand) {
      return;
    }
    const nextDraft = `${draft.slice(0, activeCommand.start)}${suggestion.insertText} ${draft.slice(activeCommand.end)}`;
    const nextCursor = activeCommand.start + suggestion.insertText.length + 1;
    setDraft(nextDraft);
    setCursorIndex(nextCursor);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (showCommandSuggestions && event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      insertCommandSuggestion(commandSuggestions[0]);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  }

  async function resendLastUserMessageAfterError(): Promise<void> {
    const lastUserMessage = getLastUserMessage(chatStore.messages);
    if (!lastUserMessage || chatStore.busy || chatStore.loading || !chatStore.session) {
      return;
    }

    await chatStore.sendMessage(lastUserMessage.content);
  }

  async function copyChatText(text: string, onCopied: () => void): Promise<void> {
    setCopyError(null);
    const trimmedText = text.trim();
    if (!trimmedText) {
      setCopyError("当前没有可复制的 AI 回复。");
      return;
    }
    if (!navigator.clipboard) {
      setCopyError("系统剪贴板不可用。");
      return;
    }

    try {
      await navigator.clipboard.writeText(trimmedText);
      onCopied();
    } catch (reason) {
      setCopyError(reason instanceof Error ? reason.message : "复制失败");
    }
  }

  async function copyChatMessage(message: AiChatMessageRecord): Promise<void> {
    await copyChatText(message.content, () => {
      setCopiedMessageId(message.id);
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === message.id ? null : current));
      }, 1600);
    });
  }

  async function copyStreamingReply(): Promise<void> {
    await copyChatText(chatStore.streamingText, () => {
      setCopiedStreaming(true);
      window.setTimeout(() => setCopiedStreaming(false), 1600);
    });
  }

  async function deleteCurrentSession(): Promise<void> {
    setDeleteConfirmOpen(false);
    await chatStore.deleteCurrentSession();
  }

  const lastUserMessage = getLastUserMessage(chatStore.messages);
  const errorHint = chatStore.error ? chatErrorHint(chatStore.error) : null;
  const showSettingsAction = Boolean(chatStore.error && (isAiSettingsError(chatStore.error) || isOpenRouterRateLimitError(chatStore.error)));
  const contextDisplay = chatStore.contextUsage ? buildChatContextUsageDisplay(chatStore.contextUsage) : null;
  const summaryBanner = buildSummaryIndexBanner(chatStore.summaryIndexStatus, chatStore.summaryIndexLoading, chatStore.summaryIndexError);
  const showContextStatus = Boolean(contextDisplay || chatStore.contextUsagePending);
  const contextRingStyle = contextDisplay
    ? ({
        "--context-used": `${contextDisplay.percent * 3.6}deg`
      } as CSSProperties)
    : undefined;

  return (
    <>
      <section className="chat">
        <div className="chat-title-row">
          <h2 className="task-title">AI 对话</h2>
          <div className="chat-title-actions">
            <button
              className="small-button blue chat-new-button"
              disabled={chatStore.busy || chatStore.loading || !currentProjectId}
              onClick={() => void chatStore.createSession()}
              type="button"
              title="新建一个空白 AI 对话"
            >
              <Plus size={15} />
              新对话
            </button>
            <button
              className="icon-lite-button"
              disabled={chatStore.busy || chatStore.loading || !chatStore.session}
              onClick={() => setDeleteConfirmOpen(true)}
              type="button"
              aria-label="删除当前对话"
              title="删除当前对话"
            >
              <Trash size={16} />
            </button>
          </div>
        </div>
        <div className="chat-session-bar">
          <select
            aria-label="切换 AI 对话"
            className="chat-session-select"
            disabled={chatStore.busy || chatStore.loading || chatStore.sessions.length === 0}
            onChange={(event) => void chatStore.selectSession(event.target.value)}
            title="切换 AI 对话"
            value={chatStore.session?.id ?? ""}
          >
            {chatStore.sessions.length === 0 ? <option value="">暂无对话</option> : null}
            {chatStore.sessions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </div>
        <div className="chips">
          <span className="chip">当前章节：{currentChapterTitle ?? "未选择章节"}</span>
          <span className="chip">{selectionSnapshot ? "已选中文本" : "未选中文本"}</span>
        </div>
        {summaryBanner ? (
          <div className={`summary-index-banner ${summaryBanner.variant}`} role="status">
            <div className="summary-index-copy">
              <b>{summaryBanner.title}</b>
              <span>{summaryBanner.detail}</span>
            </div>
            {summaryBanner.actionLabel ? (
              <button
                className="small-button"
                disabled={chatStore.summaryIndexLoading || chatStore.busy}
                onClick={() => {
                  if (summaryBanner.actionLabel === "打开 AI 服务设置") {
                    onOpenSettings("AI 服务");
                    return;
                  }
                  if (summaryBanner.actionLabel === "打开缓存设置") {
                    onOpenSettings("章节索引缓存");
                    return;
                  }
                  if (summaryBanner.actionLabel === "重试") {
                    void chatStore.refreshSummaryIndexStatus();
                    return;
                  }
                  if (summaryBanner.actionLabel === "停止后台索引") {
                    void chatStore.cancelSummaryIndexJob();
                    return;
                  }
                  void chatStore.rebuildSummaryIndex();
                }}
                type="button"
              >
                {summaryBanner.actionLabel}
              </button>
            ) : null}
            {chatStore.summaryIndexNotice ? <p className="summary-index-notice">{chatStore.summaryIndexNotice}</p> : null}
          </div>
        ) : null}
        <div className="messages" aria-live="polite">
          {chatStore.loading ? (
            <div className="message pending" role="status">
              <div className="message-content">正在读取 AI 对话...</div>
            </div>
          ) : null}
          {!chatStore.loading && chatStore.messages.length === 0 ? (
            <div className="message">
              <div className="message-content">暂无对话记录。</div>
            </div>
          ) : null}
          {chatStore.messages.map((message, index) => {
            const isRegeneratingMessage = chatStore.regeneratingMessageId === message.id;
            const visibleMessageContent = isRegeneratingMessage
              ? chatStore.streamingText
                ? chatStore.streamingText
                : chatStore.contextUsagePending
                  ? "正在分析上下文..."
                  : "正在重新生成..."
              : message.content;
            const showAssistantActions = message.role === "assistant" && message.content.trim() && !isRegeneratingMessage;
            return (
              <div className={`${messageClassName(message)}${isRegeneratingMessage ? " regenerating" : ""}`} key={message.id}>
                {showAssistantActions ? (
                  <div className="message-action-stack">
                    <IconButton
                      className={`message-copy-button ${copiedMessageId === message.id ? "copied" : ""}`}
                      label="复制 AI 回复"
                      onClick={() => void copyChatMessage(message)}
                    >
                      {copiedMessageId === message.id ? <Check size={16} weight="bold" /> : <CopySimple size={16} />}
                    </IconButton>
                    {canRegenerateMessage(chatStore.messages, message, index) ? (
                      <IconButton
                        className="message-regenerate-button"
                        disabled={chatStore.busy || chatStore.loading || !chatStore.session}
                        label="重新生成 AI 回复"
                        onClick={() => void chatStore.regenerateAssistantMessage(message.id)}
                      >
                        <ArrowClockwise size={16} />
                      </IconButton>
                    ) : null}
                  </div>
                ) : null}
                {isRegeneratingMessage && chatStore.streamingReasoning ? (
                  <details className="chat-reasoning" open>
                    <summary>思考</summary>
                    <div>{chatStore.streamingReasoning}</div>
                  </details>
                ) : null}
                <ChatMessageContent
                  content={visibleMessageContent}
                  rich={message.role === "assistant" && (!isRegeneratingMessage || Boolean(chatStore.streamingText))}
                />
                <div className="message-time">{new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</div>
              </div>
            );
          })}
          {chatStore.busy && !chatStore.regeneratingMessageId ? (
            <div className="message pending" role="status">
              {chatStore.streamingText.trim() ? (
                <IconButton
                  className={`message-copy-button ${copiedStreaming ? "copied" : ""}`}
                  label="复制正在生成的 AI 回复"
                  onClick={() => void copyStreamingReply()}
                >
                  {copiedStreaming ? <Check size={16} weight="bold" /> : <CopySimple size={16} />}
                </IconButton>
              ) : null}
              {chatStore.streamingReasoning ? (
                <details className="chat-reasoning" open>
                  <summary>思考</summary>
                  <div>{chatStore.streamingReasoning}</div>
                </details>
              ) : null}
              <ChatMessageContent
                content={chatStore.streamingText ? chatStore.streamingText : chatStore.contextUsagePending ? "正在分析上下文..." : "AI 正在思考中"}
                rich={Boolean(chatStore.streamingText)}
              />
            </div>
          ) : null}
          {copyError ? (
            <div className="chat-copy-error" role="alert">
              {copyError}
            </div>
          ) : null}
          {chatStore.error ? (
            <div className="chat-error-panel" role="alert">
              <b>{chatErrorTitle(chatStore.error)}</b>
              <p>{chatStore.error}</p>
              {errorHint ? <p className="chat-error-hint">{errorHint}</p> : null}
              <div className="chat-error-actions">
                <button
                  className="small-button blue"
                  disabled={!lastUserMessage || chatStore.busy || chatStore.loading || !chatStore.session}
                  onClick={() => void resendLastUserMessageAfterError()}
                  type="button"
                >
                  重试上一条
                </button>
                {showSettingsAction ? (
                  <button className="small-button" onClick={() => onOpenSettings("AI 服务")} type="button">
                    打开 AI 服务设置
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="chat-scroll-anchor" ref={messagesEndRef} aria-hidden="true" />
        </div>
        <div className="chat-input">
          {showCommandSuggestions ? (
            <div className="chat-command-menu" role="listbox" aria-label={activeCommand?.trigger === "@" ? "选择上下文范围" : "选择写作操作"}>
              <div className="chat-command-menu-title">{activeCommand?.trigger === "@" ? "选择上下文" : "调用 skill"}</div>
              {commandSuggestions.map((suggestion) => (
                <button className="chat-command-item" key={suggestion.label} onMouseDown={(event) => event.preventDefault()} onClick={() => insertCommandSuggestion(suggestion)} type="button">
                  <span>{suggestion.label}</span>
                  <small>{suggestion.detail}</small>
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            aria-label="AI 对话输入，Enter 发送，Shift Enter 换行"
            onChange={handleDraftChange}
            onClick={(event) => setCursorIndex(event.currentTarget.selectionStart ?? draft.length)}
            onKeyDown={handleDraftKeyDown}
            onKeyUp={(event) => setCursorIndex(event.currentTarget.selectionStart ?? draft.length)}
            placeholder="告诉 AI 你的想法..."
            ref={inputRef}
            value={draft}
          />
          <div className="chat-bottom chat-bottom-send">
            <div className="chat-bottom-meta">
              {showContextStatus ? (
                <div
                  className={`chat-context-status${chatStore.contextUsagePending ? " preparing" : ""}`}
                  aria-label={
                    contextDisplay
                      ? `背景信息窗口：${chatStore.contextUsagePending ? "正在准备新上下文，" : ""}${contextDisplay.percentText} 已用，${contextDisplay.usedOfTotalLabel}`
                      : "正在分析上下文"
                  }
                  tabIndex={0}
                >
                  <div className="chat-context-status-main">
                    <span className="chat-context-ring" style={contextRingStyle} aria-hidden="true" />
                    <strong>{contextDisplay?.percentText ?? "分析中"}</strong>
                    {contextDisplay ? <span>{contextDisplay.usedLabel}</span> : null}
                    <span className="chat-context-model-label">{contextDisplay?.modelLabel ?? "准备上下文"}</span>
                    {contextDisplay ? <span className="chat-context-source-label">{contextDisplay.sourceLabel}</span> : null}
                    {contextDisplay?.memoryLabel ? <span className="chat-context-source-label">{contextDisplay.memoryLabel}</span> : null}
                    {chatStore.contextUsagePending ? <span className="context-updating">更新中</span> : null}
                  </div>
                  {contextDisplay ? (
                    <div className="chat-context-popover" role="tooltip">
                      <div className="chat-context-popover-title">背景信息窗口：</div>
                      <div className="chat-context-popover-percent">{contextDisplay.percentText} 已用</div>
                      <div className="chat-context-popover-total">{contextDisplay.usedOfTotalLabel}</div>
                      <div className="chat-context-popover-strong">{contextDisplay.compressionLabel}</div>
                      {contextDisplay.memoryLabel ? <div className="chat-context-popover-strong">{contextDisplay.memoryLabel}</div> : null}
                      {chatStore.contextUsagePending ? (
                        <div className="chat-context-popover-pending">正在准备新上下文，新用量会在最终请求开始时刷新。</div>
                      ) : null}
                      <div className="chat-context-popover-meta">
                        <span>模型 {contextDisplay.modelLabel}</span>
                        <span>范围 {contextDisplay.scopeLabel}</span>
                        <span>上下文 {contextDisplay.sourceLabel}</span>
                        {contextDisplay.memoryLabel ? <span>对话记忆 {contextDisplay.memoryLabel}</span> : null}
                        {contextDisplay.coverageLabel ? <span>{contextDisplay.coverageLabel}</span> : null}
                        <span>模型窗口 {contextDisplay.windowLabel}</span>
                        <span>输入预算 {contextDisplay.inputBudgetLabel}</span>
                        <span>输出 {contextDisplay.outputBudgetLabel}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            {chatStore.busy ? (
              <button
                className="send stop"
                disabled={chatStore.loading}
                onClick={() => chatStore.cancelActiveStream()}
                type="button"
                aria-label="停止 AI 回答"
                title="停止 AI 回答"
              >
                <Stop size={20} weight="fill" />
              </button>
            ) : (
              <button
                className="send"
                disabled={!draft.trim() || chatStore.loading || !chatStore.session || !currentProjectId}
                onClick={() => void sendMessage()}
                type="button"
                aria-label="发送"
              >
                <PaperPlaneRight size={20} weight="regular" />
              </button>
            )}
          </div>
        </div>
      </section>
      <Modal open={deleteConfirmOpen} title="删除当前对话" onClose={() => setDeleteConfirmOpen(false)}>
        <div className="confirm-dialog-body">
          <p>删除后，这个 AI 对话和其中的消息记录会从当前项目中移除。</p>
          <div className="modal-actions">
            <Button onClick={() => setDeleteConfirmOpen(false)} type="button" variant="ghost">
              取消
            </Button>
            <Button
              className="danger-button"
              disabled={chatStore.busy || chatStore.loading}
              onClick={() => void deleteCurrentSession()}
              type="button"
              variant="primary"
            >
              删除
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
