import { describe, expect, it } from "vitest";
import { parseChatAtReference, parseChatScopeReference } from "../../src/main/ai/chat-reference-parser";

describe("chat @ reference parser", () => {
  it("parses current chapter and selection references", () => {
    expect(parseChatAtReference("@本章 总结一下")).toEqual({
      scope: { type: "current_chapter" },
      messageWithoutReference: "总结一下"
    });
    expect(parseChatAtReference("请校对 @选区")).toEqual({
      scope: { type: "selection" },
      messageWithoutReference: "请校对"
    });
  });

  it("parses single chapter references with Arabic and Chinese numerals", () => {
    expect(parseChatAtReference("@第4章 总结")).toEqual({
      scope: { type: "chapter", ordinal: 4 },
      messageWithoutReference: "总结"
    });
    expect(parseChatAtReference("@第四章 总结")).toEqual({
      scope: { type: "chapter", ordinal: 4 },
      messageWithoutReference: "总结"
    });
    expect(parseChatAtReference("@第４章 总结")).toEqual({
      scope: { type: "chapter", ordinal: 4 },
      messageWithoutReference: "总结"
    });
  });

  it("parses chapter range references", () => {
    expect(parseChatAtReference("@第2-5章 梳理主线")).toEqual({
      scope: { type: "chapter_range", from: 2, to: 5 },
      messageWithoutReference: "梳理主线"
    });
    expect(parseChatAtReference("@第十二到第十五章 检查伏笔")).toEqual({
      scope: { type: "chapter_range", from: 12, to: 15 },
      messageWithoutReference: "检查伏笔"
    });
  });

  it("parses all-chapter references", () => {
    expect(parseChatAtReference("@全部章节 总结现有剧情")).toEqual({
      scope: { type: "all_chapters" },
      messageWithoutReference: "总结现有剧情"
    });
    expect(parseChatAtReference("总结 @全书")).toEqual({
      scope: { type: "all_chapters" },
      messageWithoutReference: "总结"
    });
  });

  it("returns null when there is no supported @ reference", () => {
    expect(parseChatAtReference("总结第4章")).toBeNull();
    expect(parseChatAtReference("@人物 林远")).toBeNull();
  });

  it("parses obvious natural-language all-chapter references", () => {
    expect(parseChatScopeReference("总结现有的全部章节的内容")).toEqual({
      scope: { type: "all_chapters" },
      messageWithoutReference: "总结现有的的内容"
    });
    expect(parseChatScopeReference("总结全书剧情")).toEqual({
      scope: { type: "all_chapters" },
      messageWithoutReference: "总结剧情"
    });
  });

  it("parses obvious natural-language chapter references", () => {
    expect(parseChatScopeReference("总结一下第4章的内容")).toEqual({
      scope: { type: "chapter", ordinal: 4 },
      messageWithoutReference: "总结一下的内容"
    });
    expect(parseChatScopeReference("帮我总结前两章的内容")).toEqual({
      scope: { type: "chapter_range", from: 1, to: 2 },
      messageWithoutReference: "帮我总结的内容"
    });
    expect(parseChatScopeReference("帮我总结前十章的内容")).toEqual({
      scope: { type: "chapter_range", from: 1, to: 10 },
      messageWithoutReference: "帮我总结的内容"
    });
    expect(parseChatScopeReference("梳理第2到第3章主线")).toEqual({
      scope: { type: "chapter_range", from: 2, to: 3 },
      messageWithoutReference: "梳理主线"
    });
    expect(parseChatScopeReference("对比第3章和第6章，人物关系有什么变化")).toEqual({
      scope: { type: "chapter_range", from: 3, to: 6 },
      messageWithoutReference: "对比，人物关系有什么变化"
    });
  });

  it("parses Japanese chapter, range, selection, and whole-book references", () => {
    expect(parseChatScopeReference("第3話を要約してください")).toEqual({
      scope: { type: "chapter", ordinal: 3 },
      messageWithoutReference: "を要約してください"
    });
    expect(parseChatScopeReference("第2章から第5章までの伏線を確認して")).toEqual({
      scope: { type: "chapter_range", from: 2, to: 5 },
      messageWithoutReference: "の伏線を確認して"
    });
    expect(parseChatScopeReference("すべての章を要約して")).toEqual({
      scope: { type: "all_chapters" },
      messageWithoutReference: "を要約して"
    });
    expect(parseChatScopeReference("現在の選択範囲を校正して")).toEqual({
      scope: { type: "selection" },
      messageWithoutReference: "を校正して"
    });
  });
});
