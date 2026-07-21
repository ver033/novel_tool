import { BookOpen, CheckCircle, DownloadSimple, FileText } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { ChapterSummary, ExportTxtResult, ProjectRecord } from "../../main/shared/types";
import { Button } from "../components/Button";
import { getNovelToolApi } from "../state/app-store";

type ExportPageProps = {
  readonly chapters: readonly ChapterSummary[];
  readonly currentProject: ProjectRecord | null;
  readonly onClose: () => void;
};

type SelectedExportPath = {
  readonly filePath: string;
};

type ExportRangeMode = "all_chapters" | "chapter_range";

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatPath(filePath: string | null): string {
  return filePath ?? "尚未选择保存位置";
}

export function ExportPage({ chapters, currentProject, onClose }: ExportPageProps) {
  const api = useMemo(getNovelToolApi, []);
  const [includeChapterTitles, setIncludeChapterTitles] = useState(true);
  const [rangeMode, setRangeMode] = useState<ExportRangeMode>("all_chapters");
  const [fromChapterId, setFromChapterId] = useState(chapters[0]?.id ?? "");
  const [toChapterId, setToChapterId] = useState(chapters[chapters.length - 1]?.id ?? "");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportTxtResult | null>(null);

  useEffect(() => {
    const chapterIds = new Set(chapters.map((chapter) => chapter.id));
    const firstChapterId = chapters[0]?.id ?? "";
    const lastChapterId = chapters[chapters.length - 1]?.id ?? "";
    if (!chapterIds.has(fromChapterId)) {
      setFromChapterId(firstChapterId);
    }
    if (!chapterIds.has(toChapterId)) {
      setToChapterId(lastChapterId);
    }
  }, [chapters, fromChapterId, toChapterId]);

  const selectedChapters = useMemo(() => {
    if (rangeMode === "all_chapters") {
      return chapters;
    }

    const fromIndex = chapters.findIndex((chapter) => chapter.id === fromChapterId);
    const toIndex = chapters.findIndex((chapter) => chapter.id === toChapterId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex > toIndex) {
      return [];
    }
    return chapters.slice(fromIndex, toIndex + 1);
  }, [chapters, fromChapterId, rangeMode, toChapterId]);
  const selectedWordCount = selectedChapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const isInvalidRange = rangeMode === "chapter_range" && chapters.length > 0 && selectedChapters.length === 0;
  const canExport = Boolean(currentProject && filePath && selectedChapters.length > 0 && !busy);

  function updateRangeMode(mode: ExportRangeMode): void {
    setRangeMode(mode);
    setResult(null);
    setError(null);
  }

  function updateFromChapterId(chapterId: string): void {
    setFromChapterId(chapterId);
    setResult(null);
    setError(null);
  }

  function updateToChapterId(chapterId: string): void {
    setToChapterId(chapterId);
    setResult(null);
    setError(null);
  }

  async function selectExportPath(): Promise<void> {
    if (!currentProject) {
      setError("请先打开一个项目，再导出 TXT。");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const selected = (await api.export.selectTxtFilePath({
        projectId: currentProject.id,
        suggestedName: currentProject.name
      })) as SelectedExportPath | null;
      if (!selected) {
        return;
      }
      setFilePath(selected.filePath);
      setResult(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "选择导出位置失败");
    } finally {
      setBusy(false);
    }
  }

  async function exportTxt(): Promise<void> {
    if (!currentProject) {
      setError("请先打开一个项目，再导出 TXT。");
      return;
    }
    if (!filePath) {
      setError("请先选择 TXT 保存位置。");
      return;
    }
    if (selectedChapters.length === 0) {
      setError("请选择有效的导出章节范围。");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const exported = (await api.export.exportTxt({
        projectId: currentProject.id,
        filePath,
        range:
          rangeMode === "all_chapters"
            ? "all_chapters"
            : {
                type: "chapter_range",
                fromChapterId,
                toChapterId
              },
        includeChapterTitles
      })) as ExportTxtResult;
      setResult(exported);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导出 TXT 失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="import-shell export-shell">
      <header className="settings-top">
        <button className="brand brand-button" onClick={onClose} title="返回写作页" type="button">
          <span className="line-icon">
            <BookOpen size={24} />
          </span>
          <span>导出小说</span>
        </button>
        <div className="top-actions">
          <button className="icon-button" onClick={onClose} type="button" aria-label="关闭导出" title="关闭导出">
            ×
          </button>
        </div>
      </header>

      <main className="import-page export-page">
        <section className="panel wizard export-panel">
          <div className="export-head">
            <div>
              <h1>导出 TXT</h1>
              <p>导出当前项目正文。草稿纸和 AI 记录不会进入正文导出。</p>
            </div>
            <span className="export-format-mark">
              <FileText size={28} weight="regular" />
              TXT
            </span>
          </div>

          <div className="export-grid">
            <div className="export-main">
              <section className="export-section">
                <span className="export-section-label">格式</span>
                <div className="export-choice active">
                  <div>
                    <strong>TXT 文本</strong>
                    <span>UTF-8 编码，适合备份、投稿前整理和跨工具继续编辑。</span>
                  </div>
                  <span className="tag">第一版</span>
                </div>
              </section>

              <section className="export-section">
                <span className="export-section-label">范围</span>
                <div className="export-range-options">
                  <button
                    className={`export-choice ${rangeMode === "all_chapters" ? "active" : ""}`}
                    disabled={busy}
                    onClick={() => updateRangeMode("all_chapters")}
                    type="button"
                  >
                    <div>
                      <strong>全部章节</strong>
                      <span>按左侧章节顺序导出当前项目的所有正文。</span>
                    </div>
                    <span className="tag">{formatNumber(chapters.length)} 章</span>
                  </button>
                  <button
                    className={`export-choice ${rangeMode === "chapter_range" ? "active" : ""}`}
                    disabled={busy || chapters.length === 0}
                    onClick={() => updateRangeMode("chapter_range")}
                    type="button"
                  >
                    <div>
                      <strong>自定义范围</strong>
                      <span>选择起始章节和结束章节，按章节顺序导出中间内容。</span>
                    </div>
                    <span className="tag">{formatNumber(selectedChapters.length)} 章</span>
                  </button>
                </div>
                {rangeMode === "chapter_range" ? (
                  <div className="export-range-picker">
                    <label>
                      <span>起始章节</span>
                      <select
                        disabled={busy}
                        onChange={(event) => updateFromChapterId(event.target.value)}
                        value={fromChapterId}
                      >
                        {chapters.map((chapter) => (
                          <option key={chapter.id} value={chapter.id}>
                            {chapter.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>结束章节</span>
                      <select disabled={busy} onChange={(event) => updateToChapterId(event.target.value)} value={toChapterId}>
                        {chapters.map((chapter) => (
                          <option key={chapter.id} value={chapter.id}>
                            {chapter.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    {isInvalidRange ? <span className="export-range-error">起始章节不能晚于结束章节。</span> : null}
                  </div>
                ) : null}
              </section>

              <section className="export-section">
                <span className="export-section-label">选项</span>
                <label className={`export-option ${includeChapterTitles ? "active" : ""}`}>
                  <input
                    checked={includeChapterTitles}
                    onChange={(event) => {
                      setIncludeChapterTitles(event.target.checked);
                      setResult(null);
                    }}
                    type="checkbox"
                  />
                  <span>
                    <strong>包含章节标题</strong>
                    <small>每章先写入章节名，再写入正文内容。</small>
                  </span>
                </label>
              </section>

              <section className="export-section">
                <span className="export-section-label">保存位置</span>
                <div className="export-destination">
                  <span title={filePath ?? undefined}>{formatPath(filePath)}</span>
                  <Button disabled={busy || !currentProject} onClick={() => void selectExportPath()} type="button" variant="secondary">
                    选择位置
                  </Button>
                </div>
              </section>
            </div>

            <aside className="export-summary-panel">
              <div>
                <span className="export-section-label">当前项目</span>
                <h2>{currentProject?.name ?? "未打开项目"}</h2>
              </div>
              <div className="export-stat-grid">
                <div>
                  <b>{formatNumber(selectedChapters.length)}</b>
                  <span>章节</span>
                </div>
                <div>
                  <b>{formatNumber(selectedWordCount)}</b>
                  <span>正文统计</span>
                </div>
              </div>
              {result ? (
                <div className="export-result" role="status">
                  <CheckCircle size={22} weight="fill" />
                  <span>
                    已导出 {formatNumber(result.chapterCount)} 章，{formatNumber(result.wordCount)} 字。
                  </span>
                </div>
              ) : null}
              {error ? (
                <div className="import-status error" role="alert">
                  {error}
                </div>
              ) : null}
              <Button disabled={!canExport} onClick={() => void exportTxt()} type="button" variant="primary">
                <DownloadSimple size={20} />
                {busy ? "正在处理" : "导出 TXT"}
              </Button>
              <Button disabled={busy} onClick={onClose} type="button" variant="ghost">
                返回写作
              </Button>
            </aside>
          </div>
        </section>
      </main>
    </div>
  );
}
