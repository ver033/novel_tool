import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [sessions, setSessions] = useState<readonly AiChatSessionRecord[]>([]);
  const [messages, setMessages] = useState<readonly AiChatMessageRecord[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequestId = useRef<string | null>(null);

  const cancelActiveStream = useCallback(() => {
    const requestId = activeRequestId.current;
    if (!requestId) {
      return;
    }
    activeRequestId.current = null;
    void api.ai.cancelStream({ requestId });
  }, [api]);

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

  const refreshSessions = useCallback(
    async (preferredSessionId?: string) => {
      if (!projectId) {
        return;
      }

      const loadedSessions = (await api.ai.listChatSessions({ projectId })) as AiChatSessionRecord[];
      setSessions(loadedSessions);
      const refreshedSession = loadedSessions.find((item) => item.id === preferredSessionId);
      if (refreshedSession) {
        setSession(refreshedSession);
      }
    },
    [api, projectId]
  );

  useEffect(() => {
    let disposed = false;

    if (!projectId) {
      cancelActiveStream();
      setSession(null);
      setSessions([]);
      setMessages([]);
      setStreamingText("");
      setError(null);
      return () => {
        disposed = true;
      };
    }

    setLoading(true);
    setError(null);
    void (async () => {
      let loadedSessions = (await api.ai.listChatSessions({ projectId })) as AiChatSessionRecord[];
      if (loadedSessions.length === 0) {
        const createdSession = (await api.ai.getChatSession({ projectId })) as AiChatSessionRecord;
        loadedSessions = [createdSession];
      }
      const nextSession = loadedSessions[0] ?? null;
      const loadedMessages = nextSession ? await api.ai.listChatMessages({ projectId: nextSession.projectId, sessionId: nextSession.id }) : [];

      return {
        loadedMessages: loadedMessages as AiChatMessageRecord[],
        loadedSessions,
        nextSession
      };
    })()
      .then(({ loadedMessages, loadedSessions, nextSession }) => {
        if (disposed) {
          return;
        }
        setSessions(loadedSessions);
        setSession(nextSession);
        setMessages(loadedMessages);
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
  }, [api, cancelActiveStream, projectId]);

  useEffect(() => () => cancelActiveStream(), [cancelActiveStream]);

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

  const selectSession = useCallback(
    async (sessionId: string) => {
      if (!projectId || busy || loading || session?.id === sessionId) {
        return;
      }

      const selectedSession = sessions.find((item) => item.id === sessionId);
      if (!selectedSession) {
        return;
      }

      setLoading(true);
      setError(null);
      setStreamingText("");
      try {
        setSession(selectedSession);
        await loadMessages(selectedSession);
      } catch (reason) {
        setError(formatIpcErrorMessage(reason, "切换 AI 对话失败"));
      } finally {
        setLoading(false);
      }
    },
    [busy, loadMessages, loading, projectId, session, sessions]
  );

  const createSession = useCallback(async () => {
    if (!projectId || busy || loading) {
      return;
    }

    setLoading(true);
    setError(null);
    setStreamingText("");
    try {
      const createdSession = (await api.ai.createChatSession({ projectId })) as AiChatSessionRecord;
      const loadedSessions = (await api.ai.listChatSessions({ projectId })) as AiChatSessionRecord[];
      setSessions(loadedSessions.length > 0 ? loadedSessions : [createdSession]);
      setSession(createdSession);
      setMessages([]);
    } catch (reason) {
      setError(formatIpcErrorMessage(reason, "创建 AI 对话失败"));
    } finally {
      setLoading(false);
    }
  }, [api, busy, loading, projectId]);

  const deleteCurrentSession = useCallback(async () => {
    if (!projectId || !session || busy || loading) {
      return;
    }

    setLoading(true);
    setError(null);
    setStreamingText("");
    try {
      await api.ai.deleteChatSession({
        projectId,
        sessionId: session.id
      });
      const loadedSessions = (await api.ai.listChatSessions({ projectId })) as AiChatSessionRecord[];
      const nextSession =
        loadedSessions[0] ?? ((await api.ai.createChatSession({ projectId })) as AiChatSessionRecord);
      setSessions(loadedSessions.length > 0 ? loadedSessions : [nextSession]);
      setSession(nextSession);
      await loadMessages(nextSession);
    } catch (reason) {
      setError(formatIpcErrorMessage(reason, "删除 AI 对话失败"));
    } finally {
      setLoading(false);
    }
  }, [api, busy, loadMessages, loading, projectId, session]);

  const sendMessage = useCallback(
    async (rawMessage: string) => {
      const message = rawMessage.trim();
      if (!message || !projectId || !session || busy) {
        return;
      }

      const requestId = createRequestId("chat_stream");
      cancelActiveStream();
      activeRequestId.current = requestId;
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
        const content =
          currentChapterId && projectId
            ? ((await api.chapter.getContent({ projectId, chapterId: currentChapterId })) as ChapterContent | undefined)
            : undefined;
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
        await refreshSessions(session.id);
      } catch (reason) {
        setError(formatIpcErrorMessage(reason, "AI 对话失败"));
        await loadMessages(session).catch(() => {
          setMessages((current) => current.filter((item) => item.id !== pendingUser.id));
        });
      } finally {
        if (activeRequestId.current === requestId) {
          activeRequestId.current = null;
        }
        unsubscribe?.();
        setBusy(false);
        setStreamingText("");
      }
    },
    [api, busy, currentChapterId, currentChapterTitle, loadMessages, projectId, refreshSessions, selectionSnapshot, session]
  );

  return {
    busy,
    clearChat,
    createSession,
    deleteCurrentSession,
    error,
    loading,
    messages,
    selectSession,
    sendMessage,
    session,
    sessions,
    streamingText
  };
}
