import { ChatCircleDots, CheckCircle, Clock, FileText, NotePencil, Sparkle, X } from "@phosphor-icons/react";
import type { ChapterSummary, SelectionSnapshot, TaskPromptPreset } from "../../main/shared/types";
import { IconButton } from "../components/IconButton";
import { AiChatTab } from "../sidebar/AiChatTab";
import type { AiChatDraftSeed } from "../sidebar/chat-draft";
import { ScratchpadTab } from "../sidebar/ScratchpadTab";
import type { SettingsCategory } from "../routes/SettingsPage";
import type { ChatStore } from "../state/chat-store";
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
  readonly taskPromptPreset: TaskPromptPreset | null;
  readonly taskType: TaskType;
  readonly onAuxiliaryChanged: () => void;
  readonly onTabChange: (tab: SidebarTab) => void;
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
  taskPromptPreset,
  taskType,
  onTabChange,
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
  const activeTaskLabel = japanese
    ? { polish: "推敲", expand: "加筆", proofread: "校正", continue: "続きを書く" }[taskType]
    : { polish: "润色", expand: "扩写", proofread: "校对", continue: "续写" }[taskType];
  const taskCopy = japanese
    ? {
        request: "今回の要望",
        noSelection: "本文を選択すると、中央の編集面に改稿候補が表示されます。",
        selected: "選択範囲を受け取りました",
        context: "前後の段落を参照します",
        center: "改稿候補は本文の下で確認できます",
        waiting: "適用・調整・破棄を選んでください",
        label: "中央の改稿シートと同期"
      }
    : {
        request: "本次要求",
        noSelection: "选择正文后，修改候选会显示在中央编辑区。",
        selected: "已接收选区",
        context: "参考选区前后的段落",
        center: "修改候选在正文下方查看",
        waiting: "请选择应用、调整或放弃",
        label: "与中央修改面板同步"
      };
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
          <section className="agent-task-overview">
            <span className="agent-task-kicker">{activeTaskLabel} · {taskCopy.label}</span>
            <div className="agent-request-brief">
              <span>{taskCopy.request}</span>
              <p>{taskPromptPreset?.instruction || selectionSnapshot?.text || taskCopy.noSelection}</p>
            </div>
            <ol className="agent-task-steps">
              <li className={selectionSnapshot ? "complete" : "active"}>
                {selectionSnapshot ? <CheckCircle size={18} weight="fill" /> : <Clock size={18} />}
                <span>{selectionSnapshot ? taskCopy.selected : taskCopy.noSelection}</span>
              </li>
              <li className={selectionSnapshot ? "active" : "queued"}>
                <FileText size={18} />
                <span>{taskCopy.context}</span>
              </li>
              <li className={selectionSnapshot ? "active" : "queued"}>
                <Sparkle size={18} />
                <span>{taskCopy.center}</span>
              </li>
              <li className="queued">
                <Clock size={18} />
                <span>{taskCopy.waiting}</span>
              </li>
            </ol>
          </section>
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
