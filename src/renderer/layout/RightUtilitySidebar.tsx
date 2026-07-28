import { ChatCircleDots, NotePencil, Sparkle, X } from "@phosphor-icons/react";
import type { ChapterSummary, SelectionSnapshot, TaskPromptPreset } from "../../main/shared/types";
import { IconButton } from "../components/IconButton";
import { AiChatTab } from "../sidebar/AiChatTab";
import type { AiChatDraftSeed } from "../sidebar/chat-draft";
import { ScratchpadTab } from "../sidebar/ScratchpadTab";
import { CurrentTaskTab } from "../sidebar/CurrentTaskTab";
import type { SettingsCategory } from "../routes/SettingsPage";
import type { ChatStore } from "../state/chat-store";
import type { TaskStore } from "../state/task-store";
import { useI18n } from "../i18n";

export type SidebarTab = "chat" | "task" | "scratch";
export type TaskType = "polish" | "expand" | "proofread" | "continue";

type RightUtilitySidebarProps = {
  readonly activeTab: SidebarTab;
  readonly aiChatDraftSeed: AiChatDraftSeed | null;
  readonly chatStore: ChatStore;
  readonly chapters: readonly ChapterSummary[];
  readonly currentChapterId: string | null;
  readonly currentChapterTitle: string | null;
  readonly currentProjectId: string | null;
  readonly scratchpadRefreshToken: number;
  readonly selectionSnapshot: SelectionSnapshot | null;
  readonly taskInstruction: string;
  readonly taskPromptPreset: TaskPromptPreset | null;
  readonly taskRunId: number | null;
  readonly taskStore: TaskStore;
  readonly taskType: TaskType;
  readonly onAuxiliaryChanged: () => void;
  readonly onTabChange: (tab: SidebarTab) => void;
  readonly onTaskInstructionChange: (instruction: string) => void;
  readonly onClose: () => void;
  readonly onOpenSettings: (category?: SettingsCategory) => void;
};

export function RightUtilitySidebar({
  activeTab,
  aiChatDraftSeed,
  chatStore,
  chapters,
  currentChapterId,
  currentChapterTitle,
  currentProjectId,
  onAuxiliaryChanged,
  scratchpadRefreshToken,
  selectionSnapshot,
  taskInstruction,
  taskPromptPreset,
  taskRunId,
  taskStore,
  taskType,
  onTabChange,
  onTaskInstructionChange,
  onClose,
  onOpenSettings
}: RightUtilitySidebarProps) {
  const { locale, t } = useI18n();
  const japanese = locale === "ja-JP";
  const tabLabels: Array<[SidebarTab, string]> = [
    ["chat", t("aiChat")],
    ["task", t("currentTask")],
    ["scratch", t("scratchpad")]
  ];
  const tabIcons = {
    chat: <ChatCircleDots size={17} />,
    task: <Sparkle size={17} />,
    scratch: <NotePencil size={17} />
  } as const;
  const assistantTitle = japanese ? "執筆アシスタント" : "写作助手";
  return (
    <aside className="right-sidebar">
      <header className="sidebar-heading">
        <div>
          <h2>{assistantTitle}</h2>
          <span>Pi Agent</span>
        </div>
        <IconButton className="sidebar-close" label={t("closeRightSidebar")} onClick={onClose}>
          <X size={18} />
        </IconButton>
      </header>
      <nav className="sidebar-tabs">
        {tabLabels.map(([tab, label]) => (
          <button className={`tab-button ${activeTab === tab ? "active" : ""}`} key={tab} onClick={() => onTabChange(tab)} type="button">
            {tabIcons[tab]}
            {label}
          </button>
        ))}
      </nav>
      <div className="sidebar-content">
        {activeTab === "chat" ? (
          <AiChatTab
            chapters={chapters}
            currentChapterTitle={currentChapterTitle}
            currentProjectId={currentProjectId}
            chatStore={chatStore}
            draftSeed={aiChatDraftSeed}
            selectionSnapshot={selectionSnapshot}
            onOpenSettings={onOpenSettings}
          />
        ) : null}
        {activeTab === "task" ? (
          <CurrentTaskTab
            currentChapterTitle={currentChapterTitle}
            instruction={taskInstruction}
            selectionSnapshot={selectionSnapshot}
            taskPromptPreset={taskPromptPreset}
            taskRunId={taskRunId}
            taskStore={taskStore}
            taskType={taskType}
            onInstructionChange={onTaskInstructionChange}
            onOpenSettings={onOpenSettings}
          />
        ) : null}
        {activeTab === "scratch" ? (
          <ScratchpadTab
            chapterId={currentChapterId}
            chapters={chapters}
            onNotesChanged={onAuxiliaryChanged}
            projectId={currentProjectId}
            refreshToken={scratchpadRefreshToken}
          />
        ) : null}
      </div>
    </aside>
  );
}
