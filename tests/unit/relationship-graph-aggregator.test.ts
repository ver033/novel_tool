import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { SummaryRepository } from "../../src/main/db/repositories/summary-repo";
import { SummaryRelationshipGraphAggregator } from "../../src/main/relationships/relationship-graph-aggregator";
import type { BookAiSummaryPayload } from "../../src/main/shared/summary-index";
import { arcIndexPayloadV2, bookIndexPayloadV2 } from "../helpers/summary-index-fixtures";

const tempDirs: string[] = [];
const now = "2026-05-01T00:00:00.000Z";

function createDb(): SqliteDatabase {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-relationship-graph-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "novel-tool.sqlite3"));
  runMigrations(db);
  new ProjectRepository(db).create({
    id: "project_1",
    name: "关系图测试",
    rootPath: null,
    createdAt: now,
    updatedAt: now
  });
  return db;
}

function createChapter(repo: ChapterRepository, chapterId: string, title: string, sortOrder: number): void {
  repo.create({
    id: chapterId,
    projectId: "project_1",
    title,
    volumeTitle: "第一卷",
    sortOrder,
    contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `${title}正文` }] }] },
    plainText: `${title}正文`,
    wordCount: 4,
    dailyWordCount: 0,
    dailyWordCountDate: null,
    targetWordCount: null,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    contentUpdatedAt: now
  });
}

function relationshipBookPayload(): BookAiSummaryPayload {
  return {
    ...bookIndexPayloadV2(),
    人物关系图谱: {
      版本: "summary-relationship-v1",
      生成来源: {
        arcSummaryIds: ["arc_1"],
        chapterRange: { start: 1, end: 2 }
      },
      人物: [
        {
          id: "character-linyuan",
          name: "林远",
          aliases: ["主角"],
          mentionForms: ["林远", "他"],
          roleHints: ["追查旧信的人"],
          importance: "major",
          firstSeenChapter: 1,
          lastSeenChapter: 2,
          chapterActivity: [
            { chapterNumber: 1, weight: 1, relationEventCount: 1 },
            { chapterNumber: 2, weight: 1, relationEventCount: 1 }
          ],
          confidence: 0.96,
          sourceArcRanges: [{ start: 1, end: 2 }]
        },
        {
          id: "character-jiuyou",
          name: "旧友",
          aliases: [],
          mentionForms: ["旧友"],
          roleHints: ["提供线索的人"],
          importance: "supporting",
          firstSeenChapter: 2,
          lastSeenChapter: 2,
          chapterActivity: [{ chapterNumber: 2, weight: 0.7, relationEventCount: 1 }],
          confidence: 0.82,
          sourceArcRanges: [{ start: 1, end: 2 }]
        }
      ],
      关系: [
        {
          id: "relation-linyuan-jiuyou",
          sourceId: "character-linyuan",
          targetId: "character-jiuyou",
          primaryLabel: "旧友",
          category: "基础关系",
          polarity: "positive",
          directed: false,
          stable: true,
          labels: [
            {
              label: "旧友",
              firstSeenChapter: 1,
              lastSeenChapter: 2,
              confidence: 0.86
            }
          ],
          evidence: [
            {
              chapterNumber: 2,
              arcRange: "1-2",
              text: "林远与旧友重新联系。",
              reason: "阶段摘要确认旧友关系重新进入剧情"
            }
          ]
        }
      ],
      阶段索引: [
        {
          arcKey: "auto:001-002",
          startChapter: 1,
          endChapter: 2,
          characterIds: ["character-linyuan", "character-jiuyou"],
          relationIds: ["relation-linyuan-jiuyou"]
        }
      ],
      未确认称谓: [],
      图谱摘要: "林远与旧友的基础关系重新进入主线。",
      质量提示: []
    }
  };
}

function seedReadyGraph(db: SqliteDatabase): { readonly summaryRepo: SummaryRepository; readonly chapterRepo: ChapterRepository } {
  const chapterRepo = new ChapterRepository(db);
  const summaryRepo = new SummaryRepository(db);
  createChapter(chapterRepo, "chapter_1", "第1章", 0);
  createChapter(chapterRepo, "chapter_2", "第2章", 1);
  summaryRepo.upsertArcSummary({
    id: "arc_1",
    projectId: "project_1",
    arcKey: "auto:001-002",
    chapterFrom: 1,
    chapterTo: 2,
    sourceHash: "arc_hash",
    summary: "林远开始追查旧信。",
    structured: {
      ...arcIndexPayloadV2(),
      人物图谱: {
        版本: "summary-relationship-v1",
        阶段范围: {
          起始章节号: 1,
          结束章节号: 2,
          起始章节标题: "第1章",
          结束章节标题: "第2章"
        },
        人物归一: [],
        称谓待确认: [],
        基础关系: [],
        剧情关系: [],
        阶段关系摘要: "林远与旧友关系重新进入剧情。",
        质量提示: []
      }
    },
    status: "ready",
    error: null,
    createdAt: now,
    updatedAt: now
  });
  summaryRepo.upsertBookSummary({
    id: "book_1",
    projectId: "project_1",
    sourceHash: "book_hash",
    summaryShort: "林远追查旧信。",
    summaryLong: "林远回到旧城后与旧友重新联系，旧信推动主线。",
    structured: relationshipBookPayload(),
    status: "ready",
    error: null,
    createdAt: now,
    updatedAt: now
  });
  return { summaryRepo, chapterRepo };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("SummaryRelationshipGraphAggregator", () => {
  it("builds graph nodes and edges from the book summary relationship graph", () => {
    const db = createDb();
    const { summaryRepo, chapterRepo } = seedReadyGraph(db);
    const graph = new SummaryRelationshipGraphAggregator(summaryRepo, chapterRepo).getGraph({
      projectId: "project_1",
      roleScope: "all",
      chapterCursor: "all"
    });

    expect(graph.sourceStatus.state).toBe("ready");
    expect(graph.nodes.map((node) => node.name)).toEqual(["林远", "旧友"]);
    expect(graph.edges).toMatchObject([
      {
        sourceName: "林远",
        targetName: "旧友",
        baseRelationLabel: "旧友",
        primaryDimensionName: "基础关系",
        evidenceSources: ["summary_book"]
      }
    ]);
    expect(graph.availableChapters.map((chapter) => chapter.status)).toEqual(["ready", "ready"]);
    db.close();
  });

  it("reports missing book graph fields without falling back to old per-chapter indexes", () => {
    const db = createDb();
    const chapterRepo = new ChapterRepository(db);
    const summaryRepo = new SummaryRepository(db);
    createChapter(chapterRepo, "chapter_1", "第1章", 0);
    summaryRepo.upsertArcSummary({
      id: "arc_1",
      projectId: "project_1",
      arcKey: "auto:001-001",
      chapterFrom: 1,
      chapterTo: 1,
      sourceHash: "arc_hash",
      summary: "阶段摘要。",
      structured: {
        ...arcIndexPayloadV2(),
        人物图谱: {
          版本: "summary-relationship-v1",
          阶段范围: { 起始章节号: 1, 结束章节号: 1 },
          人物归一: [],
          称谓待确认: [],
          基础关系: [],
          剧情关系: [],
          阶段关系摘要: "暂无关系。",
          质量提示: []
        }
      },
      status: "ready",
      error: null,
      createdAt: now,
      updatedAt: now
    });
    summaryRepo.upsertBookSummary({
      id: "book_1",
      projectId: "project_1",
      sourceHash: "book_hash",
      summaryShort: "短摘要",
      summaryLong: "长摘要",
      structured: bookIndexPayloadV2(),
      status: "ready",
      error: null,
      createdAt: now,
      updatedAt: now
    });

    const status = new SummaryRelationshipGraphAggregator(summaryRepo, chapterRepo).getSourceStatus("project_1");

    expect(status).toMatchObject({
      state: "needs_book_graph_fields",
      nodeCount: 0,
      edgeCount: 0,
      bookSummary: {
        exists: true,
        hasRelationshipGraph: false,
        failed: false
      }
    });
    db.close();
  });

  it("reports failed arc and book summary jobs as relationship graph source failures", () => {
    const db = createDb();
    const chapterRepo = new ChapterRepository(db);
    const summaryRepo = new SummaryRepository(db);
    createChapter(chapterRepo, "chapter_1", "第1章", 0);
    const arcJob = summaryRepo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "arc_summary",
      targetId: "auto:001-001",
      sourceHash: "arc_hash",
      priority: 6,
      now
    });
    const runningArc = summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:01:00.000Z");
    summaryRepo.failSummaryJob(runningArc?.id ?? arcJob.id, "阶段摘要结构无效", null, "2026-05-01T00:02:00.000Z");
    const bookJob = summaryRepo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "book_summary",
      targetId: null,
      sourceHash: "book_hash",
      priority: 4,
      now: "2026-05-01T00:03:00.000Z"
    });
    const runningBook = summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:04:00.000Z");
    summaryRepo.failSummaryJob(runningBook?.id ?? bookJob.id, "全书摘要被截断", null, "2026-05-01T00:05:00.000Z");

    const status = new SummaryRelationshipGraphAggregator(summaryRepo, chapterRepo).getSourceStatus("project_1");

    expect(status).toMatchObject({
      state: "failed",
      arcSummary: {
        failed: 1
      },
      bookSummary: {
        failed: true
      },
      latestFailure: "全书摘要被截断"
    });
    db.close();
  });
});
