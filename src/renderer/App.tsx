import "./styles/globals.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "./layout/AppShell";
import type { FloatingPanelGeometry, FloatingPanelKind, FloatingPanelState, OutlineFloatingTab } from "./layout/floating-panel-state";
import { clampFloatingPanelGeometry, createFloatingPanelId, getDefaultFloatingPanelGeometry, openOrRaiseFloatingPanel } from "./layout/floating-panel-state";
import type { SidebarTab, TaskType } from "./layout/RightUtilitySidebar";
import { ExportPage } from "./routes/ExportPage";
import { ImportWizardPage } from "./routes/ImportWizardPage";
import { ChapterReviewPage } from "./routes/ChapterReviewPage";
import { NewProjectPage } from "./routes/NewProjectPage";
import { OutlinePage } from "./routes/OutlinePage";
import { CharacterRelationshipGraphPage } from "./relationship-graph/CharacterRelationshipGraphPage";
import { SettingsPage, type SettingsCategory } from "./routes/SettingsPage";
import { WelcomePage } from "./routes/WelcomePage";
import { WritingGoalsPage } from "./routes/WritingGoalsPage";
import { WritingPage } from "./routes/WritingPage";
import type { AiChatDraftSeed } from "./sidebar/chat-draft";
import { getNovelToolApi, useAppStore } from "./state/app-store";
import type { ImportConfirmResult, ProjectCreateInput, SelectionSnapshot, TaskPromptPreset, UsageAnalyticsRecordEventInput } from "../main/shared/types";
import { useI18n } from "./i18n";

type Page = "welcome" | "writing" | "relationshipGraph" | "outline" | "chapterReview" | "writingGoals" | "settings" | "import" | "export" | "newProject";
type ImportReturnPage = "welcome" | "writing";
type ExportReturnPage = "welcome" | "writing";
type SettingsReturnPage = "welcome" | "writing" | "relationshipGraph" | "outline" | "chapterReview" | "writingGoals";

const pageUsageFeatures: Record<Page, UsageAnalyticsRecordEventInput["feature"]> = {
  welcome: "welcome",
  writing: "writing",
  relationshipGraph: "relationshipGraph",
  outline: "outline",
  chapterReview: "chapterReview",
  writingGoals: "writingGoals",
  settings: "settings",
  import: "import",
  export: "export",
  newProject: "newProject"
};

export function App() {
  const { locale } = useI18n();
  const [page, setPage] = useState<Page>("welcome");
  const [importReturnPage, setImportReturnPage] = useState<ImportReturnPage>("welcome");
  const [exportReturnPage, setExportReturnPage] = useState<ExportReturnPage>("writing");
  const [settingsReturnPage, setSettingsReturnPage] = useState<SettingsReturnPage>("welcome");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("task");
  const [taskType, setTaskType] = useState<TaskType>("polish");
  const [taskPromptPreset, setTaskPromptPreset] = useState<TaskPromptPreset | null>(null);
  const [selectionSnapshot, setSelectionSnapshot] = useState<SelectionSnapshot | null>(null);
  const [aiChatDraftSeed, setAiChatDraftSeed] = useState<AiChatDraftSeed | null>(null);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("ai");
  const [importStep, setImportStep] = useState(1);
  const [welcomeNotice, setWelcomeNotice] = useState<string | null>(null);
  const [scratchpadRefreshToken, setScratchpadRefreshToken] = useState(0);
  const [auxiliaryRefreshToken, setAuxiliaryRefreshToken] = useState(0);
  const [floatingPanels, setFloatingPanels] = useState<FloatingPanelState[]>([]);
  const appStore = useAppStore();
  const usagePageRef = useRef<Page>(page);
  const usageStartedAtRef = useRef<number | null>(null);

  const recordUsageEvent = useCallback((input: UsageAnalyticsRecordEventInput) => {
    void getNovelToolApi().usageAnalytics.recordEvent(input).catch(() => undefined);
  }, []);

  const isUsageActive = useCallback(() => !document.hidden && document.hasFocus(), []);

  const startUsageTimer = useCallback(() => {
    if (!isUsageActive() || usageStartedAtRef.current !== null) {
      return;
    }
    usageStartedAtRef.current = Date.now();
  }, [isUsageActive]);

  const flushUsageTimer = useCallback(() => {
    const startedAt = usageStartedAtRef.current;
    usageStartedAtRef.current = null;
    if (startedAt === null) {
      return;
    }
    const durationMs = Date.now() - startedAt;
    if (durationMs < 1000) {
      return;
    }
    recordUsageEvent({
      eventType: "page_active",
      feature: pageUsageFeatures[usagePageRef.current],
      durationMs,
      occurredAt: new Date().toISOString()
    });
  }, [recordUsageEvent]);

  const floatingViewport = useCallback(
    () => ({
      width: Math.max(360, window.innerWidth - (sidebarOpen ? 420 : 0)),
      height: Math.max(420, window.innerHeight - 70)
    }),
    [sidebarOpen]
  );

  useEffect(() => {
    recordUsageEvent({ eventType: "app_opened", feature: "app", occurredAt: new Date().toISOString() });
    recordUsageEvent({ eventType: "page_view", feature: pageUsageFeatures[usagePageRef.current], occurredAt: new Date().toISOString() });
    startUsageTimer();

    function handleVisibilityOrFocusChange(): void {
      if (isUsageActive()) {
        startUsageTimer();
      } else {
        flushUsageTimer();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityOrFocusChange);
    window.addEventListener("focus", handleVisibilityOrFocusChange);
    window.addEventListener("blur", handleVisibilityOrFocusChange);
    window.addEventListener("beforeunload", flushUsageTimer);
    return () => {
      flushUsageTimer();
      document.removeEventListener("visibilitychange", handleVisibilityOrFocusChange);
      window.removeEventListener("focus", handleVisibilityOrFocusChange);
      window.removeEventListener("blur", handleVisibilityOrFocusChange);
      window.removeEventListener("beforeunload", flushUsageTimer);
    };
  }, [flushUsageTimer, isUsageActive, recordUsageEvent, startUsageTimer]);

  useEffect(() => {
    if (usagePageRef.current === page) {
      return;
    }
    flushUsageTimer();
    usagePageRef.current = page;
    recordUsageEvent({ eventType: "page_view", feature: pageUsageFeatures[page], occurredAt: new Date().toISOString() });
    startUsageTimer();
  }, [flushUsageTimer, page, recordUsageEvent, startUsageTimer]);

  useEffect(() => {
    function handleFloatingViewportResize(): void {
      setFloatingPanels((current) =>
        current.length === 0
          ? current
          : current.map((panel) => ({
              ...panel,
              ...clampFloatingPanelGeometry(panel, floatingViewport())
            }))
      );
    }

    handleFloatingViewportResize();
    window.addEventListener("resize", handleFloatingViewportResize);
    return () => window.removeEventListener("resize", handleFloatingViewportResize);
  }, [floatingViewport]);

  const openWriting = useCallback(() => {
    setSidebarOpen(false);
    setPage("writing");
  }, []);
  const openRelationshipGraph = useCallback(() => {
    recordUsageEvent({ eventType: "feature_used", feature: "relationship_graph", occurredAt: new Date().toISOString() });
    setSidebarOpen(false);
    setPage("relationshipGraph");
  }, [recordUsageEvent]);
  const openOutline = useCallback(() => {
    setSidebarOpen(false);
    setPage("outline");
  }, []);
  const openChapterReview = useCallback(() => {
    setSidebarOpen(false);
    setPage("chapterReview");
  }, []);
  const openWritingGoals = useCallback(() => {
    setSidebarOpen(false);
    setPage("writingGoals");
  }, []);
  const openWritingAtChapter = useCallback((chapterId: string) => {
    appStore.selectChapter(chapterId);
    setSidebarOpen(false);
    setPage("writing");
  }, [appStore]);
  const openWelcome = useCallback(() => {
    setWelcomeNotice(null);
    void appStore.refreshRecentProjects();
    setPage("welcome");
  }, [appStore]);
  const openSettings = useCallback((category?: SettingsCategory) => {
    if (category) {
      setSettingsCategory(category);
    }
    setSettingsReturnPage(page === "writing" || page === "relationshipGraph" || page === "outline" || page === "chapterReview" || page === "writingGoals" ? page : "welcome");
    setPage("settings");
  }, [page]);
  const returnFromSettings = useCallback(() => {
    setPage(settingsReturnPage);
  }, [settingsReturnPage]);
  const openImport = useCallback(() => {
    recordUsageEvent({ eventType: "feature_used", feature: "txt_import", occurredAt: new Date().toISOString() });
    setImportStep(1);
    setImportReturnPage(page === "writing" ? "writing" : "welcome");
    setPage("import");
  }, [page, recordUsageEvent]);
  const returnFromImport = useCallback(() => {
    setPage(importReturnPage);
  }, [importReturnPage]);
  const openExport = useCallback(() => {
    recordUsageEvent({ eventType: "feature_used", feature: "txt_export", occurredAt: new Date().toISOString() });
    setExportReturnPage(page === "writing" ? "writing" : "welcome");
    setPage("export");
  }, [page, recordUsageEvent]);
  const returnFromExport = useCallback(() => {
    setPage(exportReturnPage);
  }, [exportReturnPage]);
  const continueWriting = useCallback(() => {
    void appStore.openProjectFile()
      .then((opened) => {
        if (opened) {
          setWelcomeNotice(null);
          openWriting();
          return;
        }
        setWelcomeNotice(locale === "ja-JP" ? "プロジェクトファイルを開く操作をキャンセルしました。最近のプロジェクトからも執筆を再開できます。" : "已取消打开项目文件。也可以从下方最近项目继续写作。");
      })
      .catch((reason: unknown) => {
        setWelcomeNotice(reason instanceof Error ? reason.message : String(reason));
      });
  }, [appStore, locale, openWriting]);
  const openNewProject = useCallback(() => {
    setWelcomeNotice(null);
    setPage("newProject");
  }, []);
  const createProject = useCallback(async (input: ProjectCreateInput) => {
    setWelcomeNotice(null);
    await appStore.createProject(input);
    openWriting();
  }, [appStore, openWriting]);
  const openProject = useCallback((projectId: string) => {
    setWelcomeNotice(null);
    void appStore.openProject(projectId).then(openWriting);
  }, [appStore, openWriting]);
  const renameProject = useCallback((projectId: string, name: string) => {
    void appStore.renameProject(projectId, name).catch((reason: unknown) => {
      setWelcomeNotice(reason instanceof Error ? reason.message : String(reason));
    });
  }, [appStore]);
  const deleteProject = useCallback((projectId: string, currentName: string) => {
    void appStore.deleteProject(projectId, currentName).catch((reason: unknown) => {
      setWelcomeNotice(reason instanceof Error ? reason.message : String(reason));
    });
  }, [appStore]);
  const createChapter = useCallback((options?: { readonly afterChapterId?: string }) => {
    void appStore.createChapter(options);
  }, [appStore]);
  const renameChapter = useCallback((chapterId: string, title: string) => {
    void appStore.renameChapter(chapterId, title);
  }, [appStore]);
  const updateChapterTargetWordCount = useCallback(
    (chapterId: string, targetWordCount: number | null) => appStore.updateChapterTargetWordCount(chapterId, targetWordCount),
    [appStore]
  );
  const deleteChapter = useCallback((chapterId: string) => {
    void appStore.deleteChapter(chapterId);
  }, [appStore]);
  const openAiChat = useCallback(() => {
    recordUsageEvent({ eventType: "feature_used", feature: "ai_chat", occurredAt: new Date().toISOString() });
    setSidebarOpen(true);
    setSidebarTab("chat");
  }, [recordUsageEvent]);
  const sendSelectionToChat = useCallback((snapshot: SelectionSnapshot) => {
    recordUsageEvent({ eventType: "feature_used", feature: "ai_chat", occurredAt: new Date().toISOString() });
    setSelectionSnapshot(snapshot);
    setSidebarOpen(true);
    setSidebarTab("chat");
    setAiChatDraftSeed((current) => ({
      id: (current?.id ?? 0) + 1,
      text: snapshot.text
    }));
  }, [recordUsageEvent]);
  const openScratchpad = useCallback(() => {
    recordUsageEvent({ eventType: "feature_used", feature: "scratchpad", occurredAt: new Date().toISOString() });
    setSidebarOpen(true);
    setSidebarTab("scratch");
    setScratchpadRefreshToken((current) => current + 1);
  }, [recordUsageEvent]);
  const handleAuxiliaryChanged = useCallback(() => {
    setAuxiliaryRefreshToken((current) => current + 1);
    setScratchpadRefreshToken((current) => current + 1);
  }, []);
  const runTask = useCallback((task: TaskType, snapshot?: SelectionSnapshot | null, preset?: TaskPromptPreset | null) => {
    recordUsageEvent({ eventType: "feature_used", feature: "ai_task", occurredAt: new Date().toISOString() });
    setTaskType(task);
    setTaskPromptPreset(preset ?? null);
    setSelectionSnapshot(snapshot ?? null);
    setSidebarOpen(true);
    setSidebarTab("task");
  }, [recordUsageEvent]);
  const openFloatingPanel = useCallback(
    (kind: FloatingPanelKind, chapterId: string | null = appStore.activeChapterId, scratchNoteId: string | null = null, outlineTab: OutlineFloatingTab = "chapter") => {
      setFloatingPanels((current) => openOrRaiseFloatingPanel(current, kind, chapterId, floatingViewport(), scratchNoteId, outlineTab));
    },
    [appStore.activeChapterId, floatingViewport]
  );
  const openFloatingAiChat = useCallback(() => {
    recordUsageEvent({ eventType: "feature_used", feature: "ai_chat", occurredAt: new Date().toISOString() });
    openFloatingPanel("chat", null);
  }, [openFloatingPanel, recordUsageEvent]);
  const openFloatingScratchpad = useCallback(
    (chapterId: string | null = appStore.activeChapterId, scratchNoteId: string | null = null) => {
      recordUsageEvent({ eventType: "feature_used", feature: "scratchpad", occurredAt: new Date().toISOString() });
      openFloatingPanel("scratch", chapterId, scratchNoteId);
      setScratchpadRefreshToken((current) => current + 1);
    },
    [appStore.activeChapterId, openFloatingPanel, recordUsageEvent]
  );
  const runFloatingTask = useCallback(
    (task: TaskType, snapshot?: SelectionSnapshot | null, preset?: TaskPromptPreset | null) => {
      recordUsageEvent({ eventType: "feature_used", feature: "ai_task", occurredAt: new Date().toISOString() });
      setTaskType(task);
      setTaskPromptPreset(preset ?? null);
      setSelectionSnapshot(snapshot ?? null);
      openFloatingPanel("task", snapshot?.chapterId ?? appStore.activeChapterId);
    },
    [appStore.activeChapterId, openFloatingPanel, recordUsageEvent]
  );
  const closeFloatingPanel = useCallback((panelId: string) => {
    setFloatingPanels((current) => current.filter((panel) => panel.id !== panelId));
  }, []);
  const handleFloatingScratchNoteSaved = useCallback((panelId: string, noteId: string) => {
    setFloatingPanels((current) =>
      current.map((panel) =>
        panel.id === panelId && panel.kind === "scratch"
          ? {
              ...panel,
              id: createFloatingPanelId("scratch", panel.chapterId, noteId),
              scratchDraftId: null,
              scratchNoteId: noteId
            }
          : panel
      )
    );
  }, []);
  const minimizeFloatingPanel = useCallback((panelId: string) => {
    setFloatingPanels((current) => current.map((panel) => (panel.id === panelId ? { ...panel, minimized: !panel.minimized } : panel)));
  }, []);
  const raiseFloatingPanel = useCallback((panelId: string) => {
    setFloatingPanels((current) => {
      const maxZIndex = current.reduce((max, panel) => Math.max(max, panel.zIndex), 100);
      return current.map((panel) => (panel.id === panelId ? { ...panel, zIndex: maxZIndex + 1 } : panel));
    });
  }, []);
  const moveFloatingPanel = useCallback(
    (panelId: string, geometry: Pick<FloatingPanelGeometry, "x" | "y">) => {
      setFloatingPanels((current) =>
        current.map((panel) =>
          panel.id === panelId
            ? {
                ...panel,
                ...clampFloatingPanelGeometry({ ...panel, ...geometry }, floatingViewport())
              }
            : panel
        )
      );
    },
    [floatingViewport]
  );
  const resizeFloatingPanel = useCallback(
    (panelId: string, geometry: Pick<FloatingPanelGeometry, "width" | "height">) => {
      setFloatingPanels((current) =>
        current.map((panel) =>
          panel.id === panelId
            ? {
                ...panel,
                ...clampFloatingPanelGeometry({ ...panel, ...geometry }, floatingViewport())
              }
            : panel
        )
      );
    },
    [floatingViewport]
  );
  const resetFloatingPanel = useCallback(
    (panelId: string) => {
      setFloatingPanels((current) =>
        current.map((panel, index) =>
          panel.id === panelId
            ? {
                ...panel,
                ...getDefaultFloatingPanelGeometry(panel.kind, floatingViewport(), index * 26),
                minimized: false
              }
            : panel
        )
      );
    },
    [floatingViewport]
  );
  const minimizeAllFloatingPanels = useCallback(() => {
    setFloatingPanels((current) => current.map((panel) => ({ ...panel, minimized: true })));
  }, []);
  const resetAllFloatingPanels = useCallback(() => {
    setFloatingPanels((current) =>
      current.map((panel, index) => ({
        ...panel,
        ...getDefaultFloatingPanelGeometry(panel.kind, floatingViewport(), index * 26),
        minimized: false
      }))
    );
  }, [floatingViewport]);
  const nextImportStep = useCallback(() => setImportStep((current) => Math.min(current + 1, 4)), []);
  const previousImportStep = useCallback(() => setImportStep((current) => Math.max(current - 1, 1)), []);
  const finishImport = useCallback(
    (result: ImportConfirmResult | null) => {
      void (async () => {
        if (result) {
          await appStore.acceptImportedProject(result);
        }
        setWelcomeNotice(null);
        openWriting();
      })();
    },
    [appStore, openWriting]
  );

  if (page === "settings") {
    return (
      <AppShell>
        <SettingsPage
          activeCategory={settingsCategory}
          currentProject={settingsReturnPage === "welcome" ? null : appStore.currentProject}
          onCategoryChange={setSettingsCategory}
          onClose={returnFromSettings}
          onWelcome={returnFromSettings}
        />
      </AppShell>
    );
  }

  if (page === "import") {
    return (
      <AppShell>
        <ImportWizardPage
          currentProjectId={appStore.currentProject?.id ?? null}
          currentProjectLanguage={appStore.currentProject?.contentLanguage ?? null}
          initialMode={importReturnPage === "writing" ? "import_into_current_project" : "create_new_project"}
          step={importStep}
          onBack={previousImportStep}
          onCancel={returnFromImport}
          onFinish={finishImport}
          onNext={nextImportStep}
          onStepChange={setImportStep}
        />
      </AppShell>
    );
  }

  if (page === "export") {
    return (
      <AppShell>
        <ExportPage
          chapters={appStore.chapters}
          currentProject={appStore.currentProject}
          onClose={returnFromExport}
        />
      </AppShell>
    );
  }

  if (page === "newProject") {
    return (
      <AppShell>
        <NewProjectPage
          onCancel={openWelcome}
          onCreate={createProject}
          onSelectProjectSavePath={appStore.selectProjectSavePath}
          onSuggestProjectPath={appStore.suggestProjectPath}
        />
      </AppShell>
    );
  }

  if (page === "relationshipGraph") {
    return (
      <AppShell>
        <CharacterRelationshipGraphPage
          currentProject={appStore.currentProject}
          onOpenChapter={openWritingAtChapter}
          onOpenChapterReview={openChapterReview}
          onOpenOutline={openOutline}
          onOpenSettings={() => openSettings()}
          onOpenWriting={openWriting}
          onOpenWritingGoals={openWritingGoals}
          onWelcome={openWelcome}
        />
      </AppShell>
    );
  }

  if (page === "outline") {
    return (
      <AppShell>
        <OutlinePage
          currentProject={appStore.currentProject}
          initialChapterId={appStore.activeChapterId}
          onOpenRelationshipGraph={openRelationshipGraph}
          onOpenChapterReview={openChapterReview}
          onOpenSettings={() => openSettings()}
          onOpenWriting={openWriting}
          onOpenWritingGoals={openWritingGoals}
          onWelcome={openWelcome}
        />
      </AppShell>
    );
  }

  if (page === "writingGoals") {
    return (
      <AppShell>
        <WritingGoalsPage
          currentProject={appStore.currentProject}
          onOpenOutline={openOutline}
          onOpenChapterReview={openChapterReview}
          onOpenRelationshipGraph={openRelationshipGraph}
          onOpenSettings={() => openSettings()}
          onOpenWriting={openWriting}
          onWelcome={openWelcome}
        />
      </AppShell>
    );
  }

  if (page === "chapterReview") {
    return (
      <AppShell>
        <ChapterReviewPage
          chapters={appStore.chapters}
          currentProject={appStore.currentProject}
          onOpenChapter={openWritingAtChapter}
          onOpenOutline={openOutline}
          onOpenRelationshipGraph={openRelationshipGraph}
          onOpenSettings={() => openSettings()}
          onOpenWriting={openWriting}
          onOpenWritingGoals={openWritingGoals}
          onWelcome={openWelcome}
        />
      </AppShell>
    );
  }

  if (page === "writing") {
    return (
      <AppShell>
        <WritingPage
          activeChapter={appStore.activeChapter}
          activeChapterId={appStore.activeChapterId}
          chapters={appStore.chapters}
          currentProject={appStore.currentProject}
          floatingPanels={floatingPanels}
          sidebarOpen={sidebarOpen}
          sidebarTab={sidebarTab}
          aiChatDraftSeed={aiChatDraftSeed}
          auxiliaryRefreshToken={auxiliaryRefreshToken}
          scratchpadRefreshToken={scratchpadRefreshToken}
          selectionSnapshot={selectionSnapshot}
          taskPromptPreset={taskPromptPreset}
          taskType={taskType}
          onCreateChapter={createChapter}
          onDeleteChapter={deleteChapter}
          onAuxiliaryChanged={handleAuxiliaryChanged}
          onCloseSidebar={() => setSidebarOpen(false)}
          onExport={openExport}
          onImport={openImport}
          onCloseFloatingPanel={closeFloatingPanel}
          onMinimizeAllFloatingPanels={minimizeAllFloatingPanels}
          onMinimizeFloatingPanel={minimizeFloatingPanel}
          onMoveFloatingPanel={moveFloatingPanel}
          onOpenAiChat={openAiChat}
          onOpenFloatingAiChat={openFloatingAiChat}
          onOpenFloatingPanel={openFloatingPanel}
          onOpenOutline={openOutline}
          onOpenChapterReview={openChapterReview}
          onOpenFloatingScratchpad={openFloatingScratchpad}
          onOpenRelationshipGraph={openRelationshipGraph}
          onOpenWritingGoals={openWritingGoals}
          onOpenScratchpad={openScratchpad}
          onRaiseFloatingPanel={raiseFloatingPanel}
          onResetAllFloatingPanels={resetAllFloatingPanels}
          onResetFloatingPanel={resetFloatingPanel}
          onResizeFloatingPanel={resizeFloatingPanel}
          onFloatingScratchNoteSaved={handleFloatingScratchNoteSaved}
          onFloatingTask={runFloatingTask}
          onSelectionToChat={sendSelectionToChat}
          onChapterSaved={appStore.updateChapterFromSavedContent}
          onRenameChapter={renameChapter}
          onSelectChapter={appStore.selectChapter}
          onUpdateChapterTargetWordCount={updateChapterTargetWordCount}
          onSettings={openSettings}
          onSidebarTabChange={setSidebarTab}
          onTask={runTask}
          onWelcome={openWelcome}
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <WelcomePage
        recentProjects={appStore.recentProjects}
        welcomeNotice={welcomeNotice}
        onContinueWriting={continueWriting}
        onImport={openImport}
        onNewProject={openNewProject}
        onOpenProject={openProject}
        onRenameProject={renameProject}
        onDeleteProject={deleteProject}
        onSettings={openSettings}
      />
    </AppShell>
  );
}
