import type { Editor } from "@tiptap/react";

export const FLOATING_MENU_EDGE_PADDING = 12;
export const EDITOR_BOTTOM_CHROME_SAFE_AREA = 78;

type ClientRectLike = Pick<DOMRect, "bottom" | "height" | "left" | "right" | "top" | "width" | "x" | "y">;

export type FloatingMenuPoint = {
  readonly x: number;
  readonly y: number;
};

export type FloatingMenuSize = {
  readonly height: number;
  readonly width: number;
};

export type FloatingMenuPosition = {
  readonly left: number;
  readonly top: number;
};

export type FloatingMenuViewport = {
  readonly height: number;
  readonly width: number;
};

type SelectionVirtualElement = {
  readonly getBoundingClientRect: () => DOMRect;
  readonly getClientRects: () => DOMRect[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function makeDomRect(left: number, top: number, width: number, height: number): DOMRect {
  const data = {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top
  };
  return {
    ...data,
    toJSON: () => data
  } as DOMRect;
}

function copyDomRect(rect: ClientRectLike): DOMRect {
  return makeDomRect(rect.left, rect.top, rect.width, rect.height);
}

function combineRects(rects: readonly ClientRectLike[]): DOMRect | null {
  if (rects.length === 0) {
    return null;
  }

  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return makeDomRect(left, top, right - left, bottom - top);
}

function intersects(rect: ClientRectLike, bounds: ClientRectLike): boolean {
  return rect.bottom > bounds.top && rect.top < bounds.bottom && rect.right > bounds.left && rect.left < bounds.right;
}

function viewportBounds(): DOMRect {
  return makeDomRect(0, 0, window.innerWidth, window.innerHeight);
}

function visibleEditorBounds(editorDom: HTMLElement): DOMRect {
  const scrollContainer = editorDom.closest(".editor-scroll");
  const editorBounds = scrollContainer instanceof HTMLElement ? scrollContainer.getBoundingClientRect() : editorDom.getBoundingClientRect();
  const viewport = viewportBounds();
  const left = Math.max(editorBounds.left, viewport.left + FLOATING_MENU_EDGE_PADDING);
  const top = Math.max(editorBounds.top, viewport.top + FLOATING_MENU_EDGE_PADDING);
  const right = Math.min(editorBounds.right, viewport.right - FLOATING_MENU_EDGE_PADDING);
  const bottom = Math.min(editorBounds.bottom, viewport.bottom - EDITOR_BOTTOM_CHROME_SAFE_AREA);

  return makeDomRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
}

function fallbackSelectionRect(editor: Editor): DOMRect | null {
  try {
    const { from, to } = editor.state.selection;
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to, -1);
    const left = Math.min(start.left, end.left);
    const top = Math.min(start.top, end.top);
    const right = Math.max(start.right, end.right);
    const bottom = Math.max(start.bottom, end.bottom);
    return makeDomRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
  } catch {
    return null;
  }
}

function nativeSelectionRects(editor: Editor): DOMRect[] {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return [];
  }

  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer;
  const ancestorElement = ancestor instanceof Element ? ancestor : ancestor.parentElement;
  if (!ancestorElement || !editor.view.dom.contains(ancestorElement)) {
    return [];
  }

  return Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 || rect.height > 0)
    .map(copyDomRect);
}

function isFullDocumentSelection(editor: Editor): boolean {
  const { from, to } = editor.state.selection;
  const docEnd = editor.state.doc.content.size;
  return from <= 1 && to >= docEnd - 1;
}

function selectionSpansVisibleEditor(selectionBounds: ClientRectLike, visibleBounds: ClientRectLike): boolean {
  return selectionBounds.top <= visibleBounds.top + FLOATING_MENU_EDGE_PADDING && selectionBounds.bottom >= visibleBounds.bottom - FLOATING_MENU_EDGE_PADDING;
}

function topVisibleAnchorRect(visibleBounds: ClientRectLike): DOMRect {
  const anchorX = visibleBounds.left + visibleBounds.width / 2;
  const anchorY = clamp(visibleBounds.top + 76, visibleBounds.top + FLOATING_MENU_EDGE_PADDING, visibleBounds.bottom - FLOATING_MENU_EDGE_PADDING);
  return makeDomRect(anchorX, anchorY, 1, 1);
}

function lineAnchorRect(lineRect: ClientRectLike, visibleBounds: ClientRectLike): DOMRect {
  const anchorX = clamp(lineRect.left + lineRect.width / 2, visibleBounds.left + FLOATING_MENU_EDGE_PADDING, visibleBounds.right - FLOATING_MENU_EDGE_PADDING);
  const anchorY = clamp(lineRect.top, visibleBounds.top + FLOATING_MENU_EDGE_PADDING, visibleBounds.bottom - FLOATING_MENU_EDGE_PADDING);
  return makeDomRect(anchorX, anchorY, 1, Math.max(1, Math.min(lineRect.height, 24)));
}

export function createSelectionFloatingAnchor(editor: Editor): SelectionVirtualElement | null {
  const visibleBounds = visibleEditorBounds(editor.view.dom);
  const nativeRects = nativeSelectionRects(editor);
  const fallbackRect = fallbackSelectionRect(editor);
  const selectionRects = nativeRects.length > 0 ? nativeRects : fallbackRect ? [fallbackRect] : [];
  const selectionBounds = combineRects(selectionRects);
  if (!selectionBounds) {
    return null;
  }

  const visibleSelectionRects = selectionRects.filter((rect) => intersects(rect, visibleBounds));
  const shouldAnchorToViewportTop =
    isFullDocumentSelection(editor) ||
    selectionSpansVisibleEditor(selectionBounds, visibleBounds) ||
    selectionBounds.height > visibleBounds.height * 0.65 ||
    visibleSelectionRects.length > 8;

  const anchorRect = shouldAnchorToViewportTop ? topVisibleAnchorRect(visibleBounds) : lineAnchorRect(visibleSelectionRects[0] ?? selectionBounds, visibleBounds);

  return {
    getBoundingClientRect: () => anchorRect,
    getClientRects: () => [anchorRect]
  };
}

export function shouldOpenDropdownAbove(menuRect: ClientRectLike, dropdownHeight: number, viewportHeight: number = window.innerHeight): boolean {
  const spaceBelow = viewportHeight - EDITOR_BOTTOM_CHROME_SAFE_AREA - menuRect.bottom;
  const spaceAbove = menuRect.top - FLOATING_MENU_EDGE_PADDING;
  return spaceBelow < dropdownHeight + FLOATING_MENU_EDGE_PADDING && spaceAbove > spaceBelow;
}

export function clampEditorContextMenuPosition(
  point: FloatingMenuPoint,
  menuSize: FloatingMenuSize,
  viewport: FloatingMenuViewport,
  bottomSafeArea = EDITOR_BOTTOM_CHROME_SAFE_AREA,
  padding = FLOATING_MENU_EDGE_PADDING
): FloatingMenuPosition {
  const maxLeft = viewport.width - menuSize.width - padding;
  const maxTop = viewport.height - bottomSafeArea - menuSize.height;
  return {
    left: clamp(point.x, padding, maxLeft),
    top: clamp(point.y, padding, maxTop)
  };
}
