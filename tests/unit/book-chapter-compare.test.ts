import { describe, expect, it } from "vitest";
import { compareExternalBookChapters } from "../../src/main/external-book-sync/book-chapter-compare";

const projectChapters = Array.from({ length: 48 }, (_, index) => ({
  id: `chapter_${index + 1}`,
  title: `第${index + 1}章`,
  sortOrder: index,
  wordCount: 1000
}));

describe("compareExternalBookChapters", () => {
  it("finds chapters newer than the current project latest ordinal", () => {
    const result = compareExternalBookChapters({
      projectChapters,
      externalChapters: [
        { title: "第四十八章", text: "已有", order: 0, wordCount: 2, lineStart: 1, lineEnd: 2 },
        { title: "第四十九章", text: "新章一", order: 1, wordCount: 3, lineStart: 3, lineEnd: 4 },
        { title: "第五十章", text: "新章二", order: 2, wordCount: 3, lineStart: 5, lineEnd: 6 }
      ]
    });

    expect(result.currentLatestOrdinal).toBe(48);
    expect(result.missingChapters.map((chapter) => chapter.title)).toEqual(["第四十九章", "第五十章"]);
    expect(result.warnings).toEqual([]);
  });

  it("falls back to current chapter count when current titles are not numeric", () => {
    const result = compareExternalBookChapters({
      projectChapters: [
        { id: "chapter_1", title: "远山", sortOrder: 0, wordCount: 100 },
        { id: "chapter_2", title: "夜雨", sortOrder: 1, wordCount: 100 }
      ],
      externalChapters: [
        { title: "远山", text: "已有", order: 0, wordCount: 2, lineStart: 1, lineEnd: 2 },
        { title: "夜雨", text: "已有", order: 1, wordCount: 2, lineStart: 3, lineEnd: 4 },
        { title: "新章", text: "新增", order: 2, wordCount: 2, lineStart: 5, lineEnd: 6 }
      ]
    });

    expect(result.currentLatestOrdinal).toBeNull();
    expect(result.missingChapters.map((chapter) => chapter.title)).toEqual(["新章"]);
  });

  it("warns about ordinal gaps and duplicate titles", () => {
    const result = compareExternalBookChapters({
      projectChapters: projectChapters.slice(0, 48),
      externalChapters: [
        { title: "第五十章", text: "新章", order: 0, wordCount: 2, lineStart: 1, lineEnd: 2 },
        { title: "第五十章", text: "重复", order: 1, wordCount: 2, lineStart: 3, lineEnd: 4 }
      ]
    });

    expect(result.missingChapters).toHaveLength(2);
    expect(result.warnings.some((warning) => warning.includes("第 49 章"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("重复章节标题"))).toBe(true);
  });

  it("keeps duplicate missing chapter keys unique for selection", () => {
    const result = compareExternalBookChapters({
      projectChapters: projectChapters.slice(0, 48),
      externalChapters: [
        { title: "第五十章", text: "新章", order: 0, wordCount: 2, lineStart: 1, lineEnd: 2 },
        { title: "第五十章", text: "重复", order: 1, wordCount: 2, lineStart: 3, lineEnd: 4 }
      ]
    });

    expect(new Set(result.missingChapters.map((chapter) => chapter.key)).size).toBe(result.missingChapters.length);
  });

  it("returns no missing chapters when external source is not newer", () => {
    const result = compareExternalBookChapters({
      projectChapters: projectChapters.slice(0, 2),
      externalChapters: [
        { title: "第一章", text: "已有", order: 0, wordCount: 2, lineStart: 1, lineEnd: 2 },
        { title: "第二章", text: "已有", order: 1, wordCount: 2, lineStart: 3, lineEnd: 4 }
      ]
    });

    expect(result.missingChapters).toEqual([]);
  });
});
