import type { ChapterSummary, SelectionSnapshot, TaskPromptPreset } from "../../main/shared/types";
import { AiChatTab } from "../sidebar/AiChatTab";
import type { AiChatDraftSeed } from "../sidebar/chat-draft";
import { CurrentTaskTab } from "../sidebar/CurrentTaskTab";
import { OutlinePanel } from "../sidebar/OutlinePanel";
import { ScratchpadEditorPanel } from "../sidebar/ScratchpadEditorPanel";
import type { SettingsCategory } from "../routes/SettingsPage";
import type { ChatStore } from "../state/chat-store";
import type { TaskStore } from "../state/task-store";
import type { FloatingPanelKind, OutlineFloatingTab } from "./floating-panel-state";
import type { TaskType } from "./RightUtilitySidebar";

export type UtilityPanelContentProps = {
  readonly panelKind: FloatingPanelKind;
  readonly aiChatDraftSeed: AiChatDraftSeed | null;
  readonly chatStore: ChatStore;
  readonly chapters: readonly ChapterSummary[];
  readonly currentChapterId: string | null;
  readonly currentChapterTitle: string | null;
  readonly currentProjectId: string | null;
  readonly onAuxiliaryChanged: () => void;
  readonly onOpenOutline: () => void;
  readonly onOpenSettings: (category?: SettingsCategory) => void;
  readonly onScratchNoteSaved: (panelId: string, noteId: string) => void;
  readonly outlineTab: OutlineFloatingTab;
  readonly panelId: string;
  readonly scratchNoteId: string | null;
  readonly selectionSnapshot: SelectionSnapshot | null;
  readonly taskInstruction: string;
  readonly taskPromptPreset: TaskPromptPreset | null;
  readonly taskRunId: number | null;
  readonly taskStore: TaskStore;
  readonly taskType: TaskType;
  readonly onTaskInstructionChange: (instruction: string) => void;
};

export function UtilityPanelContent({
  aiChatDraftSeed,
  chatStore,
  chapters,
  currentChapterId,
  currentChapterTitle,
  currentProjectId,
  onAuxiliaryChanged,
  onOpenOutline,
  onOpenSettings,
  onScratchNoteSaved,
  outlineTab,
  panelId,
  panelKind,
  scratchNoteId,
  selectionSnapshot,
  taskInstruction,
  taskPromptPreset,
  taskRunId,
  taskStore,
  onTaskInstructionChange,
  taskType
}: UtilityPanelContentProps) {
  if (panelKind === "chat") {
    return (
      <AiChatTab
        chapters={chapters}
        currentChapterTitle={currentChapterTitle}
        currentProjectId={currentProjectId}
        chatStore={chatStore}
        draftSeed={aiChatDraftSeed}
        selectionSnapshot={selectionSnapshot}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  if (panelKind === "task") {
    return (
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
    );
  }

  if (panelKind === "outline") {
    return (
      <OutlinePanel
        chapterId={currentChapterId}
        currentChapterTitle={currentChapterTitle}
        initialTab={outlineTab}
        onAuxiliaryChanged={onAuxiliaryChanged}
        onOpenOutline={onOpenOutline}
        projectId={currentProjectId}
      />
    );
  }

  return (
    <ScratchpadEditorPanel
      chapterId={currentChapterId}
      currentChapterTitle={currentChapterTitle}
      onNotesChanged={onAuxiliaryChanged}
      onScratchNoteSaved={onScratchNoteSaved}
      panelId={panelId}
      projectId={currentProjectId}
      scratchNoteId={scratchNoteId}
    />
  );
}
