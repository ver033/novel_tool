import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AiChatAction,
  AiChatMessageRecord,
  AiChatSessionRecord,
  AiStreamContextEvent,
  ChapterContent,
  SelectionSnapshot,
  SettingsState,
  SummaryIndexStatus
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

const SUMMARY_INDEX_POLL_MS = 15_000;

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
  const [summaryIndexStatus, setSummaryIndexStatus] = useState<SummaryIndexStatus | null>(null);
  const [summaryIndexLoading, setSummaryIndexLoading] = useState(false);
  const [summaryIndexError, setSummaryIndexError] = useState<string | null>(null);
  const [summaryIndexNotice, setSummaryIndexNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequestId = useRef<string | null>(null);
  const canceledRequestIds = useRef<Set<string>>(new Set());

  const cancelActiveStream = useCallback((options: { readonly detach?: boolean } = {}) => {
    const requestId = activeRequestId.current;
    if (!requestId) {
      return;
    }
    canceledRequestIds.current.add(requestId);
    if (options.detach) {
      activeRequestId.current = null;
    }
    void api.ai.cancelStream({ requestId });
    setBusy(false);
    setStreamingText("");
    setStreamingReasoning("");
    setContextUsagePending(false);
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

  const refreshSummaryIndexStatus = useCallback(async () => {
    if (!projectId) {
      setSummaryIndexStatus(null);
      setSummaryIndexError(null);
      setSummaryIndexNotice(null);
      setSummaryIndexLoading(false);
      return;
    }

    setSummaryIndexLoading(true);
    setSummaryIndexError(null);
    setSummaryIndexNotice(null);
    try {
      const status = (await api.summary.getIndexStatus({ projectId })) as SummaryIndexStatus;
      setSummaryIndexStatus(status);
    } catch (reason) {
      setSummaryIndexError(formatIpcErrorMessage(reason, "读取全书索引状态失败"));
    } finally {
      setSummaryIndexLoading(false);
    }
  }, [api, projectId]);

  const rebuildSummaryIndex = useCallback(async (options: { readonly force?: boolean } = {}) => {
    if (!projectId) {
      return;
    }

    setSummaryIndexLoading(true);
    setSummaryIndexError(null);
    setSummaryIndexNotice(null);
    try {
      const status = (await api.summary.rebuildProjectIndex({ projectId, ...(options.force ? { force: true } : {}) })) as SummaryIndexStatus;
      setSummaryIndexStatus(status);
      setSummaryIndexNotice(options.force ? "全书索引已强制重新排队。" : "后台索引任务已重新排队。");
    } catch (reason) {
      setSummaryIndexError(formatIpcErrorMessage(reason, "建立全书索引失败"));
    } finally {
      setSummaryIndexLoading(false);
    }
  }, [api, projectId]);

  const cancelSummaryIndexJob = useCallback(async () => {
    if (!projectId) {
      return;
    }

    setSummaryIndexLoading(true);
    setSummaryIndexError(null);
    setSummaryIndexNotice(null);
    try {
      const status = (await api.summary.cancelCurrentJob({ projectId })) as SummaryIndexStatus;
      setSummaryIndexStatus(status);
      setSummaryIndexNotice("后台索引已停止；已完成的章节缓存会保留。");
    } catch (reason) {
      setSummaryIndexError(formatIpcErrorMessage(reason, "停止当前索引任务失败"));
    } finally {
      setSummaryIndexLoading(false);
    }
  }, [api, projectId]);

  useEffect(() => {
    let disposed = false;
    cancelActiveStream({ detach: true });

    if (!projectId) {
      setSession(null);
      setSessions([]);
      setMessages([]);
      setStreamingText("");
      setStreamingReasoning("");
      setIdleContextUsage(null);
      setContextUsage(null);
      setContextUsagePending(false);
      setSummaryIndexStatus(null);
      setSummaryIndexLoading(false);
      setSummaryIndexError(null);
      setSummaryIndexNotice(null);
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

  useEffect(() => {
    void refreshSummaryIndexStatus();
  }, [refreshSummaryIndexStatus]);

  useEffect(() => {
    if (!projectId || !summaryIndexStatus) {
      return undefined;
    }
    if (summaryIndexStatus.queuedJobCount === 0 && !summaryIndexStatus.runningJobLabel) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void refreshSummaryIndexStatus();
    }, SUMMARY_INDEX_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [projectId, refreshSummaryIndexStatus, summaryIndexStatus]);

  useEffect(() => () => cancelActiveStream({ detach: true }), [cancelActiveStream]);

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
      cancelActiveStream({ detach: true });
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
            if (activeRequestId.current !== requestId || canceledRequestIds.current.has(requestId)) {
              return;
            }
            setStreamingText((current) => `${current}${event.content}`);
          },
          onReasoning(event) {
            if (activeRequestId.current !== requestId || canceledRequestIds.current.has(requestId)) {
              return;
            }
            setStreamingReasoning((current) => `${current}${event.content}`);
          },
          onContext(event) {
            if (activeRequestId.current !== requestId || canceledRequestIds.current.has(requestId)) {
              return;
            }
            setContextUsage(event);
            setContextUsagePending(false);
          },
          onDone(event) {
            if (activeRequestId.current !== requestId || canceledRequestIds.current.has(requestId)) {
              return;
            }
            applyResult(event.payload as ChatStreamPayload);
          },
          onError(event) {
            if (activeRequestId.current !== requestId || canceledRequestIds.current.has(requestId)) {
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
        if (canceledRequestIds.current.has(requestId)) {
          if (activeRequestId.current === requestId) {
            setContextUsagePending(false);
            await loadMessages(session).catch(() => {
              setMessages((current) => current.filter((item) => item.id !== pendingUser.id));
            });
          }
          return;
        }
        applyResult(result);
        await refreshSessions(session.id);
      } catch (reason) {
        if (isCanceledIpcError(reason) || canceledRequestIds.current.has(requestId)) {
          if (activeRequestId.current === requestId) {
            setContextUsagePending(false);
            setStreamingText("");
            setStreamingReasoning("");
            await loadMessages(session).catch(() => {
              setMessages((current) => current.filter((item) => item.id !== pendingUser.id));
            });
          }
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
        canceledRequestIds.current.delete(requestId);
        if (isCurrentRequest) {
          setBusy(false);
          setStreamingText("");
          setStreamingReasoning("");
          setContextUsagePending(false);
        }
      }
    },
    [api, busy, cancelActiveStream, currentChapterId, currentChapterTitle, loadMessages, projectId, refreshSessions, selectionSnapshot, session]
  );

  return {
    busy,
    clearChat,
    contextUsage,
    contextUsagePending,
    cancelActiveStream,
    cancelSummaryIndexJob,
    createSession,
    deleteCurrentSession,
    error,
    loading,
    messages,
    rebuildSummaryIndex,
    refreshSummaryIndexStatus,
    selectSession,
    sendMessage,
    session,
    sessions,
    summaryIndexError,
    summaryIndexLoading,
    summaryIndexNotice,
    summaryIndexStatus,
    streamingReasoning,
    streamingText
  };
}
