import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { RelationshipIndexRepository } from "../../src/main/db/repositories/relationship-index-repo";
import { OpenRouterError } from "../../src/main/ai/openrouter-error";
import {
  RELATIONSHIP_INDEX_MIN_AUTO_UNITS,
  RelationshipIndexService,
  type RelationshipIndexGenerator
} from "../../src/main/relationships/relationship-index-service";
import { RelationshipIndexWorker } from "../../src/main/relationships/relationship-index-worker";
import { computeChapterContentHash } from "../../src/main/shared/summary-index";
import { parseRelationshipExtractionPayload, type RelationshipIndexExtractionPayload } from "../../src/main/shared/relationship-index";
import type { ChapterContent } from "../../src/main/shared/types";

const tempDirs: string[] = [];
const baseNow = "2026-05-13T01:00:00.000Z";

function createTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-relationship-worker-"));
  tempDirs.push(dir);
  return join(dir, "novel-tool.sqlite3");
}

function createTestDb(): SqliteDatabase {
  const db = createDatabase(createTempDbPath());
  runMigrations(db);
  new ProjectRepository(db).create({
    id: "project_1",
    name: "关系索引 Worker 测试",
    rootPath: null,
    createdAt: baseNow,
    updatedAt: baseNow
  });
  return db;
}

function textWithUnits(units = RELATIONSHIP_INDEX_MIN_AUTO_UNITS): string {
  return `林砚看着雾灵，知道她隐瞒了契约代价。${"雨".repeat(units)}`;
}

function createChapter(repo: ChapterRepository, input: { readonly id: string; readonly text: string; readonly updatedAt?: string }): void {
  repo.create({
    id: input.id,
    projectId: "project_1",
    title: "第1章 雾起",
    volumeTitle: "第一卷",
    sortOrder: 0,
    contentJson: { type: "doc", content: [] },
    plainText: input.text,
    wordCount: input.text.length,
    dailyWordCount: 0,
    dailyWordCountDate: null,
    targetWordCount: null,
    status: "draft",
    createdAt: baseNow,
    updatedAt: input.updatedAt ?? baseNow,
    contentUpdatedAt: input.updatedAt ?? baseNow
  } satisfies ChapterContent);
}

function updateChapterText(db: SqliteDatabase, text: string, updatedAt: string): void {
  db.prepare("UPDATE chapters SET plain_text = ?, word_count = ?, updated_at = ?, content_updated_at = ? WHERE id = ?").run(
    text,
    text.length,
    updatedAt,
    updatedAt,
    "chapter_1"
  );
}

function relationshipPayload(label = "动态稳定关系"): RelationshipIndexExtractionPayload {
  return parseRelationshipExtractionPayload({
    索引信息: {
      缓存版本: "关系索引一",
      章节序号: 1,
      章节标题: "第1章 雾起",
      语言: "简体中文"
    },
    人物: [
      {
        姓名: "林砚",
        别名: ["阿砚"],
        实体类型: "person",
        重要程度: "main",
        身份摘要: "章节中的行动主体",
        阵营: "",
        置信度: 0.9,
        证据短句: ["林砚看着雾灵"]
      },
      {
        姓名: "雾灵",
        别名: [],
        实体类型: "nonhuman",
        重要程度: "supporting",
        身份摘要: "知道契约代价的非人实体",
        阵营: "",
        置信度: 0.85,
        证据短句: ["雾灵隐瞒了契约代价"]
      }
    ],
    关系事件: [
      {
        主体: "林砚",
        客体: "雾灵",
        关系维度: [
          { 名称: "模型生成维度甲", 说明: "来自正文的动态维度", 置信度: 0.8 },
          { 名称: "模型生成维度乙", 说明: "同一关系的另一层面", 置信度: 0.7 }
        ],
        主维度: "模型生成维度甲",
        基础关系: { 名称: label, 说明: "稳定层来自正文" },
        剧情关系: { 名称: "当前阶段隐瞒", 说明: "本章阶段变化来自正文" },
        语义标记: ["隐瞒"],
        方向: "source_to_target",
        极性: "mixed",
        强度: 0.7,
        本章变化: "林砚意识到雾灵没有说出全部事实",
        开始状态: "未明确",
        结束状态: "互相试探",
        变化原因: "雾灵回避",
        证据短句: "知道她隐瞒了契约代价",
        置信度: 0.8,
        不确定说明: ""
      }
    ],
    不确定项: []
  });
}

function createHarness(generator: RelationshipIndexGenerator = fakeGenerator()): {
  readonly chapterRepo: ChapterRepository;
  readonly db: SqliteDatabase;
  readonly repo: RelationshipIndexRepository;
  readonly service: RelationshipIndexService;
  readonly worker: RelationshipIndexWorker;
} {
  const db = createTestDb();
  const chapterRepo = new ChapterRepository(db);
  const repo = new RelationshipIndexRepository(db);
  const service = new RelationshipIndexService(repo, chapterRepo, { generator });
  const worker = new RelationshipIndexWorker({
    relationshipService: service,
    isForegroundAiActive: () => false,
    ensureAiConfigured: async () => undefined
  });
  return { chapterRepo, db, repo, service, worker };
}

function fakeGenerator(
  run: RelationshipIndexGenerator["extractChapterRelationshipsForIndex"] = async () => relationshipPayload()
): RelationshipIndexGenerator {
  return {
    extractChapterRelationshipsForIndex: run
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("RelationshipIndexWorker", () => {
  it("pauses when foreground AI is active", async () => {
    const { chapterRepo, db, service } = createHarness();
    createChapter(chapterRepo, { id: "chapter_1", text: textWithUnits() });
    service.enqueueImportedChapters("project_1", ["chapter_1"], baseNow);
    const worker = new RelationshipIndexWorker({
      relationshipService: service,
      isForegroundAiActive: () => true,
      ensureAiConfigured: async () => undefined
    });

    await expect(worker.runOnce("project_1", baseNow)).resolves.toEqual({ status: "paused_foreground_ai" });

    db.close();
  });

  it("returns idle when there is no eligible relationship job", async () => {
    const { db, worker } = createHarness();

    await expect(worker.runOnce("project_1", baseNow)).resolves.toEqual({ status: "idle" });

    db.close();
  });

  it("claims one job and persists fake LLM extraction", async () => {
    const calls: string[] = [];
    const { chapterRepo, db, repo, service, worker } = createHarness(
      fakeGenerator(async (input) => {
        calls.push(input.plainText);
        return relationshipPayload("缓存写入关系");
      })
    );
    createChapter(chapterRepo, { id: "chapter_1", text: textWithUnits() });
    service.enqueueImportedChapters("project_1", ["chapter_1"], baseNow);

    const result = await worker.runOnce("project_1", baseNow);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error(`Expected completed relationship job, got ${result.status}`);
    }
    expect(calls).toHaveLength(1);
    expect(repo.getChapterIndexState("project_1", "chapter_1")).toMatchObject({ status: "ready" });
    expect(repo.listRelationshipJobs("project_1").find((job) => job.id === result.jobId)).toMatchObject({ status: "completed" });
    expect(repo.listMentions("project_1")).toHaveLength(1);
    expect(repo.listMentions("project_1")[0]).toMatchObject({
      baseRelationLabel: "缓存写入关系",
      plotRelationLabel: "当前阶段隐瞒",
      primaryDimensionName: "模型生成维度甲"
    });

    db.close();
  });

  it("discards stale source hash output and requeues current chapter content", async () => {
    const generatorCalls: string[] = [];
    const { chapterRepo, db, repo, service, worker } = createHarness(
      fakeGenerator(async (input) => {
        generatorCalls.push(input.plainText);
        return relationshipPayload("旧内容关系");
      })
    );
    const oldText = textWithUnits();
    const newText = textWithUnits(RELATIONSHIP_INDEX_MIN_AUTO_UNITS + 10);
    createChapter(chapterRepo, { id: "chapter_1", text: oldText, updatedAt: "2026-05-13T00:00:00.000Z" });
    service.enqueueImportedChapters("project_1", ["chapter_1"], baseNow);
    updateChapterText(db, newText, "2026-05-13T00:00:00.000Z");

    const result = await worker.runOnce("project_1", "2026-05-13T02:00:00.000Z");

    expect(result.status).toBe("completed");
    expect(generatorCalls).toHaveLength(0);
    expect(repo.listMentions("project_1")).toHaveLength(0);
    expect(repo.listRelationshipJobs("project_1")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceHash: computeChapterContentHash(oldText), status: "completed" }),
        expect.objectContaining({ sourceHash: computeChapterContentHash(newText), status: "queued" })
      ])
    );

    db.close();
  });

  it("schedules retry for OpenRouter rate limits", async () => {
    const { chapterRepo, db, repo, service, worker } = createHarness(
      fakeGenerator(async () => {
        throw new OpenRouterError({ code: "rate_limited", status: 429, message: "rate limited" });
      })
    );
    createChapter(chapterRepo, { id: "chapter_1", text: textWithUnits() });
    service.enqueueImportedChapters("project_1", ["chapter_1"], baseNow);

    const result = await worker.runOnce("project_1", baseNow);

    expect(result).toMatchObject({
      status: "retry_scheduled",
      nextRunAt: "2026-05-13T01:15:00.000Z"
    });
    expect(repo.listRelationshipJobs("project_1")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "failed", error: "rate limited" }),
        expect.objectContaining({ status: "queued", nextRunAt: "2026-05-13T01:15:00.000Z", attemptCount: 1 })
      ])
    );

    db.close();
  });

  it("marks a running job cancelled when extraction is cancelled", async () => {
    const { chapterRepo, db, repo, service, worker } = createHarness(
      fakeGenerator(async () => {
        throw new OpenRouterError({ code: "canceled", message: "canceled", isCanceled: true });
      })
    );
    createChapter(chapterRepo, { id: "chapter_1", text: textWithUnits() });
    service.enqueueImportedChapters("project_1", ["chapter_1"], baseNow);

    const result = await worker.runOnce("project_1", baseNow);

    expect(result.status).toBe("cancelled");
    expect(repo.listRelationshipJobs("project_1")).toEqual(expect.arrayContaining([expect.objectContaining({ status: "cancelled" })]));

    db.close();
  });
});
