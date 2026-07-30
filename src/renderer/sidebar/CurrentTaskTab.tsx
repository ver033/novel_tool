import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight, BookOpenText, Check, CheckCircle, CircleNotch, CopySimple, StopCircle, WarningCircle } from "@phosphor-icons/react";
import { AI_TASK_INSTRUCTION_MAX_CHARACTERS } from "../../main/shared/ai-task-limits";
import { proofreadIssueLabels, proofreadIssueLabelsJa, type ProofreadIssue } from "../../main/shared/proofread";
import { estimateTextTokens } from "../../main/shared/text-token-estimate";
import type { SelectionSnapshot, TaskPromptPreset, TaskType } from "../../main/shared/types";
import { Button } from "../components/Button";
import { IconButton } from "../components/IconButton";
import { Textarea } from "../components/Textarea";
import type { SettingsCategory } from "../routes/SettingsPage";
import { candidateStatusLabels, taskLabels, taskStatusLabels } from "../state/sidebar-store";
import { buildTaskExecutionActivities, type TaskExecutionActivityStatus, type TaskExecutionPhase } from "../state/task-execution";
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

const defaultTaskRule: Record<TaskType, string> = {
  polish: "按原文风格轻量润色，优先处理拗口、重复和节奏问题。",
  expand: "把原片段扩写为可替换原选区的完整版本，保持当前场景和人物认知。",
  proofread: "按校对规则检查明确问题；不确定的逻辑风险标记为需要作者判断。",
  continue: "从当前最后一句自然接续，只生成插入选区下方的新正文。"
};

const defaultTaskRuleJa: Record<TaskType, string> = {
  polish: "原文の文体を保ちながら軽く推敲し、読みにくさ、重複、リズムを優先して整えてください。",
  expand: "現在の場面と人物の認識を保ち、選択範囲を置き換えられる完成した文章へ加筆してください。",
  proofread: "明確な問題を校正し、断定できない論理上の懸念は作者の判断が必要だと示してください。",
  continue: "現在の最後の一文から自然に続け、選択範囲の下へ挿入する新しい本文だけを生成してください。"
};

const requestPlaceholder: Record<TaskType, string> = {
  polish: "例如：语气更克制，保留短句节奏，不增加新情节。",
  expand: "例如：补充环境压迫感和人物犹豫，但不要改变事件结果。",
  proofread: "例如：重点检查人物称呼、时间顺序和重复表达。",
  continue: "例如：继续当前对话约500字，不要立刻揭示幕后人物。"
};

const requestPlaceholderJa: Record<TaskType, string> = {
  polish: "例：抑制の利いた語調にし、短文のリズムと筋書きを保ってください。",
  expand: "例：出来事の結果を変えず、場面の緊張感と人物のためらいを補ってください。",
  proofread: "例：人物の呼称、時系列、重複表現を重点的に確認してください。",
  continue: "例：現在の会話を約500字続け、黒幕はまだ明かさないでください。"
};

export function initialInstructionForTask(_taskType: TaskType, _taskPromptPreset: TaskPromptPreset | null, _japanese = false): string {
  return "";
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

function isTaskInputTooLongError(error: string): boolean {
  return error.includes("本次要求与目标文本合计过长") || error.includes("今回の要望と対象本文が長すぎる");
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
  if (isTaskInputTooLongError(error)) {
    return japanese ? "入力内容が長すぎます" : "输入内容过长";
  }
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
  if (isTaskInputTooLongError(error)) {
    return japanese
      ? "今回の要望は自動的に切り捨てられていません。選択範囲を短くするか、要望を分けて実行してください。"
      : "系统没有截断本次要求。请缩短选区，或把要求拆成两次任务执行。";
  }
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

function TaskActivityIcon({ status }: { readonly status: TaskExecutionActivityStatus }) {
  if (status === "complete") {
    return <CheckCircle size={16} weight="fill" />;
  }
  if (status === "error") {
    return <WarningCircle size={16} weight="fill" />;
  }
  if (status === "stopped") {
    return <StopCircle size={16} weight="fill" />;
  }
  return <CircleNotch className="task-activity-spinner" size={16} weight="bold" />;
}

function TaskExecutionProgress({
  contextCount,
  hasTask,
  japanese,
  phase,
  taskType
}: {
  readonly contextCount: number;
  readonly hasTask: boolean;
  readonly japanese: boolean;
  readonly phase: TaskExecutionPhase;
  readonly taskType: TaskType;
}) {
  const activities = buildTaskExecutionActivities(phase, hasTask);
  if (activities.length === 0) {
    return null;
  }

  const taskName = japanese
    ? { polish: "推敲", expand: "加筆", proofread: "校正", continue: "続きを書く" }[taskType]
    : taskLabels[taskType];
  const labels = japanese
    ? {
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
  const activityLabels = japanese
    ? {
        context: {
          title: "選択範囲と参照情報を準備",
          active: "本文を保存し、今回の操作に必要な範囲を確認しています",
          complete: contextCount > 0 ? `選択範囲を固定し、${contextCount} 件の参照情報を使用しました` : "選択範囲と必要な参照情報を固定しました",
          error: "選択範囲または参照情報の準備に失敗しました",
          stopped: "参照情報の準備を停止しました"
        },
        generation: {
          title: `${taskName}の候補を生成`,
          active: phase === "canceling" ? "モデルの生成を停止しています" : "モデルから候補本文を受信しています",
          complete: "モデルから候補本文を受信しました",
          error: "モデルによる候補生成に失敗しました",
          stopped: "候補生成を停止しました"
        },
        result: {
          title: "確認できる候補として整理",
          active: "候補内容と適用方法を整理しています",
          complete: "候補を確認できます。本文にはまだ反映されていません",
          error: "候補結果の整理に失敗しました",
          stopped: "候補結果の整理を停止しました"
        }
      }
    : {
        context: {
          title: "准备选区与参考上下文",
          active: "正在保存当前正文，并确认本次操作需要引用的范围",
          complete: contextCount > 0 ? `已锁定选区，并使用 ${contextCount} 项参考上下文` : "已锁定选区与本次操作所需上下文",
          error: "选区或参考上下文准备失败",
          stopped: "已停止准备参考上下文"
        },
        generation: {
          title: `调用模型生成${taskName}候选`,
          active: phase === "canceling" ? "正在停止模型生成" : "正在接收模型生成的候选内容",
          complete: "已收到模型生成的候选内容",
          error: "模型生成候选内容失败",
          stopped: "候选内容生成已停止"
        },
        result: {
          title: "整理为可确认的候选结果",
          active: "正在整理候选内容与可用操作",
          complete: "候选结果可供检查，尚未写入正文",
          error: "候选结果整理失败",
          stopped: "候选结果整理已停止"
        }
      };
  const phaseProgress: Record<TaskExecutionPhase, number> = {
    idle: 0,
    ready: 0,
    creating: 0.12,
    preparing: 0.3,
    requesting: 0.48,
    streaming: 0.72,
    finalizing: 0.92,
    complete: 1,
    canceling: 0.72,
    canceled: 0.72,
    error: 0.72
  };

  return (
    <section className={`task-execution-progress phase-${phase}`} aria-label={japanese ? "タスクの実行状況" : "任务执行动态"} aria-live="polite">
      <header className="task-execution-progress-head">
        <span className={`task-execution-pulse ${phase}`} aria-hidden="true" />
        <div>
          <strong>{labels[phase]}</strong>
          <small>{japanese ? "この履歴は結果が出た後も残ります" : "执行记录会保留在当前面板"}</small>
        </div>
      </header>
      <div className="task-execution-progress-track" aria-hidden="true">
        <span style={{ transform: `scaleX(${phaseProgress[phase]})` }} />
      </div>
      <ol className="task-activity-list">
        {activities.map((activity) => {
          const copy = activityLabels[activity.id];
          return (
            <li className={activity.status} key={activity.id}>
              <span className="task-activity-icon" aria-hidden="true">
                <TaskActivityIcon status={activity.status} />
              </span>
              <span>
                <strong>{copy.title}</strong>
                <small>{copy[activity.status]}</small>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TaskRequestEditor({
  busy,
  instruction,
  japanese,
  onChange,
  onSubmit,
  resetKey,
  taskType
}: {
  readonly busy: boolean;
  readonly instruction: string;
  readonly japanese: boolean;
  readonly onChange: (instruction: string) => void;
  readonly onSubmit: () => void;
  readonly resetKey: number | null;
  readonly taskType: TaskType;
}) {
  const [expanded, setExpanded] = useState(false);
  const generatedId = useId();
  const requestId = `task-request-${generatedId}`;
  const characterCount = Array.from(instruction).length;
  const estimatedTokens = estimateTextTokens(instruction);
  const overLimit = characterCount > AI_TASK_INSTRUCTION_MAX_CHARACTERS;
  const countId = `${requestId}-count`;
  const errorId = `${requestId}-error`;
  const describedBy = overLimit ? `${countId} ${errorId}` : countId;

  useEffect(() => {
    setExpanded(false);
  }, [resetKey, taskType]);

  return (
    <section className={`task-request-editor ${expanded ? "expanded" : ""} ${busy ? "read-only" : ""}`}>
      <div className="task-request-heading">
        <div>
          <label className="field-label" htmlFor={requestId}>
            {japanese ? "今回の要望" : "本次要求"}
            <span>{japanese ? "任意" : "可选"}</span>
          </label>
          <p>{japanese ? "空欄の場合は、下の基本ルールで実行します。" : "不填写时，将按下方默认规则执行。"}</p>
        </div>
        <button
          aria-expanded={expanded}
          className="task-request-expand"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded ? (japanese ? "コンパクト表示" : "收起编辑") : (japanese ? "広く編集" : "展开编辑")}
        </button>
      </div>
      <div className="task-default-rule">
        <span>{japanese ? "基本ルール" : "默认规则"}</span>
        <p>{(japanese ? defaultTaskRuleJa : defaultTaskRule)[taskType]}</p>
      </div>
      <Textarea
        aria-describedby={describedBy}
        aria-invalid={overLimit}
        autoResize
        className="task-request-textarea"
        id={requestId}
        maxAutoHeight={expanded ? 520 : 280}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter"
            && (event.metaKey || event.ctrlKey)
            && !event.nativeEvent.isComposing
            && !busy
            && !overLimit
          ) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder={(japanese ? requestPlaceholderJa : requestPlaceholder)[taskType]}
        readOnly={busy}
        value={instruction}
      />
      <footer className="task-request-footer" id={countId}>
        <span className={overLimit ? "limit-error" : ""}>
          {characterCount.toLocaleString(japanese ? "ja-JP" : "zh-CN")}
          {" / "}
          {AI_TASK_INSTRUCTION_MAX_CHARACTERS.toLocaleString(japanese ? "ja-JP" : "zh-CN")}
          {japanese ? " 文字" : " 字符"}
          {instruction.trim() ? ` · ≈ ${estimatedTokens.toLocaleString(japanese ? "ja-JP" : "zh-CN")} tokens` : ""}
        </span>
        <span>{busy ? (japanese ? "生成中は編集できません" : "生成期间暂不可编辑") : (japanese ? "Ctrl / ⌘ + Enter で開始" : "Ctrl / ⌘ + Enter 开始")}</span>
      </footer>
      {overLimit ? (
        <p className="task-request-limit-error" id={errorId} role="alert">
          {japanese
            ? `今回の要望は ${AI_TASK_INSTRUCTION_MAX_CHARACTERS.toLocaleString("ja-JP")} 文字以内にしてください。内容が自動的に切り捨てられることはありません。`
            : `本次要求不能超过 ${AI_TASK_INSTRUCTION_MAX_CHARACTERS.toLocaleString("zh-CN")} 字符，内容不会被静默截断。`}
        </p>
      ) : null}
    </section>
  );
}

function TaskRequestSummary({
  busy,
  instruction,
  japanese,
  onEdit,
  taskType
}: {
  readonly busy: boolean;
  readonly instruction: string;
  readonly japanese: boolean;
  readonly onEdit: () => void;
  readonly taskType: TaskType;
}) {
  const characterCount = Array.from(instruction).length;
  const displayedInstruction = instruction.trim() || (japanese ? defaultTaskRuleJa : defaultTaskRule)[taskType];
  return (
    <section className="task-request-summary">
      <details>
        <summary>
          <span>{japanese ? "今回の要望を確認" : "查看本次要求"}</span>
          <small>
            {instruction.trim()
              ? `${characterCount.toLocaleString(japanese ? "ja-JP" : "zh-CN")} ${japanese ? "文字" : "字符"}`
              : japanese ? "基本ルールを使用" : "使用默认规则"}
          </small>
        </summary>
        <p>{displayedInstruction}</p>
      </details>
      {!busy ? (
        <button onClick={onEdit} type="button">
          {japanese ? "要望を編集して再生成" : "修改要求后重新生成"}
        </button>
      ) : null}
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
  const { locale } = useI18n();
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
        ignoreCandidate: "候補を破棄", readyToStart: "開始待ち", selectedCharacters: "文字を選択", showOriginal: "選択した原文を確認",
        selectionLocked: "選択範囲を固定", configureHint: "開始するまでモデルには送信されません", runningHint: "この画面を開いたまま処理を続けます", resultHint: "候補はまだ本文へ反映されていません",
        startActions: { polish: "推敲を開始", expand: "加筆を開始", proofread: "校正を開始", continue: "続きを生成" } as Record<TaskType, string>
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
        ignoreCandidate: "忽略候选", readyToStart: "等待开始", selectedCharacters: "字选区", showOriginal: "查看选中的原文",
        selectionLocked: "选区已锁定", configureHint: "点击开始前不会向模型发送内容", runningHint: "当前面板会保持打开并持续显示进度", resultHint: "候选内容尚未写入正文",
        startActions: { polish: "开始润色", expand: "开始扩写", proofread: "开始校对", continue: "开始续写" } as Record<TaskType, string>
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
  const [requestEditing, setRequestEditing] = useState(false);
  const taskRootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setCopiedIssueIndex(null);
    setCopiedCandidate(false);
    setCopiedAllProofread(false);
    setCopyError(null);
    setRequestEditing(false);
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
  const selectedCharacterCount = Array.from(selectionSnapshot?.text ?? "").length;
  const label = localizedTaskLabels[taskType];
  const primaryLabel = taskType === "expand" ? ui.replaceOriginal : taskType === "continue" ? ui.insertBelow : ui.applyReplacement;
  const hasCandidateText = Boolean(taskStore.candidate?.generatedText.trim());
  const candidateCopyText = taskStore.streamingText || taskStore.candidate?.generatedText || taskStore.task?.outputText || "";
  const partialTruncatedText = taskStore.streamingText || taskStore.task?.outputText || "";
  const canContinueTruncated = Boolean(taskStore.task && taskStore.error?.includes("截断") && partialTruncatedText.trim() && taskType !== "proofread");
  const instructionOverLimit = Array.from(instruction).length > AI_TASK_INSTRUCTION_MAX_CHARACTERS;
  const canStart = Boolean(selectionSnapshot) && !taskStore.busy && !instructionOverLimit;
  const candidateActionable = taskStore.candidate?.status === "preview";
  const taskActionState = taskStore.busy ? "running" : candidateActionable ? "result" : "configure";
  const taskActionHint =
    taskActionState === "running"
      ? ui.runningHint
      : taskActionState === "result"
        ? ui.resultHint
        : ui.configureHint;
  const taskActionNote = taskActionState === "configure"
    ? null
    : <span className="task-action-note">{taskActionHint}</span>;
  const hasExecutionOutput = Boolean(
    taskStore.busy
    || taskStore.candidate
    || taskStore.streamingText
    || taskStore.task?.outputText
    || taskStore.error
    || taskStore.taskExecutionPhase === "canceled"
  );
  const statusText = useMemo(() => {
    if (taskStore.busy) {
      return ui.processing;
    }
    if (taskStore.task) {
      return localizedTaskStatusLabels[taskStore.task.status];
    }
    return selectionSnapshot ? ui.readyToStart : ui.waitingSelection;
  }, [localizedTaskStatusLabels, selectionSnapshot, taskStore.busy, taskStore.task, ui.processing, ui.readyToStart, ui.waitingSelection]);
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
  const executionProgress = (
    <TaskExecutionProgress
      contextCount={contextPlan?.supportingContext.length ?? 0}
      hasTask={Boolean(taskStore.task)}
      japanese={japanese}
      phase={taskStore.taskExecutionPhase}
      taskType={taskType}
    />
  );
  const startTaskGeneration = () => {
    setRequestEditing(false);
    void taskStore.generatePreview();
  };
  const requestEditor =
    (taskStore.busy || taskStore.candidate) && !requestEditing ? (
      <TaskRequestSummary
        busy={taskStore.busy}
        instruction={instruction}
        japanese={japanese}
        onEdit={() => setRequestEditing(true)}
        taskType={taskType}
      />
    ) : (
      <TaskRequestEditor
        busy={taskStore.busy}
        instruction={instruction}
        japanese={japanese}
        onChange={onInstructionChange}
        onSubmit={startTaskGeneration}
        resetKey={taskRunId}
        taskType={taskType}
      />
    );
  const selectionPreview = (
    <details className="task-selection-preview">
      <summary>
        <span>{ui.showOriginal}</span>
        <small>{selectedCharacterCount.toLocaleString(japanese ? "ja-JP" : "zh-CN")} {ui.selectedCharacters}</small>
      </summary>
      <div className="preview-box">{selectedText}</div>
    </details>
  );
  const lockedSelectionMeta = selectionSnapshot ? (
    <div className="task-selection-lock">
      <span aria-hidden="true" />
      {ui.selectionLocked} · {selectedCharacterCount.toLocaleString(japanese ? "ja-JP" : "zh-CN")} {ui.selectedCharacters}
    </div>
  ) : (
    <div>{selectedCharacterCount.toLocaleString(japanese ? "ja-JP" : "zh-CN")} {ui.selectedCharacters}</div>
  );

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
        <header className="task-card-header">
          <div>
            <span className="task-card-kicker">Ask AI</span>
            <h2 className="task-title">
              {localizedTaskLabels.proofread}
              {taskPromptPreset ? <span className="mini-tag">{taskPromptPreset.name}</span> : null}
            </h2>
          </div>
          <span className={`task-status-pill phase-${taskStore.taskExecutionPhase}`}>{statusText}</span>
        </header>
        <div className="task-meta">
          <div>{currentChapterTitle ?? ui.noSelectedChapter}</div>
          {lockedSelectionMeta}
          {taskStore.candidate ? <div>{ui.result}：{localizedCandidateStatusLabels[taskStore.candidate.status]}</div> : null}
        </div>
        {executionProgress}
        {contextSummary}
        {errorPanel}
        {copyErrorPanel}
        {taskPromptPreset ? (
          <details className="task-preset-summary">
            <summary>{ui.presetRequest} · {taskPromptPreset.name}</summary>
            <p>{taskPromptPreset.instruction}</p>
          </details>
        ) : null}
        {requestEditor}
        {selectionPreview}
        {hasExecutionOutput ? (
          <>
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
            ) : !taskStore.candidate ? null : taskStore.candidate.proofreadIssues === null ? (
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
          </>
        ) : null}
        <div className={`task-actions state-${taskActionState}`}>
          {taskActionNote}
          <div className="task-action-buttons">
            {taskStore.busy ? (
              <Button onClick={() => taskStore.cancelActiveStream()} variant="secondary">
                {ui.stopGeneration}
              </Button>
            ) : null}
            {!taskStore.busy ? (
              <Button
                className={!taskStore.candidate ? "task-primary-start" : ""}
                disabled={!canStart}
                onClick={startTaskGeneration}
                variant={taskStore.candidate ? "ghost" : "primary"}
              >
                {!taskStore.candidate ? <ArrowRight aria-hidden="true" size={16} /> : null}
                {taskStore.candidate ? ui.reproofread : ui.startActions.proofread}
              </Button>
            ) : null}
            {candidateActionable ? (
              <Button disabled={taskStore.busy} onClick={() => void taskStore.rejectCandidate()} variant="secondary">
                {ui.closeResult}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="task-card" ref={taskRootRef}>
      <header className="task-card-header">
        <div>
          <span className="task-card-kicker">Ask AI</span>
          <h2 className="task-title">
            {label}
            {taskPromptPreset ? <span className="mini-tag">{taskPromptPreset.name}</span> : null}
          </h2>
        </div>
        <span className={`task-status-pill phase-${taskStore.taskExecutionPhase}`}>{statusText}</span>
      </header>
      <div className="task-meta">
        <div>{currentChapterTitle ?? ui.noSelectedChapter}</div>
        {lockedSelectionMeta}
        {taskStore.candidate ? <div>{ui.result}：{localizedCandidateStatusLabels[taskStore.candidate.status]}</div> : null}
      </div>
      {executionProgress}
      {contextSummary}
      {errorPanel}
      {taskPromptPreset ? (
        <details className="task-preset-summary">
          <summary>{ui.presetRequest} · {taskPromptPreset.name}</summary>
          <p>{taskPromptPreset.instruction}</p>
        </details>
      ) : null}
      {requestEditor}
      {selectionPreview}
      {hasExecutionOutput ? (
        <>
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
        </>
      ) : null}
      <div className={`task-actions state-${taskActionState}`}>
        {taskActionNote}
        <div className="task-action-buttons">
          {taskStore.busy ? (
            <Button onClick={() => taskStore.cancelActiveStream()} variant="secondary">
              {ui.stopGeneration}
            </Button>
          ) : null}
          {!taskStore.busy ? (
            <Button
              className={!taskStore.candidate ? "task-primary-start" : ""}
              disabled={!canStart}
              onClick={startTaskGeneration}
              variant={taskStore.candidate ? "ghost" : "primary"}
            >
              {!taskStore.candidate ? <ArrowRight aria-hidden="true" size={16} /> : null}
              {taskStore.candidate ? ui.regenerate : ui.startActions[taskType]}
            </Button>
          ) : null}
          {canContinueTruncated ? (
            <Button disabled={taskStore.busy} onClick={() => void taskStore.continuePreview()} variant="ghost">
              {ui.continueGeneration}
            </Button>
          ) : null}
          {candidateActionable ? (
            <>
              <Button disabled={taskStore.busy} onClick={() => void taskStore.rejectCandidate()} variant="ghost">
                {ui.ignoreCandidate}
              </Button>
              <Button disabled={!hasCandidateText || taskStore.busy} onClick={() => void taskStore.saveCandidateToScratchpad()} variant="ghost">
                {ui.addScratchpad}
              </Button>
              <Button disabled={!hasCandidateText || taskStore.busy} onClick={() => void taskStore.applyCandidate(applyModeForTask(taskType))} variant="primary">
                {primaryLabel}
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
