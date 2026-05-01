import type { z } from "zod";
import { countWritingUnits } from "../shared/text";
import type { ImportPreviewChapter } from "../shared/types";
import type { importUpdatePreviewInputSchema } from "../shared/schemas";

export type ImportPreviewOperation = z.input<typeof importUpdatePreviewInputSchema>["operations"][number];

type Line = {
  readonly text: string;
  readonly number: number;
};

const headingPattern =
  /^(?:第[零〇一二三四五六七八九十百千万\d]+[章节回卷部集][\s　、:：.-]*.*|卷[零〇一二三四五六七八九十百千万\d]+[\s　、:：.-]*.*|第[零〇一二三四五六七八九十百千万\d]+卷[\s　、:：.-]*.*|序章|楔子|番外(?:[\s　、:：.-].*)?|后记)$/;

export function normalizeTxtContent(content: string): string {
  return content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\u3000/g, " ").trimEnd().trimStart())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function createChapter(title: string, lines: readonly Line[], order: number): ImportPreviewChapter {
  const text = normalizeTxtContent(lines.map((line) => line.text).join("\n"));
  return {
    title: title.trim() || "正文",
    text,
    order,
    wordCount: countWritingUnits(text),
    lineStart: lines[0]?.number ?? 1,
    lineEnd: lines.at(-1)?.number ?? lines[0]?.number ?? 1
  };
}

function reorder(chapters: readonly ImportPreviewChapter[]): ImportPreviewChapter[] {
  return chapters.map((chapter, order) => ({
    ...chapter,
    order,
    wordCount: countWritingUnits(chapter.text)
  }));
}

function isChapterHeading(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length <= 80 && headingPattern.test(trimmed);
}

function getHeadingMarker(line: string): string | null {
  const trimmed = line.trim();
  return trimmed.match(/^(第[零〇一二三四五六七八九十百千万\d]+[章节回卷部集]|卷[零〇一二三四五六七八九十百千万\d]+|序章|楔子|番外|后记)/)?.[1] ?? null;
}

function isWordCountOnlyHeading(line: string): boolean {
  return /^(?:第[零〇一二三四五六七八九十百千万\d]+[章节回卷部集]|卷[零〇一二三四五六七八九十百千万\d]+)[\s　、:：.-]*[0-9零〇一二三四五六七八九十百千万,.，]+\s*字$/.test(line.trim());
}

export function detectTxtChapters(content: string): ImportPreviewChapter[] {
  const normalized = normalizeTxtContent(content);
  if (!normalized) {
    return [createChapter("正文", [{ text: "", number: 1 }], 0)];
  }

  const lines = normalized.split("\n").map((text, index) => ({ text, number: index + 1 }));
  const chapters: ImportPreviewChapter[] = [];
  let currentTitle = "";
  let currentLines: Line[] = [];
  let foundHeading = false;

  for (const line of lines) {
    if (isChapterHeading(line.text)) {
      if (foundHeading && currentLines.length > 0) {
        chapters.push(createChapter(currentTitle, currentLines, chapters.length));
      } else if (foundHeading && !isWordCountOnlyHeading(currentTitle)) {
        chapters.push(createChapter(currentTitle, currentLines, chapters.length));
      } else if (foundHeading && getHeadingMarker(currentTitle) !== getHeadingMarker(line.text)) {
        chapters.push(createChapter(currentTitle, currentLines, chapters.length));
      }
      foundHeading = true;
      currentTitle = line.text.trim();
      currentLines = [];
      continue;
    }

    if (!foundHeading) {
      currentLines.push(line);
      continue;
    }

    currentLines.push(line);
  }

  if (!foundHeading) {
    return [createChapter("正文", lines, 0)];
  }

  if (currentLines.length > 0 || chapters.length === 0) {
    chapters.push(createChapter(currentTitle, currentLines, chapters.length));
  }

  return reorder(chapters);
}

function renameChapter(chapters: readonly ImportPreviewChapter[], chapterIndex: number, title: string): ImportPreviewChapter[] {
  return reorder(chapters.map((chapter, index) => (index === chapterIndex ? { ...chapter, title } : chapter)));
}

function mergeWithPrevious(chapters: readonly ImportPreviewChapter[], chapterIndex: number): ImportPreviewChapter[] {
  if (chapterIndex <= 0 || chapterIndex >= chapters.length) {
    return reorder(chapters);
  }

  const previous = chapters[chapterIndex - 1];
  const current = chapters[chapterIndex];
  const merged: ImportPreviewChapter = {
    ...previous,
    text: normalizeTxtContent(`${previous.text}\n\n${current.title}\n${current.text}`),
    lineEnd: current.lineEnd
  };
  return reorder([...chapters.slice(0, chapterIndex - 1), merged, ...chapters.slice(chapterIndex + 1)]);
}

function splitFromLine(chapters: readonly ImportPreviewChapter[], chapterIndex: number, lineNumber: number): ImportPreviewChapter[] {
  const chapter = chapters[chapterIndex];
  if (!chapter) {
    return reorder(chapters);
  }

  const lines = chapter.text.split("\n");
  if (lineNumber <= 1 || lineNumber > lines.length) {
    return reorder(chapters);
  }

  const firstText = normalizeTxtContent(lines.slice(0, lineNumber - 1).join("\n"));
  const secondText = normalizeTxtContent(lines.slice(lineNumber - 1).join("\n"));
  const first: ImportPreviewChapter = {
    ...chapter,
    text: firstText,
    lineEnd: chapter.lineStart + lineNumber - 2
  };
  const second: ImportPreviewChapter = {
    ...chapter,
    title: `${chapter.title} 下`,
    text: secondText,
    lineStart: chapter.lineStart + lineNumber - 1
  };

  return reorder([...chapters.slice(0, chapterIndex), first, second, ...chapters.slice(chapterIndex + 1)]);
}

export function applyImportPreviewOperations(
  chapters: readonly ImportPreviewChapter[],
  operations: readonly ImportPreviewOperation[]
): ImportPreviewChapter[] {
  let next = [...chapters];

  for (const operation of operations) {
    if (operation.type === "rename_chapter") {
      next = renameChapter(next, operation.chapterIndex, operation.title);
      continue;
    }
    if (operation.type === "merge_with_previous") {
      next = mergeWithPrevious(next, operation.chapterIndex);
      continue;
    }
    if (operation.type === "split_from_line") {
      next = splitFromLine(next, operation.chapterIndex, operation.lineNumber);
      continue;
    }
    if (operation.type === "redetect") {
      next = [createChapter("正文", [{ text: next.map((chapter) => chapter.text).join("\n\n"), number: 1 }], 0)];
    }
  }

  return reorder(next);
}
