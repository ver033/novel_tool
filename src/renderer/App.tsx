import "./styles/globals.css";
import { useCallback, useState } from "react";
import { AppShell } from "./layout/AppShell";
import type { SidebarTab, TaskType } from "./layout/RightUtilitySidebar";
import { ExportPage } from "./routes/ExportPage";
import { ImportWizardPage } from "./routes/ImportWizardPage";
import { NewProjectPage } from "./routes/NewProjectPage";
import { SettingsPage, type SettingsCategory } from "./routes/SettingsPage";
import { WelcomePage } from "./routes/WelcomePage";
import { WritingPage } from "./routes/WritingPage";
import type { AiChatDraftSeed } from "./sidebar/chat-draft";
import { useAppStore } from "./state/app-store";
import type { ImportConfirmResult, ProjectCreateInput, SelectionSnapshot, TaskPromptPreset } from "../main/shared/types";

type Page = "welcome" | "writing" | "settings" | "import" | "export" | "newProject";
type ImportReturnPage = "welcome" | "writing";
type ExportReturnPage = "welcome" | "writing";
type SettingsReturnPage = "welcome" | "writing";

export function App() {
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
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("AI 服务");
  const [importStep, setImportStep] = useState(1);
  const [welcomeNotice, setWelcomeNotice] = useState<string | null>(null);
  const [scratchpadRefreshToken, setScratchpadRefreshToken] = useState(0);
  const appStore = useAppStore();

  const openWriting = useCallback(() => {
    setSidebarOpen(false);
    setPage("writing");
  }, []);
  const openWelcome = useCallback(() => {
    setWelcomeNotice(null);
    void appStore.refreshRecentProjects();
    setPage("welcome");
  }, [appStore]);
  const openSettings = useCallback((category?: SettingsCategory) => {
    if (category) {
      setSettingsCategory(category);
    }
    setSettingsReturnPage(page === "writing" ? "writing" : "welcome");
    setPage("settings");
  }, [page]);
  const returnFromSettings = useCallback(() => {
    setPage(settingsReturnPage);
  }, [settingsReturnPage]);
  const openImport = useCallback(() => {
    setImportStep(1);
    setImportReturnPage(page === "writing" ? "writing" : "welcome");
    setPage("import");
  }, [page]);
  const returnFromImport = useCallback(() => {
    setPage(importReturnPage);
  }, [importReturnPage]);
  const openExport = useCallback(() => {
    setExportReturnPage(page === "writing" ? "writing" : "welcome");
    setPage("export");
  }, [page]);
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
        setWelcomeNotice("已取消打开项目文件。也可以从下方最近项目继续写作。");
      })
      .catch((reason: unknown) => {
        setWelcomeNotice(reason instanceof Error ? reason.message : String(reason));
      });
  }, [appStore, openWriting]);
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
  const createChapter = useCallback(() => {
    void appStore.createChapter();
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
    setSidebarOpen(true);
    setSidebarTab("chat");
  }, []);
  const sendSelectionToChat = useCallback((snapshot: SelectionSnapshot) => {
    setSelectionSnapshot(snapshot);
    setSidebarOpen(true);
    setSidebarTab("chat");
    setAiChatDraftSeed((current) => ({
      id: (current?.id ?? 0) + 1,
      text: snapshot.text
    }));
  }, []);
  const openScratchpad = useCallback(() => {
    setSidebarOpen(true);
    setSidebarTab("scratch");
    setScratchpadRefreshToken((current) => current + 1);
  }, []);
  const runTask = useCallback((task: TaskType, snapshot?: SelectionSnapshot | null, preset?: TaskPromptPreset | null) => {
    setTaskType(task);
    setTaskPromptPreset(preset ?? null);
    setSelectionSnapshot(snapshot ?? null);
    setSidebarOpen(true);
    setSidebarTab("task");
  }, []);
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
          currentProject={settingsReturnPage === "writing" ? appStore.currentProject : null}
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

  if (page === "writing") {
    return (
      <AppShell>
        <WritingPage
          activeChapter={appStore.activeChapter}
          activeChapterId={appStore.activeChapterId}
          chapters={appStore.chapters}
          currentProject={appStore.currentProject}
          sidebarOpen={sidebarOpen}
          sidebarTab={sidebarTab}
          aiChatDraftSeed={aiChatDraftSeed}
          scratchpadRefreshToken={scratchpadRefreshToken}
          selectionSnapshot={selectionSnapshot}
          taskPromptPreset={taskPromptPreset}
          taskType={taskType}
          onCreateChapter={createChapter}
          onDeleteChapter={deleteChapter}
          onCloseSidebar={() => setSidebarOpen(false)}
          onExport={openExport}
          onImport={openImport}
          onOpenAiChat={openAiChat}
          onOpenScratchpad={openScratchpad}
          onSelectionToChat={sendSelectionToChat}
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
