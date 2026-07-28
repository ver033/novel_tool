import type { ChapterSummary, SelectionSnapshot, TaskPromptPreset } from "../../main/shared/types";
import type { AiChatDraftSeed } from "../sidebar/chat-draft";
import type { SettingsCategory } from "../routes/SettingsPage";
import type { ChatStore } from "../state/chat-store";
import type { TaskStore } from "../state/task-store";
import { useI18n } from "../i18n";
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
  readonly onClosePanel: (panelId: string) => void;
  readonly onAuxiliaryChanged: () => void;
  readonly onMinimizePanel: (panelId: string) => void;
  readonly onMovePanel: (panelId: string, geometry: Pick<FloatingPanelGeometry, "x" | "y">) => void;
  readonly onOpenOutline: () => void;
  readonly onOpenSettings: (category?: SettingsCategory) => void;
  readonly onRaisePanel: (panelId: string) => void;
  readonly onResetPanel: (panelId: string) => void;
  readonly onResizePanel: (panelId: string, geometry: Pick<FloatingPanelGeometry, "width" | "height">) => void;
  readonly onScratchNoteSaved: (panelId: string, noteId: string) => void;
  readonly panels: readonly FloatingPanelState[];
  readonly selectionSnapshot: SelectionSnapshot | null;
  readonly taskInstruction: string;
  readonly taskPromptPreset: TaskPromptPreset | null;
  readonly taskRunId: number | null;
  readonly taskStore: TaskStore;
  readonly taskType: TaskType;
  readonly onTaskInstructionChange: (instruction: string) => void;
};

function titleForPanel(panel: FloatingPanelState, chapters: readonly ChapterSummary[], japanese: boolean): string {
  if (panel.kind === "chat") {
    return japanese ? "AI チャット" : "AI 对话";
  }
  const chapterTitle = chapters.find((chapter) => chapter.id === panel.chapterId)?.title ?? (japanese ? "現在の章" : "当前章节");
  if (panel.kind === "task") {
    return `${chapterTitle} · ${japanese ? "現在のタスク" : "当前任务"}`;
  }
  if (panel.kind === "outline") {
    if (panel.outlineTab === "book") {
      return japanese ? "全体プロット" : "全书大纲速览";
    }
    return `${chapterTitle} · ${japanese ? "章プロット" : "细纲"}`;
  }
  return `${chapterTitle} · ${japanese ? "下書きメモ" : "草稿纸"}`;
}

export function FloatingWorkspaceLayer({
  activeChapterId,
  aiChatDraftSeed,
  chatStore,
  chapters,
  currentProjectId,
  onClosePanel,
  onAuxiliaryChanged,
  onMinimizePanel,
  onMovePanel,
  onOpenOutline,
  onOpenSettings,
  onRaisePanel,
  onResetPanel,
  onResizePanel,
  onScratchNoteSaved,
  panels,
  selectionSnapshot,
  taskInstruction,
  taskPromptPreset,
  taskRunId,
  taskStore,
  onTaskInstructionChange,
  taskType
}: FloatingWorkspaceLayerProps) {
  const { locale } = useI18n();
  const japanese = locale === "ja-JP";
  if (panels.length === 0) {
    return null;
  }

  return (
    <div className="floating-workspace-layer" aria-label={japanese ? "執筆補助ウィンドウ" : "写作辅助浮窗层"}>
      {panels.map((panel) => {
        const contentChapterId = panel.kind === "chat" ? activeChapterId : panel.chapterId;
        const currentChapter = chapters.find((chapter) => chapter.id === contentChapterId) ?? null;
        return (
          <FloatingPanelFrame
            key={panel.id}
            panel={panel}
            title={titleForPanel(panel, chapters, japanese)}
            onClose={onClosePanel}
            onMinimize={onMinimizePanel}
            onMove={onMovePanel}
            onPointerDown={onRaisePanel}
            onReset={onResetPanel}
            onResize={onResizePanel}
          >
            <UtilityPanelContent
              aiChatDraftSeed={aiChatDraftSeed}
              chatStore={chatStore}
              chapters={chapters}
              currentChapterId={contentChapterId}
              currentChapterTitle={currentChapter?.title ?? null}
              currentProjectId={currentProjectId}
              onAuxiliaryChanged={onAuxiliaryChanged}
              onOpenOutline={onOpenOutline}
              onOpenSettings={onOpenSettings}
              onScratchNoteSaved={onScratchNoteSaved}
              outlineTab={panel.outlineTab ?? "chapter"}
              panelId={panel.id}
              panelKind={panel.kind}
              scratchNoteId={panel.scratchNoteId}
              selectionSnapshot={selectionSnapshot}
              taskInstruction={taskInstruction}
              taskPromptPreset={taskPromptPreset}
              taskRunId={taskRunId}
              taskStore={taskStore}
              taskType={taskType}
              onTaskInstructionChange={onTaskInstructionChange}
            />
          </FloatingPanelFrame>
        );
      })}
    </div>
  );
}
