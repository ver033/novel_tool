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

type PreviewResult = {
  readonly task: AiTaskRecord;
  readonly candidate: AiTaskCandidateRecord;
};

type UseTaskStoreOptions = {
  readonly projectId: string | null;
  readonly chapterId: string | null;
  readonly taskType: TaskType;
  readonly selectionSnapshot: SelectionSnapshot | null;
  readonly instruction: string;
  readonly editor: Editor | null;
  readonly flushPendingSave: () => Promise<void>;
};

export function useTaskStore({ projectId, chapterId, taskType, selectionSnapshot, instruction, editor, flushPendingSave }: UseTaskStoreOptions) {
  const api = useMemo(getNovelToolApi, []);
  const [task, setTask] = useState<AiTaskRecord | null>(null);
  const [candidate, setCandidate] = useState<AiTaskCandidateRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configuredKey = useRef<string | null>(null);

  useEffect(() => {
    setTask(null);
    setCandidate(null);
    setError(null);
    configuredKey.current = null;
  }, [projectId, chapterId, taskType, selectionSnapshot?.selectionHash]);

  useEffect(() => {
    if (!projectId || !selectionSnapshot) {
      return;
    }

    const nextKey = `${projectId}:${chapterId ?? "none"}:${taskType}:${selectionSnapshot.selectionHash}`;
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
        setError(reason instanceof Error ? reason.message : "创建 AI 任务失败");
      })
      .finally(() => {
        setBusy(false);
      });
  }, [api, chapterId, instruction, projectId, selectionSnapshot, taskType]);

  const generatePreview = useCallback(async () => {
    if (!task) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const updatedTask = (await api.ai.updateTask({
        taskId: task.id,
        patch: {
          instruction
        }
      })) as AiTaskRecord;
      setTask(updatedTask);
      const result = (await api.ai.generatePreview({ taskId: updatedTask.id })) as PreviewResult;
      setTask(result.task);
      setCandidate(result.candidate);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "生成预览失败");
    } finally {
      setBusy(false);
    }
  }, [api, instruction, task]);

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
      setError(reason instanceof Error ? reason.message : "拒绝候选失败");
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
      setError(reason instanceof Error ? reason.message : "加入草稿纸失败");
    } finally {
      setBusy(false);
    }
  }, [api, candidate, chapterId, projectId, task]);

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
          flushPendingSave
        });
        setTask(result.task);
        setCandidate(result.candidate);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "应用候选失败");
      } finally {
        setBusy(false);
      }
    },
    [api, candidate, editor, flushPendingSave, task]
  );

  return {
    applyCandidate,
    busy,
    candidate,
    error,
    generatePreview,
    rejectCandidate,
    saveCandidateToScratchpad,
    task
  };
}
