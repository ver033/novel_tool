import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { initializeDatabase } from "../db/migrations";
import { defaultProjectConfig, writeProjectConfig } from "./project-config";

export interface CreateProjectInput {
  baseDirectory: string;
  projectName: string;
}

export interface ProjectHandle {
  projectPath: string;
  dbPath: string;
}

const projectFolders = ["originals", "canon", "outlines", "exports", "backups", "cache", "logs"];

function sanitizeProjectName(projectName: string): string {
  return projectName.trim().replace(/[/:\\]/g, "-");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function createProject(input: CreateProjectInput): Promise<ProjectHandle> {
  const cleanName = sanitizeProjectName(input.projectName);
  if (!cleanName) {
    throw new Error("Project name is required");
  }

  const projectPath = path.join(input.baseDirectory, `${cleanName}.novelproj`);
  const dbPath = path.join(projectPath, "book.db");

  if (await pathExists(projectPath)) {
    throw new Error(`项目已存在：${projectPath}。请打开已有项目，或换一个项目名后再导入。`);
  }

  await mkdir(projectPath, { recursive: true });
  await Promise.all(projectFolders.map((folder) => mkdir(path.join(projectPath, folder), { recursive: true })));
  await writeProjectConfig(projectPath, defaultProjectConfig(cleanName));
  initializeDatabase(dbPath);

  const db = new Database(dbPath);
  try {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO projects (id, name, path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run("default-project", cleanName, projectPath, now, now);
  } finally {
    db.close();
  }

  return { projectPath, dbPath };
}
