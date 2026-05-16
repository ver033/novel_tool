import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { applyImportPreviewOperations, detectTxtChapters, normalizeTxtContent } from "../../src/main/import/chapter-detector";
import { readTxtFile } from "../../src/main/import/txt-reader";

const bailuyuanTxtPath = resolve(process.cwd(), "../test_novel/《白鹿原》全集.txt");

describe("TXT chapter detector", () => {
  it("normalizes line endings, BOM, repeated blank lines, and full-width spaces", () => {
    const normalized = normalizeTxtContent("\uFEFF序章\r\n\r\n\r\n　　风起。\r第二行");

    expect(normalized).toBe("序章\n\n风起。\n第二行");
  });

  it("detects common Chinese novel chapter headings", () => {
    const detected = detectTxtChapters(`
序章
风从山口吹来。

第一章 归途
他终于回到了村口。

第12章 夜谈
灯火亮起。

卷一 少年
第一卷 山河旧梦
番外 雪夜
后记
多年以后。
`);

    expect(detected.map((chapter) => chapter.title)).toEqual(["序章", "第一章 归途", "第12章 夜谈", "卷一 少年", "第一卷 山河旧梦", "番外 雪夜", "后记"]);
    expect(detected[1].text).toContain("他终于回到了村口。");
    expect(detected.every((chapter, index) => chapter.order === index)).toBe(true);
  });

  it("detects spaced chapter number headings from legacy TXT files", () => {
    const detected = detectTxtChapters(`
第一章
这里是第一章正文。

第 二 章
这里是第二章正文。

 第三章
这里是第三章正文。
`);

    expect(detected.map((chapter) => chapter.title)).toEqual(["第一章", "第二章", "第三章"]);
    expect(detected[0].text).toBe("这里是第一章正文。");
    expect(detected[1].text).toBe("这里是第二章正文。");
  });

  it("falls back to a single chapter when no heading is detected", () => {
    const detected = detectTxtChapters("没有标题的第一段。\n\n第二段。");

    expect(detected).toHaveLength(1);
    expect(detected[0]).toMatchObject({
      title: "正文",
      text: "没有标题的第一段。\n\n第二段。"
    });
  });

  it("does not create an empty chapter from consecutive metadata and title headings", () => {
    const detected = detectTxtChapters(`
第一章 2363字
第一章 陨落的天才
“斗之力，三段！”

第二章 斗气大陆
斗气大陆正文。
`);

    expect(detected.map((chapter) => chapter.title)).toEqual(["第一章 陨落的天才", "第二章 斗气大陆"]);
    expect(detected.map((chapter) => chapter.wordCount)).not.toContain(0);
    expect(detected[0].text).toContain("斗之力");
  });

  it("does not create an empty chapter when word-count metadata has a page marker before the real title", () => {
    const detected = detectTxtChapters(`

第一章 7433字 

第一章

“怎么今晚又不回来吃饭？”妈妈停下手里的筷子。
`);

    expect(detected.map((chapter) => chapter.title)).toEqual(["第一章"]);
    expect(detected).toHaveLength(1);
    expect(detected[0].wordCount).toBeGreaterThan(0);
    expect(detected[0].text).toContain("怎么今晚又不回来吃饭");
  });

  it("supports rename, merge with previous, split from line, and redetect operations", () => {
    const chapters = detectTxtChapters("第一章 旧名\n第一行\n第二行\n第三行\n\n第二章 夜归\n第四行");

    const adjusted = applyImportPreviewOperations(chapters, [
      { type: "rename_chapter", chapterIndex: 0, title: "第一章 新名" },
      { type: "split_from_line", chapterIndex: 0, lineNumber: 2 },
      { type: "merge_with_previous", chapterIndex: 2 }
    ]);

    expect(adjusted.map((chapter) => chapter.title)).toEqual(["第一章 新名", "第一章 新名 下"]);
    expect(adjusted[0].text).toBe("第一行");
    expect(adjusted[1].text).toContain("第二行\n第三行");
    expect(adjusted[1].text).toContain("第二章 夜归\n第四行");

    const redetected = applyImportPreviewOperations(adjusted, [{ type: "redetect" }]);
    expect(redetected.map((chapter) => chapter.title)).toEqual(["正文"]);
  });
});

describe.skipIf(!existsSync(bailuyuanTxtPath))("TXT chapter detector against local 白鹿原 fixture", () => {
  it("keeps the first twenty chapter headings separated", () => {
    const { text } = readTxtFile(bailuyuanTxtPath);
    const detected = detectTxtChapters(text);

    expect(detected.slice(0, 20).map((chapter) => chapter.title)).toEqual([
      "第一章",
      "第二章",
      "第三章",
      "第四章",
      "第五章",
      "第六章",
      "第七章",
      "第八章",
      "第九章",
      "第十章",
      "第十一章",
      "第十二章",
      "第十三章",
      "第十四章",
      "第十五章",
      "第十六章",
      "第十七章",
      "第十八章",
      "第十九章",
      "第二十章"
    ]);
  });
});
