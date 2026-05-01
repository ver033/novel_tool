import { describe, expect, it } from "vitest";
import { ensureParagraphIds } from "../../src/renderer/editor/tiptap/paragraph-id";
import { createSelectionHash, createSelectionSnapshot } from "../../src/renderer/editor/tiptap/selection-utils";
import type { TiptapDocument } from "../../src/renderer/editor/tiptap/converters";

describe("phase 5 selection helpers", () => {
  it("preserves existing paragraph IDs and adds missing IDs to paragraph-like nodes", () => {
    const document: TiptapDocument = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { paragraphId: "p_existing" }, content: [{ type: "text", text: "第一段" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "第二段" }] },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "第三段" }] }] }
      ]
    };
    let idIndex = 0;

    const result = ensureParagraphIds(document, () => `p_generated_${++idIndex}`);

    expect(result.content[0].attrs?.paragraphId).toBe("p_existing");
    expect(result.content[1].attrs).toMatchObject({ level: 2, paragraphId: "p_generated_1" });
    expect(result.content[2].content?.[0].attrs?.paragraphId).toBe("p_generated_2");
    expect(document.content[1].attrs).toEqual({ level: 2 });
  });

  it("creates stable selection snapshots with a text and paragraph hash", () => {
    const input = {
      chapterId: "chapter_12",
      from: 21,
      to: 37,
      text: "他勒住马缰，望着前方越来越熟悉的山川田野",
      paragraphIds: ["p_1", "p_2"],
      createdAt: "2026-04-28T00:00:00.000Z"
    };

    const snapshot = createSelectionSnapshot(input);

    expect(snapshot).toEqual({
      ...input,
      selectionHash: createSelectionHash(input.text, input.paragraphIds)
    });
    expect(snapshot.selectionHash).not.toBe(createSelectionHash(`${input.text}。`, input.paragraphIds));
    expect(snapshot.selectionHash).not.toBe(createSelectionHash(input.text, ["p_1"]));
  });
});
