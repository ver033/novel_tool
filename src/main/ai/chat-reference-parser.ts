import type { ChatAgentScope } from "./chat-agent-types";

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

const NUMERAL = "[0-9０-９一二两三四五六七八九十百零〇]+";

export type ChatAtReference = {
  readonly scope: ChatAgentScope;
  readonly messageWithoutReference: string;
};

function normalizeFullWidthDigits(value: string): string {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

export function parseChineseOrdinal(value: string): number | null {
  const normalized = normalizeFullWidthDigits(value).replace(/\s+/g, "").replace(/[零〇]/g, "");
  if (!normalized) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  if (!/^[一二两三四五六七八九十百]+$/.test(normalized)) {
    return null;
  }

  let total = 0;
  let currentDigit = 0;
  for (const char of normalized) {
    if (char === "百") {
      total += (currentDigit || 1) * 100;
      currentDigit = 0;
      continue;
    }
    if (char === "十") {
      total += (currentDigit || 1) * 10;
      currentDigit = 0;
      continue;
    }
    currentDigit = CHINESE_DIGITS[char] ?? 0;
  }

  const result = total + currentDigit;
  return result > 0 ? result : null;
}

export function parseChapterOrdinalFromText(value: string): number | null {
  const normalized = normalizeFullWidthDigits(value);
  const match = new RegExp(`(?:第\\s*)?(${NUMERAL})\\s*[章节回話]`).exec(normalized);
  return match ? parseChineseOrdinal(match[1]) : null;
}

function cleanMessageWithoutReference(message: string, start: number, length: number): string {
  return `${message.slice(0, start)}${message.slice(start + length)}`.replace(/\s+/g, " ").trim();
}

function buildReference(message: string, start: number, length: number, scope: ChatAgentScope): ChatAtReference {
  return {
    scope,
    messageWithoutReference: cleanMessageWithoutReference(message, start, length)
  };
}

export function parseChatAtReference(message: string): ChatAtReference | null {
  const normalized = normalizeFullWidthDigits(message);
  const rangeMatch = parseRangeMatch(normalized, true);
  if (rangeMatch) {
    const from = parseChineseOrdinal(rangeMatch[1]);
    const to = parseChineseOrdinal(rangeMatch[2]);
    if (from && to && from <= to) {
      return buildReference(message, rangeMatch.index, rangeMatch[0].length, {
        type: "chapter_range",
        from,
        to
      });
    }
  }

  const allMatch = /@(?:全部章节|所有章节|全文|全书|整本书|全章|すべての章|全ての章|全編|作品全体)/.exec(normalized);
  if (allMatch) {
    return buildReference(message, allMatch.index, allMatch[0].length, {
      type: "all_chapters"
    });
  }

  const selectionMatch = /@(?:选区|选中文本|当前选区|選択範囲|選択テキスト|現在の選択範囲)/.exec(normalized);
  if (selectionMatch) {
    return buildReference(message, selectionMatch.index, selectionMatch[0].length, {
      type: "selection"
    });
  }

  const currentMatch = /@(?:本章|当前章节|当前章|这一章|这章|現在の章|この章|今の章)/.exec(normalized);
  if (currentMatch) {
    return buildReference(message, currentMatch.index, currentMatch[0].length, {
      type: "current_chapter"
    });
  }

  const chapterMatch = new RegExp(`@(?:第\\s*)?(${NUMERAL})\\s*[章节回話]`).exec(normalized);
  if (chapterMatch) {
    const ordinal = parseChineseOrdinal(chapterMatch[1]);
    if (ordinal) {
      return buildReference(message, chapterMatch.index, chapterMatch[0].length, {
        type: "chapter",
        ordinal
      });
    }
  }

  return null;
}

function parseRangeMatch(message: string, requireAt: boolean): RegExpExecArray | null {
  const prefix = requireAt ? "@" : "";
  return new RegExp(
    `${prefix}(?:第\\s*)?(${NUMERAL})\\s*[章节回話]?\\s*(?:-|到|至|~|—|－|から)\\s*(?:第\\s*)?(${NUMERAL})\\s*[章节回話]?(?:まで)?`
  ).exec(message);
}

function parseNaturalReference(message: string): ChatAtReference | null {
  const normalized = normalizeFullWidthDigits(message);
  const rangeMatch = parseRangeMatch(normalized, false);
  if (rangeMatch) {
    const from = parseChineseOrdinal(rangeMatch[1]);
    const to = parseChineseOrdinal(rangeMatch[2]);
    if (from && to && from <= to) {
      return buildReference(message, rangeMatch.index, rangeMatch[0].length, {
        type: "chapter_range",
        from,
        to
      });
    }
  }

  const pairedChapterMatch = new RegExp(
    `(?:第\\s*)?(${NUMERAL})\\s*[章节回話]\\s*(?:和|与|及|、|跟|同|と)\\s*(?:第\\s*)?(${NUMERAL})\\s*[章节回話]`
  ).exec(normalized);
  if (pairedChapterMatch) {
    const left = parseChineseOrdinal(pairedChapterMatch[1]);
    const right = parseChineseOrdinal(pairedChapterMatch[2]);
    if (left && right) {
      return buildReference(message, pairedChapterMatch.index, pairedChapterMatch[0].length, {
        type: "chapter_range",
        from: Math.min(left, right),
        to: Math.max(left, right)
      });
    }
  }

  const leadingRangeMatch = new RegExp(`(?:前\\s*|最初の|冒頭)(${NUMERAL})\\s*[章节回話]`).exec(normalized);
  if (leadingRangeMatch) {
    const to = parseChineseOrdinal(leadingRangeMatch[1]);
    if (to) {
      return buildReference(message, leadingRangeMatch.index, leadingRangeMatch[0].length, {
        type: "chapter_range",
        from: 1,
        to
      });
    }
  }

  const allMatch = /全部章节|所有章节|全文|全书|整本书|全章|すべての章|全ての章|全編|作品全体/.exec(normalized);
  if (allMatch) {
    return buildReference(message, allMatch.index, allMatch[0].length, {
      type: "all_chapters"
    });
  }

  const selectionMatch = /选区|选中文本|当前选区|選択範囲|選択テキスト|現在の選択範囲/.exec(normalized);
  if (selectionMatch) {
    return buildReference(message, selectionMatch.index, selectionMatch[0].length, {
      type: "selection"
    });
  }

  const currentMatch = /本章|当前章节|当前章|这一章|这章|現在の章|この章|今の章/.exec(normalized);
  if (currentMatch) {
    return buildReference(message, currentMatch.index, currentMatch[0].length, {
      type: "current_chapter"
    });
  }

  const chapterMatch = new RegExp(`(?:第\\s*)(${NUMERAL})\\s*[章节回話]`).exec(normalized);
  if (chapterMatch) {
    const ordinal = parseChineseOrdinal(chapterMatch[1]);
    if (ordinal) {
      return buildReference(message, chapterMatch.index, chapterMatch[0].length, {
        type: "chapter",
        ordinal
      });
    }
  }

  return null;
}

export function parseChatScopeReference(message: string): ChatAtReference | null {
  return parseChatAtReference(message) ?? parseNaturalReference(message);
}
