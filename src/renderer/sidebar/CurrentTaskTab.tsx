import { useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { AiTaskCandidateRecord, SelectionSnapshot, TaskType } from "../../main/shared/types";
import { Button } from "../components/Button";
import { Textarea } from "../components/Textarea";
import type { SettingsCategory } from "../routes/SettingsPage";
import { candidateStatusLabels, taskLabels, taskStatusLabels } from "../state/sidebar-store";
import { useTaskStore } from "../state/task-store";

type CurrentTaskTabProps = {
  readonly chapterId: string | null;
  readonly currentChapterTitle: string | null;
  readonly projectId: string | null;
  readonly selectionSnapshot: SelectionSnapshot | null;
  readonly taskType: TaskType;
  readonly editor: Editor | null;
  readonly flushPendingSave: () => Promise<void>;
  readonly onOpenSettings: (category?: SettingsCategory) => void;
};

const defaultInstruction: Record<TaskType, string> = {
  polish: "请将语言表达得更文雅一些，保持剧情事实不变。",
  expand: "请补充环境和心理细节，保持节奏克制。",
  proofread: "请检查错别字、病句、重复表达和表达不顺。",
  continue: "请自然衔接后续剧情，不要突然跳转视角。"
};

function applyModeForTask(taskType: TaskType) {
  if (taskType === "expand") {
    return "insert_below" as const;
  }
  if (taskType === "continue") {
    return "insert_at_cursor" as const;
  }
  if (taskType === "proofread") {
    return "apply_proofread_suggestion" as const;
  }
  return "replace_selection" as const;
}

const aiSettingsErrorMarkers = [
  "OpenRouter API Key 未配置",
  "OpenRouter 模型名称未配置",
  "OpenRouter 服务未初始化",
  "OpenRouter 对话服务未初始化",
  "OpenRouter 连接测试未初始化",
  "OpenRouter 模型列表服务未初始化",
  "安全存储未初始化",
  "safeStorage 不可用"
];

function isAiSettingsError(error: string): boolean {
  return aiSettingsErrorMarkers.some((marker) => error.includes(marker));
}

function isTruncatedAiOutputError(error: string): boolean {
  return error.includes("finish_reason: length");
}

function taskErrorTitle(error: string, taskType: TaskType): string {
  if (isAiSettingsError(error)) {
    return "AI 服务未配置";
  }
  if (isTruncatedAiOutputError(error)) {
    return taskType === "proofread" ? "校对结果被截断" : "AI 输出被截断";
  }
  return "AI 任务失败";
}

function taskErrorHint(error: string): string | null {
  if (isAiSettingsError(error)) {
    return "请先填写 OpenRouter API Key 和模型名称，并测试保存。";
  }
  if (isTruncatedAiOutputError(error)) {
    return "模型已返回结果，但内容被截断。请缩短选区，或换用输出额度更高的模型后重试。";
  }
  return null;
}

function isCleanProofreadCandidate(candidate: AiTaskCandidateRecord | null): boolean {
  return Boolean(candidate && candidate.generatedText.trim() === "" && candidate.changeSummary === "无问题");
}

export function CurrentTaskTab({ chapterId, currentChapterTitle, projectId, selectionSnapshot, taskType, editor, flushPendingSave, onOpenSettings }: CurrentTaskTabProps) {
  const [instruction, setInstruction] = useState(defaultInstruction[taskType]);
  useEffect(() => {
    setInstruction(defaultInstruction[taskType]);
  }, [taskType, selectionSnapshot?.selectionHash]);

  const selectedText = selectionSnapshot?.text ?? "请先在正文中选中文本，再从选区工具条选择 AI 任务。";
  const label = taskLabels[taskType];
  const taskStore = useTaskStore({
    projectId,
    chapterId,
    taskType,
    selectionSnapshot,
    instruction,
    editor,
    flushPendingSave
  });
  const primaryLabel = taskType === "expand" ? "插入下方" : taskType === "continue" ? "插入到光标处" : taskType === "proofread" ? "应用建议" : "应用替换";
  const hasCandidateText = Boolean(taskStore.candidate?.generatedText.trim());
  const statusText = useMemo(() => {
    if (taskStore.busy) {
      return "处理中";
    }
    return taskStore.task ? taskStatusLabels[taskStore.task.status] : "等待选区";
  }, [taskStore.busy, taskStore.error, taskStore.task]);
  const errorPanel = taskStore.error ? (
    <div className="task-error-panel" role="alert">
      <b>{taskErrorTitle(taskStore.error, taskType)}</b>
      <p>{taskStore.error}</p>
      {taskErrorHint(taskStore.error) ? <p className="task-error-hint">{taskErrorHint(taskStore.error)}</p> : null}
      {isAiSettingsError(taskStore.error) ? (
        <Button onClick={() => onOpenSettings("AI 服务")} type="button" variant="secondary">
          打开 AI 服务设置
        </Button>
      ) : null}
    </div>
  ) : null;

  if (taskType === "proofread" && taskStore.candidate) {
    if (isCleanProofreadCandidate(taskStore.candidate)) {
      return (
        <div className="task-card">
          <h2 className="task-title">
            当前任务 <span className="mini-tag">校对</span>
          </h2>
          <div className="task-meta">
            <div>状态：{statusText}</div>
            <div>当前章节：{currentChapterTitle ?? "未选择章节"}</div>
          </div>
          {errorPanel}
          <div className="proofread-clean-state">
            <b>未发现明显问题</b>
            <p>当前选区没有可应用的校对建议，原文可以保持不变。</p>
          </div>
          <label className="field-label">原文节选</label>
          <div className="preview-box">{selectedText}</div>
          <div className="small-actions">
            <button className="small-button" disabled={taskStore.busy || !taskStore.task} onClick={() => void taskStore.generatePreview()} type="button">重新校对</button>
            <button className="small-button blue" disabled={taskStore.busy} onClick={() => void taskStore.rejectCandidate()} type="button">关闭结果</button>
          </div>
        </div>
      );
    }

    return (
      <div className="task-card">
        <h2 className="task-title">
          当前任务 <span className="mini-tag">校对</span>
        </h2>
        <div className="task-meta">
          <div>状态：{statusText}</div>
          <div>当前章节：{currentChapterTitle ?? "未选择章节"}</div>
        </div>
        {errorPanel}
        <div className="issue">
          <div className="issue-head">
            <span className="issue-number">1</span>
            <span className="mini-tag">{candidateStatusLabels[taskStore.candidate.status]}</span>
          </div>
          <p>原句：{selectedText}</p>
          <p>建议：{taskStore.candidate.generatedText || taskStore.candidate.changeSummary || "无可应用建议"}</p>
          <div className="small-actions">
            <button className="small-button blue" disabled={!hasCandidateText} onClick={() => void taskStore.applyCandidate("apply_proofread_suggestion")} type="button">应用</button>
            <button className="small-button" disabled={!hasCandidateText} onClick={() => void taskStore.saveCandidateToScratchpad()} type="button">加入草稿纸</button>
            <button className="small-button" onClick={() => void taskStore.rejectCandidate()} type="button">忽略</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="task-card">
      <h2 className="task-title">
        当前任务 <span className="mini-tag">{label}</span>
      </h2>
      <div className="task-meta">
        <div>状态：{statusText}</div>
        <div>当前章节：{currentChapterTitle ?? "未选择章节"}</div>
        <div>目标：当前选区</div>
      </div>
      {errorPanel}
      <label className="field-label">自定义要求</label>
      <Textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} />
      <label className="field-label">原文节选</label>
      <div className="preview-box">{selectedText}</div>
      <label className="field-label">预览结果</label>
      <div className="preview-box result">{taskStore.candidate?.generatedText || taskStore.candidate?.changeSummary || "尚未生成预览。"}</div>
      <div className="task-actions">
        <Button disabled={!taskStore.task || taskStore.busy} onClick={() => void taskStore.generatePreview()} variant="ghost">
          {taskStore.candidate ? "重新生成" : "生成预览"}
        </Button>
        <Button disabled={!taskStore.candidate || taskStore.busy} onClick={() => void taskStore.rejectCandidate()} variant="ghost">
          忽略候选
        </Button>
        <Button disabled={!taskStore.candidate || !hasCandidateText || taskStore.busy} onClick={() => void taskStore.saveCandidateToScratchpad()} variant="ghost">
          加入草稿纸
        </Button>
        {taskType === "expand" ? (
          <Button disabled={!taskStore.candidate || !hasCandidateText || taskStore.busy} onClick={() => void taskStore.applyCandidate("replace_selection")} variant="ghost">
            替换原文
          </Button>
        ) : null}
        <Button disabled={!taskStore.candidate || !hasCandidateText || taskStore.busy} onClick={() => void taskStore.applyCandidate(applyModeForTask(taskType))} variant="primary">
          {primaryLabel}
        </Button>
      </div>
    </div>
  );
}
