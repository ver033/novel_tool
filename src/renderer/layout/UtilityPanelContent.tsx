import type { Editor } from "@tiptap/react";
import type { ChapterContent, ChapterSummary, SelectionSnapshot, TaskPromptPreset } from "../../main/shared/types";
import { AiChatTab } from "../sidebar/AiChatTab";
import type { AiChatDraftSeed } from "../sidebar/chat-draft";
import { CurrentTaskTab } from "../sidebar/CurrentTaskTab";
import { OutlinePanel } from "../sidebar/OutlinePanel";
import { ScratchpadEditorPanel } from "../sidebar/ScratchpadEditorPanel";
import type { SettingsCategory } from "../routes/SettingsPage";
import type { ChatStore } from "../state/chat-store";
import type { SavedChapterVersion } from "../state/editor-store";
import type { FloatingPanelKind, OutlineFloatingTab } from "./floating-panel-state";
import type { TaskType } from "./RightUtilitySidebar";

export type UtilityPanelContentProps = {
  readonly panelKind: FloatingPanelKind;
  readonly activeEditorChapterId: string | null;
  readonly aiChatDraftSeed: AiChatDraftSeed | null;
  readonly chatStore: ChatStore;
  readonly chapters: readonly ChapterSummary[];
  readonly currentChapterId: string | null;
  readonly currentChapterTitle: string | null;
  readonly currentProjectId: string | null;
  readonly editor: Editor | null;
  readonly flushPendingSave: () => Promise<SavedChapterVersion | null>;
  readonly onAuxiliaryChanged: () => void;
  readonly onContentSaved: (content: ChapterContent) => void;
  readonly onOpenSettings: (category?: SettingsCategory) => void;
  readonly onScratchNoteSaved: (panelId: string, noteId: string) => void;
  readonly outlineTab: OutlineFloatingTab;
  readonly panelId: string;
  readonly scratchNoteId: string | null;
  readonly selectionSnapshot: SelectionSnapshot | null;
  readonly taskPromptPreset: TaskPromptPreset | null;
  readonly taskType: TaskType;
};

export function UtilityPanelContent({
  activeEditorChapterId,
  aiChatDraftSeed,
  chatStore,
  chapters,
  currentChapterId,
  currentChapterTitle,
  currentProjectId,
  editor,
  flushPendingSave,
  onAuxiliaryChanged,
  onContentSaved,
  onOpenSettings,
  onScratchNoteSaved,
  outlineTab,
  panelId,
  panelKind,
  scratchNoteId,
  selectionSnapshot,
  taskPromptPreset,
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
        activeEditorChapterId={activeEditorChapterId}
        chapterId={currentChapterId}
        currentChapterTitle={currentChapterTitle}
        projectId={currentProjectId}
        selectionSnapshot={selectionSnapshot}
        taskPromptPreset={taskPromptPreset}
        taskType={taskType}
        editor={editor}
        flushPendingSave={flushPendingSave}
        onContentSaved={onContentSaved}
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
