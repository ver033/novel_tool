import { useLayoutEffect, useRef, useState } from "react";
import { clampEditorContextMenuPosition, type FloatingMenuPosition } from "./floating-menu-position";

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
          <button onClick={onPolishSelection} role="menuitem" type="button">润色选中内容</button>
          <button onClick={onExpandSelection} role="menuitem" type="button">扩写选中内容</button>
          <button onClick={onProofreadSelection} role="menuitem" type="button">校对选中内容</button>
          <button onClick={onSelectionToScratchpad} role="menuitem" type="button">加入本章草稿纸</button>
        </>
      ) : null}
      <button onClick={onOpenOutline} role="menuitem" type="button">打开当前章节细纲</button>
      <button onClick={onOpenScratchpad} role="menuitem" type="button">创建当前章节草稿纸</button>
      <button onClick={onOpenChat} role="menuitem" type="button">打开 AI 对话</button>
      {canOpenAllAssist ? (
        <button onClick={onOpenAllAssist} role="menuitem" type="button">打开当前章节全部辅助窗</button>
      ) : null}
      <span className="context-menu-separator" />
      <button onClick={onCopy} role="menuitem" type="button">复制</button>
      <button onClick={onPaste} role="menuitem" type="button">粘贴</button>
      <button onClick={onUndo} role="menuitem" type="button">撤销</button>
      <button onClick={onRedo} role="menuitem" type="button">重做</button>
      <span className="context-menu-separator" />
      <button onClick={onMinimizeAllPanels} role="menuitem" type="button">收起全部悬浮窗</button>
      <button onClick={onResetPanelLayout} role="menuitem" type="button">恢复悬浮窗位置</button>
    </div>
  );
}
