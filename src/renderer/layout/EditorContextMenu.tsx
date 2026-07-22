import { useLayoutEffect, useRef, useState } from "react";
import { clampEditorContextMenuPosition, type FloatingMenuPosition } from "./floating-menu-position";
import { useI18n } from "../i18n";

type EditorContextMenuMode = "surface" | "selection";

export type EditorContextMenuState = {
  readonly mode: EditorContextMenuMode;
  readonly x: number;
  readonly y: number;
};

type EditorContextMenuProps = EditorContextMenuState & {
  readonly canOpenAllAssist: boolean;
  readonly onClose: () => void;
  readonly onCopy: () => void;
  readonly onExpandSelection: () => void;
  readonly onMinimizeAllPanels: () => void;
  readonly onOpenAllAssist: () => void;
  readonly onOpenBookOutline: () => void;
  readonly onOpenChat: () => void;
  readonly onOpenOutline: () => void;
  readonly onOpenScratchpad: () => void;
  readonly onPaste: () => void;
  readonly onPolishSelection: () => void;
  readonly onProofreadSelection: () => void;
  readonly onRedo: () => void;
  readonly onResetPanelLayout: () => void;
  readonly onSelectionToScratchpad: () => void;
  readonly onUndo: () => void;
};

export function EditorContextMenu({
  canOpenAllAssist,
  mode,
  onCopy,
  onExpandSelection,
  onMinimizeAllPanels,
  onOpenAllAssist,
  onOpenBookOutline,
  onOpenChat,
  onOpenOutline,
  onOpenScratchpad,
  onPaste,
  onPolishSelection,
  onProofreadSelection,
  onRedo,
  onResetPanelLayout,
  onSelectionToScratchpad,
  onUndo,
  x,
  y
}: EditorContextMenuProps) {
  const { locale, t } = useI18n();
  const japanese = locale === "ja-JP";
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<FloatingMenuPosition>({ left: x, top: y });

  useLayoutEffect(() => {
    function updatePosition(): void {
      const menuElement = menuRef.current;
      if (!menuElement) {
        return;
      }

      const menuRect = menuElement.getBoundingClientRect();
      setPosition(
        clampEditorContextMenuPosition(
          { x, y },
          { height: menuRect.height, width: menuRect.width },
          { height: window.innerHeight, width: window.innerWidth }
        )
      );
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [x, y]);

  return (
    <div className="editor-context-menu" ref={menuRef} role="menu" style={{ left: position.left, top: position.top }}>
      {mode === "selection" ? (
        <>
          <span className="editor-context-menu-section">{japanese ? "選択範囲" : "选中文本"}</span>
          <button onClick={onPolishSelection} role="menuitem" type="button">{japanese ? "選択範囲を推敲" : "润色选中内容"}</button>
          <button onClick={onExpandSelection} role="menuitem" type="button">{japanese ? "選択範囲へ加筆" : "扩写选中内容"}</button>
          <button onClick={onProofreadSelection} role="menuitem" type="button">{japanese ? "選択範囲を校正" : "校对选中内容"}</button>
          <button onClick={onSelectionToScratchpad} role="menuitem" type="button">{japanese ? "この章の下書きメモへ追加" : "加入本章草稿纸"}</button>
          <span className="context-menu-separator" />
        </>
      ) : null}
      <span className="editor-context-menu-section">{t("outline")}</span>
      <button className="menu-rich-item" onClick={onOpenOutline} role="menuitem" type="button">
        <span>{japanese ? "この章のコンテキストを表示" : "查看本章上下文"}</span>
        <small>{japanese ? "章プロットと前後の章の出来事" : "当前章节细纲、前后章节事件"}</small>
      </button>
      <button className="menu-rich-item" onClick={onOpenBookOutline} role="menuitem" type="button">
        <span>{japanese ? "全体プロットを表示" : "浏览全书大纲"}</span>
        <small>{japanese ? "時間、プロットライン、章から場面を探す" : "按时间、情节线和章节查找场景"}</small>
      </button>
      <span className="context-menu-separator" />
      <span className="editor-context-menu-section">{japanese ? "補助" : "辅助"}</span>
      <button onClick={onOpenScratchpad} role="menuitem" type="button">{japanese ? "この章の下書きメモを作成" : "创建当前章节草稿纸"}</button>
      <button onClick={onOpenChat} role="menuitem" type="button">{japanese ? "AI チャットを開く" : "打开 AI 对话"}</button>
      {canOpenAllAssist ? (
        <button onClick={onOpenAllAssist} role="menuitem" type="button">{japanese ? "この章の補助ウィンドウをすべて開く" : "打开当前章节全部辅助窗"}</button>
      ) : null}
      <span className="context-menu-separator" />
      <button onClick={onCopy} role="menuitem" type="button">{t("copy")}</button>
      <button onClick={onPaste} role="menuitem" type="button">{japanese ? "貼り付け" : "粘贴"}</button>
      <button onClick={onUndo} role="menuitem" type="button">{t("undo")}</button>
      <button onClick={onRedo} role="menuitem" type="button">{t("redo")}</button>
      <span className="context-menu-separator" />
      <button onClick={onMinimizeAllPanels} role="menuitem" type="button">{japanese ? "フローティングウィンドウをすべて最小化" : "收起全部悬浮窗"}</button>
      <button onClick={onResetPanelLayout} role="menuitem" type="button">{japanese ? "フローティングウィンドウの位置をリセット" : "恢复悬浮窗位置"}</button>
    </div>
  );
}
