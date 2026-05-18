import { describe, expect, it } from "vitest";
import { parseChapterOrdinal } from "../../src/main/external-book-sync/book-chapter-ordinal";

describe("parseChapterOrdinal", () => {
  it("parses common Chinese and Arabic chapter titles", () => {
    expect(parseChapterOrdinal("第四十八章 归来")).toBe(48);
    expect(parseChapterOrdinal("第  五十  章")).toBe(50);
    expect(parseChapterOrdinal("第12章 夜谈")).toBe(12);
    expect(parseChapterOrdinal("第001章")).toBe(1);
    expect(parseChapterOrdinal("第１２３章")).toBe(123);
  });

  it("parses larger Chinese ordinals", () => {
    expect(parseChapterOrdinal("第一百零二章")).toBe(102);
    expect(parseChapterOrdinal("第一千二百三十四章")).toBe(1234);
  });

  it("returns null for non-numbered special sections", () => {
    expect(parseChapterOrdinal("序章")).toBeNull();
    expect(parseChapterOrdinal("番外 雪夜")).toBeNull();
    expect(parseChapterOrdinal("正文")).toBeNull();
    expect(parseChapterOrdinal("后记")).toBeNull();
  });
});
