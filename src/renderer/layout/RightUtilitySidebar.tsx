import { X } from "@phosphor-icons/react";
import type { Editor } from "@tiptap/react";
import type { SelectionSnapshot, TaskPromptPreset } from "../../main/shared/types";
import { IconButton } from "../components/IconButton";
import { AiChatTab } from "../sidebar/AiChatTab";
import { CurrentTaskTab } from "../sidebar/CurrentTaskTab";
import { ScratchpadTab } from "../sidebar/ScratchpadTab";
import type { SettingsCategory } from "../routes/SettingsPage";

export type SidebarTab = "chat" | "task" | "scratch";
export type TaskType = "polish" | "expand" | "proofread" | "continue";

type RightUtilitySidebarProps = {
  readonly activeTab: SidebarTab;
  readonly currentChapterId: string | null;
  readonly currentChapterTitle: string | null;
  readonly currentProjectId: string | null;
  readonly scratchpadRefreshToken: number;
  readonly selectionSnapshot: SelectionSnapshot | null;
  readonly taskPromptPreset: TaskPromptPreset | null;
  readonly taskType: TaskType;
  readonly editor: Editor | null;
  readonly flushPendingSave: () => Promise<void>;
  readonly onTabChange: (tab: SidebarTab) => void;
  readonly onClose: () => void;
  readonly onOpenSettings: (category?: SettingsCategory) => void;
};

const tabLabels: Array<[SidebarTab, string]> = [
  ["chat", "AI 对话"],
  ["task", "当前任务"],
  ["scratch", "草稿纸"]
];

export function RightUtilitySidebar({
  activeTab,
  currentChapterId,
  currentChapterTitle,
  currentProjectId,
  editor,
  flushPendingSave,
  scratchpadRefreshToken,
  selectionSnapshot,
  taskPromptPreset,
  taskType,
  onTabChange,
  onClose,
  onOpenSettings
}: RightUtilitySidebarProps) {
  return (
    <aside className="right-sidebar">
      <nav className="sidebar-tabs">
        {tabLabels.map(([tab, label]) => (
          <button className={`tab-button ${activeTab === tab ? "active" : ""}`} key={tab} onClick={() => onTabChange(tab)} type="button">
            {label}
          </button>
        ))}
        <IconButton className="sidebar-close" label="关闭右侧栏" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </nav>
      <div className="sidebar-content">
        {activeTab === "chat" ? (
          <AiChatTab
            currentChapterId={currentChapterId}
            currentChapterTitle={currentChapterTitle}
            currentProjectId={currentProjectId}
            selectionSnapshot={selectionSnapshot}
          />
        ) : null}
        {activeTab === "task" ? (
          <CurrentTaskTab
            chapterId={currentChapterId}
            currentChapterTitle={currentChapterTitle}
            projectId={currentProjectId}
            selectionSnapshot={selectionSnapshot}
            taskPromptPreset={taskPromptPreset}
            taskType={taskType}
            editor={editor}
            flushPendingSave={flushPendingSave}
            onOpenSettings={onOpenSettings}
          />
        ) : null}
        {activeTab === "scratch" ? <ScratchpadTab chapterId={currentChapterId} projectId={currentProjectId} refreshToken={scratchpadRefreshToken} /> : null}
      </div>
    </aside>
  );
}
