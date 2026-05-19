import { describe, expect, it } from "vitest";
import { buildExternalBookSyncChatMessages } from "../../src/main/external-book-sync/book-prompt-builder";

describe("buildExternalBookSyncChatMessages", () => {
  it("splits long missing chapters into bounded chat messages", () => {
    const text = Array.from({ length: 120 }, (_, index) => `第${index}段内容。${"字".repeat(80)}`).join("\n\n");
    const messages = buildExternalBookSyncChatMessages({
      projectName: "测试项目",
      currentLatestLabel: "第48章",
      missingChapters: [
        { key: "book_49", title: "第四十九章", text, order: 48, wordCount: text.length, lineStart: 1, lineEnd: 240, ordinal: 49 }
      ]
    });

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) => message.length <= 7000)).toBe(true);
    expect(messages.join("\n")).toContain("第四十九章");
    expect(messages.join("\n")).toContain("第119段内容");
  });

  it("keeps short chapters in one message", () => {
    const messages = buildExternalBookSyncChatMessages({
      projectName: "举足无措",
      currentLatestLabel: "第48章",
      missingChapters: [
        { key: "book_49", title: "第四十九章", text: "新增正文。", order: 48, wordCount: 5, lineStart: 1, lineEnd: 2, ordinal: 49 }
      ]
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("不要自动改写");
    expect(messages[0]).toContain("新增正文。");
  });

  it("preserves a long single chapter across multiple LLM messages", () => {
    const longChapter = `开头${"正文".repeat(9000)}结尾`;
    const messages = buildExternalBookSyncChatMessages({
      projectName: "举足无措",
      currentLatestLabel: "第48章",
      missingChapters: [
        { key: "book_49", title: "第四十九章", text: longChapter, order: 48, wordCount: longChapter.length, lineStart: 1, lineEnd: 2, ordinal: 49 }
      ]
    });

    const joined = messages.join("\n");
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) => message.length <= 7000)).toBe(true);
    expect(joined).toContain("开头");
    expect(joined).toContain("结尾");
    expect(joined.length).toBeGreaterThan(longChapter.length);
  });

  it("includes the .Book content for the current project latest chapter", () => {
    const messages = buildExternalBookSyncChatMessages({
      projectName: "举足无措",
      currentLatestLabel: "第1章",
      latestProjectChapterInExternal: {
        key: "book_1",
        title: "第一章",
        projectChapterTitle: "第一章",
        text: ".Book 里的第一章修订正文。",
        order: 0,
        wordCount: 14,
        lineStart: 1,
        lineEnd: 2,
        ordinal: 1
      },
      missingChapters: [
        { key: "book_2", title: "第二章", text: "新增正文。", order: 1, wordCount: 5, lineStart: 3, lineEnd: 4, ordinal: 2 }
      ]
    });

    const body = messages.join("\n");
    expect(body).toContain("当前项目最新章在 .Book 中的对应内容");
    expect(body).toContain(".Book 里的第一章修订正文。");
    expect(body).toContain("缺失章节：第二章");
  });
});
