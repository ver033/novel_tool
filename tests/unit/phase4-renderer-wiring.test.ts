import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("phase 4 renderer Tiptap wiring", () => {
  it("uses the official Tiptap React entrypoints and required extensions", () => {
    const editor = readSource("src/renderer/editor/NovelEditor.tsx");
    const bubbleMenu = readSource("src/renderer/editor/SelectionBubbleMenu.tsx");

    expect(editor).toContain("@tiptap/react");
    expect(`${editor}\n${bubbleMenu}`).toContain("@tiptap/react/menus");
    expect(editor).toContain("@tiptap/starter-kit");
    expect(editor).toContain("@tiptap/extensions");
    expect(editor).toContain("@tiptap/extension-unique-id");
    expect(editor).not.toContain("@tiptap/extension-underline");
    expect(bubbleMenu).toContain("BubbleMenu");
    expect(editor).toContain("Placeholder");
    expect(editor).toContain("CharacterCount");
    expect(editor).toContain("UniqueID");
  });

  it("replaces the static manuscript with an isolated NovelEditor save pipeline", () => {
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");
    const editorStore = readSource("src/renderer/state/editor-store.ts");

    expect(writingPage).toContain("<NovelEditor");
    expect(writingPage).not.toContain("<article className=\"manuscript\"");
    expect(editorStore).toContain("AUTOSAVE_DEBOUNCE_MS = 1000");
    expect(editorStore).toContain("getContent");
    expect(editorStore).toContain("saveContent");
    expect(editorStore).toContain("api.settings.get");
    expect(editorStore).toContain("editorSettings");
    expect(editorStore).toContain("extractPlainTextFromTiptapJson");
    expect(editorStore).toContain("countWritingUnits");
  });

  it("flushes dirty editor content before chapter-changing navigation", () => {
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");
    const editorStore = readSource("src/renderer/state/editor-store.ts");

    expect(editorStore).toContain("flushPendingSave");
    expect(writingPage).toContain("flushBeforeNavigation");
    expect(writingPage).toContain("flushBeforeNavigation(() => onSelectChapter(chapterId))");
    expect(writingPage).toContain("flushBeforeNavigation(() => onCreateChapter())");
    expect(writingPage).toContain("handleDeleteChapter");
    expect(writingPage).toContain("flushBeforeNavigation(() => onDeleteChapter(chapterId))");
    expect(writingPage).toContain("onDeleteChapter={handleDeleteChapter}");
  });

  it("keeps chapter revision history removed from IPC and preload", () => {
    const types = readSource("src/main/shared/types.ts");
    const preload = readSource("src/preload/api.ts");
    const chapterIpc = readSource("src/main/ipc/chapter-ipc.ts");
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");
    const topBar = readSource("src/renderer/layout/TopBar.tsx");
    const styles = readSource("src/renderer/styles/globals.css");

    expect(types).not.toContain("listRevisions");
    expect(types).not.toContain("getRevision");
    expect(types).not.toContain("restoreRevision");
    expect(preload).not.toContain("listRevisions");
    expect(preload).not.toContain("getRevision");
    expect(preload).not.toContain("restoreRevision");
    expect(chapterIpc).not.toContain("listRevisions");
    expect(chapterIpc).not.toContain("getRevision");
    expect(chapterIpc).not.toContain("restoreRevision");
    expect(writingPage).not.toContain("ChapterHistoryModal");
    expect(writingPage).not.toContain("chapterHistoryOpen");
    expect(writingPage).not.toContain("onHistory");
    expect(topBar).not.toContain("ClockCounterClockwise");
    expect(topBar).not.toContain("历史版本");
    expect(styles).not.toContain("chapter-history");
  });

  it("wires emergency draft recovery into the editor store", () => {
    const editorStore = readSource("src/renderer/state/editor-store.ts");

    expect(editorStore).toContain("draftRecoveryStore.putEmergencyDraft");
    expect(editorStore).toContain("draftRecoveryStore.putDraft");
    expect(editorStore).toContain("draftRecoveryStore.markDraftSaved");
    expect(editorStore).toContain("pendingDraftRecovery");
    expect(editorStore).toContain("recoverDraft");
    expect(editorStore).toContain("dismissDraftRecovery");
  });

  it("renders the emergency draft recovery prompt from the writing page", () => {
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");

    expect(writingPage).toContain("DraftRecoveryPrompt");
    expect(writingPage).toContain("pendingDraftRecovery");
    expect(writingPage).toContain("recoverDraft");
    expect(writingPage).toContain("dismissDraftRecovery");
  });

  it("keeps chapter loads and restores out of the editor undo stack", () => {
    const editor = readSource("src/renderer/editor/NovelEditor.tsx");
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");

    expect(writingPage).toContain('key={`${activeChapter.id}:${editorStore.contentVersion}`}');
    expect(editor).toContain("closeHistory");
    expect(editor).toContain('setMeta("addToHistory", false)');
    expect(editor).toContain("useRef<number | null>(contentVersion)");
  });

  it("wires undo and redo controls beside the top search box", () => {
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");
    const topBar = readSource("src/renderer/layout/TopBar.tsx");
    const styles = readSource("src/renderer/styles/globals.css");

    expect(topBar).toContain("ArrowCounterClockwise");
    expect(topBar).toContain("ArrowClockwise");
    expect(topBar).toContain("label=\"撤销\"");
    expect(topBar).toContain("label=\"重做\"");
    expect(topBar).toContain("readonly onUndo?: () => void");
    expect(topBar).toContain("readonly onRedo?: () => void");
    expect(writingPage).toContain("editor?.chain().focus().undo().run()");
    expect(writingPage).toContain("editor?.chain().focus().redo().run()");
    expect(writingPage).toContain("editor.can().undo()");
    expect(writingPage).toContain("editor.can().redo()");
    expect(styles).toContain(".topbar-center");
    expect(styles).toContain(".undo-redo-group");
  });
});
