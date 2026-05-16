import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { AuthorRelationshipRepository } from "../../src/main/db/repositories/author-relationship-repo";

const tempDirs: string[] = [];

function createTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-author-relationships-"));
  tempDirs.push(dir);
  return join(dir, "novel-tool.sqlite3");
}

function createDb(): SqliteDatabase {
  const db = createDatabase(createTempDbPath());
  runMigrations(db);
  return db;
}

function seedProject(db: SqliteDatabase, projectId = "project_1"): void {
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    projectId,
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

describe("AuthorRelationshipRepository", () => {
  it("creates standalone author characters and reuses duplicate names", () => {
    const db = createDb();
    seedProject(db);
    const repo = new AuthorRelationshipRepository(db);

    const first = repo.createCharacter({ projectId: "project_1", name: " 白灵 " });
    const duplicate = repo.createCharacter({ projectId: "project_1", name: "白灵" });

    expect(first.name).toBe("白灵");
    expect(duplicate.id).toBe(first.id);
    expect(repo.listCharacters("project_1")).toHaveLength(1);

    db.close();
  });

  it("updates author character metadata used by the manual graph inspector", () => {
    const db = createDb();
    seedProject(db);
    const repo = new AuthorRelationshipRepository(db);
    const character = repo.createCharacter({ projectId: "project_1", name: " 白灵 " });

    const updated = repo.updateCharacter({
      projectId: "project_1",
      characterId: character.id,
      name: "白灵",
      aliases: ["白家姑娘", "灵灵", "白家姑娘"],
      entityKind: "person",
      importance: "main",
      roleSummary: "白家女儿，思想激进",
      faction: "白家",
      notes: "后续要重点处理与鹿兆海的关系。"
    });

    expect(updated).toMatchObject({
      id: character.id,
      name: "白灵",
      aliases: ["白家姑娘", "灵灵"],
      entityKind: "person",
      importance: "main",
      roleSummary: "白家女儿，思想激进",
      faction: "白家",
      notes: "后续要重点处理与鹿兆海的关系。"
    });

    db.close();
  });

  it("creates or reuses characters while storing an author-defined relationship", () => {
    const db = createDb();
    seedProject(db);
    const repo = new AuthorRelationshipRepository(db);

    const first = repo.createRelationship({
      projectId: "project_1",
      sourceCharacterName: " 白嘉轩 ",
      targetCharacterName: "黑娃",
      sourceToTargetLabel: "族长与晚辈",
      targetToSourceLabel: "晚辈与族长"
    });
    const second = repo.createRelationship({
      projectId: "project_1",
      sourceCharacterName: "白嘉轩",
      targetCharacterName: "鹿三",
      sourceToTargetLabel: "主家与长工",
      targetToSourceLabel: "长工与主家"
    });

    expect(first.sourceCharacter.name).toBe("白嘉轩");
    expect(first.targetCharacter.name).toBe("黑娃");
    expect(second.sourceCharacter.id).toBe(first.sourceCharacter.id);
    const characterNames = repo.listCharacters("project_1").map((character) => character.name);
    expect(characterNames).toHaveLength(3);
    expect(characterNames).toEqual(expect.arrayContaining(["白嘉轩", "黑娃", "鹿三"]));
    expect(repo.listRelationships("project_1")).toHaveLength(2);

    db.close();
  });

  it("rejects relationships that point to the same normalized character", () => {
    const db = createDb();
    seedProject(db);
    const repo = new AuthorRelationshipRepository(db);

    expect(() =>
      repo.createRelationship({
        projectId: "project_1",
        sourceCharacterName: "黑娃",
        targetCharacterName: " 黑娃 ",
        sourceToTargetLabel: "同一人"
      })
    ).toThrow("关系两端不能是同一个人物。");

    db.close();
  });

  it("rejects the same relationship entered from the reverse direction", () => {
    const db = createDb();
    seedProject(db);
    const repo = new AuthorRelationshipRepository(db);

    repo.createRelationship({
      projectId: "project_1",
      sourceCharacterName: "鹿三",
      targetCharacterName: "黑娃",
      sourceToTargetLabel: "父子",
      targetToSourceLabel: "儿子与父亲"
    });

    expect(() =>
      repo.createRelationship({
        projectId: "project_1",
        sourceCharacterName: "黑娃",
        targetCharacterName: "鹿三",
        sourceToTargetLabel: "儿子与父亲",
        targetToSourceLabel: "父子"
      })
    ).toThrow("这条作者关系已经存在。");

    db.close();
  });

  it("deletes relationships only inside the requested project", () => {
    const db = createDb();
    seedProject(db, "project_1");
    seedProject(db, "project_2");
    const repo = new AuthorRelationshipRepository(db);
    const relationship = repo.createRelationship({
      projectId: "project_1",
      sourceCharacterName: "白嘉轩",
      targetCharacterName: "仙草",
      sourceToTargetLabel: "夫妻",
      targetToSourceLabel: "夫妻"
    }).relationship;

    expect(() => repo.deleteRelationship({ projectId: "project_2", relationshipId: relationship.id })).toThrow("作者关系不存在。");
    expect(repo.listRelationships("project_1")).toHaveLength(1);

    repo.deleteRelationship({ projectId: "project_1", relationshipId: relationship.id });

    expect(repo.listRelationships("project_1")).toHaveLength(0);

    db.close();
  });

  it("deletes author characters inside the requested project and cascades their relationships", () => {
    const db = createDb();
    seedProject(db, "project_1");
    seedProject(db, "project_2");
    const repo = new AuthorRelationshipRepository(db);
    const relationship = repo.createRelationship({
      projectId: "project_1",
      sourceCharacterName: "白嘉轩",
      targetCharacterName: "鹿三",
      sourceToTargetLabel: "主家与长工"
    });

    expect(() => repo.deleteCharacter({ projectId: "project_2", characterId: relationship.sourceCharacter.id })).toThrow("作者人物不存在。");

    repo.deleteCharacter({ projectId: "project_1", characterId: relationship.sourceCharacter.id });

    expect(repo.listCharacters("project_1").map((character) => character.name)).toEqual(["鹿三"]);
    expect(repo.listRelationships("project_1")).toHaveLength(0);

    db.close();
  });
});
