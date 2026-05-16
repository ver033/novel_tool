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
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      id: expect.stringContaining("author_relationship:author_relationship_"),
      authorRelationshipId: expect.stringContaining("author_relationship_"),
      sourceName: "白嘉轩",
      targetName: "仙草",
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
});
