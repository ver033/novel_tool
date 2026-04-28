import type { Editor } from "@tiptap/react";
import type { SelectionSnapshot } from "../../../main/shared/types";

type SelectionSnapshotInput = Omit<SelectionSnapshot, "selectionHash">;

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createSelectionHash(text: string, paragraphIds: readonly string[]): string {
  return stableHash(JSON.stringify({ text, paragraphIds }));
}

export function createSelectionSnapshot(input: SelectionSnapshotInput): SelectionSnapshot {
  return {
    ...input,
    selectionHash: createSelectionHash(input.text, input.paragraphIds)
  };
}

function collectParagraphIds(editor: Editor, from: number, to: number): string[] {
  const paragraphIds = new Set<string>();
  editor.state.doc.nodesBetween(from, to, (node) => {
    const paragraphId = node.attrs.paragraphId as unknown;
    if ((node.type.name === "paragraph" || node.type.name === "heading") && typeof paragraphId === "string" && paragraphId.trim()) {
      paragraphIds.add(paragraphId);
    }
  });
  return [...paragraphIds];
}

export function createSelectionSnapshotFromEditor(editor: Editor, chapterId: string | null, createdAt = new Date()): SelectionSnapshot | null {
  if (!chapterId) {
    return null;
  }

  const { from, to, empty } = editor.state.selection;
  if (empty || to <= from) {
    return null;
  }

  const text = editor.state.doc.textBetween(from, to, "\n", "\n").trim();
  if (!text) {
    return null;
  }

  return createSelectionSnapshot({
    chapterId,
    from,
    to,
    text,
    paragraphIds: collectParagraphIds(editor, from, to),
    createdAt: createdAt.toISOString()
  });
}
