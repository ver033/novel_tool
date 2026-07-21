import { writeFileSync } from "node:fs";
import path from "node:path";
import type { ChapterRepository } from "../db/repositories/chapter-repo";
import type { ChapterSummary } from "../shared/types";
import { countWritingUnits } from "../shared/text";
import type { ExportTxtInput, ExportTxtResult } from "../shared/types";

type ChapterRepoResolver = (projectId: string) => ChapterRepository;

function normalizePlainText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trimEnd();
}

function ensureTxtFilePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  if (path.extname(resolved).toLowerCase() !== ".txt") {
    throw new Error("TXT 导出文件必须使用 .txt 扩展名。");
  }
  return resolved;
}

function selectChaptersForExport(chapters: readonly ChapterSummary[], range: ExportTxtInput["range"]): readonly ChapterSummary[] {
  if (range === "all_chapters") {
    return chapters;
  }

  const fromIndex = chapters.findIndex((chapter) => chapter.id === range.fromChapterId);
  const toIndex = chapters.findIndex((chapter) => chapter.id === range.toChapterId);
  if (fromIndex < 0 || toIndex < 0) {
    throw new Error("导出章节范围无效：找不到选择的章节。");
  }
  if (fromIndex > toIndex) {
    throw new Error("导出章节范围无效：起始章节不能晚于结束章节。");
  }

  return chapters.slice(fromIndex, toIndex + 1);
}

export class TxtExporter {
  constructor(private readonly resolveChapterRepo: ChapterRepoResolver) {}

  exportTxt(input: ExportTxtInput): ExportTxtResult {
    const filePath = ensureTxtFilePath(input.filePath);
    const chapterRepo = this.resolveChapterRepo(input.projectId);
    const chapters = chapterRepo.listByProject(input.projectId);
    if (chapters.length === 0) {
      throw new Error("没有可导出的章节。");
    }
    const selectedChapters = selectChaptersForExport(chapters, input.range);
    let wordCount = 0;
    const sections = selectedChapters.map((chapter) => {
      const content = chapterRepo.getContent(chapter.id);
      if (!content) {
        throw new Error(`章节不存在，无法导出：${chapter.title}`);
      }
      wordCount += countWritingUnits(content.plainText);
      const body = normalizePlainText(content.plainText);
      return input.includeChapterTitles ? `${chapter.title}\n\n${body}`.trimEnd() : body;
    });
    const text = `${sections.join("\n\n")}\n`;

    writeFileSync(filePath, text, "utf8");

    return {
      filePath,
      chapterCount: selectedChapters.length,
      wordCount,
      exportedAt: new Date().toISOString()
    };
  }
}
