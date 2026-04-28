import { PaperPlaneRight } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { ChapterContent, SelectionSnapshot } from "../../main/shared/types";
import { getNovelToolApi } from "../state/app-store";

type AiChatTabProps = {
  readonly currentChapterId: string | null;
  readonly currentChapterTitle: string | null;
  readonly selectionSnapshot: SelectionSnapshot | null;
};

type ChatMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly createdAt: string;
};

function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: `${role}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    role,
    content,
    createdAt: new Date().toISOString()
  };
}

function formatError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function AiChatTab({ currentChapterId, currentChapterTitle, selectionSnapshot }: AiChatTabProps) {
  const api = useMemo(getNovelToolApi, []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    createMessage("assistant", "可以围绕当前章节和选中文本提问，AI 会结合可用上下文回复。")
  ]);

  async function sendMessage(): Promise<void> {
    const message = draft.trim();
    if (!message || busy) {
      return;
    }

    setDraft("");
    setBusy(true);
    setError(null);
    setMessages((current) => [...current, createMessage("user", message)]);
    try {
      const content = currentChapterId ? ((await api.chapter.getContent({ chapterId: currentChapterId })) as ChapterContent | undefined) : undefined;
      const reply = (await api.ai.sendChatMessage({
        message,
        ...(currentChapterTitle ? { currentChapterTitle } : {}),
        ...(selectionSnapshot?.text ? { selectionText: selectionSnapshot.text } : {}),
        ...(content?.plainText ? { chapterExcerpt: content.plainText.slice(0, 6000) } : {})
      })) as ChatMessage;
      setMessages((current) => [...current, { ...reply, id: createMessage("assistant", reply.content).id }]);
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="chat">
      <h2 className="task-title">AI 对话</h2>
      <div className="chips">
        <span className="chip">当前章节：{currentChapterTitle ?? "未选择章节"}</span>
        <span className="chip">{selectionSnapshot ? "已选中文本" : "未选中文本"}</span>
      </div>
      <div className="messages" aria-live="polite">
        {messages.map((message) => (
          <div className={`message ${message.role === "user" ? "user" : ""}`} key={message.id}>
            {message.content}
            <div className="message-time">{new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</div>
          </div>
        ))}
        {busy ? (
          <div className="message pending" role="status">
            AI 正在回复...
          </div>
        ) : null}
        {error ? <div className="message error-message">{error}</div> : null}
      </div>
      <div className="chat-input">
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="告诉 AI 你的想法..." />
        <div className="chat-bottom chat-bottom-send">
          <button className="send" disabled={!draft.trim() || busy} onClick={() => void sendMessage()} type="button" aria-label="发送">
            <PaperPlaneRight size={20} weight="regular" />
          </button>
        </div>
      </div>
    </section>
  );
}
