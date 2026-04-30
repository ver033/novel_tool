import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AiChatAction,
  AiChatMessageRecord,
  AiChatSessionRecord,
  AiStreamContextEvent,
  ChapterContent,
  SelectionSnapshot,
  SettingsState
} from "../../main/shared/types";
import { createIdleChatContextUsage } from "../sidebar/chat-context-display";
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

function isCanceledIpcError(reason: unknown): boolean {
  const message = formatIpcErrorMessage(reason, "");
  return message.includes("canceled") || message.includes("AI 对话已取消");
}

function getSessionContextUsage(session: AiChatSessionRecord | null): AiStreamContextEvent | null {
  return session?.lastContextUsage ?? null;
}

export function useChatStore({ projectId, currentChapterId, currentChapterTitle, selectionSnapshot }: UseChatStoreOptions) {
  const api = useMemo(getNovelToolApi, []);
  const [session, setSession] = useState<AiChatSessionRecord | null>(null);
  const [sessions, setSessions] = useState<readonly AiChatSessionRecord[]>([]);
  const [messages, setMessages] = useState<readonly AiChatMessageRecord[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [idleContextUsage, setIdleContextUsage] = useState<AiStreamContextEvent | null>(null);
  const [contextUsage, setContextUsage] = useState<AiStreamContextEvent | null>(null);
  const [contextUsagePending, setContextUsagePending] = useState(false);
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
      setStreamingReasoning("");
      setIdleContextUsage(null);
      setContextUsage(null);
      setContextUsagePending(false);
      setError(null);
      return () => {
        disposed = true;
      };
    }

    setLoading(true);
    setError(null);
    setContextUsagePending(false);
    setContextUsage((current) => current ?? createIdleChatContextUsage(null));
    void (async () => {
      const [settings, initialSessions] = await Promise.all([
        api.settings.get() as Promise<SettingsState>,
        api.ai.listChatSessions({ projectId }) as Promise<AiChatSessionRecord[]>
      ]);
      let loadedSessions = initialSessions;
      if (loadedSessions.length === 0) {
        const createdSession = (await api.ai.getChatSession({ projectId })) as AiChatSessionRecord;
        loadedSessions = [createdSession];
      }
      const nextSession = loadedSessions[0] ?? null;
      const loadedMessages = nextSession ? await api.ai.listChatMessages({ projectId: nextSession.projectId, sessionId: nextSession.id }) : [];

      return {
        idleContextUsage: createIdleChatContextUsage(settings),
        loadedMessages: loadedMessages as AiChatMessageRecord[],
        loadedSessions,
        nextSession
      };
    })()
      .then(({ idleContextUsage, loadedMessages, loadedSessions, nextSession }) => {
        if (disposed) {
          return;
        }
        setIdleContextUsage(idleContextUsage);
        setContextUsage(getSessionContextUsage(nextSession) ?? idleContextUsage);
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
      setStreamingReasoning("");
      setContextUsage(idleContextUsage);
      setContextUsagePending(false);
    } catch (reason) {
      setError(formatIpcErrorMessage(reason, "清空 AI 对话失败"));
    } finally {
      setBusy(false);
    }
  }, [api, busy, idleContextUsage, projectId, session]);

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
      setStreamingReasoning("");
      setContextUsage(getSessionContextUsage(selectedSession) ?? idleContextUsage);
      setContextUsagePending(false);
      try {
        setSession(selectedSession);
        await loadMessages(selectedSession);
      } catch (reason) {
        setError(formatIpcErrorMessage(reason, "切换 AI 对话失败"));
      } finally {
        setLoading(false);
      }
    },
    [busy, idleContextUsage, loadMessages, loading, projectId, session, sessions]
  );

  const createSession = useCallback(async () => {
    if (!projectId || busy || loading) {
      return;
    }

    setLoading(true);
    setError(null);
    setStreamingText("");
    setStreamingReasoning("");
    setContextUsagePending(false);
    try {
      const createdSession = (await api.ai.createChatSession({ projectId })) as AiChatSessionRecord;
      const loadedSessions = (await api.ai.listChatSessions({ projectId })) as AiChatSessionRecord[];
      setSessions(loadedSessions.length > 0 ? loadedSessions : [createdSession]);
      setSession(createdSession);
      setMessages([]);
      setContextUsage(idleContextUsage);
    } catch (reason) {
      setError(formatIpcErrorMessage(reason, "创建 AI 对话失败"));
    } finally {
      setLoading(false);
    }
  }, [api, busy, idleContextUsage, loading, projectId]);

  const deleteCurrentSession = useCallback(async () => {
    if (!projectId || !session || busy || loading) {
      return;
    }

    setLoading(true);
    setError(null);
    setStreamingText("");
    setStreamingReasoning("");
    setContextUsagePending(false);
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
      setContextUsage(getSessionContextUsage(nextSession) ?? idleContextUsage);
      await loadMessages(nextSession);
    } catch (reason) {
      setError(formatIpcErrorMessage(reason, "删除 AI 对话失败"));
    } finally {
      setLoading(false);
    }
  }, [api, busy, idleContextUsage, loadMessages, loading, projectId, session]);

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
        setStreamingReasoning("");
      };

      setBusy(true);
      setError(null);
      setStreamingText("");
      setStreamingReasoning("");
      setContextUsagePending(true);
      setMessages((current) => [...current, pendingUser]);

      try {
        const content =
          currentChapterId && projectId
            ? ((await api.chapter.getContent({ projectId, chapterId: currentChapterId })) as ChapterContent | undefined)
            : undefined;
        unsubscribe = api.ai.subscribeAiStream(requestId, {
          onChunk(event) {
            if (activeRequestId.current !== requestId) {
              return;
            }
            setStreamingText((current) => `${current}${event.content}`);
          },
          onReasoning(event) {
            if (activeRequestId.current !== requestId) {
              return;
            }
            setStreamingReasoning((current) => `${current}${event.content}`);
          },
          onContext(event) {
            if (activeRequestId.current !== requestId) {
              return;
            }
            setContextUsage(event);
            setContextUsagePending(false);
          },
          onDone(event) {
            if (activeRequestId.current !== requestId) {
              return;
            }
            applyResult(event.payload as ChatStreamPayload);
          },
          onError(event) {
            if (activeRequestId.current !== requestId) {
              return;
            }
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
        if (activeRequestId.current !== requestId) {
          return;
        }
        applyResult(result);
        await refreshSessions(session.id);
      } catch (reason) {
        if (activeRequestId.current !== requestId && isCanceledIpcError(reason)) {
          return;
        }
        setContextUsagePending(false);
        setError(formatIpcErrorMessage(reason, "AI 对话失败"));
        await loadMessages(session).catch(() => {
          setMessages((current) => current.filter((item) => item.id !== pendingUser.id));
        });
      } finally {
        const isCurrentRequest = activeRequestId.current === requestId;
        if (isCurrentRequest) {
          activeRequestId.current = null;
        }
        unsubscribe?.();
        if (isCurrentRequest) {
          setBusy(false);
          setStreamingText("");
          setStreamingReasoning("");
          setContextUsagePending(false);
        }
      }
    },
    [api, busy, currentChapterId, currentChapterTitle, loadMessages, projectId, refreshSessions, selectionSnapshot, session]
  );

  return {
    busy,
    clearChat,
    contextUsage,
    contextUsagePending,
    createSession,
    deleteCurrentSession,
    error,
    loading,
    messages,
    selectSession,
    sendMessage,
    session,
    sessions,
    streamingReasoning,
    streamingText
  };
}
