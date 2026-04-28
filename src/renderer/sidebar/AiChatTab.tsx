import { PaperPlaneRight, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import type { AiChatMessageRecord, SelectionSnapshot } from "../../main/shared/types";
import { useChatStore } from "../state/chat-store";

type AiChatTabProps = {
  readonly currentChapterId: string | null;
  readonly currentChapterTitle: string | null;
  readonly currentProjectId: string | null;
  readonly selectionSnapshot: SelectionSnapshot | null;
};

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

export function AiChatTab({ currentChapterId, currentChapterTitle, currentProjectId, selectionSnapshot }: AiChatTabProps) {
  const [draft, setDraft] = useState("");
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

  return (
    <section className="chat">
      <div className="chat-title-row">
        <h2 className="task-title">AI 对话</h2>
        <button
          className="icon-lite-button"
          disabled={chatStore.busy || chatStore.loading || chatStore.messages.length === 0}
          onClick={() => void chatStore.clearChat()}
          type="button"
          aria-label="清空对话"
          title="清空对话"
        >
          <Trash size={16} />
        </button>
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
        {chatStore.error ? <div className="message error-message">{chatStore.error}</div> : null}
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
  );
}
