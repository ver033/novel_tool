import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { detectTxtChapters } from "../../src/main/import/chapter-detector";
import { readTxtFile } from "../../src/main/import/txt-reader";

const bailuyuanTxtPath = resolve(process.cwd(), "../test_novel/《白鹿原》全集.txt");

describe.skipIf(!existsSync(bailuyuanTxtPath))("TXT chapter detector real 白鹿原 fixture", () => {
  it("detects the current fixture by actual headings instead of the stale 19-chapter project cache", () => {
    const { text, encoding } = readTxtFile(bailuyuanTxtPath);
    const chapters = detectTxtChapters(text);
    const titles = chapters.map((chapter) => chapter.title);

    expect(encoding.toLowerCase()).toMatch(/gb|18030|2312/);
    expect(chapters).toHaveLength(34);
    expect(titles.slice(0, 6)).toEqual(["第一章", "第二章", "第三章", "第四章", "第五章", "第六章"]);
    expect(titles).toContain("第十三章");
    expect(titles).toContain("第三十四章");
  });
});
