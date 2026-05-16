import { createId } from "../../shared/ids";
import type { RelationshipEntityImportance, RelationshipEntityKind } from "../../shared/relationship-graph";
import type { SqliteDatabase } from "../database";

export type AuthorRelationshipCharacterRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly aliases: readonly string[];
  readonly entityKind: RelationshipEntityKind;
  readonly importance: RelationshipEntityImportance;
  readonly roleSummary: string | null;
  readonly faction: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AuthorRelationshipRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly sourceCharacterId: string;
  readonly targetCharacterId: string;
  readonly sourceToTargetLabel: string;
  readonly targetToSourceLabel: string | null;
  readonly normalizedRelationKey: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AuthorRelationshipCreateInput = {
  readonly projectId: string;
  readonly sourceCharacterName: string;
  readonly targetCharacterName: string;
  readonly sourceToTargetLabel: string;
  readonly targetToSourceLabel?: string | null;
};

export type AuthorRelationshipCharacterCreateInput = {
  readonly projectId: string;
  readonly name: string;
};

export type AuthorRelationshipCharacterUpdateInput = {
  readonly projectId: string;
  readonly characterId: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly entityKind: RelationshipEntityKind;
  readonly importance: RelationshipEntityImportance;
  readonly roleSummary?: string | null;
  readonly faction?: string | null;
  readonly notes?: string | null;
};

export type AuthorRelationshipCreateResult = {
  readonly relationship: AuthorRelationshipRecord;
  readonly sourceCharacter: AuthorRelationshipCharacterRecord;
  readonly targetCharacter: AuthorRelationshipCharacterRecord;
};

type AuthorRelationshipCharacterRow = {
  readonly id: string;
  readonly project_id: string;
  readonly name: string;
  readonly normalized_name: string;
  readonly aliases_json: string;
  readonly entity_kind: string;
  readonly importance: string;
  readonly role_summary: string | null;
  readonly faction: string | null;
  readonly notes: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

type AuthorRelationshipRow = {
  readonly id: string;
  readonly project_id: string;
  readonly source_character_id: string;
  readonly target_character_id: string;
  readonly source_to_target_label: string;
  readonly target_to_source_label: string | null;
  readonly normalized_relation_key: string;
  readonly created_at: string;
  readonly updated_at: string;
};

type DeleteRelationshipInput = {
  readonly projectId: string;
  readonly relationshipId: string;
};

type DeleteCharacterInput = {
  readonly projectId: string;
  readonly characterId: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeComparable(value: string): string {
  return normalizeText(value).toLocaleLowerCase("zh-CN");
}

function parseAliases(value: string): readonly string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((alias): alias is string => typeof alias === "string");
}

function normalizeAliases(aliases: readonly string[]): readonly string[] {
  const normalizedAliases: string[] = [];
  const seen = new Set<string>();
  for (const alias of aliases) {
    const normalized = normalizeText(alias);
    if (!normalized) {
      continue;
    }
    const comparable = normalizeComparable(normalized);
    if (seen.has(comparable)) {
      continue;
    }
    seen.add(comparable);
    normalizedAliases.push(normalized);
  }
  return normalizedAliases.slice(0, 20);
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const normalized = normalizeText(value);
  return normalized ? normalized : null;
}

function relationshipEntityKind(value: string): RelationshipEntityKind {
  if (value === "person" || value === "nonhuman" || value === "group" || value === "identity" || value === "unknown") {
    return value;
  }
  return "person";
}

function relationshipEntityImportance(value: string): RelationshipEntityImportance {
  if (value === "main" || value === "supporting" || value === "minor" || value === "unknown") {
    return value;
  }
  return "supporting";
}

function mapCharacter(row: AuthorRelationshipCharacterRow): AuthorRelationshipCharacterRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    normalizedName: row.normalized_name,
    aliases: parseAliases(row.aliases_json),
    entityKind: relationshipEntityKind(row.entity_kind),
    importance: relationshipEntityImportance(row.importance),
    roleSummary: row.role_summary,
    faction: row.faction,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRelationship(row: AuthorRelationshipRow): AuthorRelationshipRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceCharacterId: row.source_character_id,
    targetCharacterId: row.target_character_id,
    sourceToTargetLabel: row.source_to_target_label,
    targetToSourceLabel: row.target_to_source_label,
    normalizedRelationKey: row.normalized_relation_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeOptionalLabel(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function buildNormalizedRelationKey(input: {
  readonly sourceCharacterId: string;
  readonly targetCharacterId: string;
  readonly sourceToTargetLabel: string;
  readonly targetToSourceLabel: string | null;
}): string {
  const sortedIds = [input.sourceCharacterId, input.targetCharacterId].sort((left, right) => left.localeCompare(right));
  const leftId = sortedIds[0];
  const rightId = sortedIds[1];
  const normalizedForwardLabel = normalizeComparable(input.sourceToTargetLabel);
  const normalizedReverseLabel = input.targetToSourceLabel ? normalizeComparable(input.targetToSourceLabel) : "";
  const leftToRightLabel = input.sourceCharacterId === leftId ? normalizedForwardLabel : normalizedReverseLabel;
  const rightToLeftLabel = input.sourceCharacterId === leftId ? normalizedReverseLabel : normalizedForwardLabel;

  return `${leftId}|${rightId}|${leftToRightLabel}|${rightToLeftLabel}`;
}

function isUniqueRelationshipError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed: author_relationships.project_id");
}

export class AuthorRelationshipRepository {
  constructor(private readonly db: SqliteDatabase) {}

  createCharacter(input: AuthorRelationshipCharacterCreateInput): AuthorRelationshipCharacterRecord {
    const name = normalizeText(input.name);
    if (!name) {
      throw new Error("人物名称不能为空。");
    }
    return this.getOrCreateCharacter(input.projectId, name);
  }

  updateCharacter(input: AuthorRelationshipCharacterUpdateInput): AuthorRelationshipCharacterRecord {
    const name = normalizeText(input.name);
    if (!name) {
      throw new Error("人物名称不能为空。");
    }
    const normalizedName = normalizeComparable(name);
    const existing = this.findCharacterByNormalizedName(input.projectId, normalizedName);
    if (existing && existing.id !== input.characterId) {
      throw new Error("作者人物名称已存在。");
    }
    const updatedAt = nowIso();
    const result = this.db
      .prepare(
        `UPDATE author_relationship_characters
         SET name = ?,
             normalized_name = ?,
             aliases_json = ?,
             entity_kind = ?,
             importance = ?,
             role_summary = ?,
             faction = ?,
             notes = ?,
             updated_at = ?
         WHERE project_id = ? AND id = ?`
      )
      .run(
        name,
        normalizedName,
        JSON.stringify(normalizeAliases(input.aliases).filter((alias) => normalizeComparable(alias) !== normalizedName)),
        input.entityKind,
        input.importance,
        normalizeNullableText(input.roleSummary),
        normalizeNullableText(input.faction),
        normalizeNullableText(input.notes),
        updatedAt,
        input.projectId,
        input.characterId
      );

    if (result.changes === 0) {
      throw new Error("作者人物不存在。");
    }
    return this.findCharacterById(input.projectId, input.characterId);
  }

  createRelationship(input: AuthorRelationshipCreateInput): AuthorRelationshipCreateResult {
    const transaction = this.db.transaction(() => {
      const sourceName = normalizeText(input.sourceCharacterName);
      const targetName = normalizeText(input.targetCharacterName);
      const sourceToTargetLabel = normalizeText(input.sourceToTargetLabel);
      const targetToSourceLabel = normalizeOptionalLabel(input.targetToSourceLabel);

      if (!sourceName || !targetName) {
        throw new Error("人物名称不能为空。");
      }
      if (!sourceToTargetLabel) {
        throw new Error("关系名称不能为空。");
      }
      if (normalizeComparable(sourceName) === normalizeComparable(targetName)) {
        throw new Error("关系两端不能是同一个人物。");
      }

      const sourceCharacter = this.getOrCreateCharacter(input.projectId, sourceName);
      const targetCharacter = this.getOrCreateCharacter(input.projectId, targetName);
      const createdAt = nowIso();
      const relationshipId = createId("author_relationship");
      const normalizedRelationKey = buildNormalizedRelationKey({
        sourceCharacterId: sourceCharacter.id,
        targetCharacterId: targetCharacter.id,
        sourceToTargetLabel,
        targetToSourceLabel
      });

      try {
        this.db
          .prepare(
            `INSERT INTO author_relationships (
              id, project_id, source_character_id, target_character_id,
              source_to_target_label, target_to_source_label, normalized_relation_key,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            relationshipId,
            input.projectId,
            sourceCharacter.id,
            targetCharacter.id,
            sourceToTargetLabel,
            targetToSourceLabel,
            normalizedRelationKey,
            createdAt,
            createdAt
          );
      } catch (error) {
        if (isUniqueRelationshipError(error)) {
          throw new Error("这条作者关系已经存在。");
        }
        throw error;
      }

      return {
        relationship: this.findRelationshipByProjectAndId(input.projectId, relationshipId),
        sourceCharacter,
        targetCharacter
      };
    });

    return transaction();
  }

  listCharacters(projectId: string): AuthorRelationshipCharacterRecord[] {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM author_relationship_characters
         WHERE project_id = ?
         ORDER BY updated_at DESC, rowid DESC`
      )
      .all(projectId) as AuthorRelationshipCharacterRow[];

    return rows.map(mapCharacter);
  }

  listRelationships(projectId: string): AuthorRelationshipRecord[] {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM author_relationships
         WHERE project_id = ?
         ORDER BY updated_at DESC, rowid DESC`
      )
      .all(projectId) as AuthorRelationshipRow[];

    return rows.map(mapRelationship);
  }

  deleteRelationship(input: DeleteRelationshipInput): void {
    const result = this.db
      .prepare("DELETE FROM author_relationships WHERE project_id = ? AND id = ?")
      .run(input.projectId, input.relationshipId);
    if (result.changes === 0) {
      throw new Error("作者关系不存在。");
    }
  }

  deleteCharacter(input: DeleteCharacterInput): void {
    const result = this.db
      .prepare("DELETE FROM author_relationship_characters WHERE project_id = ? AND id = ?")
      .run(input.projectId, input.characterId);
    if (result.changes === 0) {
      throw new Error("作者人物不存在。");
    }
  }

  private getOrCreateCharacter(projectId: string, name: string): AuthorRelationshipCharacterRecord {
    const normalizedName = normalizeComparable(name);
    const existing = this.findCharacterByNormalizedName(projectId, normalizedName);
    if (existing) {
      return existing;
    }

    const createdAt = nowIso();
    const id = createId("author_character");
    this.db
      .prepare(
        `INSERT INTO author_relationship_characters (
          id, project_id, name, normalized_name, aliases_json, entity_kind, importance, role_summary, faction, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, projectId, name, normalizedName, JSON.stringify([]), "person", "supporting", null, null, null, createdAt, createdAt);

    return this.findCharacterByNormalizedName(projectId, normalizedName) ?? this.findCharacterById(projectId, id);
  }

  private findCharacterByNormalizedName(projectId: string, normalizedName: string): AuthorRelationshipCharacterRecord | null {
    const row = this.db
      .prepare("SELECT * FROM author_relationship_characters WHERE project_id = ? AND normalized_name = ?")
      .get(projectId, normalizedName) as AuthorRelationshipCharacterRow | undefined;
    return row ? mapCharacter(row) : null;
  }

  private findCharacterById(projectId: string, characterId: string): AuthorRelationshipCharacterRecord {
    const row = this.db
      .prepare("SELECT * FROM author_relationship_characters WHERE project_id = ? AND id = ?")
      .get(projectId, characterId) as AuthorRelationshipCharacterRow | undefined;
    if (!row) {
      throw new Error("作者人物不存在。");
    }
    return mapCharacter(row);
  }

  private findRelationshipByProjectAndId(projectId: string, relationshipId: string): AuthorRelationshipRecord {
    const row = this.db
      .prepare("SELECT * FROM author_relationships WHERE project_id = ? AND id = ?")
      .get(projectId, relationshipId) as AuthorRelationshipRow | undefined;
    if (!row) {
      throw new Error("作者关系不存在。");
    }
    return mapRelationship(row);
  }
}
