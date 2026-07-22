import { describe, expect, it } from "vitest";
import { parseExplicitChapterOrdinal } from "../../src/main/ai/chat-context-resolver";

describe("chat context resolver", () => {
  it("parses explicit Arabic and Chinese chapter references", () => {
    expect(parseExplicitChapterOrdinal("总结一下第４章的内容")).toBe(4);
    expect(parseExplicitChapterOrdinal("总结第四章")).toBe(4);
    expect(parseExplicitChapterOrdinal("总结第十二回")).toBe(12);
    expect(parseExplicitChapterOrdinal("总结第一百零三章")).toBe(103);
    expect(parseExplicitChapterOrdinal("第12話を要約して")).toBe(12);
  });
});
