import { describe, expect, it } from "vitest";
import { countWritingUnits } from "../../src/main/shared/text";
import { createTiptapDocumentFromPlainText, extractPlainTextFromTiptapJson } from "../../src/renderer/editor/tiptap/converters";

describe("phase 4 editor helpers", () => {
  it("counts Chinese characters and latin alphanumeric characters without punctuation or spaces", () => {
    expect(countWritingUnits("母亲停下筷子。He said ok.")).toBe(14);
    expect(countWritingUnits("  林远，回来了！  ")).toBe(5);
    expect(countWritingUnits("abc 123")).toBe(6);
  });

  it("counts fullwidth alphanumerics and non-BMP Han characters with a platform-stable algorithm", () => {
    expect(countWritingUnits("林远ＡＢ１２𠀀，！")).toBe(7);
  });

  it("extracts plain text from Tiptap JSON with paragraph breaks and hard breaks", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "第1章" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "母亲停下" },
            { type: "hardBreak" },
            { type: "text", text: "筷子。" }
          ]
        }
      ]
    };

    expect(extractPlainTextFromTiptapJson(doc)).toBe("第1章\n\n母亲停下\n筷子。");
  });

  it("creates a minimal Tiptap document from plain text", () => {
    expect(createTiptapDocumentFromPlainText("第一段\n\n第二段")).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "第一段" }] },
        { type: "paragraph", content: [{ type: "text", text: "第二段" }] }
      ]
    });
  });
});
