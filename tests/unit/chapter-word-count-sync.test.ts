import { describe, expect, it } from "vitest";
import { mergeSavedChapterContentIntoChapters } from "../../src/renderer/state/app-store";
import type { ChapterContent, ChapterSummary } from "../../src/main/shared/types";

function chapter(input: { readonly id: string; readonly wordCount: number; readonly updatedAt?: string }): ChapterSummary {
  return {
    id: input.id,
    projectId: "project_1",
    title: input.id === "chapter_1" ? "第1章" : "第2章",
    volumeTitle: null,
    sortOrder: input.id === "chapter_1" ? 0 : 1,
    wordCount: input.wordCount,
    dailyWordCount: 0,
    dailyWordCountDate: null,
    targetWordCount: null,
    status: "draft",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-05-01T00:00:00.000Z"
  };
}

function savedContent(input: { readonly id: string; readonly wordCount: number; readonly updatedAt: string }): ChapterContent {
  return {
    ...chapter({ id: input.id, wordCount: input.wordCount, updatedAt: input.updatedAt }),
    contentJson: { type: "doc", content: [] },
    plainText: "保存后的正文"
  };
}

describe("chapter word count synchronization", () => {
  it("updates the chapter summary word count from saved chapter content", () => {
    const chapters = [chapter({ id: "chapter_1", wordCount: 10 }), chapter({ id: "chapter_2", wordCount: 20 })];

    const merged = mergeSavedChapterContentIntoChapters(
      chapters,
      savedContent({ id: "chapter_1", wordCount: 128, updatedAt: "2026-05-01T00:12:00.000Z" })
    );

    expect(merged).toEqual([
      expect.objectContaining({ id: "chapter_1", wordCount: 128, updatedAt: "2026-05-01T00:12:00.000Z" }),
      expect.objectContaining({ id: "chapter_2", wordCount: 20 })
    ]);
    expect(merged[0]).not.toHaveProperty("plainText");
    expect(merged[0]).not.toHaveProperty("contentJson");
  });

  it("ignores saved content from another project even when chapter ids match", () => {
    const chapters = [chapter({ id: "chapter_1", wordCount: 10 })];
    const foreignContent = {
      ...savedContent({ id: "chapter_1", wordCount: 128, updatedAt: "2026-05-01T00:12:00.000Z" }),
      projectId: "project_2"
    };

    const merged = mergeSavedChapterContentIntoChapters(chapters, foreignContent);

    expect(merged).toEqual([expect.objectContaining({ id: "chapter_1", projectId: "project_1", wordCount: 10 })]);
  });
});
