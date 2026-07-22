import { ArrowClockwise, Check, CopySimple, PaperPlaneRight, Plus, Stop, Trash } from "@phosphor-icons/react";
import { Fragment, type CSSProperties, type KeyboardEvent, type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AiChatMessageRecord, ChapterSummary, SelectionSnapshot, SummaryIndexStatus } from "../../main/shared/types";
import { Button } from "../components/Button";
import { IconButton } from "../components/IconButton";
import { Modal } from "../components/Modal";
import type { SettingsCategory } from "../routes/SettingsPage";
import type { ChatStore } from "../state/chat-store";
import { ChatMessageContent } from "./ChatMessageContent";
import { AgentActivityTrail } from "./AgentActivityTrail";
import { buildChatContextUsageDisplay } from "./chat-context-display";
import type { AiChatDraftSeed } from "./chat-draft";
import { useI18n } from "../i18n";

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
  readonly action: "start" | "resume" | "stop" | "cache_settings" | "ai_settings" | "retry" | null;
};

function getChatSkillSuggestions(japanese: boolean): readonly ChatCommandSuggestion[] {
  return japanese
    ? [
        { label: "/推敲", detail: "推敲操作を呼び出し、本文候補だけを返します", insertText: "/推敲" },
        { label: "/加筆", detail: "動作・心理・つながりを補います", insertText: "/加筆" },
        { label: "/校正", detail: "問題点と提案だけを列挙します", insertText: "/校正" },
        { label: "/続きを書く", detail: "現在の文脈から続きを生成します", insertText: "/続きを書く" }
      ]
    : [
        { label: "/润色", detail: "调用润色 skill，只返回候选正文", insertText: "/润色" },
        { label: "/扩写", detail: "调用扩写 skill，补足动作、心理和承接", insertText: "/扩写" },
        { label: "/校对", detail: "调用校对 skill，只列出问题和建议", insertText: "/校对" },
        { label: "/续写", detail: "调用续写 skill，延续当前上下文", insertText: "/续写" }
      ];
}

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

function chatErrorTitle(error: string, japanese: boolean): string {
  if (isAiSettingsError(error)) {
    return japanese ? "AI サービスが未設定です" : "AI 服务未配置";
  }
  if (isOpenRouterRateLimitError(error)) {
    return japanese ? "OpenRouter のレート制限に達しました" : "OpenRouter 请求被限流";
  }
  if (isMissingChapterError(error)) {
    return japanese ? "章が見つかりません" : "找不到章节";
  }
  if (isChatInputTooLongError(error)) {
    return japanese ? "会話のコンテキストが長すぎます" : "对话上下文过长";
  }
  return japanese ? "AI チャットに失敗しました" : "AI 对话失败";
}

function chatErrorHint(error: string, japanese: boolean): string | null {
  if (isAiSettingsError(error)) {
    return japanese ? "OpenRouter API キーとモデル名を入力し、接続テスト後に保存してください。" : "请先填写 OpenRouter API Key 和模型名称，并测试保存。";
  }
  if (isOpenRouterRateLimitError(error)) {
    return japanese ? "現在のモデルまたは上流プロバイダーが制限中です。しばらく待つか、AI サービス設定で別のモデルを選んでください。" : "当前模型或上游 Provider 正在限流。可以稍后重试，或在 AI 服务设置中换用其他模型。";
  }
  if (isMissingChapterError(error)) {
    return japanese ? "章番号を確認してください。インポートまたは並べ替え直後の場合は、左側の章一覧を確認してください。" : "请检查章节编号是否存在；如果刚导入或重排章节，先确认左侧章节列表。";
  }
  if (isChatInputTooLongError(error)) {
    return japanese ? "質問を短くする、長い選択範囲を解除する、または章・段落ごとに分けて質問してください。" : "请缩短问题、取消过长选区，或改成分章/分段提问。";
  }
  return null;
}

function buildSummaryIndexBanner(
  status: SummaryIndexStatus | null,
  loading: boolean,
  error: string | null,
  japanese: boolean
): SummaryIndexBanner | null {
  if (error) {
    return {
      title: japanese ? "全文インデックスの状態を取得できませんでした" : "全书索引状态读取失败",
      detail: error,
      variant: "warning",
      action: "retry"
    };
  }
  if (!status) {
    return loading
      ? {
          title: japanese ? "全文インデックスの状態を取得しています" : "正在读取全书索引状态",
          detail: japanese ? "現在のプロジェクトに再利用可能な章要約があるか確認しています。" : "墨枢正在检查当前项目是否已有可复用的章节摘要。",
          variant: "building",
          action: null
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
      title: japanese ? "バックグラウンド索引は無効です" : "后台索引已关闭",
      detail: japanese ? `全文インデックス：${indexedCount} / ${status.totalChapterCount} 章。新しい章と古い章は自動更新されません。` : `全书索引：${indexedCount} / ${status.totalChapterCount} 章${issueSuffix}${failedSuffix}。新章节和过期章节不会自动缓存。`,
      variant: "paused",
      action: "resume"
    };
  }
  if (status.pausedReason === "ai_not_configured") {
    return {
      title: japanese ? "AI サービスが未設定のため、索引を停止しています" : "AI 服务未配置，索引暂停",
      detail: japanese ? `全文インデックス：${indexedCount} / ${status.totalChapterCount} 章。OpenRouter の設定後にバックグラウンド処理を再開します。` : `全书索引：${indexedCount} / ${status.totalChapterCount} 章。配置 OpenRouter 后会继续后台建立。`,
      variant: "paused",
      action: "ai_settings"
    };
  }
  if (status.pausedReason === "foreground_ai_active") {
    return {
      title: japanese ? "索引を一時停止中：AI が応答しています" : "索引已暂停：AI 正在回答",
      detail: japanese ? `全文インデックス：${indexedCount} / ${status.totalChapterCount} 章。AI の応答終了後に再開します。` : `全书索引：${indexedCount} / ${status.totalChapterCount} 章。后台索引会等前台 AI 结束后继续。`,
      variant: "paused",
      action: null
    };
  }
  if (status.staleChapterCount > 0) {
    return {
      title: japanese ? `索引が古くなっています：${status.staleChapterCount} 章を更新してください` : `索引过期：${status.staleChapterCount} 章需要更新`,
      detail: japanese ? `全文インデックス：${indexedCount} / ${status.totalChapterCount} 章。最近編集した章の要約を更新する必要があります。` : `全书索引：${indexedCount} / ${status.totalChapterCount} 章${issueSuffix}${failedSuffix}。最近编辑过的章节需要重新摘要。`,
      variant: "warning",
      action: "cache_settings"
    };
  }
  if (queuedOrRunning) {
    return {
      title: japanese ? `全文インデックス：${indexedCount} / ${status.totalChapterCount} 章` : `全书索引：${indexedCount} / ${status.totalChapterCount} 章`,
      detail: japanese
        ? status.runningJobLabel
          ? `要約中：${status.runningJobLabel.replace(/^正在摘要：/, "")}`
          : "バックグラウンド要約は待機中です。現在の AI チャットを妨げないタイミングで続行します。"
        : status.runningJobLabel
          ? `正在摘要：${status.runningJobLabel.replace(/^正在摘要：/, "")}${issueSuffix}${retrySuffix}${failedSuffix}`
          : `后台摘要任务已排队，会在不影响当前 AI 对话时继续${issueSuffix}${retrySuffix}${failedSuffix}。`,
      variant: "building",
      action: "stop"
    };
  }
  if (status.cancelledJobCount > 0 && status.missingChapterCount > 0) {
    const stoppedIssueParts = [
      `已停止 ${status.cancelledJobCount} 个任务`,
      status.failedJobCount > 0 ? `失败 ${status.failedJobCount} 个任务` : ""
    ].filter(Boolean);
    return {
      title: japanese ? "バックグラウンド索引を停止しました" : "后台索引已停止",
      detail: japanese ? `全文インデックス：${indexedCount} / ${status.totalChapterCount} 章。` : `全书索引：${indexedCount} / ${status.totalChapterCount} 章；${stoppedIssueParts.join("；")}${failedSuffix}。`,
      variant: "paused",
      action: "resume"
    };
  }
  if (status.missingChapterCount > 0) {
    return {
      title: japanese ? `全文インデックス：${indexedCount} / ${status.totalChapterCount} 章` : `全书索引：${indexedCount} / ${status.totalChapterCount} 章`,
      detail: japanese ? `現在、全文要約インデックスに利用できるのは ${indexedCount} / ${status.totalChapterCount} 章です。` : `当前只有 ${indexedCount} / ${status.totalChapterCount} 章可用于全文摘要索引${issueSuffix}${retrySuffix}${failedSuffix}。`,
      variant: "warning",
      action: "start"
    };
  }
  return {
    title: japanese ? `全文インデックス：${indexedCount} / ${status.totalChapterCount} 章` : `全书索引：${indexedCount} / ${status.totalChapterCount} 章`,
    detail: japanese ? "全文要約や章をまたぐ質問では要約インデックスを優先し、作品全体の再読み込みを抑えます。" : "全文总结和跨章节提问会优先使用摘要索引，避免临时读取整本书。",
    variant: "ready",
    action: "cache_settings"
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
  const { locale, t } = useI18n();
  const japanese = locale === "ja-JP";
  const copy = japanese
    ? {
        newChat: "新しいチャット", newChatTitle: "空の AI チャットを作成", deleteChat: "現在のチャットを削除",
        switchChat: "AI チャットを切り替え", noChat: "チャットはありません", currentChapter: "現在の章",
        noSelectedChapter: "章が選択されていません", selectedText: "テキストを選択中", noSelectedText: "テキスト未選択",
        loadingChat: "AI チャットを読み込んでいます...", noMessages: "チャット履歴はありません。", analyzing: "コンテキストを分析しています...",
        regenerating: "再生成しています...", copyReply: "AI の回答をコピー", regenerateReply: "AI の回答を再生成", thinking: "思考",
        copyStreaming: "生成中の AI 回答をコピー", aiThinking: "執筆アシスタントが作業しています", retryLast: "直前のメッセージを再試行",
        openAiSettings: "AI サービス設定を開く", selectContextScope: "コンテキスト範囲を選択", selectWritingOperation: "執筆操作を選択",
        selectContext: "コンテキストを選択", invokeSkill: "操作を呼び出す", inputAria: "AI チャット入力。Enter で送信、Shift+Enter で改行",
        inputPlaceholder: "AI に相談したいことを入力...", contextWindow: "背景情報ウィンドウ", preparingContext: "新しいコンテキストを準備中、",
        used: "使用済み", analyzingShort: "分析中", prepareContext: "コンテキストを準備", updating: "更新中",
        contextPending: "新しいコンテキストを準備しています。新しい使用量は最終リクエストの開始時に更新されます。",
        model: "モデル", scope: "範囲", context: "コンテキスト", memory: "会話メモリ", modelWindow: "モデルウィンドウ",
        inputBudget: "入力予算", output: "出力", stopAi: "AI の回答を停止", deleteDescription: "削除すると、この AI チャットとメッセージ履歴が現在のプロジェクトから取り除かれます。",
        noCopyReply: "コピーできる AI の回答がありません。", clipboardUnavailable: "システムのクリップボードを利用できません。", copyFailed: "コピーに失敗しました",
        selectedMention: "@選択範囲", selectedMentionDetail: "現在選択している本文を使用", currentMention: "@現在の章", allMention: "@すべての章",
        allMentionDetail: "現在のプロジェクトの全章を読み込む", agentModel: "Pi Agent", modelReady: "準備完了", modelRunning: "実行中", modelNotConfigured: "モデル未設定", savedToScratchpad: "下書きメモへ追加しました", toolCompleted: "関連する操作を完了しました"
      }
    : {
        newChat: "新对话", newChatTitle: "新建一个空白 AI 对话", deleteChat: "删除当前对话",
        switchChat: "切换 AI 对话", noChat: "暂无对话", currentChapter: "当前章节",
        noSelectedChapter: "未选择章节", selectedText: "已选中文本", noSelectedText: "未选中文本",
        loadingChat: "正在读取 AI 对话...", noMessages: "暂无对话记录。", analyzing: "正在分析上下文...",
        regenerating: "正在重新生成...", copyReply: "复制 AI 回复", regenerateReply: "重新生成 AI 回复", thinking: "思考",
        copyStreaming: "复制正在生成的 AI 回复", aiThinking: "写作助手正在处理", retryLast: "重试上一条",
        openAiSettings: "打开 AI 服务设置", selectContextScope: "选择上下文范围", selectWritingOperation: "选择写作操作",
        selectContext: "选择上下文", invokeSkill: "调用 skill", inputAria: "AI 对话输入，Enter 发送，Shift Enter 换行",
        inputPlaceholder: "告诉 AI 你的想法...", contextWindow: "背景信息窗口", preparingContext: "正在准备新上下文，",
        used: "已用", analyzingShort: "分析中", prepareContext: "准备上下文", updating: "更新中",
        contextPending: "正在准备新上下文，新用量会在最终请求开始时刷新。",
        model: "模型", scope: "范围", context: "上下文", memory: "对话记忆", modelWindow: "模型窗口",
        inputBudget: "输入预算", output: "输出", stopAi: "停止 AI 回答", deleteDescription: "删除后，这个 AI 对话和其中的消息记录会从当前项目中移除。",
        noCopyReply: "当前没有可复制的 AI 回复。", clipboardUnavailable: "系统剪贴板不可用。", copyFailed: "复制失败",
        selectedMention: "@选区", selectedMentionDetail: "使用当前选中的正文", currentMention: "@当前章节", allMention: "@全部章节",
        allMentionDetail: "读取当前项目所有章节", agentModel: "Pi Agent", modelReady: "已就绪", modelRunning: "执行中", modelNotConfigured: "模型未配置", savedToScratchpad: "已加入草稿纸", toolCompleted: "相关操作已完成"
      };
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
        label: copy.selectedMention,
        detail: copy.selectedMentionDetail,
        insertText: copy.selectedMention
      });
    }
    if (currentChapterTitle) {
      suggestions.push({
        label: copy.currentMention,
        detail: currentChapterTitle,
        insertText: copy.currentMention
      });
    }
    suggestions.push({
      label: copy.allMention,
      detail: copy.allMentionDetail,
      insertText: copy.allMention
    });
    for (const [index, chapter] of chapters.entries()) {
      suggestions.push({
        label: `@第${index + 1}章`,
        detail: chapter.title,
        insertText: `@第${index + 1}章`
      });
    }
    return suggestions;
  }, [chapters, copy.allMention, copy.allMentionDetail, copy.currentMention, copy.selectedMention, copy.selectedMentionDetail, currentChapterTitle, selectionSnapshot?.text]);

  const activeCommand = getActiveCommand(draft, cursorIndex);
  const commandSuggestions = activeCommand
    ? filterCommandSuggestions(activeCommand.trigger === "@" ? chatMentionSuggestions : getChatSkillSuggestions(japanese), activeCommand.query)
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
      setCopyError(copy.noCopyReply);
      return;
    }
    if (!navigator.clipboard) {
      setCopyError(copy.clipboardUnavailable);
      return;
    }

    try {
      await navigator.clipboard.writeText(trimmedText);
      onCopied();
    } catch (reason) {
      setCopyError(reason instanceof Error ? reason.message : copy.copyFailed);
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
  const errorHint = chatStore.error ? chatErrorHint(chatStore.error, japanese) : null;
  const showSettingsAction = Boolean(chatStore.error && (isAiSettingsError(chatStore.error) || isOpenRouterRateLimitError(chatStore.error)));
  const contextDisplay = chatStore.contextUsage ? buildChatContextUsageDisplay(chatStore.contextUsage, locale) : null;
  const summaryBanner = buildSummaryIndexBanner(chatStore.summaryIndexStatus, chatStore.summaryIndexLoading, chatStore.summaryIndexError, japanese);
  const summaryActionLabels = japanese
    ? { start: "索引を作成", resume: "索引を再開", stop: "バックグラウンド索引を停止", cache_settings: "キャッシュ設定を開く", ai_settings: "AI サービス設定を開く", retry: "再試行" }
    : { start: "开始建立索引", resume: "继续建立索引", stop: "停止后台索引", cache_settings: "打开缓存设置", ai_settings: "打开 AI 服务设置", retry: "重试" };
  const showContextStatus = Boolean(contextDisplay || chatStore.contextUsagePending);
  const rawModelName = chatStore.contextUsage?.modelName.trim();
  const activeModelName = !rawModelName || rawModelName === "模型未配置" ? copy.modelNotConfigured : rawModelName;
  const contextRingStyle = contextDisplay
    ? ({
        "--context-used": `${contextDisplay.percent * 3.6}deg`
      } as CSSProperties)
    : undefined;

  return (
    <>
      <section className="chat">
        <div className="chat-title-row">
          <h2 className="sr-only">{t("aiChat")}</h2>
          <div className="chat-title-actions">
            <button
              className="small-button blue chat-new-button"
              disabled={chatStore.busy || chatStore.loading || !currentProjectId}
              onClick={() => void chatStore.createSession()}
              type="button"
              title={copy.newChatTitle}
            >
              <Plus size={15} />
              {copy.newChat}
            </button>
            <button
              className="icon-lite-button"
              disabled={chatStore.busy || chatStore.loading || !chatStore.session}
              onClick={() => setDeleteConfirmOpen(true)}
              type="button"
              aria-label={copy.deleteChat}
              title={copy.deleteChat}
            >
              <Trash size={16} />
            </button>
          </div>
        </div>
        <div className="chat-session-bar">
          <select
            aria-label={copy.switchChat}
            className="chat-session-select"
            disabled={chatStore.busy || chatStore.loading || chatStore.sessions.length === 0}
            onChange={(event) => void chatStore.selectSession(event.target.value)}
            title={copy.switchChat}
            value={chatStore.session?.id ?? ""}
          >
            {chatStore.sessions.length === 0 ? <option value="">{copy.noChat}</option> : null}
            {chatStore.sessions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </div>
        <div className="chips">
          <span className="chip">{copy.currentChapter}：{currentChapterTitle ?? copy.noSelectedChapter}</span>
          <span className="chip">{selectionSnapshot ? copy.selectedText : copy.noSelectedText}</span>
        </div>
        {summaryBanner ? (
          <div className={`summary-index-banner ${summaryBanner.variant}`} role="status">
            <div className="summary-index-copy">
              <b>{summaryBanner.title}</b>
              <span>{summaryBanner.detail}</span>
            </div>
            {summaryBanner.action ? (
              <button
                className="small-button"
                disabled={chatStore.summaryIndexLoading || chatStore.busy}
                onClick={() => {
                  if (summaryBanner.action === "ai_settings") {
                    onOpenSettings("ai");
                    return;
                  }
                  if (summaryBanner.action === "cache_settings") {
                    onOpenSettings("chapter-cache");
                    return;
                  }
                  if (summaryBanner.action === "retry") {
                    void chatStore.refreshSummaryIndexStatus();
                    return;
                  }
                  if (summaryBanner.action === "stop") {
                    void chatStore.cancelSummaryIndexJob();
                    return;
                  }
                  void chatStore.rebuildSummaryIndex();
                }}
                type="button"
              >
                {summaryActionLabels[summaryBanner.action]}
              </button>
            ) : null}
            {chatStore.summaryIndexNotice ? <p className="summary-index-notice">{chatStore.summaryIndexNotice}</p> : null}
          </div>
        ) : null}
        <div className="messages" aria-live="polite">
          {chatStore.loading ? (
            <div className="message pending" role="status">
              <div className="message-content">{copy.loadingChat}</div>
            </div>
          ) : null}
          {!chatStore.loading && chatStore.messages.length === 0 ? (
            <div className="message">
              <div className="message-content">{copy.noMessages}</div>
            </div>
          ) : null}
          {chatStore.messages.map((message, index) => {
            const isRegeneratingMessage = chatStore.regeneratingMessageId === message.id;
            const visibleMessageContent = isRegeneratingMessage
              ? chatStore.streamingText
                ? chatStore.streamingText
                : chatStore.contextUsagePending
                  ? copy.analyzing
                  : copy.regenerating
              : message.content;
            const showAssistantActions = message.role === "assistant" && message.content.trim() && !isRegeneratingMessage;
            if (message.role === "tool") {
              return (
                <div className="agent-tool-event" key={message.id}>
                  <Check size={16} weight="bold" />
                  <span>{message.action?.type === "add_to_scratchpad" ? copy.savedToScratchpad : copy.toolCompleted}</span>
                  <time>{new Date(message.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</time>
                </div>
              );
            }
            return (
              <Fragment key={message.id}>
                {message.role === "assistant" ? (
                  <AgentActivityTrail activities={isRegeneratingMessage ? chatStore.agentActivities : message.activities ?? []} />
                ) : null}
              <div className={`${messageClassName(message)}${isRegeneratingMessage ? " regenerating" : ""}`}>
                {showAssistantActions ? (
                  <div className="message-action-stack">
                    <IconButton
                      className={`message-copy-button ${copiedMessageId === message.id ? "copied" : ""}`}
                      label={copy.copyReply}
                      onClick={() => void copyChatMessage(message)}
                    >
                      {copiedMessageId === message.id ? <Check size={16} weight="bold" /> : <CopySimple size={16} />}
                    </IconButton>
                    {canRegenerateMessage(chatStore.messages, message, index) ? (
                      <IconButton
                        className="message-regenerate-button"
                        disabled={chatStore.busy || chatStore.loading || !chatStore.session}
                        label={copy.regenerateReply}
                        onClick={() => void chatStore.regenerateAssistantMessage(message.id)}
                      >
                        <ArrowClockwise size={16} />
                      </IconButton>
                    ) : null}
                  </div>
                ) : null}
                <ChatMessageContent
                  content={visibleMessageContent}
                  rich={message.role === "assistant" && (!isRegeneratingMessage || Boolean(chatStore.streamingText))}
                />
                <div className="message-time">{new Date(message.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</div>
              </div>
              </Fragment>
            );
          })}
          {chatStore.busy && !chatStore.regeneratingMessageId ? (
            <>
            <AgentActivityTrail activities={chatStore.agentActivities} />
            <div className="message pending" role="status">
              {chatStore.streamingText.trim() ? (
                <IconButton
                  className={`message-copy-button ${copiedStreaming ? "copied" : ""}`}
                  label={copy.copyStreaming}
                  onClick={() => void copyStreamingReply()}
                >
                  {copiedStreaming ? <Check size={16} weight="bold" /> : <CopySimple size={16} />}
                </IconButton>
              ) : null}
              <ChatMessageContent
                content={chatStore.streamingText ? chatStore.streamingText : chatStore.contextUsagePending ? copy.analyzing : copy.aiThinking}
                rich={Boolean(chatStore.streamingText)}
              />
            </div>
            </>
          ) : null}
          {!chatStore.busy && chatStore.agentActivities.length > 0 ? <AgentActivityTrail activities={chatStore.agentActivities} /> : null}
          {copyError ? (
            <div className="chat-copy-error" role="alert">
              {copyError}
            </div>
          ) : null}
          {chatStore.error ? (
            <div className="chat-error-panel" role="alert">
              <b>{chatErrorTitle(chatStore.error, japanese)}</b>
              <p>{chatStore.error}</p>
              {errorHint ? <p className="chat-error-hint">{errorHint}</p> : null}
              <div className="chat-error-actions">
                <button
                  className="small-button blue"
                  disabled={!lastUserMessage || chatStore.busy || chatStore.loading || !chatStore.session}
                  onClick={() => void resendLastUserMessageAfterError()}
                  type="button"
                >
                  {copy.retryLast}
                </button>
                {showSettingsAction ? (
                  <button className="small-button" onClick={() => onOpenSettings("ai")} type="button">
                    {copy.openAiSettings}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="chat-scroll-anchor" ref={messagesEndRef} aria-hidden="true" />
        </div>
        <div className="chat-input">
          {showCommandSuggestions ? (
            <div className="chat-command-menu" role="listbox" aria-label={activeCommand?.trigger === "@" ? copy.selectContextScope : copy.selectWritingOperation}>
              <div className="chat-command-menu-title">{activeCommand?.trigger === "@" ? copy.selectContext : copy.invokeSkill}</div>
              {commandSuggestions.map((suggestion) => (
                <button className="chat-command-item" key={suggestion.label} onMouseDown={(event) => event.preventDefault()} onClick={() => insertCommandSuggestion(suggestion)} type="button">
                  <span>{suggestion.label}</span>
                  <small>{suggestion.detail}</small>
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            aria-label={copy.inputAria}
            onChange={handleDraftChange}
            onClick={(event) => setCursorIndex(event.currentTarget.selectionStart ?? draft.length)}
            onKeyDown={handleDraftKeyDown}
            onKeyUp={(event) => setCursorIndex(event.currentTarget.selectionStart ?? draft.length)}
            placeholder={copy.inputPlaceholder}
            ref={inputRef}
            value={draft}
          />
          <div className="chat-bottom chat-bottom-send">
            <button
              className="chat-runtime-bar"
              onClick={() => onOpenSettings("ai")}
              title={`${copy.model}：${activeModelName}`}
              type="button"
            >
              <span className={`chat-runtime-dot${chatStore.busy ? " running" : ""}`} aria-hidden="true" />
              <span className="chat-runtime-agent">{copy.agentModel}</span>
              <strong>{activeModelName}</strong>
              <span className="chat-runtime-state">{chatStore.busy ? copy.modelRunning : copy.modelReady}</span>
            </button>
            <div className="chat-bottom-meta">
              {showContextStatus ? (
                <div
                  className={`chat-context-status${chatStore.contextUsagePending ? " preparing" : ""}`}
                  aria-label={
                    contextDisplay
                      ? `${copy.contextWindow}：${chatStore.contextUsagePending ? copy.preparingContext : ""}${contextDisplay.percentText} ${copy.used}，${contextDisplay.usedOfTotalLabel}`
                      : copy.analyzing
                  }
                  tabIndex={0}
                >
                  <div className="chat-context-status-main">
                    <span className="chat-context-ring" style={contextRingStyle} aria-hidden="true" />
                    <strong>{contextDisplay?.percentText ?? copy.analyzingShort}</strong>
                    {contextDisplay ? <span>{contextDisplay.usedLabel}</span> : null}
                    <span className="chat-context-model-label">{contextDisplay?.modelLabel ?? copy.prepareContext}</span>
                    {contextDisplay ? <span className="chat-context-source-label">{contextDisplay.sourceLabel}</span> : null}
                    {contextDisplay?.memoryLabel ? <span className="chat-context-source-label">{contextDisplay.memoryLabel}</span> : null}
                    {chatStore.contextUsagePending ? <span className="context-updating">{copy.updating}</span> : null}
                  </div>
                  {contextDisplay ? (
                    <div className="chat-context-popover" role="tooltip">
                      <div className="chat-context-popover-title">{copy.contextWindow}：</div>
                      <div className="chat-context-popover-percent">{contextDisplay.percentText} {copy.used}</div>
                      <div className="chat-context-popover-total">{contextDisplay.usedOfTotalLabel}</div>
                      <div className="chat-context-popover-strong">{contextDisplay.compressionLabel}</div>
                      {contextDisplay.memoryLabel ? <div className="chat-context-popover-strong">{contextDisplay.memoryLabel}</div> : null}
                      {chatStore.contextUsagePending ? (
                        <div className="chat-context-popover-pending">{copy.contextPending}</div>
                      ) : null}
                      <div className="chat-context-popover-meta">
                        <span>{copy.model} {contextDisplay.modelLabel}</span>
                        <span>{copy.scope} {contextDisplay.scopeLabel}</span>
                        <span>{copy.context} {contextDisplay.sourceLabel}</span>
                        {contextDisplay.memoryLabel ? <span>{copy.memory} {contextDisplay.memoryLabel}</span> : null}
                        {contextDisplay.coverageLabel ? <span>{contextDisplay.coverageLabel}</span> : null}
                        <span>{copy.modelWindow} {contextDisplay.windowLabel}</span>
                        <span>{copy.inputBudget} {contextDisplay.inputBudgetLabel}</span>
                        <span>{copy.output} {contextDisplay.outputBudgetLabel}</span>
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
                aria-label={copy.stopAi}
                title={copy.stopAi}
              >
                <Stop size={20} weight="fill" />
              </button>
            ) : (
              <button
                className="send"
                disabled={!draft.trim() || chatStore.loading || !chatStore.session || !currentProjectId}
                onClick={() => void sendMessage()}
                type="button"
                aria-label={t("send")}
              >
                <PaperPlaneRight size={20} weight="regular" />
              </button>
            )}
          </div>
        </div>
      </section>
      <Modal open={deleteConfirmOpen} title={copy.deleteChat} onClose={() => setDeleteConfirmOpen(false)}>
        <div className="confirm-dialog-body">
          <p>{copy.deleteDescription}</p>
          <div className="modal-actions">
            <Button onClick={() => setDeleteConfirmOpen(false)} type="button" variant="ghost">
              {t("cancel")}
            </Button>
            <Button
              className="danger-button"
              disabled={chatStore.busy || chatStore.loading}
              onClick={() => void deleteCurrentSession()}
              type="button"
              variant="primary"
            >
              {t("delete")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
