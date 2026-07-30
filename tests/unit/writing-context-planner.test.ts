import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyChapterContent } from "../../src/main/chapter/default-content";
import { planWritingOperationContext } from "../../src/main/ai/writing-context-planner";
import { getWritingOperationDefinition } from "../../src/main/ai/writing-operation-registry";
import { getTokenBudget } from "../../src/main/ai/token-budget";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { createId } from "../../src/main/shared/ids";

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

function createChapter(repo: ChapterRepository, projectId: string, title: string, sortOrder: number, plainText: string) {
  const now = new Date().toISOString();
  return repo.create({
    id: createId("chapter"),
    projectId,
    title,
    volumeTitle: null,
    sortOrder,
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

function createRepo(projectId: string) {
  const dir = mkdtempSync(join(tmpdir(), "moshu-writing-context-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "project.sqlite3"));
  runMigrations(db);
  createProject(db, projectId);
  return { db, chapterRepo: new ChapterRepository(db) };
}

describe("writing context planner", () => {
  it("keeps selected text as target and adds local context as reference only", () => {
    const projectId = "project_context";
    const { db, chapterRepo } = createRepo(projectId);
    const target = "萧炎垂下眼，指节慢慢攥紧。";
    const chapter = createChapter(
      chapterRepo,
      projectId,
      "第3章 客人",
      3,
      `前文压力逐渐逼近。众人的目光落在少年身上。\n${target}\n纳兰嫣然没有立刻开口，厅中一时寂静。`
    );

    const plan = planWritingOperationContext({
      projectId,
      operation: getWritingOperationDefinition("polish"),
      target: {
        kind: "selection",
        chapterId: chapter.id,
        selectionHash: "hash_target",
        text: target
      },
      chapterRepo,
      tokenBudget: getTokenBudget("polish")
    });

    expect(plan.targetText).toBe(target);
    expect(plan.supportingContext.map((item) => item.kind)).toEqual(["same_chapter_before", "same_chapter_after"]);
    expect(plan.supportingContext.map((item) => item.content).join("\n")).toContain("前文压力逐渐逼近");
    expect(plan.supportingContext.map((item) => item.content).join("\n")).toContain("纳兰嫣然没有立刻开口");
    expect(plan.mode).toBe("direct");

    db.close();
  });

  it("maps whitespace-normalized selection matches back to the real chapter position", () => {
    const projectId = "project_context_whitespace";
    const { db, chapterRepo } = createRepo(projectId);
    const target = "萧炎垂下眼，指节慢慢攥紧。";
    const chapter = createChapter(
      chapterRepo,
      projectId,
      "第3章 客人",
      3,
      "前文压力逐渐逼近。众人的目光落在少年身上。\n萧炎垂下眼，\n指节慢慢攥紧。\n纳兰嫣然没有立刻开口，厅中一时寂静。"
    );

    const plan = planWritingOperationContext({
      projectId,
      operation: getWritingOperationDefinition("polish"),
      target: {
        kind: "selection",
        chapterId: chapter.id,
        selectionHash: "hash_target_whitespace",
        text: target
      },
      chapterRepo,
      tokenBudget: getTokenBudget("polish")
    });

    const contextText = plan.supportingContext.map((item) => item.content).join("\n");
    expect(contextText).toContain("前文压力逐渐逼近");
    expect(contextText).toContain("纳兰嫣然没有立刻开口");
    expect(plan.supportingContext[0]?.content).not.toBe("");

    db.close();
  });

  it("adds local before and after context for selected-text proofread", () => {
    const projectId = "project_proofread_context";
    const { db, chapterRepo } = createRepo(projectId);
    const target = "他轻轻地轻轻推开门。";
    const chapter = createChapter(chapterRepo, projectId, "第1章", 1, `门外的脚步声忽然停住。\n${target}\n屋内没有人回应，只有烛火晃了一下。`);

    const plan = planWritingOperationContext({
      projectId,
      operation: getWritingOperationDefinition("proofread"),
      target: {
        kind: "selection",
        chapterId: chapter.id,
        selectionHash: "hash_proofread",
        text: target
      },
      chapterRepo,
      tokenBudget: getTokenBudget("proofread")
    });

    expect(plan.targetText).toBe(target);
    expect(plan.supportingContext.map((item) => item.kind)).toEqual(["same_chapter_before", "same_chapter_after"]);
    expect(plan.supportingContext[0]?.content).toContain("门外的脚步声忽然停住");
    expect(plan.supportingContext[1]?.content).toContain("屋内没有人回应");
    expect(plan.reason).toContain("前后文");

    db.close();
  });

  it("resolves chapter range targets from the requested project", () => {
    const projectId = "project_range_context";
    const { db, chapterRepo } = createRepo(projectId);
    createChapter(chapterRepo, projectId, "第1章", 1, "第一章正文。");
    createChapter(chapterRepo, projectId, "第2章", 2, "第二章正文。");

    const plan = planWritingOperationContext({
      projectId,
      operation: getWritingOperationDefinition("proofread"),
      target: {
        kind: "chapter_range",
        fromOrdinal: 1,
        toOrdinal: 2
      },
      chapterRepo,
      tokenBudget: getTokenBudget("proofread")
    });

    expect(plan.targetText).toContain("[第1章 第1章]");
    expect(plan.targetText).toContain("第一章正文。");
    expect(plan.targetText).toContain("[第2章 第2章]");
    expect(plan.targetText).toContain("第二章正文。");

    db.close();
  });

  it("rejects chapter targets from another project", () => {
    const projectId = "project_owner_context";
    const otherProjectId = "project_other_context";
    const { db, chapterRepo } = createRepo(projectId);
    createProject(db, otherProjectId);
    const otherChapter = createChapter(chapterRepo, otherProjectId, "外部章节", 1, "不应该被读取的正文。");

    expect(() =>
      planWritingOperationContext({
        projectId,
        operation: getWritingOperationDefinition("proofread"),
        target: {
          kind: "chapter",
          chapterId: otherChapter.id
        },
        chapterRepo,
        tokenBudget: getTokenBudget("proofread")
      })
    ).toThrow("目标章节不属于当前项目");

    db.close();
  });

  it("fails when target text alone exceeds input budget", () => {
    const projectId = "project_long_target";
    const { db, chapterRepo } = createRepo(projectId);

    expect(() =>
      planWritingOperationContext({
        projectId,
        operation: getWritingOperationDefinition("polish"),
        target: {
          kind: "inline_text",
          text: "林".repeat(9000)
        },
        chapterRepo,
        tokenBudget: getTokenBudget("polish")
      })
    ).toThrow("本次要求与目标文本合计过长");

    db.close();
  });

  it("reserves room for a long user instruction before adding target text", () => {
    const projectId = "project_long_instruction";
    const { db, chapterRepo } = createRepo(projectId);

    expect(() =>
      planWritingOperationContext({
        projectId,
        operation: getWritingOperationDefinition("polish"),
        target: {
          kind: "inline_text",
          text: "这是一段较短的正文。"
        },
        chapterRepo,
        tokenBudget: getTokenBudget("polish"),
        reservedInputTokens: 8_000
      })
    ).toThrow("本次要求与目标文本合计过长");

    db.close();
  });
});
