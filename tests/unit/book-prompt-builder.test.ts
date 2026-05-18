import { describe, expect, it } from "vitest";
import { buildExternalBookSyncChatMessages } from "../../src/main/external-book-sync/book-prompt-builder";

describe("buildExternalBookSyncChatMessages", () => {
  it("splits long missing chapters into bounded chat messages", () => {
    const text = Array.from({ length: 120 }, (_, index) => `第${index}段内容。${"字".repeat(80)}`).join("\n\n");
    const messages = buildExternalBookSyncChatMessages({
      projectName: "测试项目",
      bookFilePath: "C:\\Books\\测试项目\\test.Book",
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
      bookFilePath: "D:\\写作\\举足无措\\story.Book",
      currentLatestLabel: "第48章",
      missingChapters: [
        { key: "book_49", title: "第四十九章", text: "新增正文。", order: 48, wordCount: 5, lineStart: 1, lineEnd: 2, ordinal: 49 }
      ]
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("不要自动改写");
    expect(messages[0]).toContain("新增正文。");
  });
});
