import { useCallback, useEffect, useMemo, useState } from "react";
import type { AiChatAction, AiChatMessageRecord, AiChatSessionRecord, ChapterContent, SelectionSnapshot } from "../../main/shared/types";
import { getNovelToolApi } from "./app-store";
import { formatIpcErrorMessage } from "./ipc-error";

type UseChatStoreOptions = {
  readonly projectId: string | null;
  readonly currentChapterId: string | null;
  readonly currentChapterTitle: string | null;
  readonly selectionSnapshot: SelectionSnapshot | null;
};

type ChatStreamPayload = {
  readonly messages: readonly AiChatMessageRecord[];
  readonly action: AiChatAction | null;
};

function createPendingMessage(role: "user" | "assistant", content: string): AiChatMessageRecord {
  const createdAt = new Date().toISOString();
  return {
    id: `pending_${role}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    sessionId: "pending",
    projectId: "pending",
    role,
    content,
    action: null,
    createdAt
  };
}

function createRequestId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function useChatStore({ projectId, currentChapterId, currentChapterTitle, selectionSnapshot }: UseChatStoreOptions) {
  const api = useMemo(getNovelToolApi, []);
  const [session, setSession] = useState<AiChatSessionRecord | null>(null);
  const [messages, setMessages] = useState<readonly AiChatMessageRecord[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMessages = useCallback(
    async (nextSession: AiChatSessionRecord) => {
      const loaded = (await api.ai.listChatMessages({
        projectId: nextSession.projectId,
        sessionId: nextSession.id
      })) as AiChatMessageRecord[];
      setMessages(loaded);
    },
    [api]
  );

  useEffect(() => {
    let disposed = false;

    if (!projectId) {
      setSession(null);
      setMessages([]);
      setStreamingText("");
      setError(null);
      return () => {
        disposed = true;
      };
    }

    setLoading(true);
    setError(null);
    void api.ai
      .getChatSession({ projectId })
      .then(async (createdSession) => {
        if (disposed) {
          return;
        }
        const nextSession = createdSession as AiChatSessionRecord;
        setSession(nextSession);
        await loadMessages(nextSession);
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          setError(formatIpcErrorMessage(reason, "读取 AI 对话失败"));
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [api, loadMessages, projectId]);

  const clearChat = useCallback(async () => {
    if (!projectId || !session || busy) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.ai.clearChat({
        projectId,
        sessionId: session.id
      });
      setMessages([]);
      setStreamingText("");
    } catch (reason) {
      setError(formatIpcErrorMessage(reason, "清空 AI 对话失败"));
    } finally {
      setBusy(false);
    }
  }, [api, busy, projectId, session]);

  const sendMessage = useCallback(
    async (rawMessage: string) => {
      const message = rawMessage.trim();
      if (!message || !projectId || !session || busy) {
        return;
      }

      const requestId = createRequestId("chat_stream");
      const pendingUser = createPendingMessage("user", message);
      let unsubscribe: (() => void) | null = null;
      let applied = false;
      const applyResult = (result: ChatStreamPayload) => {
        if (applied) {
          return;
        }
        applied = true;
        setMessages((current) => [...current.filter((item) => item.id !== pendingUser.id), ...result.messages]);
        setStreamingText("");
      };

      setBusy(true);
      setError(null);
      setStreamingText("");
      setMessages((current) => [...current, pendingUser]);

      try {
        const content = currentChapterId ? ((await api.chapter.getContent({ chapterId: currentChapterId })) as ChapterContent | undefined) : undefined;
        unsubscribe = api.ai.subscribeAiStream(requestId, {
          onChunk(event) {
            setStreamingText((current) => `${current}${event.content}`);
          },
          onDone(event) {
            applyResult(event.payload as ChatStreamPayload);
          },
          onError(event) {
            setError(event.error);
          }
        });
        const result = (await api.ai.sendChatMessageStream({
          requestId,
          projectId,
          sessionId: session.id,
          message,
          ...(currentChapterId ? { chapterId: currentChapterId } : {}),
          ...(currentChapterTitle ? { currentChapterTitle } : {}),
          ...(selectionSnapshot?.text ? { selectionText: selectionSnapshot.text } : {}),
          ...(content?.plainText ? { chapterExcerpt: content.plainText.slice(0, 6000) } : {})
        })) as ChatStreamPayload;
        applyResult(result);
      } catch (reason) {
        setError(formatIpcErrorMessage(reason, "AI 对话失败"));
        await loadMessages(session).catch(() => {
          setMessages((current) => current.filter((item) => item.id !== pendingUser.id));
        });
      } finally {
        unsubscribe?.();
        setBusy(false);
        setStreamingText("");
      }
    },
    [api, busy, currentChapterId, currentChapterTitle, loadMessages, projectId, selectionSnapshot, session]
  );

  return {
    busy,
    clearChat,
    error,
    loading,
    messages,
    sendMessage,
    session,
    streamingText
  };
}
