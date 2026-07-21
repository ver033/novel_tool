import { readFileSync } from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import type { OutlineDaySegment, OutlineEventStatus } from "../shared/types";

export type ParsedOutlineImportRow = {
  readonly rowNumber: number;
  readonly chapterTitle: string;
  readonly storyDate: string | null;
  readonly storyTimeLabel: string;
  readonly weekdayLabel: string;
  readonly storyTimeOrder: number | null;
  readonly daySegment: OutlineDaySegment;
  readonly customDaySegment: string | null;
  readonly threadNames: readonly string[];
  readonly summary: string;
  readonly characters: readonly string[];
  readonly location: string;
  readonly status: OutlineEventStatus;
  readonly warnings: readonly string[];
};

type HeaderMapping = {
  readonly chapter?: number;
  readonly storyTimeLabel?: number;
  readonly storyDate?: number;
  readonly weekdayLabel?: number;
  readonly daySegment?: number;
  readonly thread?: number;
  readonly summary?: number;
  readonly characters?: number;
  readonly location?: number;
  readonly status?: number;
};

type MatrixContext = {
  storyTimeLabel: string;
  weekdayLabel: string;
};

type SegmentContext = {
  daySegment: OutlineDaySegment;
  customDaySegment: string | null;
};

type MatrixStoryColumn = {
  readonly index: number;
  readonly threadName: string;
  readonly segmentIndex: number | null;
};

type XlsxCellFormat = {
  readonly formatCode: string;
  readonly isDate: boolean;
};

type XlsxStyles = {
  readonly date1904: boolean;
  readonly cellFormats: readonly XlsxCellFormat[];
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  textNodeName: "text"
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function cellText(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string" || typeof record.text === "number") {
      return String(record.text);
    }
    if (record.t !== undefined) {
      return cellText(record.t);
    }
  }
  return "";
}

function normalizeHeader(value: string): string {
  return value.trim().replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
}

function parseDelimitedRows(rawText: string): string[][] {
  const normalized = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.trim()) {
    return [];
  }
  const delimiter = normalized.includes("\t") ? "\t" : ",";
  return normalized
    .split("\n")
    .map((line) => parseDelimitedLine(line, delimiter).map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  if (delimiter === "\t") {
    return line.split("\t");
  }
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function inferMapping(headers: readonly string[]): HeaderMapping {
  const normalized = headers.map(normalizeHeader);
  const find = (...needles: string[]) => {
    const normalizedNeedles = needles.map(normalizeHeader);
    for (const needle of normalizedNeedles) {
      const index = normalized.findIndex((header) => header.includes(needle));
      if (index >= 0) {
        return index;
      }
    }
    return -1;
  };
  const mapping: HeaderMapping = {
    chapter: indexOrUndefined(find("章节", "章")),
    storyTimeLabel: indexOrUndefined(find("故事时间", "日期", "时间")),
    storyDate: indexOrUndefined(find("标准日期")),
    weekdayLabel: indexOrUndefined(find("星期", "时间备注")),
    daySegment: indexOrUndefined(find("白天晚上", "昼夜", "时间段")),
    thread: indexOrUndefined(find("情节线", "剧情线", "线索")),
    summary: indexOrUndefined(find("场景摘要", "摘要", "备注", "内容")),
    characters: indexOrUndefined(find("角色", "人物")),
    location: indexOrUndefined(find("地点", "场景地点")),
    status: indexOrUndefined(find("状态"))
  };
  return mapping;
}

function indexOrUndefined(value: number): number | undefined {
  return value >= 0 ? value : undefined;
}

function splitList(value: string): string[] {
  return value
    .split(/[、,，/]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDaySegment(value: string): { readonly daySegment: OutlineDaySegment; readonly customDaySegment: string | null } {
  const normalized = normalizeHeader(value);
  if (!normalized) {
    return { daySegment: "unknown", customDaySegment: null };
  }
  if (normalized.includes("白天") || normalized.includes("昼") || normalized.includes("上午") || normalized.includes("下午")) {
    return { daySegment: "day", customDaySegment: null };
  }
  if (normalized.includes("晚上") || normalized.includes("夜") || normalized.includes("晚")) {
    return { daySegment: "night", customDaySegment: null };
  }
  return { daySegment: "custom", customDaySegment: value.trim() };
}

function parseStatus(value: string): OutlineEventStatus {
  const normalized = normalizeHeader(value);
  if (normalized.includes("完成") || normalized.includes("done")) {
    return "done";
  }
  if (normalized.includes("修改") || normalized.includes("revision")) {
    return "needs_revision";
  }
  if (normalized.includes("写") || normalized.includes("draft")) {
    return "drafting";
  }
  return "planned";
}

function validLocalDate(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;
}

function numericValue(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

function excelSerialDateParts(value: string, date1904 = false): { readonly year: number; readonly month: number; readonly day: number } | null {
  const serial = numericValue(value);
  if (serial === null || serial < 1) {
    return null;
  }
  const wholeDays = Math.floor(serial);
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(base + wholeDays * 86_400_000);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function excelSerialLocalDate(value: string, date1904 = false): string | null {
  const parts = excelSerialDateParts(value, date1904);
  if (!parts) {
    return null;
  }
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function excelSerialDateLabel(value: string, date1904 = false): string | null {
  const parts = excelSerialDateParts(value, date1904);
  if (!parts || parts.year < 1900 || parts.year > 2200) {
    return null;
  }
  return `${parts.month}月${parts.day}日`;
}

function normalizeDateLabel(value: string): string {
  return excelSerialDateLabel(value) ?? value;
}

function rowCell(row: readonly string[], index: number | undefined): string {
  return index === undefined ? "" : row[index]?.trim() ?? "";
}

function parseRowStyle(rows: readonly (readonly string[])[]): ParsedOutlineImportRow[] {
  if (rows.length < 2) {
    return [];
  }
  const headers = rows[0] ?? [];
  const mapping = inferMapping(headers);
  if (mapping.summary === undefined) {
    return [];
  }
  return rows.slice(1).flatMap((row, rowIndex) => {
    const summary = rowCell(row, mapping.summary);
    if (!summary) {
      return [];
    }
    const segment = parseDaySegment(rowCell(row, mapping.daySegment));
    const rawStoryTimeLabel = rowCell(row, mapping.storyTimeLabel);
    const rawStoryDate = rowCell(row, mapping.storyDate);
    const storyTimeLabel = normalizeDateLabel(rawStoryTimeLabel);
    return [
      {
        rowNumber: rowIndex + 2,
        chapterTitle: rowCell(row, mapping.chapter),
        storyDate: validLocalDate(rawStoryDate) ?? excelSerialLocalDate(rawStoryDate) ?? validLocalDate(storyTimeLabel) ?? excelSerialLocalDate(rawStoryTimeLabel),
        storyTimeLabel,
        weekdayLabel: rowCell(row, mapping.weekdayLabel),
        storyTimeOrder: rowIndex + 1,
        daySegment: segment.daySegment,
        customDaySegment: segment.customDaySegment,
        threadNames: splitList(rowCell(row, mapping.thread)),
        summary,
        characters: splitList(rowCell(row, mapping.characters)),
        location: rowCell(row, mapping.location),
        status: parseStatus(rowCell(row, mapping.status)),
        warnings: []
      }
    ];
  });
}

function isSpreadsheetColumnHeaderRow(row: readonly string[]): boolean {
  const nonEmpty = row.map((cell) => cell.trim()).filter(Boolean);
  if (nonEmpty.length < 4) {
    return false;
  }
  const letterCount = nonEmpty.filter((cell) => /^[A-Z]{1,3}$/.test(cell)).length;
  return letterCount / nonEmpty.length >= 0.8;
}

function rowLooksLikeHeader(row: readonly string[]): boolean {
  return row.some((cell) => {
    const normalized = normalizeHeader(cell);
    return (
      normalized.includes("章节") ||
      normalized.includes("日期") ||
      normalized.includes("星期") ||
      normalized.includes("日夜") ||
      normalized.includes("昼夜") ||
      normalized.includes("白天") ||
      normalized.includes("场景摘要") ||
      normalized.includes("情节线") ||
      normalized.includes("剧情线")
    );
  });
}

function removeSpreadsheetRowNumberColumn(rows: readonly (readonly string[])[]): string[][] {
  if (rows.length < 2 || !rowLooksLikeHeader(rows[0]?.slice(1) ?? [])) {
    return rows.map((row) => [...row]);
  }
  const sample = rows.slice(0, Math.min(rows.length, 20));
  const numberedRows = sample.filter((row) => /^\d+$/.test(row[0]?.trim() ?? "")).length;
  if (numberedRows < Math.min(3, sample.length)) {
    return rows.map((row) => [...row]);
  }
  return rows.map((row) => row.slice(1));
}

function normalizeImportRows(rows: readonly (readonly string[])[]): string[][] {
  const trimmedRows = rows
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean))
    .filter((row) => !isSpreadsheetColumnHeaderRow(row));
  return removeSpreadsheetRowNumberColumn(trimmedRows);
}

function isDateHeader(header: string): boolean {
  const normalized = normalizeHeader(header);
  return normalized.includes("日期") || normalized.includes("故事时间");
}

function isWeekdayHeader(header: string): boolean {
  return normalizeHeader(header).includes("星期");
}

function isSegmentHeader(header: string): boolean {
  const normalized = normalizeHeader(header);
  return (
    normalized.includes("日夜") ||
    normalized.includes("昼夜") ||
    (normalized.includes("白天") && normalized.includes("晚上")) ||
    normalized.includes("时间段")
  );
}

function isGenericNoteHeader(header: string): boolean {
  const normalized = normalizeHeader(header);
  return normalized === "备注" || normalized === "说明";
}

function threadNameFromMatrixHeader(header: string): string {
  const trimmed = header.trim();
  const bracketMatch = trimmed.match(/[（(]([^（）()]+)[）)]/);
  if (bracketMatch?.[1]?.trim()) {
    return bracketMatch[1].trim();
  }
  return trimmed.replace(/备注/g, "").trim() || trimmed;
}

function collectMatrixStoryColumns(headers: readonly string[]): MatrixStoryColumn[] {
  const segmentIndexes = headers.map((header, index) => (isSegmentHeader(header) ? index : -1)).filter((index) => index >= 0);
  return headers.flatMap((header, index) => {
    const trimmed = header.trim();
    const normalized = normalizeHeader(trimmed);
    if (
      !trimmed ||
      normalized.includes("章节") ||
      normalized.includes("情节线") ||
      normalized.includes("剧情线") ||
      isDateHeader(trimmed) ||
      isWeekdayHeader(trimmed) ||
      isSegmentHeader(trimmed) ||
      isGenericNoteHeader(trimmed)
    ) {
      return [];
    }
    const segmentIndex = [...segmentIndexes].reverse().find((candidate) => candidate < index) ?? null;
    return [{ index, threadName: threadNameFromMatrixHeader(trimmed), segmentIndex }];
  });
}

function looksLikeRowStyle(headers: readonly string[]): boolean {
  return headers.some((header) => {
    const normalized = normalizeHeader(header);
    return normalized.includes("场景摘要") || normalized === "摘要" || normalized === "内容";
  });
}

function looksLikeMatrix(headers: readonly string[]): boolean {
  const contextCount = headers.filter((header) => isDateHeader(header) || isWeekdayHeader(header) || isSegmentHeader(header)).length;
  return headers.length >= 4 && contextCount >= 2 && collectMatrixStoryColumns(headers).length > 0;
}

function parseMatrixStyle(rows: readonly (readonly string[])[]): ParsedOutlineImportRow[] {
  if (rows.length < 2 || !looksLikeMatrix(rows[0] ?? [])) {
    return [];
  }
  const headers = rows[0] ?? [];
  const dateIndex = headers.findIndex(isDateHeader);
  const weekdayIndex = headers.findIndex(isWeekdayHeader);
  const segmentIndexes = headers.map((header, index) => (isSegmentHeader(header) ? index : -1)).filter((index) => index >= 0);
  const storyColumns = collectMatrixStoryColumns(headers);
  const context: MatrixContext = {
    storyTimeLabel: "",
    weekdayLabel: ""
  };
  const segmentContexts = new Map<number, SegmentContext>();
  const parsed: ParsedOutlineImportRow[] = [];
  rows.slice(1).forEach((row, rowIndex) => {
    const time = normalizeDateLabel(rowCell(row, dateIndex));
    if (time) {
      context.storyTimeLabel = time;
    }
    const weekday = rowCell(row, weekdayIndex);
    if (weekday) {
      context.weekdayLabel = weekday;
    }
    for (const segmentIndex of segmentIndexes) {
      const segmentValue = rowCell(row, segmentIndex);
      if (!segmentValue) {
        continue;
      }
      segmentContexts.set(segmentIndex, parseDaySegment(segmentValue));
    }
    for (const { index, threadName, segmentIndex } of storyColumns) {
      const summary = rowCell(row, index);
      if (!summary) {
        continue;
      }
      const segment = segmentIndex === null ? { daySegment: "unknown" as const, customDaySegment: null } : segmentContexts.get(segmentIndex) ?? { daySegment: "unknown" as const, customDaySegment: null };
      parsed.push({
        rowNumber: rowIndex + 2,
        chapterTitle: "",
        storyDate: validLocalDate(context.storyTimeLabel),
        storyTimeLabel: context.storyTimeLabel,
        weekdayLabel: context.weekdayLabel,
        storyTimeOrder: rowIndex + 1,
        daySegment: segment.daySegment,
        customDaySegment: segment.customDaySegment,
        threadNames: [threadName],
        summary,
        characters: [],
        location: "",
        status: "planned",
        warnings: []
      });
    }
  });
  return parsed;
}

function parseRows(rows: readonly (readonly string[])[]): ParsedOutlineImportRow[] {
  const normalizedRows = normalizeImportRows(rows);
  if (looksLikeRowStyle(normalizedRows[0] ?? [])) {
    const rowStyleRows = parseRowStyle(normalizedRows);
    if (rowStyleRows.length > 0) {
      return rowStyleRows;
    }
  }
  const matrixRows = parseMatrixStyle(normalizedRows);
  return matrixRows.length > 0 ? matrixRows : parseRowStyle(normalizedRows);
}

export function parseOutlineText(rawText: string): ParsedOutlineImportRow[] {
  return parseRows(parseDelimitedRows(rawText));
}

export function parseOutlineFile(filePath: string): ParsedOutlineImportRow[] {
  const extension = path.extname(filePath).toLowerCase();
  const bytes = readFileSync(filePath);
  if (extension === ".csv") {
    return parseOutlineText(bytes.toString("utf8"));
  }
  if (extension === ".xlsx") {
    return parseRows(readXlsxRows(bytes));
  }
  throw new Error("只支持导入 .xlsx 或 .csv 大纲文件。");
}

function readXlsxRows(bytes: Uint8Array): string[][] {
  const zip = unzipSync(bytes);
  const sharedStrings = readSharedStrings(zip);
  const styles = readXlsxStyles(zip);
  const worksheetPath = findFirstWorksheetPath(zip);
  const worksheetXml = zip[worksheetPath];
  if (!worksheetXml) {
    return [];
  }
  const parsed = xmlParser.parse(Buffer.from(worksheetXml).toString("utf8")) as Record<string, unknown>;
  const sheetData = ((parsed.worksheet as Record<string, unknown> | undefined)?.sheetData ?? {}) as Record<string, unknown>;
  const rows = asArray(sheetData.row as Record<string, unknown> | Record<string, unknown>[] | undefined);
  return rows.map((row) => {
    const cells = asArray(row.c as Record<string, unknown> | Record<string, unknown>[] | undefined);
    const output: string[] = [];
    for (const cell of cells) {
      const ref = typeof cell.r === "string" ? cell.r : "";
      const columnIndex = columnIndexFromRef(ref);
      output[columnIndex] = readCellValue(cell, sharedStrings, styles);
    }
    return output.map((value) => value ?? "");
  });
}

const builtinDateFormatIds = new Set([14, 15, 16, 17, 22, 27, 30, 36, 50, 57]);
const builtinNumberFormats = new Map<number, string>([
  [14, "m/d/yy"],
  [15, "d-mmm-yy"],
  [16, "d-mmm"],
  [17, "mmm-yy"],
  [22, "m/d/yy h:mm"],
  [27, "yyyy年m月"],
  [30, "m/d/yy"],
  [36, "yyyy年m月d日"],
  [50, "yyyy年m月d日"],
  [57, "yyyy年m月d日"]
]);

function readXlsxStyles(zip: Record<string, Uint8Array>): XlsxStyles {
  const stylesXml = zip["xl/styles.xml"];
  const date1904 = readWorkbookDate1904(zip);
  if (!stylesXml) {
    return { date1904, cellFormats: [] };
  }
  const parsed = xmlParser.parse(Buffer.from(stylesXml).toString("utf8")) as Record<string, unknown>;
  const styleSheet = (parsed.styleSheet ?? {}) as Record<string, unknown>;
  const numberFormats = new Map<number, string>();
  const numFmts = (styleSheet.numFmts ?? {}) as Record<string, unknown>;
  for (const entry of asArray(numFmts.numFmt as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
    const id = Number(entry.numFmtId);
    const formatCode = cellText(entry.formatCode);
    if (Number.isFinite(id) && formatCode) {
      numberFormats.set(id, formatCode);
    }
  }
  const cellXfs = (styleSheet.cellXfs ?? {}) as Record<string, unknown>;
  const xfs = asArray(cellXfs.xf as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const cellFormats = xfs.map((xf) => {
    const numFmtId = Number(xf.numFmtId);
    const formatCode = numberFormats.get(numFmtId) ?? builtinNumberFormats.get(numFmtId) ?? "";
    return {
      formatCode,
      isDate: isExcelDateFormat(numFmtId, formatCode)
    };
  });
  return { date1904, cellFormats };
}

function readWorkbookDate1904(zip: Record<string, Uint8Array>): boolean {
  const workbookXml = zip["xl/workbook.xml"];
  if (!workbookXml) {
    return false;
  }
  const parsed = xmlParser.parse(Buffer.from(workbookXml).toString("utf8")) as Record<string, unknown>;
  const workbook = (parsed.workbook ?? {}) as Record<string, unknown>;
  const workbookPr = (workbook.workbookPr ?? {}) as Record<string, unknown>;
  return workbookPr.date1904 === "1" || workbookPr.date1904 === 1 || workbookPr.date1904 === true;
}

function isExcelDateFormat(numFmtId: number, formatCode: string): boolean {
  if (builtinDateFormatIds.has(numFmtId)) {
    return true;
  }
  const normalized = formatCode
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*]/g, "")
    .replace(/\\./g, "")
    .toLocaleLowerCase("zh-CN");
  return /[dy]/.test(normalized) || normalized.includes("月") || normalized.includes("日") || normalized.includes("年");
}

function readSharedStrings(zip: Record<string, Uint8Array>): string[] {
  const sharedStringsXml = zip["xl/sharedStrings.xml"];
  if (!sharedStringsXml) {
    return [];
  }
  const parsed = xmlParser.parse(Buffer.from(sharedStringsXml).toString("utf8")) as Record<string, unknown>;
  const entries = asArray(((parsed.sst as Record<string, unknown> | undefined)?.si ?? undefined) as Record<string, unknown> | Record<string, unknown>[] | undefined);
  return entries.map((entry) => {
    if (entry.t !== undefined) {
      return cellText(entry.t);
    }
    const richParts = asArray(entry.r as Record<string, unknown> | Record<string, unknown>[] | undefined);
    return richParts.map((part) => cellText(part.t)).join("");
  });
}

function findFirstWorksheetPath(zip: Record<string, Uint8Array>): string {
  const worksheet = Object.keys(zip).find((entry) => entry.startsWith("xl/worksheets/") && entry.endsWith(".xml"));
  if (!worksheet) {
    throw new Error("未找到 Excel 工作表。");
  }
  return worksheet;
}

function readCellValue(cell: Record<string, unknown>, sharedStrings: readonly string[], styles: XlsxStyles): string {
  const rawValue = cellText(cell.v);
  if (cell.t === "s") {
    return sharedStrings[Number(rawValue)] ?? "";
  }
  if (cell.t === "inlineStr") {
    return cellText(cell.is);
  }
  const styleIndex = Number(cell.s);
  const format = Number.isFinite(styleIndex) ? styles.cellFormats[styleIndex] : undefined;
  if (format?.isDate) {
    return excelSerialDateLabel(rawValue, styles.date1904) ?? rawValue;
  }
  return rawValue;
}

function columnIndexFromRef(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return Math.max(0, index - 1);
}
