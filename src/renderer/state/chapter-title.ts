import type { ChapterSummary } from "../../main/shared/types";

type ChapterNumberStyle = "arabic" | "chinese";

type ParsedChapterNumber = {
  readonly number: number;
  readonly style: ChapterNumberStyle;
};

type SuggestChapterTitleOptions = {
  readonly afterChapterId?: string;
};

const chineseDigitValues = new Map<string, number>([
  ["零", 0],
  ["〇", 0],
  ["一", 1],
  ["二", 2],
  ["两", 2],
  ["三", 3],
  ["四", 4],
  ["五", 5],
  ["六", 6],
  ["七", 7],
  ["八", 8],
  ["九", 9]
]);

const chineseUnitValues = new Map<string, number>([
  ["十", 10],
  ["百", 100],
  ["千", 1000],
  ["万", 10000]
]);

function normalizeDigits(value: string): string {
  return value.replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10));
}

function parseChineseInteger(value: string): number | null {
  let total = 0;
  let section = 0;
  let currentDigit: number | null = null;
  let sawToken = false;

  for (const char of value) {
    const digit = chineseDigitValues.get(char);
    if (digit !== undefined) {
      currentDigit = digit;
      sawToken = true;
      continue;
    }

    const unit = chineseUnitValues.get(char);
    if (unit === undefined) {
      return null;
    }

    sawToken = true;
    if (unit === 10000) {
      section += currentDigit ?? 0;
      total += (section || 1) * unit;
      section = 0;
    } else {
      section += (currentDigit ?? 1) * unit;
    }
    currentDigit = null;
  }

  if (!sawToken) {
    return null;
  }

  return total + section + (currentDigit ?? 0);
}

function formatChineseInteger(value: number): string {
  if (value <= 0 || value > 9999) {
    return String(value);
  }

  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const units = ["千", "百", "十", ""];
  const values = [Math.floor(value / 1000), Math.floor((value % 1000) / 100), Math.floor((value % 100) / 10), value % 10];
  let output = "";
  let pendingZero = false;

  values.forEach((digit, index) => {
    if (digit === 0) {
      pendingZero = output.length > 0 && values.slice(index + 1).some((next) => next > 0);
      return;
    }

    if (pendingZero) {
      output += "零";
      pendingZero = false;
    }

    output += digits[digit] + units[index];
  });

  return output.replace(/^一十/, "十");
}

export function parseLeadingChapterNumber(title: string): ParsedChapterNumber | null {
  const match = title.trim().match(/^第\s*([0-9０-９]+|[零〇一二两三四五六七八九十百千万]+)\s*[章节回]/);
  if (!match) {
    return null;
  }

  const raw = match[1] ?? "";
  if (/^[0-9０-９]+$/.test(raw)) {
    const parsed = Number.parseInt(normalizeDigits(raw), 10);
    return Number.isFinite(parsed) && parsed > 0 ? { number: parsed, style: "arabic" } : null;
  }

  const parsed = parseChineseInteger(raw);
  return parsed && parsed > 0 ? { number: parsed, style: "chinese" } : null;
}

function formatChapterNumber(value: number, style: ChapterNumberStyle): string {
  return style === "chinese" ? formatChineseInteger(value) : String(value);
}

export function suggestNewChapterTitle(
  chapters: readonly ChapterSummary[],
  options: SuggestChapterTitleOptions = {}
): string {
  const sortedChapters = [...chapters].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
  const targetChapter = options.afterChapterId ? sortedChapters.find((chapter) => chapter.id === options.afterChapterId) : null;
  const fallbackChapter = sortedChapters[sortedChapters.length - 1] ?? null;
  const baseChapter = targetChapter ?? fallbackChapter;
  const parsedChapters = sortedChapters
    .map((chapter) => parseLeadingChapterNumber(chapter.title))
    .filter((parsed): parsed is ParsedChapterNumber => Boolean(parsed));
  const baseParsed = baseChapter ? parseLeadingChapterNumber(baseChapter.title) : null;
  const style = baseParsed?.style ?? parsedChapters[parsedChapters.length - 1]?.style ?? "arabic";
  const usedNumbers = new Set(parsedChapters.map((parsed) => parsed.number));
  const maxNumber = parsedChapters.reduce((max, parsed) => Math.max(max, parsed.number), 0);
  let nextNumber = (baseParsed?.number ?? maxNumber) + 1;

  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1;
  }

  return `第${formatChapterNumber(nextNumber, style)}章`;
}
