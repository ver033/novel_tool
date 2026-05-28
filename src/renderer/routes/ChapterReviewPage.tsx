import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowClockwise, CheckSquare, MagnifyingGlass, Square, Trash } from "@phosphor-icons/react";
import type { ChapterReviewProgressEvent, ChapterReviewRunRecord, ChapterSummary, ProjectRecord } from "../../main/shared/types";
import { proofreadIssueLabels, type ProofreadIssue, type ProofreadIssueCode } from "../../main/shared/proofread";
import { ProjectModuleRail, type ProjectModule } from "../layout/ProjectModuleRail";
import { TopBar } from "../layout/TopBar";
import { getNovelToolApi } from "../state/app-store";

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

const severityLabel: Record<ProofreadIssue["severity"], string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重"
};

const riskLabel: Record<ChapterReviewRunRecord["chapters"][number]["aiToneRisk"], string> = {
  none: "无",
  low: "低",
  medium: "中",
  high: "高"
};

type IssueCategoryId = "all" | "text" | "logic" | "character" | "style";

const issueCategoryOptions: readonly { readonly id: IssueCategoryId; readonly label: string }[] = [
  { id: "all", label: "全部" },
  { id: "text", label: "文字表达" },
  { id: "logic", label: "逻辑连续" },
  { id: "character", label: "人物对白" },
  { id: "style", label: "文风AI味" }
];

const issueCategoryLabel: Record<Exclude<IssueCategoryId, "all">, string> = {
  text: "文字表达",
  logic: "逻辑连续",
  character: "人物对白",
  style: "文风AI味"
};

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
    label: issueCategoryLabel[category],
    issues: groupIssues
  }));
}

function createChapterReviewRequestId(): string {
  return `chapter_review_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "未完成";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function statusText(run: ChapterReviewRunRecord): string {
  if (run.status === "running") {
    return "审稿中";
  }
  if (run.status === "failed") {
    return "失败";
  }
  return "完成";
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

  const activeRun = useMemo(() => runs.find((run) => run.id === activeRunId) ?? runs[0] ?? null, [activeRunId, runs]);
  const selectedSet = useMemo(() => new Set(selectedChapterIds), [selectedChapterIds]);
  const selectedCount = selectedChapterIds.length;
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
  const progressText = progress?.message ?? (running ? "正在启动审稿" : "");

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
    setSelectedChapterIds((current) => {
      const availableIds = new Set(sortedChapters.map((chapter) => chapter.id));
      const retained = current.filter((id) => availableIds.has(id));
      if (retained.length > 0) {
        return retained;
      }
      return sortedChapters[0] ? [sortedChapters[0].id] : [];
    });
  }, [sortedChapters]);

  useEffect(() => {
    void reloadRuns();
  }, [reloadRuns]);

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
      setError("请选择要审稿的章节。");
      return;
    }
    setRunning(true);
    setError(null);
    const requestId = createChapterReviewRequestId();
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
      message: "正在启动审稿"
    });
    const unsubscribe = api.chapterReview.subscribeProgress(requestId, setProgress);
    try {
      const run = await api.chapterReview.startReview({ projectId, chapterIds: [...selectedChapterIds], requestId });
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setActiveRunId(run.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      await reloadRuns();
    } finally {
      unsubscribe();
      setRunning(false);
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
        <TopBar mode="writing" title="AI审稿" searchPlaceholder="AI审稿" showEditorHistoryControls={false} showSaveStatus={false} showSearch={false} onSettings={onOpenSettings} onWelcome={onWelcome} />
        <main className="chapter-review-shell">
          <ProjectModuleRail activeModule="chapterReview" onNavigate={handleNavigate} />
          <section className="chapter-review-empty">
            <MagnifyingGlass size={38} />
            <h1>先打开一个项目</h1>
            <p>打开项目后可以选择章节进行 AI 审稿。</p>
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
        subtitle="AI审稿"
        searchPlaceholder="AI审稿"
        showEditorHistoryControls={false}
        showSaveStatus={false}
        showSearch={false}
        onSettings={onOpenSettings}
        onWelcome={onWelcome}
      />
      <main className="chapter-review-shell">
        <ProjectModuleRail activeModule="chapterReview" onNavigate={handleNavigate} />
        <section className="chapter-review-workspace" aria-label="AI审稿">
          <header className="chapter-review-toolbar">
            <div>
              <span className="chapter-review-kicker">AI审稿</span>
              <h1>章节审稿</h1>
            </div>
            <div className="chapter-review-actions">
              <button className="secondary-button" onClick={reloadRuns} disabled={loading || running} type="button">
                <ArrowClockwise size={18} />刷新
              </button>
              <button className="secondary-button" onClick={() => setSelectedChapterIds(sortedChapters.map((chapter) => chapter.id))} disabled={running || sortedChapters.length === 0} type="button">
                <CheckSquare size={18} />全选
              </button>
              <button className="secondary-button" onClick={() => setSelectedChapterIds([])} disabled={running || selectedCount === 0} type="button">
                <Square size={18} />清空
              </button>
              <button className="primary-button" onClick={() => void startReview()} disabled={running || selectedCount === 0} type="button">
                <MagnifyingGlass size={18} />{running ? "审稿中" : "开始审稿"}
              </button>
            </div>
          </header>

          {error ? <div className="chapter-review-error">{error}</div> : null}
          {running || progress ? (
            <div className={`chapter-review-progress ${progress?.phase ?? "preparing"}`} aria-live="polite">
              <div className="chapter-review-progress-head">
                <span>{progressText}</span>
                <strong>{progressValue}%</strong>
              </div>
              <div className="chapter-review-progress-track">
                <span style={{ width: `${progressValue}%` }} />
              </div>
              <small>
                {progress
                  ? `${progress.completedChapters}/${progress.totalChapters} 章，${progress.completedChunks}/${progress.totalChunks} 段`
                  : `${selectedCount} 章`}
              </small>
            </div>
          ) : null}

          <div className="chapter-review-layout">
            <aside className="chapter-review-sidebar" aria-label="章节选择">
              <div className="chapter-review-panel-head">
                <h2>章节</h2>
                <span>{selectedCount}/{sortedChapters.length}</span>
              </div>
              <div className="chapter-review-chapter-list">
                {sortedChapters.map((chapter) => (
                  <label className={`chapter-review-chapter-option ${selectedSet.has(chapter.id) ? "selected" : ""}`} key={chapter.id}>
                    <input type="checkbox" checked={selectedSet.has(chapter.id)} onChange={() => toggleChapter(chapter.id)} />
                    <span>
                      <strong>{chapter.title}</strong>
                      <small>{chapter.wordCount.toLocaleString("zh-CN")} 字</small>
                    </span>
                  </label>
                ))}
              </div>
            </aside>

            <section className="chapter-review-results" aria-label="审稿结果">
              <div className="chapter-review-run-summary">
                <div>
                  <span>状态</span>
                  <strong>{activeRun ? statusText(activeRun) : loading ? "加载中" : "无记录"}</strong>
                </div>
                <div>
                  <span>问题</span>
                  <strong>{totalIssueCount}</strong>
                </div>
                <div>
                  <span>AI味风险</span>
                  <strong>{riskLabel[maxAiToneRisk]}</strong>
                </div>
                <div>
                  <span>时间</span>
                  <strong>{formatDateTime(activeRun?.completedAt ?? activeRun?.requestedAt ?? null)}</strong>
                </div>
              </div>
              {activeRun ? (
                <div className="chapter-review-category-tabs" aria-label="问题分类">
                  {issueCategoryOptions.map((option) => (
                    <button
                      className={issueCategory === option.id ? "active" : ""}
                      disabled={issueCategoryCounts[option.id] === 0 && option.id !== "all"}
                      key={option.id}
                      onClick={() => setIssueCategory(option.id)}
                      type="button"
                    >
                      <span>{option.label}</span>
                      <strong>{issueCategoryCounts[option.id]}</strong>
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
                            查看正文
                          </button>
                        </header>
                        <div className="chapter-review-metrics">
                          <span>可读性 {chapter.readabilityScore}/5</span>
                          <span>AI味 {riskLabel[chapter.aiToneRisk]}</span>
                          <span>{chapter.issueCount} 个问题</span>
                        </div>
                        {issueGroups.length > 0 ? (
                          <div className="chapter-review-issue-list">
                            {issueGroups.map((group) => (
                              <section className="chapter-review-issue-group" key={`${chapter.id}-${group.category}`}>
                                <div className="chapter-review-issue-group-head">
                                  <h3>{group.label}</h3>
                                  <span>{group.issues.length}</span>
                                </div>
                                {group.issues.map((issue, index) => (
                                  <section className={`chapter-review-issue severity-${issue.severity}`} key={`${chapter.id}-${issue.code}-${index}`}>
                                    <div className="chapter-review-issue-head">
                                      <span>{proofreadIssueLabels[issue.code]}</span>
                                      <strong>{severityLabel[issue.severity]}</strong>
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
                          <p className="chapter-review-no-issues">{chapter.issues.length > 0 ? "当前分类没有问题。" : "未发现明确问题。"}</p>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="chapter-review-placeholder">
                  <MagnifyingGlass size={36} />
                  <h2>暂无审稿结果</h2>
                </div>
              )}
            </section>

            <aside className="chapter-review-history" aria-label="历史记录">
              <div className="chapter-review-panel-head">
                <h2>记录</h2>
                <span>{runs.length}</span>
              </div>
              <div className="chapter-review-history-list">
                {runs.map((run) => (
                  <button className={`chapter-review-history-item ${activeRun?.id === run.id ? "active" : ""}`} key={run.id} onClick={() => setActiveRunId(run.id)} type="button">
                    <span>{statusText(run)}</span>
                    <strong>{run.chapters.length || run.chapterIds.length} 章 / {run.issueCount} 问题</strong>
                    <small>{formatDateTime(run.completedAt ?? run.requestedAt)}</small>
                  </button>
                ))}
              </div>
              {activeRun ? (
                <button className="secondary-button chapter-review-delete" onClick={() => void deleteRun(activeRun.id)} type="button">
                  <Trash size={18} />删除记录
                </button>
              ) : null}
            </aside>
          </div>
        </section>
      </main>
    </div>
  );
}
