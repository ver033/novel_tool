export type FloatingPanelKind = "chat" | "task" | "scratch" | "outline";
export type OutlineFloatingTab = "chapter" | "book";

export type FloatingPanelGeometry = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type FloatingPanelState = FloatingPanelGeometry & {
  readonly id: string;
  readonly kind: FloatingPanelKind;
  readonly chapterId: string | null;
  readonly outlineTab: OutlineFloatingTab | null;
  readonly scratchDraftId: string | null;
  readonly scratchNoteId: string | null;
  readonly minimized: boolean;
  readonly zIndex: number;
};

const panelMargin = 12;
const panelTopMargin = 88;
const minPanelWidth = 300;
const minPanelHeight = 220;

function createFloatingScratchDraftId(): string {
  return `draft_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function createFloatingPanelId(
  kind: FloatingPanelKind,
  chapterId: string | null,
  scratchNoteId: string | null = null,
  scratchDraftId: string | null = null,
  outlineTab: OutlineFloatingTab = "chapter"
): string {
  if (kind === "scratch" && scratchNoteId) {
    return `scratch:${chapterId ?? "global"}:${scratchNoteId}`;
  }
  if (kind === "scratch" && scratchDraftId) {
    return `scratch:${chapterId ?? "global"}:${scratchDraftId}`;
  }
  if (kind === "outline" && outlineTab === "book") {
    return "outline:book";
  }
  return `${kind}:${kind === "chat" ? "global" : chapterId ?? "current"}`;
}

function defaultPanelSize(kind: FloatingPanelKind): Pick<FloatingPanelGeometry, "width" | "height"> {
  if (kind === "chat") return { width: 460, height: 620 };
  if (kind === "task") return { width: 540, height: 620 };
  if (kind === "outline") return { width: 430, height: 520 };
  return { width: 460, height: 560 };
}

export function clampFloatingPanelGeometry(
  geometry: FloatingPanelGeometry,
  viewport: { readonly width: number; readonly height: number }
): FloatingPanelGeometry {
  const safeViewportWidth = Math.max(minPanelWidth + panelMargin * 2, viewport.width);
  const safeViewportHeight = Math.max(minPanelHeight + panelTopMargin + panelMargin, viewport.height);
  const width = Math.max(minPanelWidth, Math.min(geometry.width, safeViewportWidth - panelMargin * 2));
  const height = Math.max(minPanelHeight, Math.min(geometry.height, safeViewportHeight - panelTopMargin - panelMargin));

  return {
    x: Math.max(panelMargin, Math.min(geometry.x, safeViewportWidth - width - panelMargin)),
    y: Math.max(panelTopMargin, Math.min(geometry.y, safeViewportHeight - height - panelMargin)),
    width,
    height
  };
}

export function getDefaultFloatingPanelGeometry(
  kind: FloatingPanelKind,
  viewport: { readonly width: number; readonly height: number },
  offset = 0
): FloatingPanelGeometry {
  const size = defaultPanelSize(kind);
  const width = Math.min(size.width, Math.max(minPanelWidth, viewport.width - panelMargin * 2));
  const height = Math.min(size.height, Math.max(minPanelHeight, viewport.height - panelMargin * 2));
  const x = Math.max(panelMargin, viewport.width - width - 34 - offset);
  const y = 88 + offset;

  return clampFloatingPanelGeometry({ x, y, width, height }, viewport);
}

export function openOrRaiseFloatingPanel(
  panels: readonly FloatingPanelState[],
  kind: FloatingPanelKind,
  chapterId: string | null,
  viewport: { readonly width: number; readonly height: number },
  scratchNoteId: string | null = null,
  outlineTab: OutlineFloatingTab = "chapter"
): FloatingPanelState[] {
  const panelChapterId = kind === "chat" ? null : chapterId;
  const panelScratchNoteId = kind === "scratch" ? scratchNoteId ?? null : null;
  const panelScratchDraftId = kind === "scratch" && !panelScratchNoteId ? createFloatingScratchDraftId() : null;
  const panelOutlineTab = kind === "outline" ? outlineTab : null;
  const id = createFloatingPanelId(kind, panelChapterId, panelScratchNoteId, panelScratchDraftId, outlineTab);
  const maxZIndex = panels.reduce((max, panel) => Math.max(max, panel.zIndex), 100);
  const existing = panels.find((panel) => panel.id === id);
  if (existing) {
    return panels.map((panel) => (panel.id === id ? { ...panel, minimized: false, outlineTab: panelOutlineTab, zIndex: maxZIndex + 1 } : panel));
  }

  const geometry = getDefaultFloatingPanelGeometry(kind, viewport, panels.length * 26);
  return [
    ...panels,
    {
      ...geometry,
      id,
      kind,
      chapterId: panelChapterId,
      outlineTab: panelOutlineTab,
      scratchDraftId: panelScratchDraftId,
      scratchNoteId: panelScratchNoteId,
      minimized: false,
      zIndex: maxZIndex + 1
    }
  ];
}
