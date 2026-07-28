import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type {
  AiTaskCandidateRecord,
  AiTaskRecord,
  AiApplyCandidateInput,
  ChapterContent,
  SelectionSnapshot,
  TaskType
} from "../../main/shared/types";
import { applyAiCandidateToEditor } from "../editor/ai-apply";
import type { SavedChapterVersion } from "./editor-store";
import { getNovelToolApi } from "./app-store";
import { formatIpcErrorMessage } from "./ipc-error";
import type { TaskExecutionPhase } from "./task-execution";

type PreviewResult = {
  readonly task: AiTaskRecord;
  readonly candidate: AiTaskCandidateRecord;
};

type UseTaskStoreOptions = {
  readonly activeEditorChapterId: string | null;
  readonly projectId: string | null;
  readonly chapterId: string | null;
  readonly taskType: TaskType;
  readonly presetId: string | null;
  readonly selectionSnapshot: SelectionSnapshot | null;
  readonly instruction: string;
  readonly taskRunId: number | null;
  readonly autoStartId: number | null;
  readonly onAutoStartConsumed: (taskRunId: number) => void;
  readonly editor: Editor | null;
  readonly flushPendingSave: () => Promise<SavedChapterVersion | null>;
  readonly onContentSaved: (content: ChapterContent) => void;
};

function isCanceledIpcError(reason: unknown): boolean {
  const message = formatIpcErrorMessage(reason, "");
  return message.includes("canceled") || message.includes("AI 任务已取消");
}

export function useTaskStore({
  activeEditorChapterId,
  projectId,
  chapterId,
  taskType,
  presetId,
  selectionSnapshot,
  instruction,
  taskRunId,
  autoStartId,
  onAutoStartConsumed,
  editor,
  flushPendingSave,
  onContentSaved
}: UseTaskStoreOptions) {
  const api = useMemo(getNovelToolApi, []);
  const [task, setTask] = useState<AiTaskRecord | null>(null);
  const [candidate, setCandidate] = useState<AiTaskCandidateRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [taskExecutionPhase, setTaskExecutionPhase] = useState<TaskExecutionPhase>("idle");
  const configuredKey = useRef<string | null>(null);
  const activeTaskIdRef = useRef<string | null>(null);
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
    setTaskExecutionPhase("canceling");
    void api.ai.cancelStream({ requestId });
    setBusy(false);
    setTaskExecutionPhase("canceled");
  }, [api]);

  useEffect(() => {
    activeTaskIdRef.current = null;
    cancelActiveStream({ detach: true });
    setTask(null);
    setCandidate(null);
    setError(null);
    setStreamingText("");
    setTaskExecutionPhase("idle");
    configuredKey.current = null;
  }, [cancelActiveStream, projectId, chapterId, taskType, presetId, selectionSnapshot?.selectionHash, taskRunId]);

  useEffect(() => () => cancelActiveStream({ detach: true }), [cancelActiveStream]);

  const generatePreviewForTask = useCallback(async (sourceTask: AiTaskRecord) => {
    const isCurrentTask = (): boolean => activeTaskIdRef.current === sourceTask.id;
    setBusy(true);
    setError(null);
    setStreamingText("");
    setTaskExecutionPhase("preparing");
    let unsubscribe: (() => void) | null = null;
    let requestId: string | null = null;
    let resultApplied = false;
    const applyResult = (result: PreviewResult): void => {
      if (resultApplied || !isCurrentTask()) {
        return;
      }
      resultApplied = true;
      setTask(result.task);
      setCandidate(result.candidate);
      setStreamingText("");
    };
    try {
      await flushPendingSave();
      if (!isCurrentTask()) {
        return;
      }
      setTaskExecutionPhase("requesting");
      const updatedTask = (await api.ai.updateTask({
        taskId: sourceTask.id,
        patch: {
          instruction,
          ...(presetId ? { presetId } : {})
        }
      })) as AiTaskRecord;
      if (!isCurrentTask()) {
        return;
      }
      setTask(updatedTask);
      requestId = `task_stream_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const currentRequestId = requestId;
      cancelActiveStream({ detach: true });
      activeRequestId.current = currentRequestId;
      unsubscribe = api.ai.subscribeAiStream(currentRequestId, {
        onChunk(event) {
          if (!isCurrentTask() || activeRequestId.current !== currentRequestId || canceledRequestIds.current.has(currentRequestId)) {
            return;
          }
          setTaskExecutionPhase("streaming");
          setStreamingText((current) => `${current}${event.content}`);
        },
        onDone(event) {
          if (!isCurrentTask() || activeRequestId.current !== currentRequestId || canceledRequestIds.current.has(currentRequestId)) {
            return;
          }
          setTaskExecutionPhase("finalizing");
          applyResult(event.payload as PreviewResult);
        },
        onError(event) {
          if (!isCurrentTask() || activeRequestId.current !== currentRequestId || canceledRequestIds.current.has(currentRequestId)) {
            return;
          }
          setError(event.error);
          setTaskExecutionPhase("error");
        }
      });
      const result = (await api.ai.generatePreviewStream({ requestId: currentRequestId, taskId: updatedTask.id })) as PreviewResult;
      if (canceledRequestIds.current.has(currentRequestId) || !isCurrentTask()) {
        if (isCurrentTask()) setTaskExecutionPhase("canceled");
        return;
      }
      applyResult(result);
      setTaskExecutionPhase("complete");
    } catch (reason) {
      if (requestId && (isCanceledIpcError(reason) || canceledRequestIds.current.has(requestId))) {
        if (isCurrentTask()) setTaskExecutionPhase("canceled");
        return;
      }
      if (isCurrentTask()) {
        setError(formatIpcErrorMessage(reason, "生成预览失败"));
        setTaskExecutionPhase("error");
      }
    } finally {
      if (requestId && activeRequestId.current === requestId) {
        activeRequestId.current = null;
      }
      unsubscribe?.();
      if (requestId) {
        canceledRequestIds.current.delete(requestId);
      }
      if (isCurrentTask()) {
        setBusy(false);
      }
    }
  }, [api, cancelActiveStream, flushPendingSave, instruction, presetId]);

  const generatePreview = useCallback(async () => {
    if (task) {
      await generatePreviewForTask(task);
    }
  }, [generatePreviewForTask, task]);

  useEffect(() => {
    if (!projectId || !selectionSnapshot) {
      return;
    }

    const nextKey = `${projectId}:${chapterId ?? "none"}:${taskType}:${presetId ?? "none"}:${selectionSnapshot.selectionHash}:${taskRunId ?? "manual"}`;
    if (configuredKey.current === nextKey) {
      return;
    }
    configuredKey.current = nextKey;

    setBusy(true);
    setError(null);
    setTaskExecutionPhase("creating");
    void (async () => {
      try {
        const createdTask = (await api.ai.createTask({
          projectId,
          chapterId: chapterId ?? undefined,
          taskType,
          inputText: selectionSnapshot.text,
          instruction,
          ...(presetId ? { presetId } : {}),
          selection: {
            ...selectionSnapshot,
            paragraphIds: [...selectionSnapshot.paragraphIds]
          }
        })) as AiTaskRecord;
        if (configuredKey.current !== nextKey) {
          return;
        }
        activeTaskIdRef.current = createdTask.id;
        setTask(createdTask);
        if (taskRunId !== null && autoStartId === taskRunId) {
          onAutoStartConsumed(taskRunId);
          await generatePreviewForTask(createdTask);
        } else {
          setTaskExecutionPhase("ready");
        }
      } catch (reason) {
        if (configuredKey.current === nextKey) {
          configuredKey.current = null;
          setError(formatIpcErrorMessage(reason, "创建 AI 任务失败"));
          setTaskExecutionPhase("error");
        }
      } finally {
        if (configuredKey.current === nextKey) {
          setBusy(false);
        }
      }
    })();
  }, [
    api,
    autoStartId,
    chapterId,
    generatePreviewForTask,
    instruction,
    onAutoStartConsumed,
    presetId,
    projectId,
    selectionSnapshot,
    taskRunId,
    taskType
  ]);

  const continuePreview = useCallback(async () => {
    if (!task) {
      return;
    }

    const sourceTaskId = task.id;
    const isCurrentTask = (): boolean => activeTaskIdRef.current === sourceTaskId;
    setBusy(true);
    setError(null);
    setStreamingText((current) => current || task.outputText || "");
    setTaskExecutionPhase("requesting");
    let unsubscribe: (() => void) | null = null;
    let requestId: string | null = null;
    try {
      requestId = `task_continue_stream_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const currentRequestId = requestId;
      cancelActiveStream({ detach: true });
      activeRequestId.current = currentRequestId;
      unsubscribe = api.ai.subscribeAiStream(currentRequestId, {
        onChunk(event) {
          if (!isCurrentTask() || activeRequestId.current !== currentRequestId || canceledRequestIds.current.has(currentRequestId)) {
            return;
          }
          setTaskExecutionPhase("streaming");
          setStreamingText((current) => `${current}${event.content}`);
        },
        onDone(event) {
          if (!isCurrentTask() || activeRequestId.current !== currentRequestId || canceledRequestIds.current.has(currentRequestId)) {
            return;
          }
          const result = event.payload as PreviewResult;
          setTaskExecutionPhase("finalizing");
          setTask(result.task);
          setCandidate(result.candidate);
          setStreamingText("");
        },
        onError(event) {
          if (!isCurrentTask() || activeRequestId.current !== currentRequestId || canceledRequestIds.current.has(currentRequestId)) {
            return;
          }
          setError(event.error);
          setTaskExecutionPhase("error");
        }
      });
      const result = (await api.ai.continuePreviewStream({ requestId: currentRequestId, taskId: task.id })) as PreviewResult;
      if (canceledRequestIds.current.has(currentRequestId) || !isCurrentTask()) {
        if (isCurrentTask()) setTaskExecutionPhase("canceled");
        return;
      }
      setTask(result.task);
      setCandidate(result.candidate);
      setStreamingText("");
      setTaskExecutionPhase("complete");
    } catch (reason) {
      if (requestId && (isCanceledIpcError(reason) || canceledRequestIds.current.has(requestId))) {
        if (isCurrentTask()) setTaskExecutionPhase("canceled");
        return;
      }
      if (isCurrentTask()) {
        setError(formatIpcErrorMessage(reason, "继续生成失败"));
        setTaskExecutionPhase("error");
      }
    } finally {
      if (requestId && activeRequestId.current === requestId) {
        activeRequestId.current = null;
      }
      unsubscribe?.();
      if (requestId) {
        canceledRequestIds.current.delete(requestId);
      }
      if (isCurrentTask()) {
        setBusy(false);
      }
    }
  }, [api, cancelActiveStream, task]);

  const rejectCandidate = useCallback(async () => {
    if (!projectId || !candidate) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const rejected = (await api.ai.rejectCandidate({ projectId, candidateId: candidate.id })) as AiTaskCandidateRecord;
      setCandidate(rejected);
    } catch (reason) {
      setError(formatIpcErrorMessage(reason, "拒绝候选失败"));
    } finally {
      setBusy(false);
    }
  }, [api, candidate, projectId]);

  const saveCandidateToScratchpad = useCallback(async () => {
    if (!projectId || !candidate || !task) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.scratch.create({
        projectId,
        chapterId: chapterId ?? undefined,
        content: candidate.generatedText,
        sourceTaskId: task.id,
        pinned: false
      });
      const result = (await api.ai.saveCandidateToScratchpad({ projectId, candidateId: candidate.id })) as PreviewResult;
      setTask(result.task);
      setCandidate(result.candidate);
    } catch (reason) {
      setError(formatIpcErrorMessage(reason, "加入草稿纸失败"));
    } finally {
      setBusy(false);
    }
  }, [api, candidate, chapterId, projectId, task]);

  const saveTextToScratchpad = useCallback(
    async (content: string) => {
      if (!projectId || !task) {
        return;
      }

      setBusy(true);
      setError(null);
      try {
        await api.scratch.create({
          projectId,
          chapterId: chapterId ?? undefined,
          content,
          sourceTaskId: task.id,
          pinned: false
        });
        if (candidate) {
          const result = (await api.ai.saveCandidateToScratchpad({ projectId, candidateId: candidate.id })) as PreviewResult;
          setTask(result.task);
          setCandidate(result.candidate);
        }
      } catch (reason) {
        setError(formatIpcErrorMessage(reason, "加入草稿纸失败"));
      } finally {
        setBusy(false);
      }
    },
    [api, candidate, chapterId, projectId, task]
  );

  const applyCandidate = useCallback(
    async (applyMode: AiApplyCandidateInput["applyMode"]) => {
      if (!candidate) {
        return;
      }
      if (!task) {
        setError("当前 AI 任务不存在，不能应用候选。");
        return;
      }
      if (!editor) {
        setError("编辑器尚未就绪，不能应用候选。");
        return;
      }

      setBusy(true);
      setError(null);
      try {
        const result = await applyAiCandidateToEditor({
          api,
          editor,
          task,
          candidate,
          applyMode,
          currentChapterId: activeEditorChapterId,
          flushPendingSave,
          onContentSaved
        });
        setTask(result.task);
        setCandidate(result.candidate);
      } catch (reason) {
        setError(formatIpcErrorMessage(reason, "应用候选失败"));
      } finally {
        setBusy(false);
      }
    },
    [activeEditorChapterId, api, candidate, editor, flushPendingSave, onContentSaved, task]
  );

  return {
    applyCandidate,
    busy,
    cancelActiveStream,
    candidate,
    continuePreview,
    error,
    generatePreview,
    rejectCandidate,
    saveCandidateToScratchpad,
    saveTextToScratchpad,
    streamingText,
    task,
    taskExecutionPhase
  };
}

export type TaskStore = ReturnType<typeof useTaskStore>;
