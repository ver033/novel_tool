import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { Minus, Square, X } from "@phosphor-icons/react";
import { IconButton } from "../components/IconButton";
import type { FloatingPanelGeometry, FloatingPanelState } from "./floating-panel-state";

type FloatingPanelFrameProps = {
  readonly children: ReactNode;
  readonly panel: FloatingPanelState;
  readonly title: string;
  readonly onClose: (panelId: string) => void;
  readonly onMinimize: (panelId: string) => void;
  readonly onMove: (panelId: string, geometry: Pick<FloatingPanelGeometry, "x" | "y">) => void;
  readonly onPointerDown: (panelId: string) => void;
  readonly onReset: (panelId: string) => void;
  readonly onResize: (panelId: string, geometry: Pick<FloatingPanelGeometry, "width" | "height">) => void;
};

export function FloatingPanelFrame({
  children,
  onClose,
  onMinimize,
  onMove,
  onPointerDown,
  onReset,
  onResize,
  panel,
  title
}: FloatingPanelFrameProps) {
  function handleTitlePointerDown(event: ReactPointerEvent<HTMLElement>): void {
    if ((event.target as HTMLElement).closest(".floating-panel-actions")) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const initialX = panel.x;
    const initialY = panel.y;

    function handlePointerMove(moveEvent: PointerEvent): void {
      onMove(panel.id, {
        x: initialX + moveEvent.clientX - startX,
        y: initialY + moveEvent.clientY - startY
      });
    }

    function handlePointerUp(): void {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function handleResizePointerDown(event: ReactPointerEvent<HTMLSpanElement>): void {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const initialWidth = panel.width;
    const initialHeight = panel.height;

    function handlePointerMove(moveEvent: PointerEvent): void {
      onResize(panel.id, {
        width: initialWidth + moveEvent.clientX - startX,
        height: initialHeight + moveEvent.clientY - startY
      });
    }

    function handlePointerUp(): void {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  return (
    <section
      className={`floating-panel ${panel.minimized ? "minimized" : ""}`}
      data-floating-panel-id={panel.id}
      onPointerDown={() => onPointerDown(panel.id)}
      style={{
        height: panel.minimized ? undefined : panel.height,
        left: panel.x,
        top: panel.y,
        width: panel.width,
        zIndex: panel.zIndex
      }}
    >
      <header className="floating-panel-titlebar" onPointerDown={handleTitlePointerDown}>
        <span className="floating-panel-title">{title}</span>
        <span className="floating-panel-actions">
          <IconButton label="最小化浮窗" onClick={() => onMinimize(panel.id)}>
            <Minus size={16} />
          </IconButton>
          <IconButton label="恢复默认大小" onClick={() => onReset(panel.id)}>
            <Square size={16} />
          </IconButton>
          <IconButton label="关闭浮窗" onClick={() => onClose(panel.id)}>
            <X size={16} />
          </IconButton>
        </span>
      </header>
      {!panel.minimized ? <div className="floating-panel-body">{children}</div> : null}
      {!panel.minimized ? (
        <span
          aria-label="拖动调整大小"
          className="floating-panel-resize-handle"
          onPointerDown={handleResizePointerDown}
          role="separator"
          title="拖动调整大小"
        />
      ) : null}
    </section>
  );
}
