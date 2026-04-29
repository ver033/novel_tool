import { PaperPlaneRight, Plus, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import type { AiChatMessageRecord, SelectionSnapshot } from "../../main/shared/types";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import type { SettingsCategory } from "../routes/SettingsPage";
import { useChatStore } from "../state/chat-store";

type AiChatTabProps = {
  readonly currentChapterId: string | null;
  readonly currentChapterTitle: string | null;
  readonly currentProjectId: string | null;
  readonly selectionSnapshot: SelectionSnapshot | null;
  readonly onOpenSettings: (category?: SettingsCategory) => void;
};

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
  return error.includes("AI 对话上下文太长") || error.includes("选区太长");
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

function getLastUserMessage(messages: readonly AiChatMessageRecord[]): AiChatMessageRecord | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      return message;
    }
  }
  return null;
}

export function AiChatTab({ currentChapterId, currentChapterTitle, currentProjectId, selectionSnapshot, onOpenSettings }: AiChatTabProps) {
  const [draft, setDraft] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const chatStore = useChatStore({
    projectId: currentProjectId,
    currentChapterId,
    currentChapterTitle,
    selectionSnapshot
  });

  async function sendMessage(): Promise<void> {
    const message = draft.trim();
    if (!message || chatStore.busy || chatStore.loading || !chatStore.session) {
      return;
    }

    setDraft("");
    await chatStore.sendMessage(message);
  }

  async function retryLastMessage(): Promise<void> {
    const lastUserMessage = getLastUserMessage(chatStore.messages);
    if (!lastUserMessage || chatStore.busy || chatStore.loading || !chatStore.session) {
      return;
    }

    await chatStore.sendMessage(lastUserMessage.content);
  }

  async function deleteCurrentSession(): Promise<void> {
    setDeleteConfirmOpen(false);
    await chatStore.deleteCurrentSession();
  }

  const lastUserMessage = getLastUserMessage(chatStore.messages);
  const errorHint = chatStore.error ? chatErrorHint(chatStore.error) : null;
  const showSettingsAction = Boolean(chatStore.error && (isAiSettingsError(chatStore.error) || isOpenRouterRateLimitError(chatStore.error)));

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
        <div className="messages" aria-live="polite">
          {chatStore.loading ? (
            <div className="message pending" role="status">
              正在读取 AI 对话...
            </div>
          ) : null}
          {!chatStore.loading && chatStore.messages.length === 0 ? (
            <div className="message">暂无对话记录。</div>
          ) : null}
          {chatStore.messages.map((message) => (
            <div className={messageClassName(message)} key={message.id}>
              {message.content}
              <div className="message-time">{new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
          ))}
          {chatStore.busy ? (
            <div className="message pending" role="status">
              {chatStore.streamingText ? chatStore.streamingText : "AI 正在回复..."}
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
                  onClick={() => void retryLastMessage()}
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
        </div>
        <div className="chat-input">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="告诉 AI 你的想法..." />
          <div className="chat-bottom chat-bottom-send">
            <button
              className="send"
              disabled={!draft.trim() || chatStore.busy || chatStore.loading || !chatStore.session || !currentProjectId}
              onClick={() => void sendMessage()}
              type="button"
              aria-label="发送"
            >
              <PaperPlaneRight size={20} weight="regular" />
            </button>
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
