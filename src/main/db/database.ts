import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type SqliteDatabase = ReturnType<typeof Database>;

type CreateDatabaseOptions = {
  readonly journalMode?: "WAL" | "DELETE";
  readonly busyTimeoutMs?: number;
};

export function resolveDatabasePath(userDataPath: string): string {
  return path.join(userDataPath, "novel-tool.sqlite3");
}

export function createDatabase(databasePath: string, options: CreateDatabaseOptions = {}): SqliteDatabase {
  mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = Database(databasePath);
  db.pragma("foreign_keys = ON");
  db.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 5000}`);
  db.pragma(`journal_mode = ${options.journalMode ?? "WAL"}`);

  return db;
}
