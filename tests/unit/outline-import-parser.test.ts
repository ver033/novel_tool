import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseOutlineFile, parseOutlineText } from "../../src/main/outline/outline-import-parser";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-outline-import-"));
  tempDirs.push(dir);
  return dir;
}

function createTinyXlsx(rows: readonly (readonly string[])[]): Uint8Array {
  const sharedStrings = [...new Set(rows.flat())];
  const sharedIndex = new Map(sharedStrings.map((value, index) => [value, index]));
  const cellRef = (rowIndex: number, columnIndex: number) => `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`;
  const sheetRows = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((value, columnIndex) => `<c r="${cellRef(rowIndex, columnIndex)}" t="s"><v>${sharedIndex.get(value) ?? 0}</v></c>`)
          .join("")}</row>`
    )
    .join("");
  const sharedStringXml = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">${sharedStrings
    .map((value) => `<si><t>${value}</t></si>`)
    .join("")}</sst>`;
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="大纲" sheetId="1" r:id="rId1"/></sheets></workbook>`
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
    ),
    "xl/sharedStrings.xml": strToU8(sharedStringXml),
    "xl/worksheets/sheet1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
    )
  });
}

function createTinyInlineStringXlsx(rows: readonly (readonly string[])[]): Uint8Array {
  const cellRef = (rowIndex: number, columnIndex: number) => `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`;
  const sheetRows = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((value, columnIndex) => `<c r="${cellRef(rowIndex, columnIndex)}" t="inlineStr"><is><t>${value}</t></is></c>`)
          .join("")}</row>`
    )
    .join("");
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="大纲" sheetId="1" r:id="rId1"/></sheets></workbook>`
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
    )
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("outline import parser", () => {
  it("parses row-style pasted table text", () => {
    const rows = parseOutlineText("章节\t故事时间\t星期/备注\t时间段\t情节线\t场景摘要\n第一章\t案发当晚\t雨夜\t晚上\t主线\t主角遇见线人");

    expect(rows).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        chapterTitle: "第一章",
        storyTimeLabel: "案发当晚",
        weekdayLabel: "雨夜",
        daySegment: "night",
        threadNames: ["主线"],
        summary: "主角遇见线人"
      })
    ]);
  });

  it("parses matrix-style table text and inherits date context", () => {
    const rows = parseOutlineText("日期,星期,白天/晚上,吕老师线,马俊明线\n11月15日,星期二,白天,吕老师第一阶段1,马俊明学校被揍\n,,晚上,吕老师第一阶段2,");

    expect(rows).toEqual([
      expect.objectContaining({ rowNumber: 2, storyTimeLabel: "11月15日", weekdayLabel: "星期二", daySegment: "day", threadNames: ["吕老师线"] }),
      expect.objectContaining({ rowNumber: 2, storyTimeLabel: "11月15日", weekdayLabel: "星期二", daySegment: "day", threadNames: ["马俊明线"] }),
      expect.objectContaining({ rowNumber: 3, storyTimeLabel: "11月15日", weekdayLabel: "星期二", daySegment: "night", threadNames: ["吕老师线"] })
    ]);
  });

  it("parses selected xlsx files without modifying them", () => {
    const dir = createTempDir();
    const filePath = join(dir, "outline.xlsx");
    const bytes = createTinyXlsx([
      ["章节", "故事时间", "时间段", "情节线", "场景摘要"],
      ["第一章", "开学第一天", "白天", "校园线", "主角进入学校"]
    ]);
    writeFileSync(filePath, bytes);

    const rows = parseOutlineFile(filePath);

    expect(rows).toEqual([
      expect.objectContaining({
        chapterTitle: "第一章",
        storyTimeLabel: "开学第一天",
        daySegment: "day",
        threadNames: ["校园线"],
        summary: "主角进入学校"
      })
    ]);
  });

  it("parses xlsx files that store cells as inline strings", () => {
    const dir = createTempDir();
    const filePath = join(dir, "inline-outline.xlsx");
    const bytes = createTinyInlineStringXlsx([
      ["章节", "故事时间", "时间段", "情节线", "场景摘要"],
      ["第一章", "开学第一天", "白天", "校园线", "主角进入学校"]
    ]);
    writeFileSync(filePath, bytes);

    const rows = parseOutlineFile(filePath);

    expect(rows).toEqual([
      expect.objectContaining({
        chapterTitle: "第一章",
        storyTimeLabel: "开学第一天",
        daySegment: "day",
        threadNames: ["校园线"],
        summary: "主角进入学校"
      })
    ]);
  });

  it("parses spreadsheet-framed matrix xlsx files with merged-looking context columns", () => {
    const dir = createTempDir();
    const filePath = join(dir, "很长很长很长的大纲文件名-作者从表格软件导出的版本.xlsx");
    const bytes = createTinyXlsx([
      ["", "", "", "", "", "", "", "", ""],
      ["A", "B", "C", "D", "E", "F", "G", "H", "I"],
      ["1", "备注", "日期", "星期", "日夜", "备注（马俊明里线）", "", "日夜", "主角日常备注（方承业外线）"],
      ["2", "", "11月15日", "星期二", "白天", "第一阶段1：张氏兄弟收保护费", "", "白天", "方承业早读冲突"],
      ["3", "", "", "", "晚上", "第一阶段2：上门谈判", "", "晚上", "方承业回家"]
    ]);
    writeFileSync(filePath, bytes);

    const rows = parseOutlineFile(filePath);

    expect(rows).toHaveLength(4);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          storyTimeLabel: "11月15日",
          weekdayLabel: "星期二",
          daySegment: "day",
          threadNames: ["马俊明里线"],
          summary: "第一阶段1：张氏兄弟收保护费"
        }),
        expect.objectContaining({
          storyTimeLabel: "11月15日",
          weekdayLabel: "星期二",
          daySegment: "night",
          threadNames: ["方承业外线"],
          summary: "方承业回家"
        })
      ])
    );
  });
});

const providedOutlineFixturePath = join(process.cwd(), "..", "test_novel", "大纲.xlsx");
const fixtureIt = existsSync(providedOutlineFixturePath) ? it : it.skip;

fixtureIt("parses the provided test_novel outline workbook", () => {
  const rows = parseOutlineFile(providedOutlineFixturePath);

  expect(rows.length).toBeGreaterThan(10);
  expect(rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        storyTimeLabel: "11月15日",
        weekdayLabel: "星期二",
        daySegment: "day",
        threadNames: ["马俊明里线"],
        summary: "第一阶段1：张氏兄弟收马俊明保护费 2000元"
      }),
      expect.objectContaining({
        storyTimeLabel: "11月18日",
        weekdayLabel: "星期五",
        daySegment: "night",
        threadNames: ["马俊明里线"],
        summary: "吕老师第一阶段3：马俊明公寓瑞景花园8号楼2单元1001"
      })
    ])
  );
});
