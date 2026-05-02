import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planWritingOperationContext } from "../../src/main/ai/writing-context-planner";
import { getWritingOperationDefinition } from "../../src/main/ai/writing-operation-registry";
import { parseWritingOperationResponse } from "../../src/main/ai/writing-operation-prompt";
import { getTokenBudget } from "../../src/main/ai/token-budget";
import { emptyChapterContent } from "../../src/main/chapter/default-content";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { SummaryRepository } from "../../src/main/db/repositories/summary-repo";
import { createId } from "../../src/main/shared/ids";
import { computeChapterContentHash } from "../../src/main/shared/summary-index";
import { chapterIndexPayloadV2 } from "../helpers/summary-index-fixtures";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createProject(db: SqliteDatabase, projectId: string): void {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(projectId, projectId, now, now);
}

function createRepos(projectId: string) {
  const dir = mkdtempSync(join(tmpdir(), "moshu-cache-proofread-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "project.sqlite3"));
  runMigrations(db);
  createProject(db, projectId);
  return { db, chapterRepo: new ChapterRepository(db), summaryRepo: new SummaryRepository(db) };
}

function createChapter(repo: ChapterRepository, projectId: string, title: string, plainText: string) {
  const now = new Date().toISOString();
  return repo.create({
    id: createId("chapter"),
    projectId,
    title,
    volumeTitle: null,
    sortOrder: 0,
    contentJson: emptyChapterContent,
    plainText,
    wordCount: plainText.length,
    dailyWordCount: 0,
    dailyWordCountDate: null,
    targetWordCount: null,
    status: "draft",
    createdAt: now,
    updatedAt: now
  });
}

describe("cache-assisted proofread", () => {
  it("adds current chapter summary cache as reference for selected-text proofreading", () => {
    const projectId = "project_cache_proofread";
    const { db, chapterRepo, summaryRepo } = createRepos(projectId);
    const target = "他轻轻地轻轻推开门。";
    const plainText = `前文。\n${target}\n后文。`;
    const chapter = createChapter(chapterRepo, projectId, "第3章 客人", plainText);
    summaryRepo.upsertChapterSummary({
      id: "summary_cache_proofread",
      projectId,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      chapterOrder: 3,
      contentHash: computeChapterContentHash(plainText),
      summaryShort: "客人抵达，旧信线索推进。",
      summaryLong: "客人抵达后，人物围绕旧信产生信息差，需要后续核对人物认知边界。",
      structured: chapterIndexPayloadV2({
        oneLine: "客人抵达。",
        synopsis: "客人抵达后，人物围绕旧信产生信息差。"
      }),
      tokenCount: 80,
      status: "ready",
      error: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });

    const plan = planWritingOperationContext({
      projectId,
      operation: getWritingOperationDefinition("proofread"),
      target: {
        kind: "selection",
        chapterId: chapter.id,
        selectionHash: "hash_cache_proofread",
        text: target
      },
      chapterRepo,
      summaryRepo,
      tokenBudget: getTokenBudget("proofread")
    });

    expect(plan.targetText).toBe(target);
    expect(plan.supportingContext).toHaveLength(1);
    expect(plan.supportingContext[0]).toMatchObject({
      kind: "same_chapter_summary",
      label: "第3章 客人 章节摘要索引"
    });
    expect(plan.supportingContext[0]?.content).toContain("人物认知边界");
    expect(plan.reason).toContain("章节摘要缓存只用于逻辑和连续性判断");

    db.close();
  });

  it("proofreads inline pasted text without requiring a chapter cache", () => {
    const projectId = "project_inline_proofread";
    const { db, chapterRepo } = createRepos(projectId);

    const plan = planWritingOperationContext({
      projectId,
      operation: getWritingOperationDefinition("proofread"),
      target: {
        kind: "inline_text",
        text: "他轻轻地轻轻推开门。"
      },
      chapterRepo,
      tokenBudget: getTokenBudget("proofread")
    });

    expect(plan.targetText).toBe("他轻轻地轻轻推开门。");
    expect(plan.supportingContext).toEqual([]);
    expect(plan.reason).toContain("校对默认只检查目标文本");

    db.close();
  });

  it("defaults logic proofread issues to manual non-auto-applicable suggestions", () => {
    const parsed = parseWritingOperationResponse(
      getWritingOperationDefinition("proofread"),
      JSON.stringify({
        issues: [
          {
            type: "人物认知",
            quote: "他立刻说出旧信来自祠堂。",
            suggestion: "请核对前文是否已经让他得知旧信来源。",
            reason: "章节缓存显示该人物此前尚不知道旧信来源。",
            缓存证据: ["第3章：尚不知道旧信来源"]
          }
        ]
      })
    );

    expect(parsed.proofreadIssues).toEqual([
      {
        type: "人物认知",
        quote: "他立刻说出旧信来自祠堂。",
        suggestion: "请核对前文是否已经让他得知旧信来源。",
        reason: "章节缓存显示该人物此前尚不知道旧信来源。",
        缓存证据: ["第3章：尚不知道旧信来源"],
        是否可自动应用: "否",
        是否需要作者判断: "是",
        是否需要回读原文: "是"
      }
    ]);
  });
});
