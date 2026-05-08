import type { Editor } from "@tiptap/react";
import type { ChapterContent, ChapterSummary, SelectionSnapshot, TaskPromptPreset } from "../../main/shared/types";
import type { AiChatDraftSeed } from "../sidebar/chat-draft";
import type { SettingsCategory } from "../routes/SettingsPage";
import type { ChatStore } from "../state/chat-store";
import type { SavedChapterVersion } from "../state/editor-store";
import { FloatingPanelFrame } from "./FloatingPanelFrame";
import type { FloatingPanelGeometry, FloatingPanelState } from "./floating-panel-state";
import { UtilityPanelContent } from "./UtilityPanelContent";
import type { TaskType } from "./RightUtilitySidebar";

type FloatingWorkspaceLayerProps = {
  readonly activeChapterId: string | null;
  readonly aiChatDraftSeed: AiChatDraftSeed | null;
  readonly chatStore: ChatStore;
  readonly chapters: readonly ChapterSummary[];
  readonly currentProjectId: string | null;
  readonly editor: Editor | null;
  readonly flushPendingSave: () => Promise<SavedChapterVersion | null>;
  readonly onClosePanel: (panelId: string) => void;
  readonly onAuxiliaryChanged: () => void;
  readonly onContentSaved: (content: ChapterContent) => void;
  readonly onMinimizePanel: (panelId: string) => void;
  readonly onMovePanel: (panelId: string, geometry: Pick<FloatingPanelGeometry, "x" | "y">) => void;
  readonly onOpenSettings: (category?: SettingsCategory) => void;
  readonly onRaisePanel: (panelId: string) => void;
  readonly onResetPanel: (panelId: string) => void;
  readonly onResizePanel: (panelId: string, geometry: Pick<FloatingPanelGeometry, "width" | "height">) => void;
  readonly onScratchNoteSaved: (panelId: string, noteId: string) => void;
  readonly panels: readonly FloatingPanelState[];
  readonly selectionSnapshot: SelectionSnapshot | null;
  readonly taskPromptPreset: TaskPromptPreset | null;
  readonly taskType: TaskType;
};

function titleForPanel(panel: FloatingPanelState, chapters: readonly ChapterSummary[]): string {
  if (panel.kind === "chat") {
    return "AI 对话";
  }
  const chapterTitle = chapters.find((chapter) => chapter.id === panel.chapterId)?.title ?? "当前章节";
  if (panel.kind === "task") {
    return `${chapterTitle} · 当前任务`;
  }
  if (panel.kind === "outline") {
    return `${chapterTitle} · 细纲`;
  }
  return `${chapterTitle} · 草稿纸`;
}

export function FloatingWorkspaceLayer({
  activeChapterId,
  aiChatDraftSeed,
  chatStore,
  chapters,
  currentProjectId,
  editor,
  flushPendingSave,
  onClosePanel,
  onAuxiliaryChanged,
  onContentSaved,
  onMinimizePanel,
  onMovePanel,
  onOpenSettings,
  onRaisePanel,
  onResetPanel,
  onResizePanel,
  onScratchNoteSaved,
  panels,
  selectionSnapshot,
  taskPromptPreset,
  taskType
}: FloatingWorkspaceLayerProps) {
  if (panels.length === 0) {
    return null;
  }

  return (
    <div className="floating-workspace-layer" aria-label="写作辅助浮窗层">
      {panels.map((panel) => {
        const contentChapterId = panel.kind === "chat" ? activeChapterId : panel.chapterId;
        const currentChapter = chapters.find((chapter) => chapter.id === contentChapterId) ?? null;
        return (
          <FloatingPanelFrame
            key={panel.id}
            panel={panel}
            title={titleForPanel(panel, chapters)}
            onClose={onClosePanel}
            onMinimize={onMinimizePanel}
            onMove={onMovePanel}
            onPointerDown={onRaisePanel}
            onReset={onResetPanel}
            onResize={onResizePanel}
          >
            <UtilityPanelContent
              activeEditorChapterId={activeChapterId}
              aiChatDraftSeed={aiChatDraftSeed}
              chatStore={chatStore}
              chapters={chapters}
              currentChapterId={contentChapterId}
              currentChapterTitle={currentChapter?.title ?? null}
              currentProjectId={currentProjectId}
              editor={editor}
              flushPendingSave={flushPendingSave}
              onAuxiliaryChanged={onAuxiliaryChanged}
              onContentSaved={onContentSaved}
              onOpenSettings={onOpenSettings}
              onScratchNoteSaved={onScratchNoteSaved}
              panelId={panel.id}
              panelKind={panel.kind}
              scratchNoteId={panel.scratchNoteId}
              selectionSnapshot={selectionSnapshot}
              taskPromptPreset={taskPromptPreset}
              taskType={taskType}
            />
          </FloatingPanelFrame>
        );
      })}
    </div>
  );
}
