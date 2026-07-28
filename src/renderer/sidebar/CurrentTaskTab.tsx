import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenText, Check, CheckCircle, Circle, CopySimple, SpinnerGap, StopCircle, WarningCircle } from "@phosphor-icons/react";
import { proofreadIssueLabels, proofreadIssueLabelsJa, type ProofreadIssue } from "../../main/shared/proofread";
import type { SelectionSnapshot, TaskPromptPreset, TaskType } from "../../main/shared/types";
import { Button } from "../components/Button";
import { IconButton } from "../components/IconButton";
import { Textarea } from "../components/Textarea";
import type { SettingsCategory } from "../routes/SettingsPage";
import { candidateStatusLabels, taskLabels, taskStatusLabels } from "../state/sidebar-store";
import { buildTaskExecutionSteps, type TaskExecutionPhase, type TaskExecutionStepStatus } from "../state/task-execution";
import type { TaskStore } from "../state/task-store";
import { useI18n } from "../i18n";

type CurrentTaskTabProps = {
  readonly currentChapterTitle: string | null;
  readonly instruction: string;
  readonly selectionSnapshot: SelectionSnapshot | null;
  readonly taskPromptPreset: TaskPromptPreset | null;
  readonly taskStore: TaskStore;
  readonly taskRunId: number | null;
  readonly taskType: TaskType;
  readonly onInstructionChange: (instruction: string) => void;
  readonly onOpenSettings: (category?: SettingsCategory) => void;
};

const defaultInstruction: Record<TaskType, string> = {
  polish: "按原文风格轻量润色，优先处理拗口、重复和节奏问题。",
  expand: "把原片段扩写为可替换原选区的完整版本，保持当前场景和人物认知。",
  proofread: "按校对规则检查明确问题；不确定的逻辑风险标记为需要作者判断。",
  continue: "从当前最后一句自然接续，只生成插入选区下方的新正文。"
};

const defaultInstructionJa: Record<TaskType, string> = {
  polish: "原文の文体を保ちながら軽く推敲し、読みにくさ、重複、リズムを優先して整えてください。",
  expand: "現在の場面と人物の認識を保ち、選択範囲を置き換えられる完成した文章へ加筆してください。",
  proofread: "明確な問題を校正し、断定できない論理上の懸念は作者の判断が必要だと示してください。",
  continue: "現在の最後の一文から自然に続け、選択範囲の下へ挿入する新しい本文だけを生成してください。"
};

export function initialInstructionForTask(taskType: TaskType, taskPromptPreset: TaskPromptPreset | null, japanese = false): string {
  return taskPromptPreset ? "" : (japanese ? defaultInstructionJa : defaultInstruction)[taskType];
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

const proofreadSeverityLabelsJa: Record<ProofreadIssue["severity"], string> = {
  low: "低", medium: "中", high: "高", critical: "重大"
};

function taskErrorTitle(error: string, taskType: TaskType, japanese: boolean): string {
  if (isAiSettingsError(error)) {
    return japanese ? "AI サービスが未設定です" : "AI 服务未配置";
  }
  if (isOpenRouterRateLimitError(error)) {
    return japanese ? "OpenRouter のレート制限に達しました" : "OpenRouter 请求被限流";
  }
  if (isTruncatedAiOutputError(error)) {
    return japanese ? (taskType === "proofread" ? "校正結果が途中で切れました" : "AI の出力が途中で切れました") : taskType === "proofread" ? "校对结果被截断" : "AI 输出被截断";
  }
  return japanese ? "AI タスクに失敗しました" : "AI 任务失败";
}

function taskErrorHint(error: string, taskType: TaskType, japanese: boolean): string | null {
  if (isAiSettingsError(error)) {
    return japanese ? "OpenRouter API キーとモデル名を入力し、接続テスト後に保存してください。" : "请先填写 OpenRouter API Key 和模型名称，并测试保存。";
  }
  if (isOpenRouterRateLimitError(error)) {
    return japanese ? "現在のモデルまたは上流プロバイダーが制限中です。しばらく待つか、AI サービス設定で別のモデルを選んでください。" : "当前模型或上游 Provider 正在限流。请稍后重试，或在 AI 服务设置中换用其他模型。";
  }
  if (isTruncatedAiOutputError(error)) {
    return japanese
      ? taskType === "proofread" ? "校正結果の一部は返されましたが途中で切れています。選択範囲を短くして再試行してください。" : "一部の結果は返されています。続きを生成するか、選択範囲を短くして再生成してください。"
      : taskType === "proofread" ? "模型已返回结果，但校对内容被截断。请缩短选区后重试。" : "模型已返回部分结果。可以点击继续生成，或缩短选区后重新生成。";
  }
  return null;
}

function formatProofreadIssueDraft(issue: ProofreadIssue, japanese = false): string {
  const label = japanese ? proofreadIssueLabelsJa[issue.code] : proofreadIssueLabels[issue.code];
  const severity = japanese ? proofreadSeverityLabelsJa[issue.severity] : proofreadSeverityLabels[issue.severity];
  if (japanese) {
    const lines = [
      `校正提案：${label}｜${severity}`,
      `原文：${issue.quote || "未記載"}`,
      `位置：${issue.locationHint || "未記載"}`,
      `修正案：${issue.suggestion || "未記載"}`,
      `説明：${issue.explanation || "未記載"}`
    ];
    if (issue.suggestedReplacement) lines.push(`置換候補：${issue.suggestedReplacement}`);
    if (issue.evidence.length) lines.push(`根拠：${issue.evidence.map((item) => `${item.note}：${item.quote}`).join("；")}`);
    lines.push(`扱い：${issue.canAutoApply ? "手動修正の参考にできます" : "診断のみ。作者が判断してください"}${issue.needsAuthorJudgment ? "。作者の判断が必要です" : ""}`);
    return lines.join("\n");
  }
  const lines = [
    `校对建议：${label}｜${severity}`,
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

function formatAllProofreadIssues(issues: readonly ProofreadIssue[], japanese = false): string {
  if (issues.length === 0) {
    return japanese ? "明確な問題は見つかりませんでした。" : "未发现明显问题。";
  }

  return issues.map((issue, index) => `${index + 1}. ${formatProofreadIssueDraft(issue, japanese)}`).join("\n\n");
}

function TaskStepIcon({ status }: { readonly status: TaskExecutionStepStatus }) {
  if (status === "complete") return <CheckCircle size={17} weight="fill" />;
  if (status === "active") return <SpinnerGap className="agent-process-spinner" size={17} weight="bold" />;
  if (status === "error") return <WarningCircle size={17} weight="fill" />;
  if (status === "stopped") return <StopCircle size={17} weight="fill" />;
  return <Circle size={15} />;
}

function TaskExecutionProgress({
  hasSelection,
  japanese,
  phase,
  taskType
}: {
  readonly hasSelection: boolean;
  readonly japanese: boolean;
  readonly phase: TaskExecutionPhase;
  readonly taskType: TaskType;
}) {
  const steps = buildTaskExecutionSteps(phase, hasSelection);
  const taskName = japanese
    ? { polish: "推敲", expand: "加筆", proofread: "校正", continue: "続きを書く" }[taskType]
    : taskLabels[taskType];
  const labels = japanese
    ? {
        selection: hasSelection ? "選択範囲を受け取りました" : "本文の選択を待っています",
        setup: "タスクと参照範囲を準備",
        generation: `${taskName}の結果を生成`,
        result: "結果を確認して次の操作を選択",
        idle: "開始準備中",
        creating: "タスクを作成しています",
        preparing: "本文を保存し、参照範囲を準備しています",
        ready: "タスクの準備ができました",
        requesting: "モデルへ送信し、応答を待っています",
        streaming: "モデルから内容を受信しています",
        finalizing: "結果を整理しています",
        complete: "結果を確認できます",
        canceling: "生成を停止しています",
        canceled: "生成を停止しました",
        error: "処理中にエラーが発生しました"
      }
    : {
        selection: hasSelection ? "已接收选区" : "等待选择正文",
        setup: "准备任务与参考范围",
        generation: `生成${taskName}结果`,
        result: "检查结果并选择下一步",
        idle: "正在准备启动",
        creating: "正在创建任务",
        preparing: "正在保存正文并准备参考范围",
        ready: "任务已准备完成",
        requesting: "已发送给模型，正在等待响应",
        streaming: "正在接收模型生成内容",
        finalizing: "正在整理生成结果",
        complete: "结果已就绪，可以继续处理",
        canceling: "正在停止生成",
        canceled: "生成已停止",
        error: "任务执行失败"
      };
  const completedCount = steps.filter((step) => step.status === "complete").length;

  return (
    <section className={`task-execution-progress phase-${phase}`} aria-label={japanese ? "タスクの実行状況" : "任务执行状态"}>
      <header className="task-execution-progress-head">
        <span className={`task-execution-pulse ${phase}`} aria-hidden="true" />
        <div>
          <strong>{labels[phase]}</strong>
          <small>{japanese ? `${completedCount} / ${steps.length} ステップ` : `${completedCount} / ${steps.length} 阶段`}</small>
        </div>
      </header>
      <div className="task-execution-progress-track" aria-hidden="true">
        <span style={{ transform: `scaleX(${completedCount / steps.length})` }} />
      </div>
      <ol className="task-execution-step-list" aria-live="polite">
        {steps.map((step) => (
          <li className={step.status} key={step.id}>
            <span aria-hidden="true"><TaskStepIcon status={step.status} /></span>
            <span>{labels[step.id]}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function CurrentTaskTab({
  currentChapterTitle,
  instruction,
  selectionSnapshot,
  taskPromptPreset,
  taskStore,
  taskRunId,
  taskType,
  onInstructionChange,
  onOpenSettings
}: CurrentTaskTabProps) {
  const { t, locale } = useI18n();
  const japanese = locale === "ja-JP";
  const ui = japanese
    ? {
        selectTextFirst: "先に本文を選択し、選択ツールバーから AI 操作を選んでください。", replaceOriginal: "原文を置換", insertBelow: "下に挿入", applyReplacement: "置換を適用",
        processing: "処理中", waitingSelection: "選択待ち", openAiSettings: "AI サービス設定を開く", copyFailed: "コピーに失敗しました",
        clipboardUnavailable: "システムのクリップボードを利用できません。", noCopyContent: "コピーできる内容がありません。", currentTask: "現在のタスク",
        status: "状態", currentChapter: "現在の章", noSelectedChapter: "章が選択されていません", result: "結果", request: "今回の要望",
        originalExcerpt: "原文の抜粋", proofreadFindings: "校正結果", copyAllProofread: "校正結果をすべてコピー", generatingProofread: "AI が校正結果を生成しています...",
        proofreadNotStarted: "校正はまだ開始されていません。", incompleteProofread: "校正結果の形式が不完全です", incompleteProofreadHint: "構造化された校正項目がありません。もう一度校正してください。",
        noIssues: "明確な問題は見つかりませんでした", noIssuesHint: "現在の選択範囲に明確な校正提案はありません。原文を維持できます。",
        noLocation: "位置未記載", authorJudgment: "作者の判断が必要", quote: "原文", location: "位置", suggestion: "修正案", explanation: "説明",
        replacement: "置換候補", evidence: "根拠", handling: "扱い", manualReference: "置換候補を手動修正の参考にできます", diagnosisOnly: "診断のみ。作者が判断してください",
        copyIssue: "この校正提案をコピー", addScratchpad: "下書きメモへ追加", copied: "コピー済み", stopGeneration: "生成を停止", reproofread: "再校正",
        startProofread: "校正を開始", closeResult: "結果を閉じる", target: "対象", currentSelection: "現在の選択範囲", presetRequest: "プリセットの要望",
        optionalRequest: "任意：今回だけの追加要望です。プリセットは変更されません。", previewResult: "プレビュー結果", copyCandidate: "本文候補をコピー",
        generating: "AI が生成しています", noPreview: "プレビューはまだありません。", regenerate: "再生成", generatePreview: "プレビューを生成", continueGeneration: "続きを生成",
        ignoreCandidate: "候補を破棄"
      }
    : {
        selectTextFirst: "请先在正文中选中文本，再从选区工具条选择 AI 任务。", replaceOriginal: "替换原文", insertBelow: "插入下方", applyReplacement: "应用替换",
        processing: "处理中", waitingSelection: "等待选区", openAiSettings: "打开 AI 服务设置", copyFailed: "复制失败",
        clipboardUnavailable: "系统剪贴板不可用。", noCopyContent: "当前没有可复制的内容。", currentTask: "当前任务",
        status: "状态", currentChapter: "当前章节", noSelectedChapter: "未选择章节", result: "结果", request: "本次要求",
        originalExcerpt: "原文节选", proofreadFindings: "校对发现", copyAllProofread: "复制全部校对结果", generatingProofread: "AI 正在生成校对结果...",
        proofreadNotStarted: "尚未开始校对。", incompleteProofread: "校对结果格式不完整", incompleteProofreadHint: "当前候选没有结构化校对问题，请重新校对。",
        noIssues: "未发现明显问题", noIssuesHint: "当前选区没有明确的校对建议，原文可以保持不变。",
        noLocation: "未提供位置", authorJudgment: "需要作者判断", quote: "原文片段", location: "位置", suggestion: "建议改法", explanation: "说明",
        replacement: "建议替换", evidence: "证据", handling: "处理方式", manualReference: "建议替换可作为手动修改参考", diagnosisOnly: "仅供诊断，建议作者手动判断",
        copyIssue: "复制这条校对建议", addScratchpad: "加入草稿纸", copied: "已复制", stopGeneration: "停止生成", reproofread: "重新校对",
        startProofread: "开始校对", closeResult: "关闭结果", target: "目标", currentSelection: "当前选区", presetRequest: "预设要求",
        optionalRequest: "可选：只补充这一次任务的要求，不会改动预设。", previewResult: "预览结果", copyCandidate: "复制候选正文",
        generating: "AI 正在生成", noPreview: "尚未生成预览。", regenerate: "重新生成", generatePreview: "生成预览", continueGeneration: "继续生成",
        ignoreCandidate: "忽略候选"
      };
  const localizedTaskLabels: Record<TaskType, string> = japanese
    ? { polish: "推敲", expand: "加筆", proofread: "校正", continue: "続きを書く" }
    : taskLabels;
  const localizedTaskStatusLabels: typeof taskStatusLabels = japanese
    ? { empty: "未設定", configured: "設定済み", generating: "生成中", preview_ready: "プレビュー完了", failed: "生成失敗", applied: "適用済み", inserted: "挿入済み", saved_to_scratchpad: "下書きメモへ追加済み" }
    : taskStatusLabels;
  const localizedCandidateStatusLabels: typeof candidateStatusLabels = japanese
    ? { preview: "プレビュー", applied: "置換済み", inserted: "挿入済み", rejected: "破棄済み", copied: "コピー済み", inserted_to_scratchpad: "下書きメモへ追加済み" }
    : candidateStatusLabels;
  const [copiedIssueIndex, setCopiedIssueIndex] = useState<number | null>(null);
  const [copiedCandidate, setCopiedCandidate] = useState(false);
  const [copiedAllProofread, setCopiedAllProofread] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const taskRootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setCopiedIssueIndex(null);
    setCopiedCandidate(false);
    setCopiedAllProofread(false);
    setCopyError(null);
  }, [japanese, taskType, taskPromptPreset?.id, selectionSnapshot?.selectionHash]);
  useEffect(() => {
    if (taskRunId === null) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      const scrollContainer = taskRootRef.current?.closest<HTMLElement>(".sidebar-content, .floating-panel-body");
      scrollContainer?.scrollTo({ top: 0 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [taskRunId]);

  const selectedText = selectionSnapshot?.text ?? ui.selectTextFirst;
  const label = localizedTaskLabels[taskType];
  const primaryLabel = taskType === "expand" ? ui.replaceOriginal : taskType === "continue" ? ui.insertBelow : ui.applyReplacement;
  const hasCandidateText = Boolean(taskStore.candidate?.generatedText.trim());
  const candidateCopyText = taskStore.streamingText || taskStore.candidate?.generatedText || taskStore.task?.outputText || "";
  const partialTruncatedText = taskStore.streamingText || taskStore.task?.outputText || "";
  const canContinueTruncated = Boolean(taskStore.task && taskStore.error?.includes("截断") && partialTruncatedText.trim() && taskType !== "proofread");
  const statusText = useMemo(() => {
    if (taskStore.busy) {
      return ui.processing;
    }
    return taskStore.task ? localizedTaskStatusLabels[taskStore.task.status] : ui.waitingSelection;
  }, [localizedTaskStatusLabels, taskStore.busy, taskStore.task, ui.processing, ui.waitingSelection]);
  const errorPanel = taskStore.error ? (
    <div className="task-error-panel" role="alert">
      <b>{taskErrorTitle(taskStore.error, taskType, japanese)}</b>
      <p>{taskStore.error}</p>
      {taskErrorHint(taskStore.error, taskType, japanese) ? <p className="task-error-hint">{taskErrorHint(taskStore.error, taskType, japanese)}</p> : null}
      {isAiSettingsError(taskStore.error) ? (
        <Button onClick={() => onOpenSettings("ai")} type="button" variant="secondary">
          {ui.openAiSettings}
        </Button>
      ) : null}
    </div>
  ) : null;
  const copyErrorPanel = copyError ? (
    <div className="task-error-panel" role="alert">
      <b>{ui.copyFailed}</b>
      <p>{copyError}</p>
    </div>
  ) : null;
  const executionProgress = (
    <TaskExecutionProgress
      hasSelection={Boolean(selectionSnapshot)}
      japanese={japanese}
      phase={taskStore.taskExecutionPhase}
      taskType={taskType}
    />
  );
  const contextPlan = taskStore.candidate?.writingContextPlan ?? null;
  const contextModeLabel = contextPlan
    ? japanese
      ? { direct: "直接文脈", summarized: "要約文脈", mixed: "混合文脈" }[contextPlan.mode]
      : { direct: "直接上下文", summarized: "摘要上下文", mixed: "混合上下文" }[contextPlan.mode]
    : null;
  const contextSummary = contextPlan ? (
    <details className="task-context-plan">
      <summary>
        <BookOpenText size={16} />
        <span>
          {japanese
            ? `参照範囲 ${contextPlan.supportingContext.length} 件 · ${contextModeLabel}`
            : `已使用 ${contextPlan.supportingContext.length} 项参考 · ${contextModeLabel}`}
        </span>
        <small>≈ {contextPlan.estimatedInputTokens.toLocaleString(japanese ? "ja-JP" : "zh-CN")} tokens</small>
      </summary>
      <p>{contextPlan.reason}</p>
      {contextPlan.supportingContext.length > 0 ? (
        <ul>
          {contextPlan.supportingContext.map((item, index) => (
            <li key={`${item.kind}-${index}`}>
              <strong>{item.label}</strong>
              <span>{item.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </details>
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
      setCopyError(ui.clipboardUnavailable);
      return;
    }

    const trimmedText = text.trim();
    if (!trimmedText) {
      setCopyError(ui.noCopyContent);
      return;
    }

    try {
      await navigator.clipboard.writeText(trimmedText);
      onCopied();
    } catch (reason) {
      setCopyError(reason instanceof Error ? reason.message : ui.copyFailed);
    }
  }

  async function copyGeneratedCandidate(): Promise<void> {
    await copyText(candidateCopyText, () => markCopied("candidate"));
  }

  async function copyAllProofreadIssues(issues: readonly ProofreadIssue[]): Promise<void> {
    await copyText(formatAllProofreadIssues(issues, japanese), () => markCopied("proofread-all"));
  }

  async function copyProofreadIssue(issue: ProofreadIssue, issueIndex: number): Promise<void> {
    await copyText(formatProofreadIssueDraft(issue, japanese), () => markCopied("proofread-issue", issueIndex));
  }

  if (taskType === "proofread") {
    const proofreadIssues = taskStore.candidate?.proofreadIssues ?? [];
    return (
      <div className="task-card" ref={taskRootRef}>
        <h2 className="task-title">
          {ui.currentTask} <span className="mini-tag">{localizedTaskLabels.proofread}</span>
        </h2>
        <div className="task-meta">
          <div>{ui.status}：{statusText}</div>
          <div>{ui.currentChapter}：{currentChapterTitle ?? ui.noSelectedChapter}</div>
          {taskStore.candidate ? <div>{ui.result}：{localizedCandidateStatusLabels[taskStore.candidate.status]}</div> : null}
        </div>
        {executionProgress}
        {contextSummary}
        {errorPanel}
        {copyErrorPanel}
        <label className="field-label">{ui.request}</label>
        <Textarea value={instruction} onChange={(event) => onInstructionChange(event.target.value)} />
        <label className="field-label">{ui.originalExcerpt}</label>
        <div className="preview-box">{selectedText}</div>
        <div className="field-label-row">
          <label className="field-label">{ui.proofreadFindings}</label>
          <IconButton
            className={`copy-icon-button ${copiedAllProofread ? "copied" : ""}`}
            disabled={taskStore.busy || !taskStore.candidate || taskStore.candidate.proofreadIssues === null}
            label={ui.copyAllProofread}
            onClick={() => void copyAllProofreadIssues(proofreadIssues)}
          >
            {copiedAllProofread ? <Check size={17} weight="bold" /> : <CopySimple size={17} />}
          </IconButton>
        </div>
        {taskStore.busy && !taskStore.candidate ? (
          <div className="preview-box result" role="status">{ui.generatingProofread}</div>
        ) : !taskStore.candidate ? (
          <div className="preview-box result">{ui.proofreadNotStarted}</div>
        ) : taskStore.candidate.proofreadIssues === null ? (
          <div className="task-error-panel" role="alert">
            <b>{ui.incompleteProofread}</b>
            <p>{ui.incompleteProofreadHint}</p>
          </div>
        ) : proofreadIssues.length === 0 ? (
          <div className="proofread-clean-state">
            <b>{ui.noIssues}</b>
            <p>{ui.noIssuesHint}</p>
          </div>
        ) : (
          <div className="proofread-issue-list">
            {proofreadIssues.map((issue, index) => (
              <div className="issue proofread-issue-card" key={`${issue.code}-${index}`}>
                <div className="issue-head">
                  <div className="proofread-issue-primary">
                    <span className="issue-number">{index + 1}</span>
                    <div>
                      <b>{japanese ? proofreadIssueLabelsJa[issue.code] : proofreadIssueLabels[issue.code]}</b>
                      <span>{issue.locationHint || ui.noLocation}</span>
                    </div>
                  </div>
                  <div className="issue-meta-row">
                    <span className="mini-tag subtle">{japanese ? proofreadSeverityLabelsJa[issue.severity] : proofreadSeverityLabels[issue.severity]}</span>
                    {issue.needsAuthorJudgment ? <span className="mini-tag warning">{ui.authorJudgment}</span> : null}
                  </div>
                </div>
                <div className="issue-body">
                  <div>
                    <span className="issue-label">{ui.quote}</span>
                    <p>{issue.quote || selectedText}</p>
                  </div>
                  <div>
                    <span className="issue-label">{ui.location}</span>
                    <p>{issue.locationHint || ui.noLocation}</p>
                  </div>
                  <div>
                    <span className="issue-label">{ui.suggestion}</span>
                    <p>{issue.suggestion || ui.noLocation}</p>
                  </div>
                  <div>
                    <span className="issue-label">{ui.explanation}</span>
                    <p>{issue.explanation || ui.noLocation}</p>
                  </div>
                  {issue.suggestedReplacement ? (
                    <div>
                      <span className="issue-label">{ui.replacement}</span>
                      <p>{issue.suggestedReplacement}</p>
                    </div>
                  ) : null}
                  {issue.evidence.length ? (
                    <div>
                      <span className="issue-label">{ui.evidence}</span>
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
                    <span className="issue-label">{ui.handling}</span>
                    <p>
                      {issue.canAutoApply ? ui.manualReference : ui.diagnosisOnly}
                      {issue.needsAuthorJudgment ? `，${ui.authorJudgment}` : ""}
                    </p>
                  </div>
                </div>
                <div className="small-actions">
                  <IconButton
                    className={`copy-icon-button ${copiedIssueIndex === index ? "copied" : ""}`}
                    disabled={taskStore.busy}
                    label={ui.copyIssue}
                    onClick={() => void copyProofreadIssue(issue, index)}
                  >
                    {copiedIssueIndex === index ? <Check size={17} weight="bold" /> : <CopySimple size={17} />}
                  </IconButton>
                  <button className="small-button" disabled={taskStore.busy} onClick={() => void taskStore.saveTextToScratchpad(formatProofreadIssueDraft(issue, japanese))} type="button">{ui.addScratchpad}</button>
                  {copiedIssueIndex === index ? <span className="issue-copy-status">{ui.copied}</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="task-actions two">
          {taskStore.busy ? (
            <Button onClick={() => taskStore.cancelActiveStream()} variant="secondary">
              {ui.stopGeneration}
            </Button>
          ) : null}
          <Button disabled={!taskStore.task || taskStore.busy} onClick={() => void taskStore.generatePreview()} variant="ghost">
            {taskStore.candidate ? ui.reproofread : ui.startProofread}
          </Button>
          <Button disabled={!taskStore.candidate || taskStore.busy} onClick={() => void taskStore.rejectCandidate()} variant="secondary">
            {ui.closeResult}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="task-card" ref={taskRootRef}>
      <h2 className="task-title">
        {ui.currentTask} <span className="mini-tag">{label}</span>
        {taskPromptPreset ? <span className="mini-tag">{taskPromptPreset.name}</span> : null}
      </h2>
      <div className="task-meta">
        <div>{ui.status}：{statusText}</div>
        <div>{ui.currentChapter}：{currentChapterTitle ?? ui.noSelectedChapter}</div>
        <div>{ui.target}：{ui.currentSelection}</div>
      </div>
      {executionProgress}
      {contextSummary}
      {errorPanel}
      {taskPromptPreset ? (
        <>
          <label className="field-label">{ui.presetRequest}</label>
          <div className="preview-box preset-preview">{taskPromptPreset.instruction}</div>
        </>
      ) : null}
      <label className="field-label">{ui.request}</label>
      <Textarea
        value={instruction}
        placeholder={taskPromptPreset ? ui.optionalRequest : undefined}
        onChange={(event) => onInstructionChange(event.target.value)}
      />
      <label className="field-label">{ui.originalExcerpt}</label>
      <div className="preview-box">{selectedText}</div>
      <div className="field-label-row">
        <label className="field-label">{ui.previewResult}</label>
        <IconButton
          className={`copy-icon-button ${copiedCandidate ? "copied" : ""}`}
          disabled={!candidateCopyText.trim()}
          label={ui.copyCandidate}
          onClick={() => void copyGeneratedCandidate()}
        >
          {copiedCandidate ? <Check size={17} weight="bold" /> : <CopySimple size={17} />}
        </IconButton>
      </div>
      <div className="preview-box result">
        {taskStore.streamingText ? (
          <>
            <span className="streaming-label">{ui.generating}</span>
            {taskStore.streamingText}
          </>
        ) : (
          taskStore.candidate?.generatedText || taskStore.candidate?.changeSummary || taskStore.task?.outputText || ui.noPreview
        )}
      </div>
      <div className="task-actions">
        {taskStore.busy ? (
          <Button onClick={() => taskStore.cancelActiveStream()} variant="secondary">
            {ui.stopGeneration}
          </Button>
        ) : null}
        <Button disabled={!taskStore.task || taskStore.busy} onClick={() => void taskStore.generatePreview()} variant="ghost">
          {taskStore.candidate ? ui.regenerate : ui.generatePreview}
        </Button>
        {canContinueTruncated ? (
          <Button disabled={taskStore.busy} onClick={() => void taskStore.continuePreview()} variant="ghost">
            {ui.continueGeneration}
          </Button>
        ) : null}
        <Button disabled={!taskStore.candidate || taskStore.busy} onClick={() => void taskStore.rejectCandidate()} variant="ghost">
          {ui.ignoreCandidate}
        </Button>
        <Button disabled={!taskStore.candidate || !hasCandidateText || taskStore.busy} onClick={() => void taskStore.saveCandidateToScratchpad()} variant="ghost">
          {ui.addScratchpad}
        </Button>
        <Button disabled={!taskStore.candidate || !hasCandidateText || taskStore.busy} onClick={() => void taskStore.applyCandidate(applyModeForTask(taskType))} variant="primary">
          {primaryLabel}
        </Button>
      </div>
    </div>
  );
}
