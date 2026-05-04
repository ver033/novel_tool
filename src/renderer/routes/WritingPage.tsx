import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import type { Editor } from "@tiptap/react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, useDefaultLayout } from "react-resizable-panels";
import { Button } from "../components/Button";
import { DraftRecoveryPrompt } from "../components/DraftRecoveryPrompt";
import { Input } from "../components/Input";
import { Modal } from "../components/Modal";
import { FloatingAiButton } from "../editor/FloatingAiButton";
import { NovelEditor } from "../editor/NovelEditor";
import { LeftChapterTree } from "../layout/LeftChapterTree";
import { RightUtilitySidebar, type SidebarTab, type TaskType } from "../layout/RightUtilitySidebar";
import type { AiChatDraftSeed } from "../sidebar/chat-draft";
import { TopBar } from "../layout/TopBar";
import { getNovelToolApi } from "../state/app-store";
import { useEditorStore } from "../state/editor-store";
import { formatIpcErrorMessage } from "../state/ipc-error";
import type { SettingsCategory } from "./SettingsPage";
import type { ChapterSummary, ProjectRecord, SelectionSnapshot, TaskPromptPreset } from "../../main/shared/types";

type EditorInnerStyle = CSSProperties & {
  readonly maxWidth: string;
};

const pageWidthBySetting = {
  narrow: "760px",
  medium: "860px",
  wide: "980px"
} as const;

const themeClassBySetting = {
  light: "theme-light",
  eye: "theme-eye",
  night: "theme-night"
} as const;

type EditorSearchResult = {
  readonly chapterId: string;
  readonly snippet: string;
  readonly title: string;
};

export type SearchHighlightPart = {
  readonly highlighted: boolean;
  readonly text: string;
};

export function getHighlightedSearchParts(text: string, query: string): SearchHighlightPart[] {
  const trimmedQuery = query.trim();
  if (!text || !trimmedQuery) {
    return text ? [{ highlighted: false, text }] : [];
  }

  const lowerText = text.toLocaleLowerCase("zh-CN");
  const lowerQuery = trimmedQuery.toLocaleLowerCase("zh-CN");
  const parts: SearchHighlightPart[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const matchIndex = lowerText.indexOf(lowerQuery, cursor);
    if (matchIndex < 0) {
      parts.push({ highlighted: false, text: text.slice(cursor) });
      break;
    }

    if (matchIndex > cursor) {
      parts.push({ highlighted: false, text: text.slice(cursor, matchIndex) });
    }
    parts.push({ highlighted: true, text: text.slice(matchIndex, matchIndex + trimmedQuery.length) });
    cursor = matchIndex + trimmedQuery.length;
  }

  return parts;
}

function buildSearchSnippet(text: string, query: string): string {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (!normalizedText) {
    return "匹配章节标题";
  }

  const index = normalizedText.toLocaleLowerCase("zh-CN").indexOf(query.toLocaleLowerCase("zh-CN"));
  if (index < 0) {
    return normalizedText.slice(0, 68);
  }

  const start = Math.max(0, index - 24);
  const end = Math.min(normalizedText.length, index + query.length + 44);
  return `${start > 0 ? "..." : ""}${normalizedText.slice(start, end)}${end < normalizedText.length ? "..." : ""}`;
}

function renderHighlightedSearchText(text: string, query: string) {
  return getHighlightedSearchParts(text, query).map((part, index) =>
    part.highlighted ? (
      <mark className="search-result-highlight" key={`${part.text}-${index}`}>
        {part.text}
      </mark>
    ) : (
      <span key={`${part.text}-${index}`}>{part.text}</span>
    )
  );
}

type WritingPageProps = {
  readonly activeChapter: ChapterSummary | null;
  readonly activeChapterId: string | null;
  readonly chapters: readonly ChapterSummary[];
  readonly currentProject: ProjectRecord | null;
  readonly sidebarOpen: boolean;
  readonly sidebarTab: SidebarTab;
  readonly aiChatDraftSeed: AiChatDraftSeed | null;
  readonly scratchpadRefreshToken: number;
  readonly selectionSnapshot: SelectionSnapshot | null;
  readonly taskPromptPreset: TaskPromptPreset | null;
  readonly taskType: TaskType;
  readonly onCreateChapter: (options?: { readonly afterChapterId?: string }) => void;
  readonly onDeleteChapter: (chapterId: string) => void;
  readonly onRenameChapter: (chapterId: string, currentTitle: string) => void;
  readonly onSelectChapter: (chapterId: string) => void;
  readonly onUpdateChapterTargetWordCount: (chapterId: string, targetWordCount: number | null) => Promise<void>;
  readonly onSidebarTabChange: (tab: SidebarTab) => void;
  readonly onCloseSidebar: () => void;
  readonly onOpenAiChat: () => void;
  readonly onOpenScratchpad: () => void;
  readonly onSelectionToChat: (snapshot: SelectionSnapshot) => void;
  readonly onExport: () => void;
  readonly onImport: () => void;
  readonly onTask: (task: TaskType, snapshot?: SelectionSnapshot | null, preset?: TaskPromptPreset | null) => void;
  readonly onWelcome: () => void;
  readonly onSettings: (category?: SettingsCategory) => void;
};

export function WritingPage({
  activeChapter,
  activeChapterId,
  chapters,
  currentProject,
  sidebarOpen,
  sidebarTab,
  aiChatDraftSeed,
  scratchpadRefreshToken,
  selectionSnapshot,
  taskPromptPreset,
  taskType,
  onCreateChapter,
  onDeleteChapter,
  onRenameChapter,
  onSelectChapter,
  onUpdateChapterTargetWordCount,
  onSidebarTabChange,
  onCloseSidebar,
  onOpenAiChat,
  onOpenScratchpad,
  onSelectionToChat,
  onExport,
  onImport,
  onTask,
  onWelcome,
  onSettings
}: WritingPageProps) {
  const api = useMemo(getNovelToolApi, []);
  const editorStore = useEditorStore(activeChapter);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [taskPromptPresets, setTaskPromptPresets] = useState<TaskPromptPreset[]>([]);
  const [taskPromptPresetError, setTaskPromptPresetError] = useState<string | null>(null);
  const [renameChapterDraft, setRenameChapterDraft] = useState<{ id: string; title: string } | null>(null);
  const [renameChapterTitle, setRenameChapterTitle] = useState("");
  const [targetWordCountModalOpen, setTargetWordCountModalOpen] = useState(false);
  const [targetWordCountDraft, setTargetWordCountDraft] = useState("");
  const [targetWordCountError, setTargetWordCountError] = useState<string | null>(null);
  const [targetWordCountSaving, setTargetWordCountSaving] = useState(false);
  const [confirmWelcomeOpen, setConfirmWelcomeOpen] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [inlineChapterRenameActive, setInlineChapterRenameActive] = useState(false);
  const [inlineChapterTitle, setInlineChapterTitle] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [searchResults, setSearchResults] = useState<EditorSearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [undoRedoState, setUndoRedoState] = useState({ canRedo: false, canUndo: false });
  const targetWordCount = activeChapter?.targetWordCount ?? null;
  const targetProgressLabel = useMemo(() => {
    if (!targetWordCount) {
      return null;
    }

    const remaining = targetWordCount - editorStore.wordCount;
    const progress = Math.min(999, Math.round((editorStore.wordCount / targetWordCount) * 100));
    if (remaining > 0) {
      return `还差 ${remaining.toLocaleString("zh-CN")} 字 · ${progress}%`;
    }
    if (remaining < 0) {
      return `已超过 ${Math.abs(remaining).toLocaleString("zh-CN")} 字 · ${progress}%`;
    }
    return "已达成本章目标 · 100%";
  }, [editorStore.wordCount, targetWordCount]);
  const editorInnerStyle: EditorInnerStyle = {
    maxWidth: pageWidthBySetting[editorStore.editorSettings.pageWidth] ?? pageWidthBySetting.medium
  };
  const editorThemeClass = themeClassBySetting[editorStore.editorSettings.theme] ?? themeClassBySetting.light;
  const sidebarLayoutPanelIds = useMemo(() => (!focusMode && sidebarOpen ? ["editor", "right-sidebar"] : ["editor"]), [focusMode, sidebarOpen]);
  const sidebarLayout = useDefaultLayout({ id: "moshu-writing-sidebar-v2", panelIds: sidebarLayoutPanelIds });
  const flushBeforeNavigation = useCallback(
    (next: () => void) => {
      setNavigationError(null);
      void editorStore.flushPendingSave()
        .then(next)
        .catch((reason: unknown) => {
          setNavigationError(formatIpcErrorMessage(reason, "保存失败，已留在当前页面。"));
        });
    },
    [editorStore]
  );
  useEffect(() => {
    let cancelled = false;
    void api.settings
      .get()
      .then((settings) => {
        if (!cancelled) {
          const presets = (settings as { taskPromptPresets?: readonly TaskPromptPreset[] }).taskPromptPresets ?? [];
          setTaskPromptPresets([...presets]);
          setTaskPromptPresetError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setTaskPromptPresets([]);
          setTaskPromptPresetError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api]);
  useEffect(() => {
    if (!editor) {
      setUndoRedoState({ canRedo: false, canUndo: false });
      return undefined;
    }

    const updateUndoRedoState = () => {
      setUndoRedoState({
        canRedo: editor.can().redo(),
        canUndo: editor.can().undo()
      });
    };

    updateUndoRedoState();
    editor.on("transaction", updateUndoRedoState);
    return () => {
      editor.off("transaction", updateUndoRedoState);
    };
  }, [editor]);
  useEffect(() => {
    const query = searchValue.trim();
    if (!currentProject || !query) {
      setSearchResults([]);
      setSearchBusy(false);
      return;
    }

    let cancelled = false;
    setSearchBusy(true);
    void Promise.all(
      chapters.map(async (chapter) => {
        const content = (await api.chapter.getContent({ projectId: currentProject.id, chapterId: chapter.id })) as { plainText?: string } | undefined;
        const plainText = content?.plainText ?? "";
        const titleMatches = chapter.title.toLocaleLowerCase("zh-CN").includes(query.toLocaleLowerCase("zh-CN"));
        const contentMatches = plainText.toLocaleLowerCase("zh-CN").includes(query.toLocaleLowerCase("zh-CN"));
        if (!titleMatches && !contentMatches) {
          return null;
        }

        return {
          chapterId: chapter.id,
          snippet: buildSearchSnippet(contentMatches ? plainText : chapter.title, query),
          title: chapter.title
        } satisfies EditorSearchResult;
      })
    )
      .then((results) => {
        if (!cancelled) {
          setSearchResults(results.filter((result): result is EditorSearchResult => Boolean(result)));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSearchResults([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSearchBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, chapters, currentProject, searchValue]);
  const handleCreateChapter = useCallback(() => flushBeforeNavigation(() => onCreateChapter()), [flushBeforeNavigation, onCreateChapter]);
  const handleCreateChapterAfter = useCallback(
    (chapterId: string) => flushBeforeNavigation(() => onCreateChapter({ afterChapterId: chapterId })),
    [flushBeforeNavigation, onCreateChapter]
  );
  const handleSelectChapter = useCallback(
    (chapterId: string) => {
      flushBeforeNavigation(() => onSelectChapter(chapterId));
    },
    [flushBeforeNavigation, onSelectChapter]
  );
  const handleDeleteChapter = useCallback(
    (chapterId: string) => {
      flushBeforeNavigation(() => onDeleteChapter(chapterId));
    },
    [flushBeforeNavigation, onDeleteChapter]
  );
  const handleExport = useCallback(() => flushBeforeNavigation(onExport), [flushBeforeNavigation, onExport]);
  const handleImport = useCallback(() => flushBeforeNavigation(onImport), [flushBeforeNavigation, onImport]);
  const handleWelcome = useCallback(() => {
    setConfirmWelcomeOpen(true);
  }, []);
  const closeConfirmWelcome = useCallback(() => {
    setConfirmWelcomeOpen(false);
  }, []);
  const confirmWelcome = useCallback(() => {
    setConfirmWelcomeOpen(false);
    flushBeforeNavigation(onWelcome);
  }, [flushBeforeNavigation, onWelcome]);
  const handleSettings = useCallback((category?: SettingsCategory) => flushBeforeNavigation(() => onSettings(category)), [flushBeforeNavigation, onSettings]);
  const handleFocusModeToggle = useCallback(() => {
    setFocusMode((current) => !current);
    setSearchValue("");
  }, []);
  const handleUndo = useCallback(() => {
    editor?.chain().focus().undo().run();
  }, [editor]);
  const handleRedo = useCallback(() => {
    editor?.chain().focus().redo().run();
  }, [editor]);
  const handleSearchResultSelect = useCallback(
    (chapterId: string) => {
      setSearchValue("");
      flushBeforeNavigation(() => onSelectChapter(chapterId));
    },
    [flushBeforeNavigation, onSelectChapter]
  );
  const handleSelectionToScratchpad = useCallback(
    async (snapshot: SelectionSnapshot) => {
      if (!currentProject) {
        throw new Error("当前项目不可用，无法加入草稿纸。");
      }

      await api.scratch.create({
        projectId: currentProject.id,
        chapterId: snapshot.chapterId,
        content: snapshot.text,
        pinned: false
      });
      onOpenScratchpad();
    },
    [api, currentProject, onOpenScratchpad]
  );
  const startChapterRename = useCallback((chapterId: string, currentTitle: string) => {
    setRenameChapterDraft({ id: chapterId, title: currentTitle });
    setRenameChapterTitle(currentTitle);
  }, []);

  const cancelChapterRename = useCallback(() => {
    setRenameChapterDraft(null);
    setRenameChapterTitle("");
  }, []);

  const startInlineChapterRename = useCallback(() => {
    if (!activeChapter) {
      return;
    }
    setInlineChapterTitle(activeChapter.title);
    setInlineChapterRenameActive(true);
  }, [activeChapter]);

  const cancelInlineChapterRename = useCallback(() => {
    setInlineChapterRenameActive(false);
    setInlineChapterTitle("");
  }, []);

  const submitInlineChapterRename = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const title = inlineChapterTitle.trim();
      if (!activeChapter || !title) {
        cancelInlineChapterRename();
        return;
      }

      if (title !== activeChapter.title) {
        onRenameChapter(activeChapter.id, title);
      }
      cancelInlineChapterRename();
    },
    [activeChapter, cancelInlineChapterRename, inlineChapterTitle, onRenameChapter]
  );

  const openTargetWordCountModal = useCallback(() => {
    if (!activeChapter) {
      return;
    }
    setTargetWordCountDraft(activeChapter.targetWordCount ? String(activeChapter.targetWordCount) : "");
    setTargetWordCountError(null);
    setTargetWordCountModalOpen(true);
  }, [activeChapter]);

  const closeTargetWordCountModal = useCallback(() => {
    if (targetWordCountSaving) {
      return;
    }
    setTargetWordCountModalOpen(false);
    setTargetWordCountDraft("");
    setTargetWordCountError(null);
  }, [targetWordCountSaving]);

  const submitChapterRename = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const title = renameChapterTitle.trim();
      if (!renameChapterDraft || !title) {
        return;
      }

      if (title !== renameChapterDraft.title) {
        onRenameChapter(renameChapterDraft.id, title);
      }

      cancelChapterRename();
    },
    [cancelChapterRename, onRenameChapter, renameChapterDraft, renameChapterTitle]
  );

  const submitTargetWordCount = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!activeChapter || targetWordCountSaving) {
        return;
      }

      const trimmed = targetWordCountDraft.trim();
      const nextTargetWordCount = trimmed ? Number.parseInt(trimmed, 10) : null;
      if (trimmed && (!/^\d+$/.test(trimmed) || !nextTargetWordCount || nextTargetWordCount < 100 || nextTargetWordCount > 500000)) {
        setTargetWordCountError("目标字数需要在 100 到 500,000 之间。");
        return;
      }

      setTargetWordCountSaving(true);
      setTargetWordCountError(null);
      try {
        await onUpdateChapterTargetWordCount(activeChapter.id, nextTargetWordCount);
        setTargetWordCountModalOpen(false);
        setTargetWordCountDraft("");
      } catch (reason) {
        setTargetWordCountError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setTargetWordCountSaving(false);
      }
    },
    [activeChapter, onUpdateChapterTargetWordCount, targetWordCountDraft, targetWordCountSaving]
  );

  return (
    <div className="writing-page">
      <TopBar
        focusMode={focusMode}
        title={currentProject?.name ?? "我的小说"}
        saveStatus={editorStore.saveStatus}
        searchValue={searchValue}
        editorSettings={editorStore.editorSettings}
        canRedo={undoRedoState.canRedo}
        canUndo={undoRedoState.canUndo}
        onExport={handleExport}
        onImport={handleImport}
        onRedo={editor ? handleRedo : undefined}
        onUndo={editor ? handleUndo : undefined}
        onEditorSettingsChange={editorStore.updateEditorSettings}
        onFocusModeToggle={handleFocusModeToggle}
        onSearchChange={setSearchValue}
        onWelcome={handleWelcome}
        onSettings={handleSettings}
      />
      {navigationError ? (
        <div className="navigation-error-banner" role="alert">
          {navigationError}
        </div>
      ) : null}
      {searchValue.trim() && !focusMode ? (
        <div className="search-result-list" role="listbox" aria-label="搜索结果">
          {searchBusy ? <div className="search-result-empty">正在搜索...</div> : null}
          {!searchBusy && searchResults.length === 0 ? <div className="search-result-empty">没有找到匹配内容</div> : null}
          {searchResults.map((result) => (
            <button key={result.chapterId} onClick={() => handleSearchResultSelect(result.chapterId)} type="button">
              <strong>{renderHighlightedSearchText(result.title, searchValue)}</strong>
              <span>{renderHighlightedSearchText(result.snippet, searchValue)}</span>
            </button>
          ))}
        </div>
      ) : null}

      <main className={`workspace ${focusMode ? "focus-mode no-sidebar" : sidebarOpen ? "" : "no-sidebar"} ${editorThemeClass}`}>
        {!focusMode ? (
          <LeftChapterTree
            activeChapterId={activeChapterId}
            chapters={chapters}
            onCreateChapter={handleCreateChapter}
            onCreateChapterAfter={handleCreateChapterAfter}
            onDeleteChapter={handleDeleteChapter}
            onRenameChapter={startChapterRename}
            onSelectChapter={handleSelectChapter}
          />
        ) : null}

        <PanelGroup
          className="workspace-main-panels"
          defaultLayout={sidebarLayout.defaultLayout}
          id="moshu-writing-sidebar-v2"
          onLayoutChanged={sidebarLayout.onLayoutChanged}
          orientation="horizontal"
        >
          <Panel className="editor-panel" defaultSize="100%" id="editor" minSize={!focusMode && sidebarOpen ? "360px" : "100%"}>
            <section className="editor-wrap">
              <div className="editor-scroll">
                <div className="editor-inner" style={editorInnerStyle}>
                  {taskPromptPresetError ? (
                    <div className="inline-error-banner" role="alert">
                      提示词预设加载失败：{taskPromptPresetError}
                    </div>
                  ) : null}
                  {editorStore.pendingDraftRecovery ? (
                    <DraftRecoveryPrompt
                      draft={editorStore.pendingDraftRecovery}
                      onDismiss={editorStore.dismissDraftRecovery}
                      onRecover={editorStore.recoverDraft}
                    />
                  ) : null}
                  {activeChapter ? (
                    <>
                      {inlineChapterRenameActive ? (
                        <form className="chapter-title-form" onSubmit={submitInlineChapterRename}>
                          <Input
                            autoFocus
                            id="chapter-title-input"
                            value={inlineChapterTitle}
                            onChange={(event) => setInlineChapterTitle(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                cancelInlineChapterRename();
                              }
                            }}
                          />
                          <button className="small-button blue" disabled={!inlineChapterTitle.trim()} type="submit">
                            保存
                          </button>
                        </form>
                      ) : (
                        <button className="chapter-heading chapter-heading-button" onClick={startInlineChapterRename} title="点击重命名章节" type="button">
                          {activeChapter.title}
                        </button>
                      )}
                      <NovelEditor
                        chapterId={activeChapter.id}
                        contentJson={editorStore.contentJson}
                        contentVersion={editorStore.contentVersion}
                        editorSettings={editorStore.editorSettings}
                        key={`${activeChapter.id}:${editorStore.contentVersion}`}
                        taskPromptPresets={taskPromptPresets}
                        onContentChange={editorStore.handleContentChange}
                        onEditorReady={setEditor}
                        onSelectionToChat={onSelectionToChat}
                        onSelectionToScratchpad={handleSelectionToScratchpad}
                        onTask={onTask}
                      />
                    </>
                  ) : (
                    <div className="empty-editor-state">
                      <h1 className="chapter-heading">请选择或新建章节</h1>
                      <p>从左侧章节列表选择一个章节，或新建章节后开始写作。</p>
                      <button className="small-button blue" onClick={handleCreateChapter} type="button">
                        新建章节
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {!focusMode && !sidebarOpen && activeChapter ? <FloatingAiButton onClick={onOpenAiChat} /> : null}

              <footer className="bottom-metrics">
                <div className="metrics-inner">
                  <div className="metric-left">
                    <span>字数：{editorStore.wordCount.toLocaleString("zh-CN")}</span>
                    <span>今日：{editorStore.dailyWordCount.toLocaleString("zh-CN")}</span>
                    <button className="metric-button" disabled={!activeChapter} onClick={openTargetWordCountModal} type="button">
                      本章目标：{targetWordCount ? targetWordCount.toLocaleString("zh-CN") : "设置"}
                    </button>
                    {targetProgressLabel ? <span className="metric-progress">{targetProgressLabel}</span> : null}
                  </div>
                  <div className="metric-right">
                    <span>{editorStore.saveStatusLabel}</span>
                  </div>
                </div>
              </footer>
            </section>
          </Panel>

          {!focusMode && sidebarOpen ? (
            <>
              <PanelResizeHandle className="sidebar-resize-handle" />
              <Panel className="right-sidebar-panel" defaultSize="520px" groupResizeBehavior="preserve-pixel-size" id="right-sidebar" maxSize="75%" minSize="360px">
                <RightUtilitySidebar
                  activeTab={sidebarTab}
                  aiChatDraftSeed={aiChatDraftSeed}
                  chapters={chapters}
                  currentChapterId={activeChapter?.id ?? null}
                  currentChapterTitle={activeChapter?.title ?? null}
                  currentProjectId={currentProject?.id ?? null}
                  scratchpadRefreshToken={scratchpadRefreshToken}
                  selectionSnapshot={selectionSnapshot}
                  taskPromptPreset={taskPromptPreset}
                  taskType={taskType}
                  editor={editor}
                  flushPendingSave={editorStore.flushPendingSave}
                  onTabChange={onSidebarTabChange}
                  onClose={onCloseSidebar}
                  onOpenSettings={handleSettings}
                />
              </Panel>
            </>
          ) : null}
        </PanelGroup>
      </main>

      <Modal open={Boolean(renameChapterDraft)} title="重命名章节" onClose={cancelChapterRename}>
        <form className="rename-form" onSubmit={submitChapterRename}>
          <label className="field-label" htmlFor="chapter-rename-input">
            章节名称
          </label>
          <Input
            autoFocus
            id="chapter-rename-input"
            value={renameChapterTitle}
            onChange={(event) => setRenameChapterTitle(event.target.value)}
          />
          <div className="modal-actions">
            <Button onClick={cancelChapterRename} type="button" variant="ghost">
              取消
            </Button>
            <Button disabled={!renameChapterTitle.trim() || renameChapterTitle.trim() === renameChapterDraft?.title} type="submit" variant="primary">
              保存
            </Button>
          </div>
        </form>
      </Modal>
      <Modal open={targetWordCountModalOpen} title="设置本章目标" onClose={closeTargetWordCountModal}>
        <form className="rename-form" onSubmit={submitTargetWordCount}>
          <label className="field-label" htmlFor="chapter-target-input">
            目标字数
          </label>
          <Input
            autoFocus
            id="chapter-target-input"
            inputMode="numeric"
            placeholder="例如 3000，留空表示不设置"
            value={targetWordCountDraft}
            onChange={(event) => setTargetWordCountDraft(event.target.value)}
          />
          {targetWordCountError ? (
            <div className="inline-error-banner compact" role="alert">
              {targetWordCountError}
            </div>
          ) : null}
          <div className="modal-actions">
            <Button disabled={targetWordCountSaving} onClick={closeTargetWordCountModal} type="button" variant="ghost">
              取消
            </Button>
            <Button disabled={targetWordCountSaving} type="submit" variant="primary">
              保存
            </Button>
          </div>
        </form>
      </Modal>
      <Modal open={confirmWelcomeOpen} title="返回开始页？" onClose={closeConfirmWelcome}>
        <div className="confirm-dialog-body">
          <p>当前项目会保留在最近项目中，编辑内容会先保存。确认返回开始页吗？</p>
          <div className="modal-actions">
            <Button onClick={closeConfirmWelcome} type="button" variant="ghost">
              继续写作
            </Button>
            <Button onClick={confirmWelcome} type="button" variant="primary">
              返回开始页
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
