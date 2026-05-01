import { describe, expect, it } from "vitest";
import { applyImportPreviewOperations, detectTxtChapters, normalizeTxtContent } from "../../src/main/import/chapter-detector";

describe("TXT chapter detector", () => {
  it("normalizes line endings, BOM, repeated blank lines, and full-width spaces", () => {
    const normalized = normalizeTxtContent("\uFEFF序章\r\n\r\n\r\n　　风起。\r第二行");

    expect(normalized).toBe("序章\n\n风起。\n第二行");
  });

  it("detects common Chinese novel chapter headings", () => {
    const detected = detectTxtChapters(`
序章
风从山口吹来。

第一章 归途
他终于回到了村口。

第12章 夜谈
灯火亮起。

卷一 少年
第一卷 山河旧梦
番外 雪夜
后记
多年以后。
`);

    expect(detected.map((chapter) => chapter.title)).toEqual(["序章", "第一章 归途", "第12章 夜谈", "卷一 少年", "第一卷 山河旧梦", "番外 雪夜", "后记"]);
    expect(detected[1].text).toContain("他终于回到了村口。");
    expect(detected.every((chapter, index) => chapter.order === index)).toBe(true);
  });

  it("falls back to a single chapter when no heading is detected", () => {
    const detected = detectTxtChapters("没有标题的第一段。\n\n第二段。");

    expect(detected).toHaveLength(1);
    expect(detected[0]).toMatchObject({
      title: "正文",
      text: "没有标题的第一段。\n\n第二段。"
    });
  });

  it("supports rename, merge with previous, split from line, and redetect operations", () => {
    const chapters = detectTxtChapters("第一章 旧名\n第一行\n第二行\n第三行\n\n第二章 夜归\n第四行");

    const adjusted = applyImportPreviewOperations(chapters, [
      { type: "rename_chapter", chapterIndex: 0, title: "第一章 新名" },
      { type: "split_from_line", chapterIndex: 0, lineNumber: 2 },
      { type: "merge_with_previous", chapterIndex: 2 }
    ]);

    expect(adjusted.map((chapter) => chapter.title)).toEqual(["第一章 新名", "第一章 新名 下"]);
    expect(adjusted[0].text).toBe("第一行");
    expect(adjusted[1].text).toContain("第二行\n第三行");
    expect(adjusted[1].text).toContain("第二章 夜归\n第四行");

    const redetected = applyImportPreviewOperations(adjusted, [{ type: "redetect" }]);
    expect(redetected.map((chapter) => chapter.title)).toEqual(["正文"]);
  });
});
