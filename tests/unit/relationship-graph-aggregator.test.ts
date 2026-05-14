import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { RelationshipIndexRepository } from "../../src/main/db/repositories/relationship-index-repo";
import { RelationshipGraphAggregator } from "../../src/main/relationships/relationship-graph-aggregator";
import { parseRelationshipExtractionPayload, type RelationshipEntityImportance } from "../../src/main/shared/relationship-index";

const tempDirs: string[] = [];
const now = "2026-05-13T01:00:00.000Z";

function createTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-relationship-aggregator-"));
  tempDirs.push(dir);
  return join(dir, "novel-tool.sqlite3");
}

function createTestDb(): SqliteDatabase {
  const db = createDatabase(createTempDbPath());
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run("project_1", "关系图聚合测试", now, now);
  for (let order = 1; order <= 140; order += 1) {
    db.prepare(
      `INSERT INTO chapters
       (id, project_id, title, sort_order, content_json, plain_text, word_count, daily_word_count, created_at, updated_at, content_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `chapter_${order}`,
      "project_1",
      `第${order}章`,
      order - 1,
      JSON.stringify({ type: "doc", content: [] }),
      "正文",
      2,
      0,
      now,
      now,
      now
    );
  }
  return db;
}

type CharacterSeed = {
  readonly name: string;
  readonly importance?: RelationshipEntityImportance;
  readonly entityKind?: "person" | "nonhuman" | "group" | "identity" | "unknown";
};

type MentionSeed = {
  readonly source: string;
  readonly target: string;
  readonly base: string;
  readonly plot: string;
  readonly dimensions?: readonly string[];
  readonly primary?: string;
  readonly confidence?: number;
  readonly intensity?: number;
  readonly uncertainty?: string;
};

function seedChapter(
  repo: RelationshipIndexRepository,
  input: {
    readonly chapterOrder: number;
    readonly characters: readonly CharacterSeed[];
    readonly mentions: readonly MentionSeed[];
  }
): void {
  const payload = parseRelationshipExtractionPayload({
    索引信息: {
      缓存版本: "关系索引一",
      章节序号: input.chapterOrder,
      章节标题: `第${input.chapterOrder}章`,
      语言: "简体中文"
    },
    人物: input.characters.map((character) => ({
      姓名: character.name,
      别名: [],
      实体类型: character.entityKind ?? "person",
      重要程度: character.importance ?? "unknown",
      身份摘要: `${character.name}的缓存身份`,
      阵营: "",
      置信度: 0.9,
      证据短句: [`${character.name}出现`]
    })),
    关系事件: input.mentions.map((mention) => {
      const dimensions = mention.dimensions ?? ["动态维度"];
      return {
        主体: mention.source,
        客体: mention.target,
        关系维度: dimensions.map((name, index) => ({ 名称: name, 说明: `${name}说明${index + 1}`, 置信度: 0.7 + index * 0.05 })),
        主维度: mention.primary ?? dimensions[0],
        基础关系: { 名称: mention.base, 说明: `${mention.base}稳定层` },
        剧情关系: { 名称: mention.plot, 说明: `${mention.plot}阶段层` },
        语义标记: ["模型语义标记"],
        方向: "source_to_target",
        极性: "mixed",
        强度: mention.intensity ?? 0.7,
        本章变化: `${mention.source}与${mention.target}在本章变化`,
        开始状态: "未明确",
        结束状态: mention.plot,
        变化原因: "正文推进",
        证据短句: `${mention.source}看向${mention.target}`,
        置信度: mention.confidence ?? 0.8,
        不确定说明: mention.uncertainty ?? ""
      };
    }),
    不确定项: []
  });

  repo.replaceChapterExtraction({
    projectId: "project_1",
    chapterId: `chapter_${input.chapterOrder}`,
    chapterTitle: `第${input.chapterOrder}章`,
    chapterOrder: input.chapterOrder,
    sourceHash: `hash_${input.chapterOrder}`,
    payload,
    tokenCount: 100,
    stableAfterMs: 3600000,
    extractorVersion: "relationship-index-v1",
    indexedAt: now,
    now
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("RelationshipGraphAggregator", () => {
  it("applies role scopes and caps all-mode graph size", () => {
    const db = createTestDb();
    const repo = new RelationshipIndexRepository(db);
    const minorMentions: MentionSeed[] = [];
    const minorCharacters: CharacterSeed[] = [];
    for (let index = 0; index < 130; index += 1) {
      const name = `边缘人物${index}`;
      minorCharacters.push({ name, importance: "minor" });
      minorMentions.push({
        source: "林砚",
        target: name,
        base: `缓存基础关系${index}`,
        plot: `缓存剧情关系${index}`,
        confidence: 0.55,
        intensity: 0.4
      });
    }
    seedChapter(repo, {
      chapterOrder: 1,
      characters: [
        { name: "林砚", importance: "main" },
        { name: "雾灵", importance: "supporting", entityKind: "nonhuman" },
        { name: "路人甲", importance: "minor" },
        ...minorCharacters
      ],
      mentions: [
        { source: "林砚", target: "雾灵", base: "缓存稳定同路", plot: "缓存强互动", confidence: 0.9, intensity: 0.9 },
        { source: "路人甲", target: "林砚", base: "缓存擦肩", plot: "缓存弱互动", confidence: 0.4, intensity: 0.2 },
        ...minorMentions
      ]
    });
    const aggregator = new RelationshipGraphAggregator(repo);

    const mainGraph = aggregator.getGraph({ projectId: "project_1", roleScope: "main" });
    expect(mainGraph.nodes.map((node) => node.name)).toEqual(expect.arrayContaining(["林砚", "雾灵"]));
    expect(mainGraph.nodes.map((node) => node.name)).not.toContain("路人甲");

    const supportingGraph = aggregator.getGraph({ projectId: "project_1", roleScope: "supporting" });
    expect(supportingGraph.nodes.map((node) => node.name)).toEqual(expect.arrayContaining(["林砚", "雾灵"]));
    expect(supportingGraph.nodes.map((node) => node.name)).not.toContain("路人甲");

    const allGraph = aggregator.getGraph({ projectId: "project_1", roleScope: "all" });
    expect(allGraph.truncated).toBe(true);
    expect(allGraph.nodes.length).toBeLessThanOrEqual(120);

    db.close();
  });

  it("builds focus one-hop and two-hop graphs from cached mentions only", () => {
    const db = createTestDb();
    const repo = new RelationshipIndexRepository(db);
    seedChapter(repo, {
      chapterOrder: 1,
      characters: [
        { name: "林砚", importance: "main" },
        { name: "雾灵", importance: "supporting" },
        { name: "沈照", importance: "supporting" }
      ],
      mentions: [
        { source: "林砚", target: "雾灵", base: "缓存同行", plot: "缓存互疑" },
        { source: "雾灵", target: "沈照", base: "缓存旧识", plot: "缓存试探" }
      ]
    });
    const aggregator = new RelationshipGraphAggregator(repo);

    const oneHop = aggregator.getGraph({ projectId: "project_1", mode: "focus", focusName: "林砚", hopDepth: 1, roleScope: "all" });
    expect(oneHop.nodes.map((node) => node.name).sort()).toEqual(["林砚", "雾灵"]);

    const twoHop = aggregator.getGraph({ projectId: "project_1", mode: "focus", focusName: "林砚", hopDepth: 2, roleScope: "all" });
    expect(twoHop.nodes.map((node) => node.name).sort()).toEqual(["林砚", "沈照", "雾灵"]);

    db.close();
  });

  it("resolves chapter cursor state, dynamic dimensions, timeline, and uncertain filtering", () => {
    const db = createTestDb();
    const repo = new RelationshipIndexRepository(db);
    seedChapter(repo, {
      chapterOrder: 1,
      characters: [
        { name: "林砚", importance: "main" },
        { name: "雾灵", importance: "supporting", entityKind: "nonhuman" }
      ],
      mentions: [
        {
          source: "林砚",
          target: "雾灵",
          base: "缓存稳定同路",
          plot: "第一阶段互相试探",
          dimensions: ["契约张力", "信息差"],
          primary: "信息差"
        }
      ]
    });
    seedChapter(repo, {
      chapterOrder: 12,
      characters: [
        { name: "林砚", importance: "main" },
        { name: "雾灵", importance: "supporting", entityKind: "nonhuman" }
      ],
      mentions: [
        {
          source: "林砚",
          target: "雾灵",
          base: "缓存稳定同路",
          plot: "第十二章临时结盟",
          dimensions: ["契约张力", "共同风险"],
          primary: "共同风险",
          confidence: 0.95
        }
      ]
    });
    seedChapter(repo, {
      chapterOrder: 13,
      characters: [
        { name: "林砚", importance: "main" },
        { name: "雾灵", importance: "supporting", entityKind: "nonhuman" }
      ],
      mentions: [
        {
          source: "林砚",
          target: "雾灵",
          base: "缓存稳定同路",
          plot: "第十三章疑似背离",
          dimensions: ["不确定动机"],
          primary: "不确定动机",
          uncertainty: "正文没有确认是否真的背离"
        }
      ]
    });
    const aggregator = new RelationshipGraphAggregator(repo);

    const graphAt12 = aggregator.getGraph({ projectId: "project_1", chapterCursor: 12, roleScope: "all" });
    expect(graphAt12.indexStatus.total).toBe(3);
    expect(graphAt12.graphStats.usedMentionCount).toBe(2);
    expect(graphAt12.availableChapters.map((chapter) => chapter.chapterOrder)).toEqual([1, 12, 13]);
    expect(graphAt12.relationshipDimensions.map((dimension) => dimension.name)).toEqual(expect.arrayContaining(["契约张力", "信息差", "共同风险"]));
    expect(graphAt12.relationshipDimensions.map((dimension) => dimension.name)).not.toContain("不确定动机");
    expect(graphAt12.edges[0]).toMatchObject({
      baseRelationLabel: "缓存稳定同路",
      plotRelationLabel: "第十二章临时结盟",
      plotRelationSummary: "第十二章临时结盟阶段层",
      primaryDimensionName: "共同风险",
      semanticMarkers: ["模型语义标记"]
    });
    expect(graphAt12.edges[0].relationshipDimensions.map((dimension) => dimension.name)).toEqual(expect.arrayContaining(["契约张力", "共同风险"]));
    expect(graphAt12.edges[0].timeline.map((stage) => stage.chapterOrder)).toEqual([1, 12]);

    const latestWithoutUncertain = aggregator.getGraph({ projectId: "project_1", chapterCursor: "all", roleScope: "all" });
    expect(latestWithoutUncertain.edges[0].plotRelationLabel).toBe("第十二章临时结盟");

    const latestWithUncertain = aggregator.getGraph({ projectId: "project_1", chapterCursor: "all", roleScope: "all", includeUncertain: true });
    expect(latestWithUncertain.edges[0].plotRelationLabel).toBe("第十三章疑似背离");
    expect(latestWithUncertain.relationshipDimensions.map((dimension) => dimension.name)).toContain("不确定动机");

    db.close();
  });

  it("keeps showing a partial cached graph when a non-adjacent chapter has no relationship cache yet", () => {
    const db = createTestDb();
    const repo = new RelationshipIndexRepository(db);
    seedChapter(repo, {
      chapterOrder: 1,
      characters: [
        { name: "白嘉轩", importance: "main" },
        { name: "鹿子霖", importance: "supporting" }
      ],
      mentions: [{ source: "白嘉轩", target: "鹿子霖", base: "同村宗族对照", plot: "暗中较劲", dimensions: ["乡约秩序"] }]
    });
    seedChapter(repo, {
      chapterOrder: 3,
      characters: [
        { name: "白嘉轩", importance: "main" },
        { name: "仙草", importance: "supporting" }
      ],
      mentions: [{ source: "白嘉轩", target: "仙草", base: "家庭共同体", plot: "共同承担家事", dimensions: ["家庭结构"] }]
    });
    db.prepare("DELETE FROM relationship_mentions WHERE project_id = ? AND chapter_id = ?").run("project_1", "chapter_3");
    db.prepare("DELETE FROM relationship_index_chapters WHERE project_id = ? AND chapter_id = ?").run("project_1", "chapter_3");
    const aggregator = new RelationshipGraphAggregator(repo);

    const graph = aggregator.getGraph({ projectId: "project_1", chapterCursor: "all", roleScope: "all" });

    expect(graph.nodes.map((node) => node.name)).toEqual(expect.arrayContaining(["白嘉轩", "鹿子霖"]));
    expect(graph.nodes.map((node) => node.name)).not.toContain("仙草");
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      baseRelationLabel: "同村宗族对照",
      plotRelationLabel: "暗中较劲"
    });
    expect(graph.availableChapters.map((chapter) => chapter.chapterOrder)).toEqual([1]);
    expect(graph.indexStatus).toMatchObject({ ready: 1, total: 1 });

    db.close();
  });

  it("excludes relationship mentions whose source hash no longer matches a ready relationship chapter", () => {
    const db = createTestDb();
    const repo = new RelationshipIndexRepository(db);
    seedChapter(repo, {
      chapterOrder: 1,
      characters: [
        { name: "白嘉轩", importance: "main" },
        { name: "白孝文", importance: "supporting" }
      ],
      mentions: [{ source: "白嘉轩", target: "白孝文", base: "父子", plot: "管束", dimensions: ["家庭结构"] }]
    });
    repo.markChapterStale({
      projectId: "project_1",
      chapterId: "chapter_1",
      chapterTitle: "第1章",
      chapterOrder: 1,
      contentHash: "new_hash",
      extractorVersion: "chapter-summary-v3-lite-relationship-index",
      now
    });

    const graph = new RelationshipGraphAggregator(repo).getGraph({ projectId: "project_1", roleScope: "all" });

    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.graphStats.usedMentionCount).toBe(0);
    expect(graph.indexStatus).toMatchObject({ stale: 1, total: 1 });

    db.close();
  });
});
