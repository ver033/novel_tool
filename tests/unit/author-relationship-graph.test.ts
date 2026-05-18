import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { AuthorRelationshipRepository } from "../../src/main/db/repositories/author-relationship-repo";
import { AuthorRelationshipGraphService } from "../../src/main/relationships/author-relationship-graph";

const tempDirs: string[] = [];

function createTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-author-relationship-graph-"));
  tempDirs.push(dir);
  return join(dir, "novel-tool.sqlite3");
}

function createDb(): SqliteDatabase {
  const db = createDatabase(createTempDbPath());
  runMigrations(db);
  return db;
}

function seedProject(db: SqliteDatabase): void {
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    "project_1",
    "白鹿原",
    "2026-05-16T00:00:00.000Z",
    "2026-05-16T00:00:00.000Z"
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("AuthorRelationshipGraphService", () => {
  it("maps author-defined characters and relationships into graph data without AI cache dependencies", () => {
    const db = createDb();
    seedProject(db);
    const repo = new AuthorRelationshipRepository(db);
    repo.createCharacter({ projectId: "project_1", name: "白灵" });
    const whiteJiaxuan = repo.createCharacter({ projectId: "project_1", name: "白嘉轩" });
    repo.updateCharacter({
      projectId: "project_1",
      characterId: whiteJiaxuan.id,
      name: "白嘉轩",
      aliases: ["族长", "白家掌柜"],
      entityKind: "person",
      importance: "main",
      roleSummary: "白鹿村白家族长",
      faction: "白家",
      notes: "手工设定：全书核心父权角色。"
    });
    repo.createRelationship({
      projectId: "project_1",
      sourceCharacterName: "白嘉轩",
      targetCharacterName: "仙草",
      sourceToTargetLabel: "夫妻",
      targetToSourceLabel: "夫妻"
    });
    const service = new AuthorRelationshipGraphService(repo);

    const graph = service.getGraph({ projectId: "project_1" }, "2026-05-16T00:10:00.000Z");

    expect(graph.sourceStatus.state).toBe("ready");
    expect(graph.sourceStatus.message).toContain("作者手工人物关系");
    expect(graph.nodes.map((node) => node.name)).toEqual(expect.arrayContaining(["白灵", "白嘉轩", "仙草"]));
    expect(graph.nodes.find((node) => node.name === "白嘉轩")).toMatchObject({
      aliases: ["族长", "白家掌柜"],
      importance: "main",
      roleSummary: "白鹿村白家族长",
      faction: "白家",
      authorNotes: "手工设定：全书核心父权角色。"
    });
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringContaining("author_relationship:author_relationship_"),
          authorRelationshipId: expect.stringContaining("author_relationship_"),
          sourceName: "白嘉轩",
          targetName: "仙草",
          baseRelationLabel: "夫妻",
          plotRelationLabel: ""
        }),
        expect.objectContaining({
          id: expect.stringContaining("author_relationship:author_relationship_"),
          authorRelationshipId: expect.stringContaining("author_relationship_"),
          sourceName: "仙草",
          targetName: "白嘉轩",
          baseRelationLabel: "夫妻",
          plotRelationLabel: ""
        })
      ])
    );
    expect(graph.edges[0]).toMatchObject({
      id: expect.stringContaining("author_relationship:author_relationship_"),
      authorRelationshipId: expect.stringContaining("author_relationship_"),
      baseRelationLabel: "夫妻",
      plotRelationLabel: ""
    });
    expect(graph.edges[0]?.timeline[0]?.chapterId).toContain("author:manual:author_relationship_");
    expect(graph.availableChapters).toEqual([]);
    expect(graph.generatedAt).toBe("2026-05-16T00:10:00.000Z");

    db.close();
  });

  it("supports focus mode around a selected author character", () => {
    const db = createDb();
    seedProject(db);
    const repo = new AuthorRelationshipRepository(db);
    repo.createCharacter({ projectId: "project_1", name: "白灵" });
    repo.createRelationship({
      projectId: "project_1",
      sourceCharacterName: "白嘉轩",
      targetCharacterName: "仙草",
      sourceToTargetLabel: "夫妻"
    });
    const service = new AuthorRelationshipGraphService(repo);

    const graph = service.getGraph({ projectId: "project_1", mode: "focus", focusName: "白嘉轩", hopDepth: 1 });

    expect(graph.mode).toBe("focus");
    expect(graph.nodes.map((node) => node.name).sort()).toEqual(["仙草", "白嘉轩"]);
    expect(graph.edges).toHaveLength(1);

    db.close();
  });

  it("renders reciprocal author labels as separate directed graph edges", () => {
    const db = createDb();
    seedProject(db);
    const repo = new AuthorRelationshipRepository(db);
    repo.createRelationship({
      projectId: "project_1",
      sourceCharacterName: "黑娃",
      targetCharacterName: "鹿三",
      sourceToTargetLabel: "儿子",
      targetToSourceLabel: "父亲"
    });
    const service = new AuthorRelationshipGraphService(repo);

    const graph = service.getGraph({ projectId: "project_1" });

    expect(graph.edges).toHaveLength(2);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringContaining(":source_to_target"),
          sourceName: "黑娃",
          targetName: "鹿三",
          baseRelationLabel: "儿子",
          baseRelationSourceToTargetLabel: "儿子",
          baseRelationTargetToSourceLabel: null,
          direction: "source_to_target"
        }),
        expect.objectContaining({
          id: expect.stringContaining(":target_to_source"),
          sourceName: "鹿三",
          targetName: "黑娃",
          baseRelationLabel: "父亲",
          baseRelationSourceToTargetLabel: "父亲",
          baseRelationTargetToSourceLabel: null,
          direction: "source_to_target"
        })
      ])
    );
    const forwardEdge = graph.edges.find((edge) => edge.sourceName === "黑娃" && edge.targetName === "鹿三");
    const reverseEdge = graph.edges.find((edge) => edge.sourceName === "鹿三" && edge.targetName === "黑娃");
    expect(forwardEdge).toMatchObject({
      sourceName: "黑娃",
      targetName: "鹿三",
      baseRelationLabel: "儿子",
      baseRelationSourceToTargetLabel: "儿子",
      baseRelationTargetToSourceLabel: null
    });
    expect(forwardEdge?.baseRelationSummary).toBe("黑娃 → 鹿三：儿子");
    expect(forwardEdge?.timeline[0]).toMatchObject({
      baseRelationLabel: "儿子",
      baseRelationSourceToTargetLabel: "儿子",
      baseRelationTargetToSourceLabel: null
    });
    expect(reverseEdge).toMatchObject({
      sourceName: "鹿三",
      targetName: "黑娃",
      baseRelationLabel: "父亲",
      baseRelationSourceToTargetLabel: "父亲",
      baseRelationTargetToSourceLabel: null
    });
    expect(reverseEdge?.baseRelationSummary).toBe("鹿三 → 黑娃：父亲");
    expect(reverseEdge?.timeline[0]).toMatchObject({
      baseRelationLabel: "父亲",
      baseRelationSourceToTargetLabel: "父亲",
      baseRelationTargetToSourceLabel: null
    });

    db.close();
  });

  it("persists author character layout positions for manual graph dragging", () => {
    const db = createDb();
    seedProject(db);
    const repo = new AuthorRelationshipRepository(db);
    const character = repo.createCharacter({ projectId: "project_1", name: "白嘉轩" });

    repo.updateCharacterLayout({
      projectId: "project_1",
      characterId: character.id,
      layoutPosition: { x: 128.5, y: -64.25 }
    });

    const graph = new AuthorRelationshipGraphService(new AuthorRelationshipRepository(db)).getGraph({ projectId: "project_1" });

    expect(graph.nodes.find((node) => node.id === character.id)).toMatchObject({
      name: "白嘉轩",
      layoutPosition: { x: 128.5, y: -64.25 }
    });
    db.close();
  });
});
