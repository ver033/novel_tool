import { useCallback, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import type { Editor } from "@tiptap/react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Modal } from "../components/Modal";
import { FloatingAiButton } from "../editor/FloatingAiButton";
import { NovelEditor } from "../editor/NovelEditor";
import { LeftChapterTree } from "../layout/LeftChapterTree";
import { RightUtilitySidebar, type SidebarTab, type TaskType } from "../layout/RightUtilitySidebar";
import { TopBar } from "../layout/TopBar";
import { getNovelToolApi } from "../state/app-store";
import { useEditorStore } from "../state/editor-store";
import type { SettingsCategory } from "./SettingsPage";
import type { ChapterSummary, ProjectRecord, SelectionSnapshot } from "../../main/shared/types";

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

type WritingPageProps = {
  readonly activeChapter: ChapterSummary | null;
  readonly activeChapterId: string | null;
  readonly chapters: readonly ChapterSummary[];
  readonly currentProject: ProjectRecord | null;
  readonly sidebarOpen: boolean;
  readonly sidebarTab: SidebarTab;
  readonly scratchpadRefreshToken: number;
  readonly selectionSnapshot: SelectionSnapshot | null;
  readonly taskType: TaskType;
  readonly onCreateChapter: () => void;
  readonly onDeleteChapter: (chapterId: string) => void;
  readonly onRenameChapter: (chapterId: string, currentTitle: string) => void;
  readonly onSelectChapter: (chapterId: string) => void;
  readonly onSidebarTabChange: (tab: SidebarTab) => void;
  readonly onCloseSidebar: () => void;
  readonly onOpenAiChat: () => void;
  readonly onOpenScratchpad: () => void;
  readonly onImport: () => void;
  readonly onTask: (task: TaskType, snapshot?: SelectionSnapshot | null) => void;
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
  scratchpadRefreshToken,
  selectionSnapshot,
  taskType,
  onCreateChapter,
  onDeleteChapter,
  onRenameChapter,
  onSelectChapter,
  onSidebarTabChange,
  onCloseSidebar,
  onOpenAiChat,
  onOpenScratchpad,
  onImport,
  onTask,
  onWelcome,
  onSettings
}: WritingPageProps) {
  const api = useMemo(getNovelToolApi, []);
  const editorStore = useEditorStore(activeChapter);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [renameChapterDraft, setRenameChapterDraft] = useState<{ id: string; title: string } | null>(null);
  const [renameChapterTitle, setRenameChapterTitle] = useState("");
  const targetWordCount = activeChapter?.targetWordCount ?? 3000;
  const editorInnerStyle: EditorInnerStyle = {
    maxWidth: pageWidthBySetting[editorStore.editorSettings.pageWidth] ?? pageWidthBySetting.medium
  };
  const editorThemeClass = themeClassBySetting[editorStore.editorSettings.theme] ?? themeClassBySetting.light;
  const flushBeforeNavigation = useCallback(
    (next: () => void) => {
      void editorStore.flushPendingSave().then(next).catch(() => undefined);
    },
    [editorStore]
  );
  const handleCreateChapter = useCallback(() => flushBeforeNavigation(onCreateChapter), [flushBeforeNavigation, onCreateChapter]);
  const handleSelectChapter = useCallback(
    (chapterId: string) => {
      flushBeforeNavigation(() => onSelectChapter(chapterId));
    },
    [flushBeforeNavigation, onSelectChapter]
  );
  const handleImport = useCallback(() => flushBeforeNavigation(onImport), [flushBeforeNavigation, onImport]);
  const handleWelcome = useCallback(() => flushBeforeNavigation(onWelcome), [flushBeforeNavigation, onWelcome]);
  const handleSettings = useCallback((category?: SettingsCategory) => flushBeforeNavigation(() => onSettings(category)), [flushBeforeNavigation, onSettings]);
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

  return (
    <div className="writing-page">
      <TopBar
        title={currentProject?.name ?? "我的小说"}
        saveStatus={editorStore.saveStatus}
        editorSettings={editorStore.editorSettings}
        onImport={handleImport}
        onEditorSettingsChange={editorStore.updateEditorSettings}
        onWelcome={handleWelcome}
        onSettings={handleSettings}
      />

      <main className={`workspace ${sidebarOpen ? "" : "no-sidebar"} ${editorThemeClass}`}>
        <LeftChapterTree
          activeChapterId={activeChapterId}
          chapters={chapters}
          onCreateChapter={handleCreateChapter}
          onDeleteChapter={onDeleteChapter}
          onRenameChapter={startChapterRename}
          onSelectChapter={handleSelectChapter}
        />

        <section className="editor-wrap">
          <div className="editor-scroll">
            <div className="editor-inner" style={editorInnerStyle}>
              {activeChapter ? (
                <>
                  <h1 className="chapter-heading">{activeChapter.title}</h1>
                  <NovelEditor
                    chapterId={activeChapter.id}
                    contentJson={editorStore.contentJson}
                    contentVersion={editorStore.contentVersion}
                    editorSettings={editorStore.editorSettings}
                    onContentChange={editorStore.handleContentChange}
                    onEditorReady={setEditor}
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

          {!sidebarOpen && activeChapter ? <FloatingAiButton onClick={onOpenAiChat} /> : null}

          <footer className="bottom-metrics">
            <div className="metrics-inner">
              <div className="metric-left">
                <span>字数：{editorStore.wordCount.toLocaleString("zh-CN")}</span>
                <span>今日：{(activeChapter?.dailyWordCount ?? 0).toLocaleString("zh-CN")}</span>
                <span>本章目标：{targetWordCount.toLocaleString("zh-CN")}</span>
              </div>
              <div className="metric-right">
                <span>中文⌄</span>
                <span>{editorStore.saveStatusLabel}</span>
              </div>
            </div>
          </footer>
        </section>

        {sidebarOpen ? (
          <RightUtilitySidebar
            activeTab={sidebarTab}
            currentChapterId={activeChapter?.id ?? null}
            currentChapterTitle={activeChapter?.title ?? null}
            currentProjectId={currentProject?.id ?? null}
            scratchpadRefreshToken={scratchpadRefreshToken}
            selectionSnapshot={selectionSnapshot}
            taskType={taskType}
            editor={editor}
            flushPendingSave={editorStore.flushPendingSave}
            onTabChange={onSidebarTabChange}
            onClose={onCloseSidebar}
            onOpenSettings={handleSettings}
          />
        ) : null}
      </main>

      <Modal open={Boolean(renameChapterDraft)} title="重命名章节">
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
    </div>
  );
}
