import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { RelationshipIndexRepository } from "../../src/main/db/repositories/relationship-index-repo";
import { parseRelationshipExtractionPayload } from "../../src/main/shared/relationship-index";

const tempDirs: string[] = [];
const now = "2026-05-13T01:00:00.000Z";
const later = "2026-05-13T02:00:00.000Z";

function createTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-relationship-repo-"));
  tempDirs.push(dir);
  return join(dir, "novel-tool.sqlite3");
}

function createTestDb(): SqliteDatabase {
  const db = createDatabase(createTempDbPath());
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run("project_1", "关系索引测试", now, now);
  for (const [chapterId, title, order] of [
    ["chapter_1", "第1章 雾起", 1],
    ["chapter_2", "第2章 归来", 2],
    ["chapter_3", "第3章 盟约", 3]
  ] as const) {
    db.prepare(
      `INSERT INTO chapters
       (id, project_id, title, sort_order, content_json, plain_text, word_count, daily_word_count, created_at, updated_at, content_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(chapterId, "project_1", title, order, JSON.stringify({ type: "doc", content: [] }), "正文", 2, 0, now, now, now);
  }
  return db;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function extractionPayload(label = "契约同行者") {
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
        身份摘要: "青石门弟子",
        阵营: "青石门",
        置信度: 0.95,
        证据短句: ["林砚按住剑柄"]
      },
      {
        姓名: "雾灵",
        别名: ["灰雾"],
        实体类型: "nonhuman",
        重要程度: "supporting",
        身份摘要: "伴随林砚的非人实体",
        阵营: "未明确",
        置信度: 0.88,
        证据短句: ["灰雾在他袖口盘旋"]
      }
    ],
    关系事件: [
      {
        主体: "林砚",
        客体: "雾灵",
        关系维度: [
          { 名称: "灵魂契约", 说明: "人与非人实体之间的绑定", 置信度: 0.8 },
          { 名称: "信息差", 说明: "一方知道另一方暂时不知道的信息", 置信度: 0.6 }
        ],
        主维度: "灵魂契约",
        基础关系: { 名称: label, 说明: `${label}的稳定结构` },
        剧情关系: { 名称: "隐瞒关键代价", 说明: "雾灵没有说明契约代价" },
        语义标记: ["隐瞒", "契约"],
        方向: "source_to_target",
        极性: "mixed",
        强度: 0.7,
        本章变化: "林砚意识到雾灵知道更多",
        开始状态: "同行",
        结束状态: "互相试探",
        变化原因: "雾灵回避问题",
        证据短句: "灰雾避开他的目光",
        置信度: 0.82,
        不确定说明: ""
      }
    ],
    不确定项: []
  });
}

describe("RelationshipIndexRepository", () => {
  it("upserts a chapter as waiting for stability", () => {
    const db = createTestDb();
    const repo = new RelationshipIndexRepository(db);

    const first = repo.markChapterWaitingStable({
      projectId: "project_1",
      chapterId: "chapter_1",
      chapterTitle: "第1章 雾起",
      chapterOrder: 1,
      contentHash: "hash_1",
      stableAfterMs: 3600000,
      extractorVersion: "relationship-index-v1",
      eligibleAt: later,
      now
    });
    const updated = repo.markChapterWaitingStable({
      projectId: "project_1",
      chapterId: "chapter_1",
      chapterTitle: "第1章 雾又起",
      chapterOrder: 1,
      contentHash: "hash_2",
      stableAfterMs: 3600000,
      extractorVersion: "relationship-index-v1",
      eligibleAt: "2026-05-13T03:00:00.000Z",
      now: later
    });

    expect(updated.id).toBe(first.id);
    expect(updated).toMatchObject({
      status: "waiting_stable",
      chapterTitle: "第1章 雾又起",
      contentHash: "hash_2",
      eligibleAt: "2026-05-13T03:00:00.000Z",
      error: null
    });

    db.close();
  });

  it("dedupes queued and running jobs by project, chapter, and source hash", () => {
    const db = createTestDb();
    const repo = new RelationshipIndexRepository(db);

    const first = repo.enqueueChapterJob({ projectId: "project_1", chapterId: "chapter_1", sourceHash: "hash_1", priority: 1, eligibleAt: now, now });
    const second = repo.enqueueChapterJob({
      projectId: "project_1",
      chapterId: "chapter_1",
      sourceHash: "hash_1",
      priority: 5,
      eligibleAt: now,
      nextRunAt: later,
      now: later
    });

    expect(second.id).toBe(first.id);
    expect(second.priority).toBe(5);
    expect(second.nextRunAt).toBe(later);

    repo.resetRunningJobs("project_1", later);
    const running = repo.claimNextRelationshipJob("project_1", "2026-05-13T03:00:00.000Z");
    const third = repo.enqueueChapterJob({
      projectId: "project_1",
      chapterId: "chapter_1",
      sourceHash: "hash_1",
      priority: 9,
      eligibleAt: now,
      now: "2026-05-13T03:01:00.000Z"
    });

    expect(running?.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(third.status).toBe("running");

    db.close();
  });

  it("keeps queued job timing gates when dedupe updates omit optional run times", () => {
    const db = createTestDb();
    const repo = new RelationshipIndexRepository(db);

    const first = repo.enqueueChapterJob({
      projectId: "project_1",
      chapterId: "chapter_1",
      sourceHash: "hash_1",
      priority: 1,
      eligibleAt: later,
      nextRunAt: later,
      now
    });
    const second = repo.enqueueChapterJob({
      projectId: "project_1",
      chapterId: "chapter_1",
      sourceHash: "hash_1",
      priority: 3,
      now: "2026-05-13T01:01:00.000Z"
    });

    expect(second.id).toBe(first.id);
    expect(second.eligibleAt).toBe(later);
    expect(second.nextRunAt).toBe(later);
    expect(repo.peekNextRelationshipJob("project_1", now)).toBeNull();

    db.close();
  });

  it("claims only jobs whose eligible_at and next_run_at are runnable", () => {
    const db = createTestDb();
    const repo = new RelationshipIndexRepository(db);

    repo.enqueueChapterJob({ projectId: "project_1", chapterId: "chapter_1", sourceHash: "future_eligible", priority: 9, eligibleAt: later, now });
    repo.enqueueChapterJob({ projectId: "project_1", chapterId: "chapter_2", sourceHash: "future_next_run", priority: 8, eligibleAt: now, nextRunAt: later, now });
    const runnable = repo.enqueueChapterJob({ projectId: "project_1", chapterId: "chapter_3", sourceHash: "ready", priority: 1, eligibleAt: now, now });

    expect(repo.peekNextRelationshipJob("project_1", now)?.id).toBe(runnable.id);
    const claimed = repo.claimNextRelationshipJob("project_1", now);

    expect(claimed).toMatchObject({
      id: runnable.id,
      status: "running",
      attemptCount: 1,
      startedAt: now
    });

    db.close();
  });

  it("replaces a chapter extraction transactionally and preserves LLM relationship data", () => {
    const db = createTestDb();
    const repo = new RelationshipIndexRepository(db);

    repo.replaceChapterExtraction({
      projectId: "project_1",
      chapterId: "chapter_1",
      chapterTitle: "第1章 雾起",
      chapterOrder: 1,
      sourceHash: "hash_old",
      payload: extractionPayload("旧契约"),
      tokenCount: 512,
      stableAfterMs: 3600000,
      extractorVersion: "relationship-index-v1",
      indexedAt: now,
      now
    });
    repo.replaceChapterExtraction({
      projectId: "project_1",
      chapterId: "chapter_1",
      chapterTitle: "第1章 雾起",
      chapterOrder: 1,
      sourceHash: "hash_new",
      payload: extractionPayload("契约同行者"),
      tokenCount: 640,
      stableAfterMs: 3600000,
      extractorVersion: "relationship-index-v1",
      indexedAt: later,
      now: later
    });

    const entities = repo.listEntities("project_1");
    const mentions = repo.listMentions("project_1");
    const chapterState = repo.getChapterIndexState("project_1", "chapter_1");

    expect(entities.map((entity) => [entity.canonicalName, entity.entityKind])).toEqual(
      expect.arrayContaining([
        ["林砚", "person"],
        ["雾灵", "nonhuman"]
      ])
    );
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatchObject({
      sourceHash: "hash_new",
      baseRelationLabel: "契约同行者",
      plotRelationLabel: "隐瞒关键代价",
      primaryDimensionName: "灵魂契约",
      semanticMarkers: ["隐瞒", "契约"],
      direction: "source_to_target",
      polarity: "mixed",
      intensity: 0.7,
      confidence: 0.82
    });
    expect(mentions[0]?.relationshipDimensions).toEqual([
      { name: "灵魂契约", description: "人与非人实体之间的绑定", confidence: 0.8 },
      { name: "信息差", description: "一方知道另一方暂时不知道的信息", confidence: 0.6 }
    ]);
    expect(chapterState).toMatchObject({
      status: "ready",
      contentHash: "hash_new",
      tokenCount: 640,
      indexedAt: later
    });

    db.close();
  });

  it("summarizes index status counts", () => {
    const db = createTestDb();
    const repo = new RelationshipIndexRepository(db);

    for (const [status, chapterId, order] of [
      ["ready", "chapter_1", 1],
      ["queued", "chapter_2", 2],
      ["failed", "chapter_3", 3]
    ] as const) {
      repo.markChapterWaitingStable({
        projectId: "project_1",
        chapterId,
        chapterTitle: `第${order}章`,
        chapterOrder: order,
        contentHash: `hash_${order}`,
        stableAfterMs: 3600000,
        extractorVersion: "relationship-index-v1",
        eligibleAt: now,
        now
      });
      db.prepare("UPDATE relationship_index_chapters SET status = ? WHERE project_id = ? AND chapter_id = ?").run(status, "project_1", chapterId);
    }

    expect(repo.getIndexStatus("project_1")).toEqual({
      ready: 1,
      stale: 0,
      waitingStable: 0,
      queued: 1,
      running: 0,
      failed: 1,
      skippedTooShort: 0,
      total: 3
    });

    db.close();
  });
});
