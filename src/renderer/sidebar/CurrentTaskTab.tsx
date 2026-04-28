import { useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { ProofreadIssue } from "../../main/shared/proofread";
import type { SelectionSnapshot, TaskPromptPreset, TaskType } from "../../main/shared/types";
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
  readonly taskPromptPreset: TaskPromptPreset | null;
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

function initialInstructionForTask(taskType: TaskType, taskPromptPreset: TaskPromptPreset | null): string {
  return taskPromptPreset ? "" : defaultInstruction[taskType];
}

function applyModeForTask(taskType: TaskType) {
  if (taskType === "expand") {
    return "insert_below" as const;
  }
  if (taskType === "continue") {
    return "insert_at_cursor" as const;
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

function isOpenRouterRateLimitError(error: string): boolean {
  return error.includes("OpenRouter 请求失败 (429)") || error.includes("rate limited") || error.includes("Rate limit");
}

function taskErrorTitle(error: string, taskType: TaskType): string {
  if (isAiSettingsError(error)) {
    return "AI 服务未配置";
  }
  if (isOpenRouterRateLimitError(error)) {
    return "OpenRouter 请求被限流";
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
  if (isOpenRouterRateLimitError(error)) {
    return "当前模型或上游 Provider 正在限流。请稍后重试，或在 AI 服务设置中换用其他模型。";
  }
  if (isTruncatedAiOutputError(error)) {
    return "模型已返回结果，但内容被截断。请缩短选区，或换用输出额度更高的模型后重试。";
  }
  return null;
}

function formatProofreadIssueDraft(issue: ProofreadIssue): string {
  return [
    `校对建议：${issue.type}`,
    `原文片段：${issue.quote || "未提供"}`,
    `建议改法：${issue.suggestion || "未提供"}`,
    `原因：${issue.reason || "未提供"}`
  ].join("\n");
}

export function CurrentTaskTab({
  chapterId,
  currentChapterTitle,
  projectId,
  selectionSnapshot,
  taskPromptPreset,
  taskType,
  editor,
  flushPendingSave,
  onOpenSettings
}: CurrentTaskTabProps) {
  const [instruction, setInstruction] = useState(initialInstructionForTask(taskType, taskPromptPreset));
  const [copiedIssueIndex, setCopiedIssueIndex] = useState<number | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  useEffect(() => {
    setInstruction(initialInstructionForTask(taskType, taskPromptPreset));
    setCopiedIssueIndex(null);
    setCopyError(null);
  }, [taskType, taskPromptPreset?.id, selectionSnapshot?.selectionHash]);

  const selectedText = selectionSnapshot?.text ?? "请先在正文中选中文本，再从选区工具条选择 AI 任务。";
  const label = taskLabels[taskType];
  const taskStore = useTaskStore({
    projectId,
    chapterId,
    taskType,
    presetId: taskPromptPreset?.id ?? null,
    selectionSnapshot,
    instruction,
    editor,
    flushPendingSave
  });
  const primaryLabel = taskType === "expand" ? "插入下方" : taskType === "continue" ? "插入到光标处" : "应用替换";
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
  const copyErrorPanel = copyError ? (
    <div className="task-error-panel" role="alert">
      <b>复制建议失败</b>
      <p>{copyError}</p>
    </div>
  ) : null;

  async function copyProofreadIssue(issue: ProofreadIssue, issueIndex: number): Promise<void> {
    setCopyError(null);
    if (!navigator.clipboard) {
      setCopyError("系统剪贴板不可用。");
      return;
    }

    try {
      await navigator.clipboard.writeText(formatProofreadIssueDraft(issue));
      setCopiedIssueIndex(issueIndex);
    } catch (reason) {
      setCopyError(reason instanceof Error ? reason.message : "复制建议失败");
    }
  }

  if (taskType === "proofread") {
    const proofreadIssues = taskStore.candidate?.proofreadIssues ?? [];
    return (
      <div className="task-card">
        <h2 className="task-title">
          当前任务 <span className="mini-tag">校对</span>
        </h2>
        <div className="task-meta">
          <div>状态：{statusText}</div>
          <div>当前章节：{currentChapterTitle ?? "未选择章节"}</div>
          {taskStore.candidate ? <div>结果：{candidateStatusLabels[taskStore.candidate.status]}</div> : null}
        </div>
        {errorPanel}
        {copyErrorPanel}
        <label className="field-label">本次要求</label>
        <Textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} />
        <label className="field-label">原文节选</label>
        <div className="preview-box">{selectedText}</div>
        <label className="field-label">校对发现</label>
        {taskStore.busy && !taskStore.candidate ? (
          <div className="preview-box result" role="status">AI 正在生成校对结果...</div>
        ) : !taskStore.candidate ? (
          <div className="preview-box result">尚未开始校对。</div>
        ) : taskStore.candidate.proofreadIssues === null ? (
          <div className="task-error-panel" role="alert">
            <b>校对结果格式不完整</b>
            <p>当前候选没有结构化校对问题，请重新校对。</p>
          </div>
        ) : proofreadIssues.length === 0 ? (
          <div className="proofread-clean-state">
            <b>未发现明显问题</b>
            <p>当前选区没有明确的校对建议，原文可以保持不变。</p>
          </div>
        ) : (
          <div className="proofread-issue-list">
            {proofreadIssues.map((issue, index) => (
              <div className="issue" key={`${issue.type}-${index}`}>
                <div className="issue-head">
                  <span className="issue-number">{index + 1}</span>
                  <span className="mini-tag">{issue.type}</span>
                </div>
                <div className="issue-body">
                  <div>
                    <span className="issue-label">原文片段</span>
                    <p>{issue.quote || selectedText}</p>
                  </div>
                  <div>
                    <span className="issue-label">建议改法</span>
                    <p>{issue.suggestion || "未提供"}</p>
                  </div>
                  <div>
                    <span className="issue-label">原因</span>
                    <p>{issue.reason || "未提供"}</p>
                  </div>
                </div>
                <div className="small-actions">
                  <button className="small-button blue" disabled={taskStore.busy} onClick={() => void copyProofreadIssue(issue, index)} type="button">复制建议</button>
                  <button className="small-button" disabled={taskStore.busy} onClick={() => void taskStore.saveTextToScratchpad(formatProofreadIssueDraft(issue))} type="button">加入草稿纸</button>
                  {copiedIssueIndex === index ? <span className="issue-copy-status">已复制</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="task-actions two">
          <Button disabled={!taskStore.task || taskStore.busy} onClick={() => void taskStore.generatePreview()} variant="ghost">
            {taskStore.candidate ? "重新校对" : "开始校对"}
          </Button>
          <Button disabled={!taskStore.candidate || taskStore.busy} onClick={() => void taskStore.rejectCandidate()} variant="secondary">
            关闭结果
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="task-card">
      <h2 className="task-title">
        当前任务 <span className="mini-tag">{label}</span>
        {taskPromptPreset ? <span className="mini-tag">{taskPromptPreset.name}</span> : null}
      </h2>
      <div className="task-meta">
        <div>状态：{statusText}</div>
        <div>当前章节：{currentChapterTitle ?? "未选择章节"}</div>
        <div>目标：当前选区</div>
      </div>
      {errorPanel}
      {taskPromptPreset ? (
        <>
          <label className="field-label">预设要求</label>
          <div className="preview-box preset-preview">{taskPromptPreset.instruction}</div>
        </>
      ) : null}
      <label className="field-label">本次要求</label>
      <Textarea
        value={instruction}
        placeholder={taskPromptPreset ? "可选：只补充这一次任务的要求，不会改动预设。" : undefined}
        onChange={(event) => setInstruction(event.target.value)}
      />
      <label className="field-label">原文节选</label>
      <div className="preview-box">{selectedText}</div>
      <label className="field-label">预览结果</label>
      <div className="preview-box result">
        {taskStore.streamingText ? (
          <>
            <span className="streaming-label">AI 正在生成</span>
            {taskStore.streamingText}
          </>
        ) : (
          taskStore.candidate?.generatedText || taskStore.candidate?.changeSummary || "尚未生成预览。"
        )}
      </div>
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
