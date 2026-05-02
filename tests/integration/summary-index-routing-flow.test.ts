import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeChatAgentTool } from "../../src/main/ai/chat-agent-tools";
import { getTokenBudget } from "../../src/main/ai/token-budget";
import { emptyChapterContent } from "../../src/main/chapter/default-content";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { ScratchNoteRepository } from "../../src/main/db/repositories/scratch-note-repo";
import { SummaryRepository } from "../../src/main/db/repositories/summary-repo";
import { createId } from "../../src/main/shared/ids";
import { computeChapterContentHash, computeSourceHash, type ChapterAiSummaryPayload } from "../../src/main/shared/summary-index";
import type { ChapterSummary } from "../../src/main/shared/types";
import { arcIndexPayloadV2, bookIndexPayloadV2, chapterIndexPayloadV2 } from "../helpers/summary-index-fixtures";

const tempDirs: string[] = [];

function createRepos() {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-summary-index-routing-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "novel-tool.sqlite3"));
  runMigrations(db);
  return {
    db,
    chapterRepo: new ChapterRepository(db),
    scratchRepo: new ScratchNoteRepository(db),
    summaryRepo: new SummaryRepository(db)
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createProject(repo: ProjectRepository, projectId: string): void {
  const now = "2026-05-01T00:00:00.000Z";
  repo.create({
    id: projectId,
    name: projectId,
    rootPath: null,
    createdAt: now,
    updatedAt: now
  });
}

function createChapter(repo: ChapterRepository, input: { readonly projectId: string; readonly ordinal: number; readonly text: string }): ChapterSummary {
  const now = "2026-05-01T00:00:00.000Z";
  return repo.create({
    id: createId("chapter"),
    projectId: input.projectId,
    title: `第${input.ordinal}章 路由${input.ordinal}`,
    volumeTitle: null,
    sortOrder: input.ordinal - 1,
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

function summaryPayload(ordinal: number): ChapterAiSummaryPayload {
  return chapterIndexPayloadV2({
    oneLine: `第${ordinal}章完成路由摘要。`,
    synopsis: `第${ordinal}章已有摘要索引。`,
    detail: `第${ordinal}章已有摘要索引。这个缓存用于验证摘要路由不会读取原文。`
  });
}

function seedChapterSummary(summaryRepo: SummaryRepository, projectId: string, chapter: ChapterSummary, ordinal: number): void {
  summaryRepo.upsertChapterSummary({
    id: `summary_routing_${ordinal}`,
    projectId,
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    chapterOrder: ordinal,
    contentHash: computeChapterContentHash(`routing-${ordinal}`),
    summaryShort: `第${ordinal}章路由短摘要。`,
    summaryLong: `第${ordinal}章路由长摘要。`,
    structured: summaryPayload(ordinal),
    tokenCount: 30,
    status: "ready",
    error: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  });
}

function parseToolJson(value: string): Record<string, unknown> {
  return JSON.parse(value) as Record<string, unknown>;
}

describe("summary index routing flow", () => {
  it("answers all-chapter read requests from the ready book index without reading raw chapter bodies", async () => {
    const { chapterRepo, db, scratchRepo, summaryRepo } = createRepos();
    const projectId = "project_book_routing";
    createProject(new ProjectRepository(db), projectId);
    const chapters = [1, 2].map((ordinal) =>
      createChapter(chapterRepo, {
        projectId,
        ordinal,
        text: `第${ordinal}章原文不应被读取。`.repeat(2000)
      })
    );
    chapters.forEach((chapter, index) => seedChapterSummary(summaryRepo, projectId, chapter, index + 1));
    summaryRepo.upsertArcSummary({
      id: "arc_routing_1",
      projectId,
      arcKey: "auto:001-002",
      chapterFrom: 1,
      chapterTo: 2,
      sourceHash: computeSourceHash(["chapter-1", "chapter-2"]),
      summary: "第1-2章路由阶段摘要。",
      structured: arcIndexPayloadV2(),
      status: "ready",
      error: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    summaryRepo.upsertBookSummary({
      id: "book_routing_1",
      projectId,
      sourceHash: "book-routing-source",
      summaryShort: "全书路由短摘要。",
      summaryLong: "全书路由长摘要。",
      structured: bookIndexPayloadV2(),
      status: "ready",
      error: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    const guardedRepo = Object.create(chapterRepo) as ChapterRepository;
    guardedRepo.getContent = () => {
      throw new Error("ready book summary routing must not read raw chapter content");
    };

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "read_chapters",
        argumentsJson: JSON.stringify({ scope: "all_chapters" }),
        runtime: {
          projectId,
          currentChapterId: chapters[0].id,
          userMessage: "总结现有全部章节",
          chapterRepo: guardedRepo,
          scratchRepo,
          summaryRepo,
          tokenBudget: getTokenBudget("chat")
        }
      })
    );

    expect(result.scopeLabel).toBe("全书摘要索引");
    expect(result.indexMode).toBe("summary_cache");
    expect(result.contextText).toContain("全书路由长摘要。");
    expect(result.contextText).not.toContain("原文不应被读取");

    db.close();
  });

  it("uses hybrid range summaries and discloses missing chapters instead of reading a large raw range", async () => {
    const { chapterRepo, db, scratchRepo, summaryRepo } = createRepos();
    const projectId = "project_range_routing";
    createProject(new ProjectRepository(db), projectId);
    const chapters = Array.from({ length: 5 }, (_, index) =>
      createChapter(chapterRepo, {
        projectId,
        ordinal: index + 1,
        text: `第${index + 1}章大范围原文不应读取。`.repeat(2000)
      })
    );
    chapters.forEach((chapter, index) => {
      if (index === 2) {
        return;
      }
      seedChapterSummary(summaryRepo, projectId, chapter, index + 1);
    });
    const guardedRepo = Object.create(chapterRepo) as ChapterRepository;
    guardedRepo.getContent = () => {
      throw new Error("partial summary routing must not read raw chapter content");
    };

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "read_chapters",
        argumentsJson: JSON.stringify({ scope: "chapter_range", from: 1, to: 5 }),
        runtime: {
          projectId,
          currentChapterId: chapters[0].id,
          userMessage: "总结前五章",
          chapterRepo: guardedRepo,
          scratchRepo,
          summaryRepo,
          tokenBudget: {
            maxInputTokens: 120_000,
            maxOutputTokens: 4096
          }
        }
      })
    );

    expect(result.scopeLabel).toBe("第1-5章摘要索引");
    expect(result.indexMode).toBe("hybrid");
    expect(result.indexedChapterCount).toBe(4);
    expect(result.totalChapterCount).toBe(5);
    expect(result.contextText).toContain("缺失章节：第3章 路由3");
    expect(result.contextText).toContain("第5章路由长摘要。");
    expect(result.contextText).not.toContain("大范围原文不应读取");

    db.close();
  });

  it("still reads raw text for an explicit small raw range", async () => {
    const { chapterRepo, db, scratchRepo, summaryRepo } = createRepos();
    const projectId = "project_raw_routing";
    createProject(new ProjectRepository(db), projectId);
    const chapters = [1, 2].map((ordinal) =>
      createChapter(chapterRepo, {
        projectId,
        ordinal,
        text: `第${ordinal}章明确要求原文。`
      })
    );
    chapters.forEach((chapter, index) => seedChapterSummary(summaryRepo, projectId, chapter, index + 1));

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "read_chapters",
        argumentsJson: JSON.stringify({ scope: "chapter_range", from: 1, to: 2, mode: "raw" }),
        runtime: {
          projectId,
          currentChapterId: chapters[0].id,
          userMessage: "逐字读取前两章",
          chapterRepo,
          scratchRepo,
          summaryRepo,
          tokenBudget: getTokenBudget("chat")
        }
      })
    );

    expect(result.mode).toBe("direct");
    expect(result.indexMode).toBeUndefined();
    expect(result.contextText).toContain("第1章明确要求原文。");
    expect(result.contextText).toContain("第2章明确要求原文。");
    expect(result.contextText).not.toContain("路由短摘要");

    db.close();
  });
});
