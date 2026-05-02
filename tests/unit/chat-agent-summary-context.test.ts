import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveChatAgentContext } from "../../src/main/ai/chat-agent-context";
import { emptyChapterContent } from "../../src/main/chapter/default-content";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { SummaryRepository } from "../../src/main/db/repositories/summary-repo";
import { createId } from "../../src/main/shared/ids";
import { computeChapterContentHash, computeSourceHash, type ChapterAiSummaryPayload } from "../../src/main/shared/summary-index";
import { arcIndexPayloadV2, bookIndexPayloadV2, chapterIndexPayloadV2 } from "../helpers/summary-index-fixtures";

const tempDirs: string[] = [];

function createDb(): SqliteDatabase {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-chat-summary-context-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "novel-tool.sqlite3"));
  runMigrations(db);
  return db;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function payload(input: { readonly oneLine: string; readonly synopsis: string }): ChapterAiSummaryPayload {
  return chapterIndexPayloadV2({
    oneLine: input.oneLine,
    synopsis: input.synopsis,
    detail: `${input.synopsis} 这个章节缓存用于上下文路由测试，保留关键事件、人物状态、伏笔线索、可核对事实和不可丢失信息。`
  });
}

function seedChapter(repo: ChapterRepository, input: { readonly projectId: string; readonly title: string; readonly sortOrder: number; readonly text: string }) {
  const now = "2026-05-01T00:00:00.000Z";
  return repo.create({
    id: createId("chapter"),
    projectId: input.projectId,
    title: input.title,
    volumeTitle: "第一卷",
    sortOrder: input.sortOrder,
    contentJson: emptyChapterContent,
    plainText: input.text,
    wordCount: input.text.length,
    dailyWordCount: 0,
    dailyWordCountDate: null,
    targetWordCount: null,
    status: "draft",
    createdAt: now,
    updatedAt: now
  });
}

describe("summary-aware chat context", () => {
  it("uses raw context for a small project when no summary index exists", () => {
    const db = createDb();
    new ProjectRepository(db).create({
      id: "project_small",
      name: "小项目",
      rootPath: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    const chapterRepo = new ChapterRepository(db);
    const summaryRepo = new SummaryRepository(db);
    const first = seedChapter(chapterRepo, {
      projectId: "project_small",
      title: "第1章 起点",
      sortOrder: 0,
      text: "小项目第一章正文。"
    });
    const second = seedChapter(chapterRepo, {
      projectId: "project_small",
      title: "第2章 暗潮",
      sortOrder: 1,
      text: "小项目第二章正文。"
    });

    const resolved = resolveChatAgentContext(
      {
        projectId: "project_small",
        message: "总结全部章节",
        chapterId: first.id
      },
      {
        intent: "summarize",
        scope: { type: "all_chapters" },
        actions: []
      },
      chapterRepo,
      undefined,
      { summaryRepo }
    );

    expect(resolved.agentContext.mode).toBe("direct");
    expect(resolved.agentContext.indexMode).toBe("raw_small_project");
    expect(resolved.agentContext.sourceChapterIds).toEqual([first.id, second.id]);
    expect(resolved.agentContext.contextText).toContain("小项目第一章正文。");
    expect(resolved.agentContext.contextText).toContain("小项目第二章正文。");

    db.close();
  });

  it("does not load raw chapter bodies for a large project when the summary index is missing", () => {
    const db = createDb();
    new ProjectRepository(db).create({
      id: "project_large_missing",
      name: "大项目",
      rootPath: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    const chapterRepo = new ChapterRepository(db);
    const summaryRepo = new SummaryRepository(db);
    const first = seedChapter(chapterRepo, {
      projectId: "project_large_missing",
      title: "第1章 起点",
      sortOrder: 0,
      text: "大项目第一章正文不应被读取。".repeat(12000)
    });
    const second = seedChapter(chapterRepo, {
      projectId: "project_large_missing",
      title: "第2章 暗潮",
      sortOrder: 1,
      text: "大项目第二章正文不应被读取。".repeat(12000)
    });
    const guardedRepo = Object.create(chapterRepo) as ChapterRepository;
    guardedRepo.getContent = () => {
      throw new Error("large all_chapters without index must not read raw chapter content");
    };

    const resolved = resolveChatAgentContext(
      {
        projectId: "project_large_missing",
        message: "总结全部章节",
        chapterId: first.id
      },
      {
        intent: "summarize",
        scope: { type: "all_chapters" },
        actions: []
      },
      guardedRepo,
      undefined,
      { summaryRepo }
    );

    expect(resolved.agentContext.mode).toBe("summarized");
    expect(resolved.agentContext.indexMode).toBe("missing");
    expect(resolved.agentContext.sourceChapterIds).toEqual([first.id, second.id]);
    expect(resolved.agentContext.contextText).toContain("全书摘要索引尚未建立");
    expect(resolved.agentContext.contextText).not.toContain("不应被读取");

    db.close();
  });

  it("uses ready chapter summaries for long chapter ranges without reading raw chapter bodies", () => {
    const db = createDb();
    new ProjectRepository(db).create({
      id: "project_range",
      name: "范围项目",
      rootPath: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    const chapterRepo = new ChapterRepository(db);
    const summaryRepo = new SummaryRepository(db);
    const chapters = [1, 2, 3, 4].map((ordinal) =>
      seedChapter(chapterRepo, {
        projectId: "project_range",
        title: `第${ordinal}章 范围${ordinal}`,
        sortOrder: ordinal - 1,
        text: `第${ordinal}章不应读取原文。`.repeat(4000)
      })
    );
    chapters.forEach((chapter, index) => {
      const ordinal = index + 1;
      summaryRepo.upsertChapterSummary({
        id: `summary_range_${ordinal}`,
        projectId: "project_range",
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterOrder: ordinal,
        contentHash: computeChapterContentHash(`range-${ordinal}`),
        summaryShort: `第${ordinal}章短摘要。`,
        summaryLong: `第${ordinal}章长摘要。`,
        structured: payload({ oneLine: `第${ordinal}章短摘要。`, synopsis: `第${ordinal}章长摘要。` }),
        tokenCount: 30,
        status: "ready",
        error: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z"
      });
    });
    const guardedRepo = Object.create(chapterRepo) as ChapterRepository;
    guardedRepo.getContent = () => {
      throw new Error("long chapter range summary context must not read raw chapter content");
    };

    const resolved = resolveChatAgentContext(
      {
        projectId: "project_range",
        message: "总结第1章到第4章",
        chapterId: chapters[0].id
      },
      {
        intent: "summarize",
        scope: { type: "chapter_range", from: 1, to: 4 },
        actions: []
      },
      guardedRepo,
      undefined,
      { summaryRepo }
    );

    expect(resolved.agentContext.mode).toBe("summarized");
    expect(resolved.agentContext.indexMode).toBe("summary_cache");
    expect(resolved.agentContext.indexedChapterCount).toBe(4);
    expect(resolved.agentContext.totalChapterCount).toBe(4);
    expect(resolved.agentContext.sourceChapterIds).toEqual(chapters.map((chapter) => chapter.id));
    expect(resolved.agentContext.contextText).toContain("第1章短摘要。");
    expect(resolved.agentContext.contextText).toContain("第4章短摘要。");
    expect(resolved.agentContext.contextText).not.toContain("不应读取原文");

    db.close();
  });

  it("prefers complete chapter-range summaries even when the raw range fits a large model window", () => {
    const db = createDb();
    new ProjectRepository(db).create({
      id: "project_range_large_window",
      name: "大窗口范围项目",
      rootPath: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    const chapterRepo = new ChapterRepository(db);
    const summaryRepo = new SummaryRepository(db);
    const chapters = Array.from({ length: 10 }, (_, index) => {
      const ordinal = index + 1;
      return seedChapter(chapterRepo, {
        projectId: "project_range_large_window",
        title: `第${ordinal}章 缓存${ordinal}`,
        sortOrder: index,
        text: `第${ordinal}章原文即使能塞进大上下文也不应读取。`
      });
    });
    chapters.forEach((chapter, index) => {
      const ordinal = index + 1;
      summaryRepo.upsertChapterSummary({
        id: `summary_large_window_${ordinal}`,
        projectId: "project_range_large_window",
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterOrder: ordinal,
        contentHash: computeChapterContentHash(`large-window-${ordinal}`),
        summaryShort: `第${ordinal}章缓存短摘要。`,
        summaryLong: `第${ordinal}章缓存长摘要。`,
        structured: payload({ oneLine: `第${ordinal}章缓存短摘要。`, synopsis: `第${ordinal}章缓存长摘要。` }),
        tokenCount: 30,
        status: "ready",
        error: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z"
      });
    });
    const guardedRepo = Object.create(chapterRepo) as ChapterRepository;
    guardedRepo.getContent = () => {
      throw new Error("complete cached chapter range must not read raw content just because the model window is large");
    };

    const resolved = resolveChatAgentContext(
      {
        projectId: "project_range_large_window",
        message: "帮我总结前十章的内容",
        chapterId: chapters[0].id
      },
      {
        intent: "summarize",
        scope: { type: "chapter_range", from: 1, to: 10 },
        actions: []
      },
      guardedRepo,
      {
        maxInputTokens: 120_000,
        maxOutputTokens: 4096
      },
      { summaryRepo }
    );

    expect(resolved.agentContext.mode).toBe("summarized");
    expect(resolved.agentContext.indexMode).toBe("summary_cache");
    expect(resolved.agentContext.indexedChapterCount).toBe(10);
    expect(resolved.agentContext.totalChapterCount).toBe(10);
    expect(resolved.agentContext.contextText).toContain("第1章缓存短摘要。");
    expect(resolved.agentContext.contextText).toContain("第10章缓存长摘要。");
    expect(resolved.agentContext.contextText).not.toContain("原文即使能塞进大上下文也不应读取");

    db.close();
  });

  it("uses hybrid summary context for partially cached long ranges instead of falling back to raw text", () => {
    const db = createDb();
    new ProjectRepository(db).create({
      id: "project_range_partial_cache",
      name: "部分缓存范围项目",
      rootPath: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    const chapterRepo = new ChapterRepository(db);
    const summaryRepo = new SummaryRepository(db);
    const chapters = Array.from({ length: 10 }, (_, index) => {
      const ordinal = index + 1;
      return seedChapter(chapterRepo, {
        projectId: "project_range_partial_cache",
        title: `第${ordinal}章 部分缓存${ordinal}`,
        sortOrder: index,
        text: `第${ordinal}章部分缓存时也不应回退读取原文。`
      });
    });
    chapters.forEach((chapter, index) => {
      const ordinal = index + 1;
      if (ordinal === 5) {
        return;
      }
      summaryRepo.upsertChapterSummary({
        id: `summary_partial_cache_${ordinal}`,
        projectId: "project_range_partial_cache",
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterOrder: ordinal,
        contentHash: computeChapterContentHash(`partial-cache-${ordinal}`),
        summaryShort: `第${ordinal}章部分缓存短摘要。`,
        summaryLong: `第${ordinal}章部分缓存长摘要。`,
        structured: payload({ oneLine: `第${ordinal}章部分缓存短摘要。`, synopsis: `第${ordinal}章部分缓存长摘要。` }),
        tokenCount: 30,
        status: "ready",
        error: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z"
      });
    });
    const guardedRepo = Object.create(chapterRepo) as ChapterRepository;
    guardedRepo.getContent = () => {
      throw new Error("partially cached long chapter ranges must not fall back to raw text");
    };

    const resolved = resolveChatAgentContext(
      {
        projectId: "project_range_partial_cache",
        message: "帮我总结前十章的内容",
        chapterId: chapters[0].id
      },
      {
        intent: "summarize",
        scope: { type: "chapter_range", from: 1, to: 10 },
        actions: []
      },
      guardedRepo,
      {
        maxInputTokens: 120_000,
        maxOutputTokens: 4096
      },
      { summaryRepo }
    );

    expect(resolved.agentContext.mode).toBe("summarized");
    expect(resolved.agentContext.indexMode).toBe("hybrid");
    expect(resolved.agentContext.indexedChapterCount).toBe(9);
    expect(resolved.agentContext.totalChapterCount).toBe(10);
    expect(resolved.agentContext.staleChapterCount).toBe(1);
    expect(resolved.agentContext.contextText).toContain("摘要缺失或过期 1 章");
    expect(resolved.agentContext.contextText).toContain("缺失章节：第5章 部分缓存5");
    expect(resolved.agentContext.contextText).toContain("第1章部分缓存短摘要。");
    expect(resolved.agentContext.contextText).toContain("第10章部分缓存长摘要。");
    expect(resolved.agentContext.contextText).not.toContain("回退读取原文");

    db.close();
  });

  it("uses ready arc and chapter summaries for all-chapter context when the book summary is not ready", () => {
    const db = createDb();
    new ProjectRepository(db).create({
      id: "project_no_book_index",
      name: "无全书缓存项目",
      rootPath: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    const chapterRepo = new ChapterRepository(db);
    const summaryRepo = new SummaryRepository(db);
    const chapters = [1, 2, 3].map((ordinal) =>
      seedChapter(chapterRepo, {
        projectId: "project_no_book_index",
        title: `第${ordinal}章 未读${ordinal}`,
        sortOrder: ordinal - 1,
        text: `第${ordinal}章不应读取原文。`.repeat(4000)
      })
    );
    chapters.slice(0, 2).forEach((chapter, index) => {
      const ordinal = index + 1;
      summaryRepo.upsertChapterSummary({
        id: `summary_no_book_${ordinal}`,
        projectId: "project_no_book_index",
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterOrder: ordinal,
        contentHash: computeChapterContentHash(`no-book-${ordinal}`),
        summaryShort: `第${ordinal}章已有短摘要。`,
        summaryLong: `第${ordinal}章已有长摘要。`,
        structured: payload({ oneLine: `第${ordinal}章已有短摘要。`, synopsis: `第${ordinal}章已有长摘要。` }),
        tokenCount: 30,
        status: "ready",
        error: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z"
      });
    });
    summaryRepo.upsertArcSummary({
      id: "arc_summary_no_book",
      projectId: "project_no_book_index",
      arcKey: "auto:001-002",
      chapterFrom: 1,
      chapterTo: 2,
      sourceHash: computeSourceHash(["chapter-1", "chapter-2"]),
      summary: "第1-2章已有阶段摘要。",
      structured: arcIndexPayloadV2(),
      status: "ready",
      error: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    const guardedRepo = Object.create(chapterRepo) as ChapterRepository;
    guardedRepo.getContent = () => {
      throw new Error("all_chapters with partial summaries must not read raw chapter content");
    };

    const resolved = resolveChatAgentContext(
      {
        projectId: "project_no_book_index",
        message: "帮我总结全部章节",
        chapterId: chapters[0].id
      },
      {
        intent: "summarize",
        scope: { type: "all_chapters" },
        actions: []
      },
      guardedRepo,
      undefined,
      { summaryRepo }
    );

    expect(resolved.agentContext.indexMode).toBe("hybrid");
    expect(resolved.agentContext.indexedChapterCount).toBe(2);
    expect(resolved.agentContext.totalChapterCount).toBe(3);
    expect(resolved.agentContext.staleChapterCount).toBe(1);
    expect(resolved.agentContext.contextText).toContain("全书摘要尚未生成");
    expect(resolved.agentContext.contextText).toContain("缺失章节：第3章 未读3");
    expect(resolved.agentContext.contextText).toContain("第1-2章已有阶段摘要。");
    expect(resolved.agentContext.contextText).toContain("第1章已有短摘要。");
    expect(resolved.agentContext.contextText).not.toContain("不应读取原文");

    db.close();
  });

  it("uses the persisted book summary index for all-chapter chat context without reading raw chapter bodies", () => {
    const db = createDb();
    new ProjectRepository(db).create({
      id: "project_1",
      name: "雨夜",
      rootPath: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    const chapterRepo = new ChapterRepository(db);
    const summaryRepo = new SummaryRepository(db);
    const first = seedChapter(chapterRepo, {
      projectId: "project_1",
      title: "第1章 雨夜",
      sortOrder: 0,
      text: "第一章不应被读取的原始正文。".repeat(1200)
    });
    const second = seedChapter(chapterRepo, {
      projectId: "project_1",
      title: "第2章 旧信",
      sortOrder: 1,
      text: "第二章不应被读取的原始正文。".repeat(1200)
    });
    summaryRepo.upsertChapterSummary({
      id: "summary_chapter_1",
      projectId: "project_1",
      chapterId: first.id,
      chapterTitle: first.title,
      chapterOrder: 1,
      contentHash: computeChapterContentHash("第一章摘要来源"),
      summaryShort: "林远在雨夜回城。",
      summaryLong: "林远回到旧城，发现旧信线索。",
      structured: payload({ oneLine: "林远回城。", synopsis: "林远回到旧城，发现旧信线索。" }),
      tokenCount: 30,
      status: "ready",
      error: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    summaryRepo.upsertChapterSummary({
      id: "summary_chapter_2",
      projectId: "project_1",
      chapterId: second.id,
      chapterTitle: second.title,
      chapterOrder: 2,
      contentHash: computeChapterContentHash("第二章摘要来源"),
      summaryShort: "旧信指向失踪故人。",
      summaryLong: "旧信揭开一段失踪往事，林远决定追查。",
      structured: payload({ oneLine: "旧信出现。", synopsis: "旧信揭开一段失踪往事，林远决定追查。" }),
      tokenCount: 32,
      status: "ready",
      error: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    summaryRepo.upsertArcSummary({
      id: "arc_summary_1",
      projectId: "project_1",
      arcKey: "auto:001-002",
      chapterFrom: 1,
      chapterTo: 2,
      sourceHash: computeSourceHash(["chapter-1", "chapter-2"]),
      summary: "第1-2章中，林远回到旧城并开始追查旧信。",
      structured: arcIndexPayloadV2(),
      status: "ready",
      error: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    summaryRepo.upsertBookSummary({
      id: "book_summary_1",
      projectId: "project_1",
      sourceHash: "book-source",
      summaryShort: "林远回城后追查旧信。",
      summaryLong: "林远在雨夜回到旧城，发现旧信，并决定追查失踪故人的真相。",
      structured: bookIndexPayloadV2(),
      status: "ready",
      error: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });

    const guardedRepo = Object.create(chapterRepo) as ChapterRepository;
    guardedRepo.getContent = () => {
      throw new Error("all_chapters summary context must not read raw chapter content");
    };

    const resolved = resolveChatAgentContext(
      {
        projectId: "project_1",
        message: "总结现有的全部章节",
        chapterId: first.id
      },
      {
        intent: "summarize",
        scope: { type: "all_chapters" },
        actions: []
      },
      guardedRepo,
      undefined,
      { summaryRepo }
    );

    expect(resolved.requiresSummaries).toBe(false);
    expect(resolved.agentContext.mode).toBe("summarized");
    expect(resolved.agentContext.scopeLabel).toBe("全书摘要索引");
    expect(resolved.agentContext.indexMode).toBe("summary_cache");
    expect(resolved.agentContext.indexedChapterCount).toBe(2);
    expect(resolved.agentContext.totalChapterCount).toBe(2);
    expect(resolved.agentContext.staleChapterCount).toBe(0);
    expect(resolved.agentContext.skippedTooShortChapterCount).toBe(0);
    expect(resolved.agentContext.sourceChapterIds).toEqual([first.id, second.id]);
    expect(resolved.agentContext.contextText).toContain("覆盖：2/2 章");
    expect(resolved.agentContext.contextText).toContain("林远在雨夜回到旧城");
    expect(resolved.agentContext.contextText).toContain("第1-2章中，林远回到旧城并开始追查旧信。");
    expect(resolved.agentContext.contextText).toContain("林远在雨夜回城。");
    expect(resolved.agentContext.contextText).not.toContain("不应被读取的原始正文");

    db.close();
  });
});
