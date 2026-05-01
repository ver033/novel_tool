import { describe, expect, it } from "vitest";
import type { ScratchNoteRecord } from "../../src/main/shared/types";
import { filterScratchNotes, getScratchNoteSourceLabel, sortScratchNotes } from "../../src/renderer/sidebar/scratchpad-utils";

function note(input: Partial<ScratchNoteRecord> & Pick<ScratchNoteRecord, "id">): ScratchNoteRecord {
  return {
    projectId: "project_1",
    chapterId: null,
    content: "便签",
    pinned: false,
    sourceTaskId: null,
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
    ...input
  };
}

describe("scratchpad note presentation", () => {
  it("derives the visible source label from persisted note data", () => {
    expect(getScratchNoteSourceLabel(note({ id: "manual_note" }))).toBe("灵感");
    expect(getScratchNoteSourceLabel(note({ id: "ai_note", sourceTaskId: "task_1" }))).toBe("AI 输出");
  });

  it("keeps pinned notes first and newest notes first inside each group", () => {
    const olderPinned = note({ id: "older_pinned", pinned: true, updatedAt: "2026-04-28T00:00:01.000Z" });
    const newerPinned = note({ id: "newer_pinned", pinned: true, updatedAt: "2026-04-28T00:00:02.000Z" });
    const newestUnpinned = note({ id: "newest_unpinned", updatedAt: "2026-04-28T00:00:03.000Z" });

    expect(sortScratchNotes([newestUnpinned, olderPinned, newerPinned]).map((item) => item.id)).toEqual([
      "newer_pinned",
      "older_pinned",
      "newest_unpinned"
    ]);
  });

  it("filters notes by real source and pinned state", () => {
    const manual = note({ id: "manual" });
    const ai = note({ id: "ai", sourceTaskId: "task_1" });
    const pinned = note({ id: "pinned", pinned: true });
    const notes = [manual, ai, pinned];

    expect(filterScratchNotes(notes, "灵感").map((item) => item.id)).toEqual(["pinned", "manual"]);
    expect(filterScratchNotes(notes, "AI 输出").map((item) => item.id)).toEqual(["ai"]);
    expect(filterScratchNotes(notes, "置顶").map((item) => item.id)).toEqual(["pinned"]);
  });
});
