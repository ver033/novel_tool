import path from "node:path";
import { existsSync } from "node:fs";
import { createDatabase, type SqliteDatabase } from "../db/database";
import { runMigrations } from "../db/migrations";
import { ProjectRepository } from "../db/repositories/project-repo";
import type { ProjectRecord } from "../shared/types";
import { contentLanguageSchema, DEFAULT_CONTENT_LANGUAGE } from "../shared/language";

export const PROJECT_FILE_EXTENSION = ".noveltool";

export type ProjectFileSource = {
  readonly type: "txt";
  readonly path: string;
};

export type ProjectFileDocument = {
  readonly app: "novel-tool";
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly projectName: string;
  readonly source: ProjectFileSource | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type ProjectRow = {
  readonly id: string;
  readonly name: string;
  readonly root_path: string | null;
  readonly content_language: string;
  readonly created_at: string;
  readonly updated_at: string;
};

type SettingRow = {
  readonly value_json: string;
};

function sanitizeProjectFileBaseName(name: string): string {
  const sanitized = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return sanitized || "novel-project";
}

function mapProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    contentLanguage: contentLanguageSchema.catch(DEFAULT_CONTENT_LANGUAGE).parse(row.content_language),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function readSource(db: SqliteDatabase): ProjectFileSource | null {
  const row = db.prepare("SELECT value_json FROM settings WHERE key = 'project_source'").get() as SettingRow | undefined;
  return row ? (JSON.parse(row.value_json) as ProjectFileSource) : null;
}

function writeSource(db: SqliteDatabase, source: ProjectFileSource | null, updatedAt: string): void {
  if (!source) {
    db.prepare("DELETE FROM settings WHERE key = 'project_source'").run();
    return;
  }

  db.prepare(
    `INSERT INTO settings (key, value_json, updated_at)
     VALUES ('project_source', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(JSON.stringify(source), updatedAt);
}

export function isNovelToolProjectFile(filePath: string): boolean {
  return path.basename(filePath).endsWith(PROJECT_FILE_EXTENSION);
}

export function resolveProjectFilePath(directoryPath: string, projectName: string): string {
  return path.join(directoryPath, `${sanitizeProjectFileBaseName(projectName)}${PROJECT_FILE_EXTENSION}`);
}

export function resolveAvailableProjectFilePath(directoryPath: string, projectName: string): string {
  const baseName = sanitizeProjectFileBaseName(projectName);
  let candidate = path.join(directoryPath, `${baseName}${PROJECT_FILE_EXTENSION}`);
  let index = 2;
  while (existsSync(candidate)) {
    candidate = path.join(directoryPath, `${baseName}-${index}${PROJECT_FILE_EXTENSION}`);
    index += 1;
  }
  return candidate;
}

export function resolveImportedProjectFilePath(sourceFilePath: string, projectName: string): string {
  return resolveAvailableProjectFilePath(path.dirname(sourceFilePath), projectName);
}

export function openProjectDatabase(filePath: string): SqliteDatabase {
  const resolvedPath = path.resolve(filePath);
  if (!isNovelToolProjectFile(resolvedPath)) {
    throw new Error("墨枢项目文件必须使用 .noveltool 扩展名。");
  }

  const db = createDatabase(resolvedPath, { journalMode: "DELETE" });
  runMigrations(db);
  return db;
}

export function openExistingProjectDatabase(filePath: string): SqliteDatabase {
  const resolvedPath = path.resolve(filePath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`项目文件不存在：${resolvedPath}`);
  }
  return openProjectDatabase(resolvedPath);
}

export function readProjectRecordFromDatabase(db: SqliteDatabase): ProjectRecord {
  const row = db.prepare("SELECT * FROM projects ORDER BY created_at ASC, rowid ASC LIMIT 1").get() as ProjectRow | undefined;
  if (!row) {
    throw new Error("无效的墨枢项目文件：缺少项目记录。");
  }

  return mapProject(row);
}

export function readProjectRecordFromDatabaseOrNull(db: SqliteDatabase): ProjectRecord | null {
  const row = db.prepare("SELECT * FROM projects ORDER BY created_at ASC, rowid ASC LIMIT 1").get() as ProjectRow | undefined;
  return row ? mapProject(row) : null;
}

export function readProjectFile(filePath: string): ProjectFileDocument {
  const resolvedPath = path.resolve(filePath);
  const db = openExistingProjectDatabase(resolvedPath);
  try {
    const project = readProjectRecordFromDatabase(db);
    return {
      app: "novel-tool",
      schemaVersion: 1,
      projectId: project.id,
      projectName: project.name,
      source: readSource(db),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    };
  } finally {
    db.close();
  }
}

export function writeProjectFile(input: {
  readonly filePath: string;
  readonly project: ProjectRecord;
  readonly source: ProjectFileSource | null;
}): ProjectFileDocument {
  const resolvedPath = path.resolve(input.filePath);
  const db = openProjectDatabase(resolvedPath);
  try {
    const updatedAt = new Date().toISOString();
    new ProjectRepository(db).upsert({
      ...input.project,
      rootPath: resolvedPath,
      updatedAt
    });
    writeSource(db, input.source, updatedAt);
    const project = readProjectRecordFromDatabase(db);
    return {
      app: "novel-tool",
      schemaVersion: 1,
      projectId: project.id,
      projectName: project.name,
      source: input.source,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    };
  } finally {
    db.close();
  }
}

export function writeProjectSource(db: SqliteDatabase, source: ProjectFileSource | null, updatedAt: string): void {
  writeSource(db, source, updatedAt);
}
