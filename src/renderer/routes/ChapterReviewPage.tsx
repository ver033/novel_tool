import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowClockwise, CheckSquare, MagnifyingGlass, Square, Trash } from "@phosphor-icons/react";
import type { ChapterReviewProgressEvent, ChapterReviewRunRecord, ChapterSummary, ProjectRecord } from "../../main/shared/types";
import { proofreadIssueLabels, proofreadIssueLabelsJa, type ProofreadIssue, type ProofreadIssueCode } from "../../main/shared/proofread";
import type { AppLocale } from "../../main/shared/language";
import { useI18n } from "../i18n";
import { useLocalizedCopy } from "../i18n/localized-copy";
import { ProjectModuleRail, type ProjectModule } from "../layout/ProjectModuleRail";
import { TopBar } from "../layout/TopBar";
import { getNovelToolApi } from "../state/app-store";
import { completeReviewProgress, estimateReviewRemainingMs, formatReviewDuration, formatReviewRemainingText, retainAvailableChapterSelection } from "./chapter-review-view-model";

type ChapterReviewPageProps = {
  readonly currentProject: ProjectRecord | null;
  readonly chapters: readonly ChapterSummary[];
  readonly onOpenChapter: (chapterId: string) => void;
  readonly onOpenOutline: () => void;
  readonly onOpenRelationshipGraph: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenWriting: () => void;
  readonly onOpenWritingGoals: () => void;
  readonly onWelcome: () => void;
};

const reviewPageCopy = {
  "zh-CN": {
    title: "AI 审稿",
    heading: "章节审稿",
    openProject: "先打开一个项目",
    openProjectHint: "打开项目后可以选择章节进行 AI 审稿。",
    refresh: "刷新",
    selectAll: "全选",
    clear: "清空",
    stop: "停止审稿",
    running: "审稿中",
    start: "开始审稿",
    selectedChapters: "已选章节",
    latestResult: "最近结果",
    loading: "加载中",
    none: "无",
    noRecord: "暂无记录",
    status: "审稿状态",
    ready: "待开始",
    notSelected: "未选择",
    canStart: "可以开始审稿",
    chooseFromLeft: "从左侧选择章节",
    chapters: "章节",
    results: "审稿结果",
    issues: "问题",
    aiToneRisk: "AI 味风险",
    time: "时间",
    categories: {
      all: "全部",
      text: "文字表达",
      logic: "逻辑连续",
      character: "人物对白",
      style: "文风 AI 味"
    },
    severity: { low: "低", medium: "中", high: "高", critical: "严重" },
    risk: { none: "无", low: "低", medium: "中", high: "高" },
    openText: "查看正文",
    readability: "可读性",
    aiTone: "AI 味",
    noCategoryIssue: "当前分类没有问题。",
    noIssue: "未发现明确问题。",
    noResult: "暂无审稿结果",
    history: "记录",
    deleteRecord: "删除记录",
    incomplete: "未完成",
    completed: "完成",
    failed: "失败",
    stopped: "已停止",
    starting: "正在启动审稿",
    stopping: "正在停止审稿",
    chooseChapterError: "请选择要审稿的章节。",
    elapsed: "已用",
    remaining: "预计剩余",
    segments: "段",
    chars: "字",
    chapterUnit: "章",
    issueUnit: "问题"
  },
  "ja-JP": {
    title: "AI レビュー",
    heading: "章レビュー",
    openProject: "先にプロジェクトを開いてください",
    openProjectHint: "プロジェクトを開くと、章を選んで AI レビューを実行できます。",
    refresh: "更新",
    selectAll: "すべて選択",
    clear: "選択解除",
    stop: "レビューを停止",
    running: "レビュー中",
    start: "レビューを開始",
    selectedChapters: "選択した章",
    latestResult: "最新の結果",
    loading: "読み込み中",
    none: "なし",
    noRecord: "記録なし",
    status: "レビュー状態",
    ready: "開始待ち",
    notSelected: "未選択",
    canStart: "レビューを開始できます",
    chooseFromLeft: "左側から章を選択してください",
    chapters: "章",
    results: "レビュー結果",
    issues: "指摘",
    aiToneRisk: "AI 表現リスク",
    time: "日時",
    categories: {
      all: "すべて",
      text: "文章表現",
      logic: "論理と連続性",
      character: "人物と台詞",
      style: "文体と AI 表現"
    },
    severity: { low: "低", medium: "中", high: "高", critical: "重大" },
    risk: { none: "なし", low: "低", medium: "中", high: "高" },
    openText: "本文を開く",
    readability: "読みやすさ",
    aiTone: "AI 表現",
    noCategoryIssue: "この分類には指摘がありません。",
    noIssue: "明確な問題は見つかりませんでした。",
    noResult: "レビュー結果はまだありません",
    history: "履歴",
    deleteRecord: "履歴を削除",
    incomplete: "未完了",
    completed: "完了",
    failed: "失敗",
    stopped: "停止済み",
    starting: "レビューを開始しています",
    stopping: "レビューを停止しています",
    chooseChapterError: "レビューする章を選択してください。",
    elapsed: "経過",
    remaining: "残り時間",
    segments: "区間",
    chars: "文字",
    chapterUnit: "章",
    issueUnit: "件"
  }
} as const;

type IssueCategoryId = "all" | "text" | "logic" | "character" | "style";

const issueCategoryOptions: readonly IssueCategoryId[] = ["all", "text", "logic", "character", "style"];

const issueCategoryRank: Record<Exclude<IssueCategoryId, "all">, number> = {
  text: 1,
  logic: 2,
  character: 3,
  style: 4
};

const issueSeverityRank: Record<ProofreadIssue["severity"], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1
};

const chapterReviewParallelCapacity = 2;
const textIssueCodes = new Set<ProofreadIssueCode>(["typo", "punctuation", "grammar", "awkward_expression", "repetition", "unclear_reference"]);
const characterIssueCodes = new Set<ProofreadIssueCode>(["dialogue_voice", "character_state_conflict", "character_knowledge_conflict", "relationship_conflict"]);
const styleIssueCodes = new Set<ProofreadIssueCode>(["style_drift", "ai_tone"]);

function issueCategoryFor(code: ProofreadIssueCode): Exclude<IssueCategoryId, "all"> {
  if (textIssueCodes.has(code)) {
    return "text";
  }
  if (characterIssueCodes.has(code)) {
    return "character";
  }
  if (styleIssueCodes.has(code)) {
    return "style";
  }
  return "logic";
}

function groupIssuesForDisplay(issues: readonly ProofreadIssue[], selectedCategory: IssueCategoryId) {
  const filtered = selectedCategory === "all" ? issues : issues.filter((issue) => issueCategoryFor(issue.code) === selectedCategory);
  const sorted = [...filtered].sort((a, b) => {
    const categoryDiff = issueCategoryRank[issueCategoryFor(a.code)] - issueCategoryRank[issueCategoryFor(b.code)];
    if (categoryDiff !== 0) {
      return categoryDiff;
    }
    return issueSeverityRank[b.severity] - issueSeverityRank[a.severity];
  });
  const groups = new Map<Exclude<IssueCategoryId, "all">, ProofreadIssue[]>();
  for (const issue of sorted) {
    const category = issueCategoryFor(issue.code);
    groups.set(category, [...(groups.get(category) ?? []), issue]);
  }
  return [...groups.entries()].map(([category, groupIssues]) => ({
    category,
    issues: groupIssues
  }));
}

function createChapterReviewRequestId(): string {
  return `chapter_review_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatDateTime(value: string | null, locale: AppLocale, incomplete: string): string {
  if (!value) {
    return incomplete;
  }
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function statusText(run: ChapterReviewRunRecord, copy: (typeof reviewPageCopy)[AppLocale]): string {
  if (run.status === "running") {
    return copy.running;
  }
  if (run.status === "failed") {
    if (run.error === "AI审稿已停止。") {
      return copy.stopped;
    }
    return copy.failed;
  }
  return copy.completed;
}

function isCanceledReviewMessage(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message.includes("AI审稿已停止") || message.includes("canceled") || message.includes("已取消");
}

export function ChapterReviewPage({
  currentProject,
  chapters,
  onOpenChapter,
  onOpenOutline,
  onOpenRelationshipGraph,
  onOpenSettings,
  onOpenWriting,
  onOpenWritingGoals,
  onWelcome
}: ChapterReviewPageProps) {
  const api = useMemo(getNovelToolApi, []);
  const { locale } = useI18n();
  const copy = useLocalizedCopy(reviewPageCopy);
  const projectId = currentProject?.id ?? null;
  const sortedChapters = useMemo(() => [...chapters].sort((a, b) => a.sortOrder - b.sortOrder), [chapters]);
  const [selectedChapterIds, setSelectedChapterIds] = useState<readonly string[]>([]);
  const [runs, setRuns] = useState<readonly ChapterReviewRunRecord[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ChapterReviewProgressEvent | null>(null);
  const [issueCategory, setIssueCategory] = useState<IssueCategoryId>("all");
  const [reviewStartedAt, setReviewStartedAt] = useState<number | null>(null);
  const [reviewClockNow, setReviewClockNow] = useState(() => Date.now());
  const [activeReviewRequestId, setActiveReviewRequestId] = useState<string | null>(null);

  const activeRun = useMemo(() => runs.find((run) => run.id === activeRunId) ?? runs[0] ?? null, [activeRunId, runs]);
  const selectedSet = useMemo(() => new Set(selectedChapterIds), [selectedChapterIds]);
  const selectedCount = selectedChapterIds.length;
  const selectedWordCount = useMemo(
    () => sortedChapters.reduce((total, chapter) => total + (selectedSet.has(chapter.id) ? chapter.wordCount : 0), 0),
    [selectedSet, sortedChapters]
  );
  const totalIssueCount = activeRun?.chapters.reduce((total, chapter) => total + chapter.issueCount, 0) ?? 0;
  const issueCategoryCounts = useMemo(() => {
    const counts: Record<IssueCategoryId, number> = { all: 0, text: 0, logic: 0, character: 0, style: 0 };
    for (const chapter of activeRun?.chapters ?? []) {
      for (const issue of chapter.issues) {
        const category = issueCategoryFor(issue.code);
        counts.all += 1;
        counts[category] += 1;
      }
    }
    return counts;
  }, [activeRun]);
  const maxAiToneRisk = activeRun?.chapters.reduce<ChapterReviewRunRecord["chapters"][number]["aiToneRisk"]>((current, chapter) => {
    const rank = { none: 0, low: 1, medium: 2, high: 3 } as const;
    return rank[chapter.aiToneRisk] > rank[current] ? chapter.aiToneRisk : current;
  }, "none") ?? "none";
  const progressValue = running ? progress?.progressPercent ?? 1 : progress?.phase === "completed" ? 100 : progress?.progressPercent ?? 0;
  const progressText = progress?.message
    ? locale === "ja-JP"
      ? progress.phase === "completed"
        ? copy.completed
        : progress.phase === "failed"
          ? copy.failed
          : copy.running
      : progress.message
    : running
      ? copy.starting
      : "";
  const reviewElapsedMs = reviewStartedAt ? Math.max(0, reviewClockNow - reviewStartedAt) : 0;
  const activeRunChapterCount = activeRun ? activeRun.chapters.length || activeRun.chapterIds.length : 0;
  const estimatedRemainingMs = progress
    ? estimateReviewRemainingMs({
      completedChunks: progress.completedChunks,
      totalChunks: progress.totalChunks,
      elapsedMs: reviewElapsedMs,
      parallelCapacity: chapterReviewParallelCapacity
    })
    : null;
  const remainingTimeText =
    locale === "ja-JP"
      ? estimatedRemainingMs !== null
        ? formatReviewDuration(estimatedRemainingMs)
        : progress && progress.completedChunks > 0 && progress.completedChunks < progress.totalChunks
          ? `残り ${Math.max(1, progress.totalChunks - progress.completedChunks)} 件の応答を待機中`
          : "計算中"
      : formatReviewRemainingText({
          estimatedRemainingMs,
          completedChunks: progress?.completedChunks ?? 0,
          totalChunks: progress?.totalChunks ?? 0
        });

  const reloadRuns = useCallback(async () => {
    if (!projectId) {
      setRuns([]);
      setActiveRunId(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextRuns = await api.chapterReview.listRuns({ projectId, limit: 20 });
      setRuns(nextRuns);
      setActiveRunId((current) => current ?? nextRuns[0]?.id ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [api, projectId]);

  useEffect(() => {
    setSelectedChapterIds((current) => retainAvailableChapterSelection(current, sortedChapters));
  }, [sortedChapters]);

  useEffect(() => {
    void reloadRuns();
  }, [reloadRuns]);

  useEffect(() => {
    if (!running || !reviewStartedAt) {
      return undefined;
    }
    setReviewClockNow(Date.now());
    const intervalId = window.setInterval(() => setReviewClockNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [reviewStartedAt, running]);

  function handleNavigate(module: ProjectModule): void {
    if (module === "writing") {
      onOpenWriting();
      return;
    }
    if (module === "relationshipGraph") {
      onOpenRelationshipGraph();
      return;
    }
    if (module === "outline") {
      onOpenOutline();
      return;
    }
    if (module === "goals") {
      onOpenWritingGoals();
      return;
    }
    if (module === "settings") {
      onOpenSettings();
    }
  }

  function toggleChapter(chapterId: string): void {
    setSelectedChapterIds((current) => current.includes(chapterId) ? current.filter((id) => id !== chapterId) : [...current, chapterId]);
  }

  async function startReview(): Promise<void> {
    if (!projectId) {
      return;
    }
    if (selectedChapterIds.length === 0) {
      setError(copy.chooseChapterError);
      return;
    }
    setRunning(true);
    setError(null);
    setReviewStartedAt(Date.now());
    setReviewClockNow(Date.now());
    const requestId = createChapterReviewRequestId();
    setActiveReviewRequestId(requestId);
    setProgress({
      requestId,
      projectId,
      runId: "",
      phase: "preparing",
      totalChapters: selectedChapterIds.length,
      completedChapters: 0,
      currentChapterTitle: null,
      totalChunks: selectedChapterIds.length,
      completedChunks: 0,
      progressPercent: 1,
      message: copy.starting
    });
    const unsubscribe = api.chapterReview.subscribeProgress(requestId, setProgress);
    try {
      const run = await api.chapterReview.startReview({ projectId, chapterIds: [...selectedChapterIds], requestId });
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setActiveRunId(run.id);
      setProgress((current) => completeReviewProgress({
        currentProgress: current,
        projectId,
        requestId,
        run,
        fallbackTotalChapters: selectedChapterIds.length
      }));
    } catch (reason) {
      setError(isCanceledReviewMessage(reason) ? null : reason instanceof Error ? reason.message : String(reason));
      await reloadRuns();
    } finally {
      setReviewClockNow(Date.now());
      setActiveReviewRequestId(null);
      unsubscribe();
      setRunning(false);
    }
  }

  async function cancelActiveReview(): Promise<void> {
    if (!activeReviewRequestId) {
      return;
    }
    setError(null);
    setProgress((current) => current ? { ...current, message: copy.stopping } : current);
    try {
      await api.chapterReview.cancelReview({ requestId: activeReviewRequestId });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function deleteRun(runId: string): Promise<void> {
    if (!projectId) {
      return;
    }
    setError(null);
    try {
      await api.chapterReview.deleteRun({ projectId, runId });
      setRuns((current) => current.filter((run) => run.id !== runId));
      setActiveRunId((current) => current === runId ? null : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  if (!currentProject) {
    return (
      <div className="chapter-review-page">
        <TopBar mode="writing" title={copy.title} searchPlaceholder={copy.title} showEditorHistoryControls={false} showSaveStatus={false} showSearch={false} onSettings={onOpenSettings} onWelcome={onWelcome} />
        <main className="chapter-review-shell">
          <ProjectModuleRail activeModule="chapterReview" onNavigate={handleNavigate} />
          <section className="chapter-review-empty">
            <MagnifyingGlass size={38} />
            <h1>{copy.openProject}</h1>
            <p>{copy.openProjectHint}</p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="chapter-review-page">
      <TopBar
        mode="writing"
        title={currentProject.name}
        subtitle={copy.title}
        searchPlaceholder={copy.title}
        showEditorHistoryControls={false}
        showSaveStatus={false}
        showSearch={false}
        onSettings={onOpenSettings}
        onWelcome={onWelcome}
      />
      <main className="chapter-review-shell">
        <ProjectModuleRail activeModule="chapterReview" onNavigate={handleNavigate} />
        <section className="chapter-review-workspace" aria-label={copy.title}>
          <header className="chapter-review-toolbar">
            <div>
              <span className="chapter-review-kicker">{copy.title}</span>
              <h1>{copy.heading}</h1>
            </div>
            <div className="chapter-review-actions">
              <button className="secondary-button" onClick={reloadRuns} disabled={loading || running} type="button">
                <ArrowClockwise size={18} />{copy.refresh}
              </button>
              <button className="secondary-button" onClick={() => setSelectedChapterIds(sortedChapters.map((chapter) => chapter.id))} disabled={running || sortedChapters.length === 0} type="button">
                <CheckSquare size={18} />{copy.selectAll}
              </button>
              <button className="secondary-button" onClick={() => setSelectedChapterIds([])} disabled={running || selectedCount === 0} type="button">
                <Square size={18} />{copy.clear}
              </button>
              {running && activeReviewRequestId ? (
                <button className="secondary-button" onClick={() => void cancelActiveReview()} type="button">
                  <Square size={18} />{copy.stop}
                </button>
              ) : null}
              <button className="primary-button" onClick={() => void startReview()} disabled={running || selectedCount === 0} type="button">
                <MagnifyingGlass size={18} />{running ? copy.running : copy.start}
              </button>
            </div>
          </header>

          {error ? <div className="chapter-review-error">{error}</div> : null}
          <div className="chapter-review-focus-panel">
            <div className="chapter-review-selection-meta">
              <span>{copy.selectedChapters}</span>
              <strong>{selectedCount}</strong>
              <small>{selectedWordCount.toLocaleString(locale)} {copy.chars}</small>
            </div>
            <div className="chapter-review-selection-meta">
              <span>{copy.latestResult}</span>
              <strong>{activeRun ? statusText(activeRun, copy) : loading ? copy.loading : copy.none}</strong>
              <small>{activeRun ? `${activeRunChapterCount} ${copy.chapterUnit} / ${totalIssueCount} ${copy.issueUnit}` : copy.noRecord}</small>
            </div>
            {running || progress ? (
              <div className={`chapter-review-progress ${progress?.phase ?? "preparing"}`} aria-live="polite">
                <div className="chapter-review-progress-head">
                  <span>{progressText}</span>
                  <strong>{progressValue}%</strong>
                </div>
                <div className="chapter-review-progress-track">
                  <span style={{ width: `${progressValue}%` }} />
                </div>
                <div className="chapter-review-progress-stats">
                  <span>
                    {progress
                      ? `${progress.completedChapters}/${progress.totalChapters} ${copy.chapterUnit}，${progress.completedChunks}/${progress.totalChunks} ${copy.segments}`
                      : `${selectedCount} ${copy.chapterUnit}`}
                  </span>
                  <span>{copy.elapsed} {formatReviewDuration(reviewElapsedMs)}</span>
                  <span>{copy.remaining}：{remainingTimeText}</span>
                </div>
              </div>
            ) : (
              <div className="chapter-review-idle-panel">
                <span>{copy.status}</span>
                <strong>{selectedCount > 0 ? copy.ready : copy.notSelected}</strong>
                <small>{selectedCount > 0 ? copy.canStart : copy.chooseFromLeft}</small>
              </div>
            )}
          </div>

          <div className="chapter-review-layout">
            <aside className="chapter-review-sidebar" aria-label={copy.selectedChapters}>
              <div className="chapter-review-panel-head">
                <h2>{copy.chapters}</h2>
                <span>{selectedCount}/{sortedChapters.length} · {selectedWordCount.toLocaleString(locale)} {copy.chars}</span>
              </div>
              <div className="chapter-review-chapter-list">
                {sortedChapters.map((chapter) => (
                  <label className={`chapter-review-chapter-option ${selectedSet.has(chapter.id) ? "selected" : ""}`} key={chapter.id}>
                    <input type="checkbox" checked={selectedSet.has(chapter.id)} onChange={() => toggleChapter(chapter.id)} />
                    <span>
                      <strong>{chapter.title}</strong>
                      <small>{chapter.wordCount.toLocaleString(locale)} {copy.chars}</small>
                    </span>
                  </label>
                ))}
              </div>
            </aside>

            <section className="chapter-review-results" aria-label={copy.results}>
              <div className="chapter-review-run-summary">
                <div>
                  <span>{copy.status}</span>
                  <strong>{activeRun ? statusText(activeRun, copy) : loading ? copy.loading : copy.noRecord}</strong>
                </div>
                <div>
                  <span>{copy.issues}</span>
                  <strong>{totalIssueCount}</strong>
                </div>
                <div>
                  <span>{copy.aiToneRisk}</span>
                  <strong>{copy.risk[maxAiToneRisk]}</strong>
                </div>
                <div>
                  <span>{copy.time}</span>
                  <strong>{formatDateTime(activeRun?.completedAt ?? activeRun?.requestedAt ?? null, locale, copy.incomplete)}</strong>
                </div>
              </div>
              {activeRun ? (
                <div className="chapter-review-category-tabs" aria-label={copy.categories.all}>
                  {issueCategoryOptions.map((option) => (
                    <button
                      className={issueCategory === option ? "active" : ""}
                      disabled={issueCategoryCounts[option] === 0 && option !== "all"}
                      key={option}
                      onClick={() => setIssueCategory(option)}
                      type="button"
                    >
                      <span>{copy.categories[option]}</span>
                      <strong>{issueCategoryCounts[option]}</strong>
                    </button>
                  ))}
                </div>
              ) : null}

              {activeRun ? (
                <div className="chapter-review-result-list">
                  {activeRun.chapters.map((chapter) => {
                    const issueGroups = groupIssuesForDisplay(chapter.issues, issueCategory);
                    return (
                      <article className="chapter-review-result" key={chapter.id}>
                        <header>
                          <div>
                            <h2>{chapter.chapterTitle}</h2>
                            <p>{chapter.summary}</p>
                          </div>
                          <button className="secondary-button compact" onClick={() => onOpenChapter(chapter.chapterId)} type="button">
                            {copy.openText}
                          </button>
                        </header>
                        <div className="chapter-review-metrics">
                          <span>{copy.readability} {chapter.readabilityScore}/5</span>
                          <span>{copy.aiTone} {copy.risk[chapter.aiToneRisk]}</span>
                          <span>{chapter.issueCount} {copy.issueUnit}</span>
                        </div>
                        {issueGroups.length > 0 ? (
                          <div className="chapter-review-issue-list">
                            {issueGroups.map((group) => (
                              <section className="chapter-review-issue-group" key={`${chapter.id}-${group.category}`}>
                                <div className="chapter-review-issue-group-head">
                                  <h3>{copy.categories[group.category]}</h3>
                                  <span>{group.issues.length}</span>
                                </div>
                                {group.issues.map((issue, index) => (
                                  <section className={`chapter-review-issue severity-${issue.severity}`} key={`${chapter.id}-${issue.code}-${index}`}>
                                    <div className="chapter-review-issue-head">
                                      <span>{locale === "ja-JP" ? proofreadIssueLabelsJa[issue.code] : proofreadIssueLabels[issue.code]}</span>
                                      <strong>{copy.severity[issue.severity]}</strong>
                                    </div>
                                    <blockquote>{issue.quote}</blockquote>
                                    <p>{issue.explanation}</p>
                                    <p className="chapter-review-suggestion">{issue.suggestion}</p>
                                    <small>{issue.locationHint}</small>
                                  </section>
                                ))}
                              </section>
                            ))}
                          </div>
                        ) : (
                          <p className="chapter-review-no-issues">{chapter.issues.length > 0 ? copy.noCategoryIssue : copy.noIssue}</p>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="chapter-review-placeholder">
                  <MagnifyingGlass size={36} />
                  <h2>{copy.noResult}</h2>
                </div>
              )}
            </section>

            <aside className="chapter-review-history" aria-label={copy.history}>
              <div className="chapter-review-panel-head">
                <h2>{copy.history}</h2>
                <span>{runs.length}</span>
              </div>
              <div className="chapter-review-history-list">
                {runs.map((run) => (
                  <button className={`chapter-review-history-item ${activeRun?.id === run.id ? "active" : ""}`} key={run.id} onClick={() => setActiveRunId(run.id)} type="button">
                    <span>{statusText(run, copy)}</span>
                    <strong>{run.chapters.length || run.chapterIds.length} {copy.chapterUnit} / {run.issueCount} {copy.issueUnit}</strong>
                    <small>{formatDateTime(run.completedAt ?? run.requestedAt, locale, copy.incomplete)}</small>
                  </button>
                ))}
              </div>
              {activeRun ? (
                <button className="secondary-button chapter-review-delete" onClick={() => void deleteRun(activeRun.id)} type="button">
                  <Trash size={18} />{copy.deleteRecord}
                </button>
              ) : null}
            </aside>
          </div>
        </section>
      </main>
    </div>
  );
}
