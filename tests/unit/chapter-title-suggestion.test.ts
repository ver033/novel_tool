import { describe, expect, it } from "vitest";
import type { ChapterSummary } from "../../src/main/shared/types";
import { suggestNewChapterTitle } from "../../src/renderer/state/chapter-title";

function chapter(input: { readonly id: string; readonly title: string; readonly sortOrder: number }): ChapterSummary {
  return {
    id: input.id,
    projectId: "project_1",
    title: input.title,
    volumeTitle: "第一卷",
    sortOrder: input.sortOrder,
    wordCount: 0,
    dailyWordCount: 0,
    dailyWordCountDate: null,
    targetWordCount: null,
    status: "draft",
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:00:00.000Z"
  };
}

describe("chapter title suggestion", () => {
  it("continues the most recent Chinese chapter-number style", () => {
    const chapters = [
      chapter({ id: "chapter_13", title: "第十三章 客人", sortOrder: 12 }),
      chapter({ id: "chapter_14", title: "第十四章 坊市", sortOrder: 13 })
    ];

    expect(suggestNewChapterTitle(chapters)).toBe("第十五章");
  });

  it("continues Arabic chapter-number style when the neighboring chapter uses digits", () => {
    const chapters = [
      chapter({ id: "chapter_13", title: "第13章 客人", sortOrder: 12 }),
      chapter({ id: "chapter_14", title: "第14章 坊市", sortOrder: 13 })
    ];

    expect(suggestNewChapterTitle(chapters)).toBe("第15章");
  });

  it("still avoids duplicate chapter labels when called with a middle chapter", () => {
    const chapters = [
      chapter({ id: "chapter_14", title: "第十四章 坊市", sortOrder: 13 }),
      chapter({ id: "chapter_15", title: "第十五章 米特尔拍卖场", sortOrder: 14 })
    ];

    expect(suggestNewChapterTitle(chapters, { afterChapterId: "chapter_14" })).toBe("第十六章");
  });
});
