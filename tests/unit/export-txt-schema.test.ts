import { describe, expect, it } from "vitest";
import { exportTxtInputSchema } from "../../src/main/shared/schemas";

describe("TXT export schema", () => {
  it("accepts all-chapter exports for backward compatibility", () => {
    expect(
      exportTxtInputSchema.safeParse({
        projectId: "project_1",
        filePath: "/tmp/novel.txt",
        range: "all_chapters",
        includeChapterTitles: true
      }).success
    ).toBe(true);
  });

  it("accepts custom chapter range exports", () => {
    expect(
      exportTxtInputSchema.safeParse({
        projectId: "project_1",
        filePath: "/tmp/novel.txt",
        range: {
          type: "chapter_range",
          fromChapterId: "chapter_2",
          toChapterId: "chapter_5"
        },
        includeChapterTitles: false
      }).success
    ).toBe(true);
  });
});
