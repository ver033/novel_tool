import { getTokenBudget } from "../../main/ai/token-budget";
import type { AiStreamContextEvent, SettingsState } from "../../main/shared/types";

function formatTokenCount(value: number | null): string {
  if (value === null) {
    return "未知";
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

function formatModelName(modelName: string): string {
  const trimmed = modelName.trim();
  if (!trimmed) {
    return "模型未配置";
  }
  const lastSegment = trimmed.split("/").at(-1) ?? trimmed;
  return lastSegment.length > 28 ? `${lastSegment.slice(0, 25)}...` : lastSegment;
}

function getContextSourceLabel(contextUsage: AiStreamContextEvent): string {
  if (contextUsage.indexMode === "summary_cache") {
    return "全文摘要索引";
  }
  if (contextUsage.indexMode === "hybrid") {
    return "摘要索引 + 原文";
  }
  if (contextUsage.indexMode === "missing") {
    return "索引缺失";
  }
  if (contextUsage.indexMode === "stale") {
    return "摘要索引可能过期";
  }
  return "原文";
}

function getCompressionLabel(contextUsage: AiStreamContextEvent): string {
  if (contextUsage.indexMode === "summary_cache") {
    return "墨枢已使用全文摘要索引";
  }
  if (contextUsage.indexMode === "hybrid") {
    return "墨枢已混合使用摘要索引和原文";
  }
  if (contextUsage.indexMode === "missing") {
    return "全书摘要索引缺失";
  }
  if (contextUsage.indexMode === "stale") {
    return "全书摘要索引可能包含过期章节";
  }
  return contextUsage.contextMode === "summarized"
    ? "墨枢已压缩背景信息"
    : contextUsage.contextMode === "mixed"
      ? "部分原文 + 压缩背景"
      : "原文背景信息";
}

function formatCoverageLabel(contextUsage: AiStreamContextEvent): string | null {
  if (contextUsage.totalChapterCount === undefined) {
    return null;
  }
  const indexedChapterCount = contextUsage.indexedChapterCount ?? 0;
  const parts = [`覆盖 ${indexedChapterCount} / ${contextUsage.totalChapterCount} 章`];
  if (contextUsage.staleChapterCount) {
    parts.push(`${contextUsage.staleChapterCount} 章过期`);
  }
  if (contextUsage.skippedTooShortChapterCount) {
    parts.push(`${contextUsage.skippedTooShortChapterCount} 章过短跳过`);
  }
  return parts.join("，");
}

export function buildChatContextUsageDisplay(contextUsage: AiStreamContextEvent): ChatContextUsageDisplay {
  const visibleTotal = contextUsage.modelContextTokens ?? contextUsage.maxInputTokens;
  const percent = Math.min(100, Math.round((contextUsage.estimatedInputTokens / Math.max(1, visibleTotal)) * 100));
  const usedLabel = formatTokenCount(contextUsage.estimatedInputTokens);
  const totalLabel = contextUsage.modelContextTokens === null ? `${formatTokenCount(contextUsage.maxInputTokens)} 输入预算` : formatTokenCount(contextUsage.modelContextTokens);

  return {
    percent,
    percentText: `${percent}%`,
    usedLabel,
    totalLabel,
    usedOfTotalLabel: `已用 ${usedLabel} 标记，共 ${totalLabel}`,
    modelLabel: formatModelName(contextUsage.modelName),
    windowLabel: formatTokenCount(contextUsage.modelContextTokens),
    inputBudgetLabel: formatTokenCount(contextUsage.maxInputTokens),
    outputBudgetLabel: formatTokenCount(contextUsage.maxOutputTokens),
    compressionLabel: getCompressionLabel(contextUsage),
    sourceLabel: getContextSourceLabel(contextUsage),
    coverageLabel: formatCoverageLabel(contextUsage),
    scopeLabel: contextUsage.scopeLabel
  };
}
