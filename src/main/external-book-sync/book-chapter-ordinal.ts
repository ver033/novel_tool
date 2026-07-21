const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};

const CHINESE_UNITS: Record<string, number> = {
  十: 10,
  百: 100,
  千: 1000,
  万: 10000
};

const fullWidthDigits = "０１２３４５６７８９";
const specialSectionPattern = /^(序章|楔子|番外(?:[\s　、:：.-].*)?|后记)$/u;
const chapterOrdinalPattern = /^第[\s　]*([0-9０-９零〇一二两三四五六七八九十百千万\s　]+)[\s　]*[章节回卷部集]/u;

function normalizeDigits(input: string): string {
  return input.replace(/[０-９]/gu, (digit) => String(fullWidthDigits.indexOf(digit)));
}

function parseChineseInteger(input: string): number | null {
  let section = 0;
  let number = 0;
  let total = 0;
  let sawNumber = false;

  for (const char of input) {
    if (char in CHINESE_DIGITS) {
      number = CHINESE_DIGITS[char];
      sawNumber = true;
      continue;
    }
    const unit = CHINESE_UNITS[char];
    if (!unit) {
      return null;
    }
    sawNumber = true;
    if (unit === 10000) {
      section = (section + (number || 0)) * unit;
      total += section;
      section = 0;
      number = 0;
      continue;
    }
    section += (number || 1) * unit;
    number = 0;
  }

  const value = total + section + number;
  return sawNumber && value > 0 ? value : null;
}

export function parseChapterOrdinal(title: string): number | null {
  const trimmed = title.trim();
  if (!trimmed || specialSectionPattern.test(trimmed)) {
    return null;
  }

  const match = trimmed.match(chapterOrdinalPattern);
  if (!match) {
    return null;
  }

  const rawOrdinal = normalizeDigits(match[1].replace(/[\s　]+/gu, ""));
  if (/^\d+$/u.test(rawOrdinal)) {
    const value = Number.parseInt(rawOrdinal, 10);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  return parseChineseInteger(rawOrdinal);
}
