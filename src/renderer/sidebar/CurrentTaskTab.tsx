import { useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Check, CopySimple } from "@phosphor-icons/react";
import { proofreadIssueLabels, type ProofreadIssue } from "../../main/shared/proofread";
import type { SelectionSnapshot, TaskPromptPreset, TaskType } from "../../main/shared/types";
import { Button } from "../components/Button";
import { IconButton } from "../components/IconButton";
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
  polish: "按原文风格轻量润色，优先处理拗口、重复和节奏问题。",
  expand: "把原片段扩写为可替换原选区的完整版本，保持当前场景和人物认知。",
  proofread: "按校对规则检查明确问题；不确定的逻辑风险标记为需要作者判断。",
  continue: "从当前最后一句自然接续，只生成插入选区下方的新正文。"
};

function initialInstructionForTask(taskType: TaskType, taskPromptPreset: TaskPromptPreset | null): string {
  return taskPromptPreset ? "" : defaultInstruction[taskType];
}

function applyModeForTask(taskType: TaskType) {
  if (taskType === "continue") {
    return "insert_below" as const;
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
  return error.includes("finish_reason: length") || error.includes("被截断") || error.includes("结果已截断");
}

function isOpenRouterRateLimitError(error: string): boolean {
  return error.includes("OpenRouter 请求失败 (429)") || error.includes("rate limited") || error.includes("Rate limit");
}

const proofreadSeverityLabels: Record<ProofreadIssue["severity"], string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重"
};

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

function taskErrorHint(error: string, taskType: TaskType): string | null {
  if (isAiSettingsError(error)) {
    return "请先填写 OpenRouter API Key 和模型名称，并测试保存。";
  }
  if (isOpenRouterRateLimitError(error)) {
    return "当前模型或上游 Provider 正在限流。请稍后重试，或在 AI 服务设置中换用其他模型。";
  }
  if (isTruncatedAiOutputError(error)) {
    return taskType === "proofread"
      ? "模型已返回结果，但校对内容被截断。请缩短选区后重试。"
      : "模型已返回部分结果。可以点击继续生成，或缩短选区后重新生成。";
  }
  return null;
}

function formatProofreadIssueDraft(issue: ProofreadIssue): string {
  const label = proofreadIssueLabels[issue.code];
  const lines = [
    `校对建议：${label}｜${proofreadSeverityLabels[issue.severity]}`,
    `原文片段：${issue.quote || "未提供"}`,
    `位置：${issue.locationHint || "未提供"}`,
    `建议改法：${issue.suggestion || "未提供"}`,
    `说明：${issue.explanation || "未提供"}`
  ];
  if (issue.suggestedReplacement) {
    lines.push(`建议替换：${issue.suggestedReplacement}`);
  }
  if (issue.evidence.length) {
    lines.push(`证据：${issue.evidence.map((item) => `${item.note}：${item.quote}`).join("；")}`);
  }
  lines.push(`处理方式：${issue.canAutoApply ? "建议替换可作为手动修改参考" : "仅供诊断，建议作者手动判断"}${issue.needsAuthorJudgment ? "，需要作者判断" : ""}`);
  return lines.join("\n");
}

function formatAllProofreadIssues(issues: readonly ProofreadIssue[]): string {
  if (issues.length === 0) {
    return "未发现明显问题。";
  }

  return issues.map((issue, index) => `${index + 1}. ${formatProofreadIssueDraft(issue)}`).join("\n\n");
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
  const [copiedCandidate, setCopiedCandidate] = useState(false);
  const [copiedAllProofread, setCopiedAllProofread] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  useEffect(() => {
    setInstruction(initialInstructionForTask(taskType, taskPromptPreset));
    setCopiedIssueIndex(null);
    setCopiedCandidate(false);
    setCopiedAllProofread(false);
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
  const primaryLabel = taskType === "expand" ? "替换原文" : taskType === "continue" ? "插入下方" : "应用替换";
  const hasCandidateText = Boolean(taskStore.candidate?.generatedText.trim());
  const candidateCopyText = taskStore.streamingText || taskStore.candidate?.generatedText || taskStore.task?.outputText || "";
  const partialTruncatedText = taskStore.streamingText || taskStore.task?.outputText || "";
  const canContinueTruncated = Boolean(taskStore.task && taskStore.error?.includes("截断") && partialTruncatedText.trim() && taskType !== "proofread");
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
      {taskErrorHint(taskStore.error, taskType) ? <p className="task-error-hint">{taskErrorHint(taskStore.error, taskType)}</p> : null}
      {isAiSettingsError(taskStore.error) ? (
        <Button onClick={() => onOpenSettings("AI 服务")} type="button" variant="secondary">
          打开 AI 服务设置
        </Button>
      ) : null}
    </div>
  ) : null;
  const copyErrorPanel = copyError ? (
    <div className="task-error-panel" role="alert">
      <b>复制失败</b>
      <p>{copyError}</p>
    </div>
  ) : null;

  function markCopied(type: "candidate" | "proofread-all" | "proofread-issue", issueIndex?: number): void {
    if (type === "candidate") {
      setCopiedCandidate(true);
      window.setTimeout(() => setCopiedCandidate(false), 1600);
      return;
    }

    if (type === "proofread-all") {
      setCopiedAllProofread(true);
      window.setTimeout(() => setCopiedAllProofread(false), 1600);
      return;
    }

    if (typeof issueIndex === "number") {
      setCopiedIssueIndex(issueIndex);
      window.setTimeout(() => {
        setCopiedIssueIndex((current) => (current === issueIndex ? null : current));
      }, 1600);
    }
  }

  async function copyText(text: string, onCopied: () => void): Promise<void> {
    setCopyError(null);
    if (!navigator.clipboard) {
      setCopyError("系统剪贴板不可用。");
      return;
    }

    const trimmedText = text.trim();
    if (!trimmedText) {
      setCopyError("当前没有可复制的内容。");
      return;
    }

    try {
      await navigator.clipboard.writeText(trimmedText);
      onCopied();
    } catch (reason) {
      setCopyError(reason instanceof Error ? reason.message : "复制失败");
    }
  }

  async function copyGeneratedCandidate(): Promise<void> {
    await copyText(candidateCopyText, () => markCopied("candidate"));
  }

  async function copyAllProofreadIssues(issues: readonly ProofreadIssue[]): Promise<void> {
    await copyText(formatAllProofreadIssues(issues), () => markCopied("proofread-all"));
  }

  async function copyProofreadIssue(issue: ProofreadIssue, issueIndex: number): Promise<void> {
    await copyText(formatProofreadIssueDraft(issue), () => markCopied("proofread-issue", issueIndex));
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
        <div className="field-label-row">
          <label className="field-label">校对发现</label>
          <IconButton
            className={`copy-icon-button ${copiedAllProofread ? "copied" : ""}`}
            disabled={taskStore.busy || !taskStore.candidate || taskStore.candidate.proofreadIssues === null}
            label="复制全部校对结果"
            onClick={() => void copyAllProofreadIssues(proofreadIssues)}
          >
            {copiedAllProofread ? <Check size={17} weight="bold" /> : <CopySimple size={17} />}
          </IconButton>
        </div>
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
              <div className="issue proofread-issue-card" key={`${issue.code}-${index}`}>
                <div className="issue-head">
                  <div className="proofread-issue-primary">
                    <span className="issue-number">{index + 1}</span>
                    <div>
                      <b>{proofreadIssueLabels[issue.code]}</b>
                      <span>{issue.locationHint || "未提供位置"}</span>
                    </div>
                  </div>
                  <div className="issue-meta-row">
                    <span className="mini-tag subtle">{proofreadSeverityLabels[issue.severity]}</span>
                    {issue.needsAuthorJudgment ? <span className="mini-tag warning">需要作者判断</span> : null}
                  </div>
                </div>
                <div className="issue-body">
                  <div>
                    <span className="issue-label">原文片段</span>
                    <p>{issue.quote || selectedText}</p>
                  </div>
                  <div>
                    <span className="issue-label">位置</span>
                    <p>{issue.locationHint || "未提供"}</p>
                  </div>
                  <div>
                    <span className="issue-label">建议改法</span>
                    <p>{issue.suggestion || "未提供"}</p>
                  </div>
                  <div>
                    <span className="issue-label">说明</span>
                    <p>{issue.explanation || "未提供"}</p>
                  </div>
                  {issue.suggestedReplacement ? (
                    <div>
                      <span className="issue-label">建议替换</span>
                      <p>{issue.suggestedReplacement}</p>
                    </div>
                  ) : null}
                  {issue.evidence.length ? (
                    <div>
                      <span className="issue-label">证据</span>
                      <ul className="issue-evidence-list">
                        {issue.evidence.map((item, evidenceIndex) => (
                          <li key={`${item.source}-${evidenceIndex}`}>
                            <b>{item.note}</b>
                            <span>{item.quote}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div>
                    <span className="issue-label">处理方式</span>
                    <p>
                      {issue.canAutoApply ? "建议替换可作为手动修改参考" : "仅供诊断，建议作者手动判断"}
                      {issue.needsAuthorJudgment ? "，需要作者判断" : ""}
                    </p>
                  </div>
                </div>
                <div className="small-actions">
                  <IconButton
                    className={`copy-icon-button ${copiedIssueIndex === index ? "copied" : ""}`}
                    disabled={taskStore.busy}
                    label="复制这条校对建议"
                    onClick={() => void copyProofreadIssue(issue, index)}
                  >
                    {copiedIssueIndex === index ? <Check size={17} weight="bold" /> : <CopySimple size={17} />}
                  </IconButton>
                  <button className="small-button" disabled={taskStore.busy} onClick={() => void taskStore.saveTextToScratchpad(formatProofreadIssueDraft(issue))} type="button">加入草稿纸</button>
                  {copiedIssueIndex === index ? <span className="issue-copy-status">已复制</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="task-actions two">
          {taskStore.busy ? (
            <Button onClick={() => taskStore.cancelActiveStream()} variant="secondary">
              停止生成
            </Button>
          ) : null}
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
      <div className="field-label-row">
        <label className="field-label">预览结果</label>
        <IconButton
          className={`copy-icon-button ${copiedCandidate ? "copied" : ""}`}
          disabled={!candidateCopyText.trim()}
          label="复制候选正文"
          onClick={() => void copyGeneratedCandidate()}
        >
          {copiedCandidate ? <Check size={17} weight="bold" /> : <CopySimple size={17} />}
        </IconButton>
      </div>
      <div className="preview-box result">
        {taskStore.streamingText ? (
          <>
            <span className="streaming-label">AI 正在生成</span>
            {taskStore.streamingText}
          </>
        ) : (
          taskStore.candidate?.generatedText || taskStore.candidate?.changeSummary || taskStore.task?.outputText || "尚未生成预览。"
        )}
      </div>
      <div className="task-actions">
        {taskStore.busy ? (
          <Button onClick={() => taskStore.cancelActiveStream()} variant="secondary">
            停止生成
          </Button>
        ) : null}
        <Button disabled={!taskStore.task || taskStore.busy} onClick={() => void taskStore.generatePreview()} variant="ghost">
          {taskStore.candidate ? "重新生成" : "生成预览"}
        </Button>
        {canContinueTruncated ? (
          <Button disabled={taskStore.busy} onClick={() => void taskStore.continuePreview()} variant="ghost">
            继续生成
          </Button>
        ) : null}
        <Button disabled={!taskStore.candidate || taskStore.busy} onClick={() => void taskStore.rejectCandidate()} variant="ghost">
          忽略候选
        </Button>
        <Button disabled={!taskStore.candidate || !hasCandidateText || taskStore.busy} onClick={() => void taskStore.saveCandidateToScratchpad()} variant="ghost">
          加入草稿纸
        </Button>
        <Button disabled={!taskStore.candidate || !hasCandidateText || taskStore.busy} onClick={() => void taskStore.applyCandidate(applyModeForTask(taskType))} variant="primary">
          {primaryLabel}
        </Button>
      </div>
    </div>
  );
}
