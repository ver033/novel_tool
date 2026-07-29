import { describe, expect, it } from "vitest";
import {
  clearScratchpadDraft,
  readScratchpadDraft,
  scratchpadDraftStorageKey,
  writeScratchpadDraft,
  type ScratchpadDraftScope
} from "../../src/renderer/sidebar/scratchpad-draft-store";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const quickScope: ScratchpadDraftScope = {
  chapterId: "chapter:1",
  kind: "quick-note",
  projectId: "project/1"
};

describe("scratchpad draft store", () => {
  it("isolates drafts by project, chapter, kind, and note", () => {
    const storage = new MemoryStorage();
    const floatingScope: ScratchpadDraftScope = {
      ...quickScope,
      kind: "floating-note",
      noteId: "note:1"
    };

    writeScratchpadDraft(quickScope, "quick", storage);
    writeScratchpadDraft(floatingScope, "floating", storage);

    expect(readScratchpadDraft(quickScope, storage)).toBe("quick");
    expect(readScratchpadDraft(floatingScope, storage)).toBe("floating");
    expect(scratchpadDraftStorageKey(quickScope)).not.toBe(scratchpadDraftStorageKey(floatingScope));
  });

  it("clears empty or successfully saved drafts without affecting other scopes", () => {
    const storage = new MemoryStorage();
    const otherScope = { ...quickScope, chapterId: "chapter:2" };
    writeScratchpadDraft(quickScope, "first", storage);
    writeScratchpadDraft(otherScope, "second", storage);

    clearScratchpadDraft(quickScope, storage);
    expect(readScratchpadDraft(quickScope, storage)).toBe("");
    expect(readScratchpadDraft(otherScope, storage)).toBe("second");

    writeScratchpadDraft(otherScope, "", storage);
    expect(readScratchpadDraft(otherScope, storage)).toBe("");
  });

  it("does not create a key without a project", () => {
    const storage = new MemoryStorage();
    const unavailableScope = { ...quickScope, projectId: null };
    writeScratchpadDraft(unavailableScope, "ignored", storage);
    expect(scratchpadDraftStorageKey(unavailableScope)).toBeNull();
    expect(storage.length).toBe(0);
  });
});
