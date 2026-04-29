import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type {
  AiTaskCandidateRecord,
  AiTaskRecord,
  AiApplyCandidateInput,
  SelectionSnapshot,
  TaskType
} from "../../main/shared/types";
import { applyAiCandidateToEditor } from "../editor/ai-apply";
import { getNovelToolApi } from "./app-store";
import { formatIpcErrorMessage } from "./ipc-error";

type PreviewResult = {
  readonly task: AiTaskRecord;
  readonly candidate: AiTaskCandidateRecord;
};

type UseTaskStoreOptions = {
  readonly projectId: string | null;
  readonly chapterId: string | null;
  readonly taskType: TaskType;
  readonly presetId: string | null;
  readonly selectionSnapshot: SelectionSnapshot | null;
  readonly instruction: string;
  readonly editor: Editor | null;
  readonly flushPendingSave: () => Promise<void>;
};

export function useTaskStore({ projectId, chapterId, taskType, presetId, selectionSnapshot, instruction, editor, flushPendingSave }: UseTaskStoreOptions) {
  const api = useMemo(getNovelToolApi, []);
  const [task, setTask] = useState<AiTaskRecord | null>(null);
  const [candidate, setCandidate] = useState<AiTaskCandidateRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const configuredKey = useRef<string | null>(null);
  const activeRequestId = useRef<string | null>(null);

  const cancelActiveStream = useCallback(() => {
    const requestId = activeRequestId.current;
    if (!requestId) {
      return;
    }
    activeRequestId.current = null;
    void api.ai.cancelStream({ requestId });
  }, [api]);

  useEffect(() => {
    cancelActiveStream();
    setTask(null);
    setCandidate(null);
    setError(null);
    setStreamingText("");
    configuredKey.current = null;
  }, [cancelActiveStream, projectId, chapterId, taskType, presetId, selectionSnapshot?.selectionHash]);

  useEffect(() => () => cancelActiveStream(), [cancelActiveStream]);

  useEffect(() => {
    if (!projectId || !selectionSnapshot) {
      return;
    }

    const nextKey = `${projectId}:${chapterId ?? "none"}:${taskType}:${presetId ?? "none"}:${selectionSnapshot.selectionHash}`;
    if (configuredKey.current === nextKey) {
      return;
    }
    configuredKey.current = nextKey;

    setBusy(true);
    setError(null);
    void api.ai
      .createTask({
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
      })
      .then((createdTask) => {
        setTask(createdTask as AiTaskRecord);
      })
      .catch((reason: unknown) => {
        configuredKey.current = null;
        setError(formatIpcErrorMessage(reason, "创建 AI 任务失败"));
      })
      .finally(() => {
        setBusy(false);
      });
  }, [api, chapterId, instruction, presetId, projectId, selectionSnapshot, taskType]);

  const generatePreview = useCallback(async () => {
    if (!task) {
      return;
    }

    setBusy(true);
    setError(null);
    setStreamingText("");
    let unsubscribe: (() => void) | null = null;
    let requestId: string | null = null;
    try {
      const updatedTask = (await api.ai.updateTask({
        taskId: task.id,
        patch: {
          instruction,
          ...(presetId ? { presetId } : {})
        }
      })) as AiTaskRecord;
      setTask(updatedTask);
      requestId = `task_stream_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      cancelActiveStream();
      activeRequestId.current = requestId;
      unsubscribe = api.ai.subscribeAiStream(requestId, {
        onChunk(event) {
          setStreamingText((current) => `${current}${event.content}`);
        },
        onDone(event) {
          const result = event.payload as PreviewResult;
          setTask(result.task);
          setCandidate(result.candidate);
          setStreamingText("");
        },
        onError(event) {
          setError(event.error);
        }
      });
      const result = (await api.ai.generatePreviewStream({ requestId, taskId: updatedTask.id })) as PreviewResult;
      setTask(result.task);
      setCandidate(result.candidate);
      setStreamingText("");
    } catch (reason) {
      setError(formatIpcErrorMessage(reason, "生成预览失败"));
    } finally {
      if (requestId && activeRequestId.current === requestId) {
        activeRequestId.current = null;
      }
      unsubscribe?.();
      setBusy(false);
    }
  }, [api, instruction, presetId, task]);

  const continuePreview = useCallback(async () => {
    if (!task) {
      return;
    }

    setBusy(true);
    setError(null);
    setStreamingText((current) => current || task.outputText || "");
    let unsubscribe: (() => void) | null = null;
    let requestId: string | null = null;
    try {
      requestId = `task_continue_stream_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      cancelActiveStream();
      activeRequestId.current = requestId;
      unsubscribe = api.ai.subscribeAiStream(requestId, {
        onChunk(event) {
          setStreamingText((current) => `${current}${event.content}`);
        },
        onDone(event) {
          const result = event.payload as PreviewResult;
          setTask(result.task);
          setCandidate(result.candidate);
          setStreamingText("");
        },
        onError(event) {
          setError(event.error);
        }
      });
      const result = (await api.ai.continuePreviewStream({ requestId, taskId: task.id })) as PreviewResult;
      setTask(result.task);
      setCandidate(result.candidate);
      setStreamingText("");
    } catch (reason) {
      setError(formatIpcErrorMessage(reason, "继续生成失败"));
    } finally {
      if (requestId && activeRequestId.current === requestId) {
        activeRequestId.current = null;
      }
      unsubscribe?.();
      setBusy(false);
    }
  }, [api, cancelActiveStream, task]);

  const rejectCandidate = useCallback(async () => {
    if (!candidate) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const rejected = (await api.ai.rejectCandidate({ candidateId: candidate.id })) as AiTaskCandidateRecord;
      setCandidate(rejected);
    } catch (reason) {
      setError(formatIpcErrorMessage(reason, "拒绝候选失败"));
    } finally {
      setBusy(false);
    }
  }, [api, candidate]);

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
      const result = (await api.ai.saveCandidateToScratchpad({ candidateId: candidate.id })) as PreviewResult;
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
          const result = (await api.ai.saveCandidateToScratchpad({ candidateId: candidate.id })) as PreviewResult;
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
          currentChapterId: chapterId,
          flushPendingSave
        });
        setTask(result.task);
        setCandidate(result.candidate);
      } catch (reason) {
        setError(formatIpcErrorMessage(reason, "应用候选失败"));
      } finally {
        setBusy(false);
      }
    },
    [api, candidate, chapterId, editor, flushPendingSave, task]
  );

  return {
    applyCandidate,
    busy,
    candidate,
    continuePreview,
    error,
    generatePreview,
    rejectCandidate,
    saveCandidateToScratchpad,
    saveTextToScratchpad,
    streamingText,
    task
  };
}
