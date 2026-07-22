import { getTokenBudget } from "../../main/ai/token-budget";
import type { AiStreamContextEvent, SettingsState } from "../../main/shared/types";
import type { AppLocale } from "../../main/shared/language";

function formatTokenCount(value: number | null, japanese = false): string {
  if (value === null) {
    return japanese ? "不明" : "未知";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  }
  return String(value);
}

export type ChatContextUsageDisplay = {
  readonly percent: number;
  readonly percentText: string;
  readonly usedLabel: string;
  readonly totalLabel: string;
  readonly usedOfTotalLabel: string;
  readonly modelLabel: string;
  readonly windowLabel: string;
  readonly inputBudgetLabel: string;
  readonly outputBudgetLabel: string;
  readonly compressionLabel: string;
  readonly sourceLabel: string;
  readonly memoryLabel: string | null;
  readonly coverageLabel: string | null;
  readonly scopeLabel: string;
};

export function createIdleChatContextUsage(settings: SettingsState | null): AiStreamContextEvent {
  const aiProvider = settings?.aiProvider ?? null;
  const modelContextTokens = aiProvider?.contextLength ?? null;
  const budget = getTokenBudget("chat", modelContextTokens);

  return {
    requestId: "idle_context",
    estimatedInputTokens: 0,
    maxInputTokens: budget.maxInputTokens,
    maxOutputTokens: budget.maxOutputTokens,
    modelContextTokens,
    modelName: aiProvider?.modelName?.trim() || "模型未配置",
    contextMode: "direct",
    scopeLabel: "待命"
  };
}

function formatModelName(modelName: string, japanese: boolean): string {
  const trimmed = modelName.trim();
  if (!trimmed || trimmed === "模型未配置") {
    return japanese ? "モデル未設定" : "模型未配置";
  }
  const lastSegment = trimmed.split("/").at(-1) ?? trimmed;
  return lastSegment.length > 28 ? `${lastSegment.slice(0, 25)}...` : lastSegment;
}

function getContextSourceLabel(contextUsage: AiStreamContextEvent, japanese: boolean): string {
  if (contextUsage.indexMode === "summary_cache") {
    return japanese ? "全文要約インデックス" : "全文摘要索引";
  }
  if (contextUsage.indexMode === "hybrid") {
    return japanese ? "要約インデックス + 原文" : "摘要索引 + 原文";
  }
  if (contextUsage.indexMode === "missing") {
    return japanese ? "インデックスなし" : "索引缺失";
  }
  if (contextUsage.indexMode === "stale") {
    return japanese ? "要約インデックスが古い可能性" : "摘要索引可能过期";
  }
  return japanese ? "原文" : "原文";
}

function getCompressionLabel(contextUsage: AiStreamContextEvent, japanese: boolean): string {
  if (contextUsage.indexMode === "summary_cache") {
    return japanese ? "墨枢は全文要約インデックスを使用しています" : "墨枢已使用全文摘要索引";
  }
  if (contextUsage.indexMode === "hybrid") {
    return japanese ? "墨枢は要約インデックスと原文を併用しています" : "墨枢已混合使用摘要索引和原文";
  }
  if (contextUsage.indexMode === "missing") {
    return japanese ? "全体の要約インデックスがありません" : "全书摘要索引缺失";
  }
  if (contextUsage.indexMode === "stale") {
    return japanese ? "全体の要約インデックスに古い章が含まれる可能性があります" : "全书摘要索引可能包含过期章节";
  }
  return contextUsage.contextMode === "summarized"
    ? japanese ? "墨枢は背景情報を圧縮しました" : "墨枢已压缩背景信息"
    : contextUsage.contextMode === "mixed"
      ? japanese ? "一部の原文 + 圧縮した背景" : "部分原文 + 压缩背景"
      : japanese ? "原文の背景情報" : "原文背景信息";
}

function formatCoverageLabel(contextUsage: AiStreamContextEvent, japanese: boolean): string | null {
  if (contextUsage.totalChapterCount === undefined) {
    return null;
  }
  const indexedChapterCount = contextUsage.indexedChapterCount ?? 0;
  const parts = [japanese ? `${indexedChapterCount} / ${contextUsage.totalChapterCount} 章を収録` : `覆盖 ${indexedChapterCount} / ${contextUsage.totalChapterCount} 章`];
  if (contextUsage.staleChapterCount) {
    parts.push(japanese ? `${contextUsage.staleChapterCount} 章が古い` : `${contextUsage.staleChapterCount} 章过期`);
  }
  if (contextUsage.skippedTooShortChapterCount) {
    parts.push(japanese ? `${contextUsage.skippedTooShortChapterCount} 章は短すぎるため除外` : `${contextUsage.skippedTooShortChapterCount} 章过短跳过`);
  }
  return parts.join(japanese ? "、" : "，");
}

function getMemoryLabel(contextUsage: AiStreamContextEvent, japanese: boolean): string | null {
  if (contextUsage.memoryCompactedThisRun) {
    return japanese ? "今回、以前の会話を圧縮しました" : "本轮已压缩早期对话";
  }
  if (contextUsage.memoryCompacted) {
    return japanese ? "以前の会話をメモリへ圧縮済み" : "早期对话已压缩为记忆";
  }
  return null;
}

export function buildChatContextUsageDisplay(contextUsage: AiStreamContextEvent, locale: AppLocale = "zh-CN"): ChatContextUsageDisplay {
  const japanese = locale === "ja-JP";
  const visibleTotal = contextUsage.modelContextTokens ?? contextUsage.maxInputTokens;
  const percent = Math.min(100, Math.round((contextUsage.estimatedInputTokens / Math.max(1, visibleTotal)) * 100));
  const usedLabel = formatTokenCount(contextUsage.estimatedInputTokens, japanese);
  const totalLabel = contextUsage.modelContextTokens === null ? `${formatTokenCount(contextUsage.maxInputTokens, japanese)} ${japanese ? "入力予算" : "输入预算"}` : formatTokenCount(contextUsage.modelContextTokens, japanese);

  return {
    percent,
    percentText: `${percent}%`,
    usedLabel,
    totalLabel,
    usedOfTotalLabel: japanese ? `${totalLabel} 中 ${usedLabel} トークンを使用` : `已用 ${usedLabel} 标记，共 ${totalLabel}`,
    modelLabel: formatModelName(contextUsage.modelName, japanese),
    windowLabel: formatTokenCount(contextUsage.modelContextTokens, japanese),
    inputBudgetLabel: formatTokenCount(contextUsage.maxInputTokens, japanese),
    outputBudgetLabel: formatTokenCount(contextUsage.maxOutputTokens, japanese),
    compressionLabel: getCompressionLabel(contextUsage, japanese),
    sourceLabel: getContextSourceLabel(contextUsage, japanese),
    memoryLabel: getMemoryLabel(contextUsage, japanese),
    coverageLabel: formatCoverageLabel(contextUsage, japanese),
    scopeLabel: japanese && contextUsage.scopeLabel === "待命" ? "待機" : contextUsage.scopeLabel
  };
}
