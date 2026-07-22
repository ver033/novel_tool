import type { SqliteDatabase } from "../database";
import type { ProjectRecord } from "../../shared/types";
import { contentLanguageSchema, DEFAULT_CONTENT_LANGUAGE, type ContentLanguage } from "../../shared/language";

type ProjectRow = {
  readonly id: string;
  readonly name: string;
  readonly root_path: string | null;
  readonly content_language?: string;
  readonly created_at: string;
  readonly updated_at: string;
};

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

function normalizedProjectName(project: ProjectRecord): string {
  const name = project.name.trim().toLocaleLowerCase("zh-CN");
  return name || `id:${project.id}`;
}

export class ProjectRepository {
  constructor(private readonly db: SqliteDatabase) {}

  private hasContentLanguageColumn(): boolean {
    return this.db
      .prepare("PRAGMA table_info(projects)")
      .all()
      .some((row) => row.name === "content_language");
  }

  create(project: Omit<ProjectRecord, "contentLanguage"> & { readonly contentLanguage?: ContentLanguage }): ProjectRecord {
    const contentLanguage = project.contentLanguage ?? DEFAULT_CONTENT_LANGUAGE;
    if (this.hasContentLanguageColumn()) {
      this.db
        .prepare("INSERT INTO projects (id, name, root_path, content_language, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(project.id, project.name, project.rootPath, contentLanguage, project.createdAt, project.updatedAt);
    } else {
      this.db
        .prepare("INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(project.id, project.name, project.rootPath, project.createdAt, project.updatedAt);
    }

    return this.findById(project.id) ?? { ...project, contentLanguage };
  }

  upsert(project: Omit<ProjectRecord, "contentLanguage"> & { readonly contentLanguage?: ContentLanguage }): ProjectRecord {
    const contentLanguage = project.contentLanguage ?? DEFAULT_CONTENT_LANGUAGE;
    if (this.hasContentLanguageColumn()) {
      this.db
        .prepare(
          `INSERT INTO projects (id, name, root_path, content_language, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             root_path = excluded.root_path,
             content_language = excluded.content_language,
             updated_at = excluded.updated_at`
        )
        .run(project.id, project.name, project.rootPath, contentLanguage, project.createdAt, project.updatedAt);
    } else {
      this.db
        .prepare(
          `INSERT INTO projects (id, name, root_path, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             root_path = excluded.root_path,
             updated_at = excluded.updated_at`
        )
        .run(project.id, project.name, project.rootPath, project.createdAt, project.updatedAt);
    }

    return this.findById(project.id) ?? { ...project, contentLanguage };
  }

  findById(projectId: string): ProjectRecord | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as ProjectRow | undefined;
    return row ? mapProject(row) : null;
  }

  findByRootPath(rootPath: string): ProjectRecord | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE root_path = ?").get(rootPath) as ProjectRow | undefined;
    return row ? mapProject(row) : null;
  }

  findMostRecentWithoutRootPathByName(name: string): ProjectRecord | null {
    const row = this.db
      .prepare("SELECT * FROM projects WHERE root_path IS NULL AND name = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1")
      .get(name) as ProjectRow | undefined;
    return row ? mapProject(row) : null;
  }

  listRecent(limit = 10): ProjectRecord[] {
    const scanLimit = Math.max(limit * 5, limit);
    const projects = (this.db.prepare("SELECT * FROM projects ORDER BY updated_at DESC, rowid DESC LIMIT ?").all(scanLimit) as ProjectRow[]).map(mapProject);
    const projectFileNames = new Set(projects.filter((project) => project.rootPath).map(normalizedProjectName));
    const seenPaths = new Set<string>();
    const seenLegacyNames = new Set<string>();
    const deduplicated: ProjectRecord[] = [];

    for (const project of projects) {
      const name = normalizedProjectName(project);
      if (project.rootPath) {
        if (seenPaths.has(project.rootPath)) {
          continue;
        }
        seenPaths.add(project.rootPath);
      } else {
        if (seenLegacyNames.has(name) || projectFileNames.has(name)) {
          continue;
        }
        seenLegacyNames.add(name);
      }
      deduplicated.push(project);
      if (deduplicated.length >= limit) {
        break;
      }
    }

    return deduplicated;
  }

  markOpened(projectId: string, updatedAt: string): void {
    this.db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(updatedAt, projectId);
  }

  assignRootPath(projectId: string, rootPath: string, updatedAt: string): void {
    this.db.prepare("UPDATE projects SET root_path = ?, updated_at = ? WHERE id = ? AND root_path IS NULL").run(rootPath, updatedAt, projectId);
  }

  updateRootPath(projectId: string, rootPath: string, updatedAt: string): void {
    this.db.prepare("UPDATE projects SET root_path = ?, updated_at = ? WHERE id = ?").run(rootPath, updatedAt, projectId);
  }

  rename(projectId: string, name: string, updatedAt: string): ProjectRecord {
    this.db.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?").run(name, updatedAt, projectId);
    const project = this.findById(projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    return project;
  }

  delete(projectId: string): void {
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  }

  setCurrentProject(projectId: string, updatedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at)
         VALUES ('current_project_id', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(JSON.stringify(projectId), updatedAt);
  }

  getCurrentProjectId(): string | null {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key = 'current_project_id'").get() as { value_json: string } | undefined;
    return row ? (JSON.parse(row.value_json) as string) : null;
  }

  clearCurrentProject(projectId: string): void {
    if (this.getCurrentProjectId() === projectId) {
      this.db.prepare("DELETE FROM settings WHERE key = 'current_project_id'").run();
    }
  }

  transact<T>(fn: () => T): T {
    const transaction = this.db.transaction(fn);
    return transaction();
  }
}
