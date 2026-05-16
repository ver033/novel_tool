import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../db/database";
import { openExistingProjectDatabase, PROJECT_FILE_EXTENSION } from "../project/project-file";
import { createId } from "../shared/ids";
import type { ExportShareableProjectCopyInput, ExportShareableProjectCopyResult } from "../shared/types";

type ProjectDbResolver = (projectId: string) => SqliteDatabase;

type ProjectPathRow = {
  readonly root_path: string | null;
};

type TextValueRow = {
  readonly value: string | null;
};

type TableRow = {
  readonly name: string;
};

type TableInfoRow = {
  readonly name: string;
  readonly type: string;
};

type BackupCapableDatabase = SqliteDatabase & {
  readonly backup: (filename: string) => Promise<unknown>;
};

type PrivacyScanResult = {
  readonly scannedTableCount: number;
  readonly scannedValueCount: number;
};

const ALWAYS_REMOVED_LABELS = ["本机路径", "章节快照", "AI 聊天记录", "AI 改写任务记录", "导入记录", "缓存任务记录"] as const;
const SECRET_PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: "API Key", pattern: /\bsk-(?:or-)?[A-Za-z0-9_-]{8,}\b/i },
  { label: "OpenRouter API Key", pattern: /OPENROUTER_API_KEY/i },
  { label: "apiKey 字段", pattern: /"?apiKey"?\s*:/i },
  { label: "encryptedApiKey 字段", pattern: /encryptedApiKey/i }
];
const LOCAL_PATH_PATTERN = /(?:\/Users\/[^\s"'<>]+|[A-Za-z]:\\Users\\[^\s"'<>]+)/;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function ensureProjectFilePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  if (path.extname(resolved).toLowerCase() !== PROJECT_FILE_EXTENSION) {
    throw new Error("可分享副本必须使用 .noveltool 扩展名。");
  }
  return resolved;
}

function tableExists(db: SqliteDatabase, tableName: string): boolean {
  const row = db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(tableName) as
    | { readonly found: number }
    | undefined;
  return Boolean(row);
}

function deleteFromTableIfExists(db: SqliteDatabase, tableName: string): void {
  if (tableExists(db, tableName)) {
    db.prepare(`DELETE FROM ${quoteIdentifier(tableName)}`).run();
  }
}

function listUserTables(db: SqliteDatabase): readonly string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC").all() as TableRow[]
  ).map((row) => row.name);
}

function listTableColumns(db: SqliteDatabase, tableName: string): readonly TableInfoRow[] {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as TableInfoRow[];
}

function rewriteProjectId(db: SqliteDatabase, sourceProjectId: string, copyProjectId: string): void {
  for (const tableName of listUserTables(db)) {
    if (tableName === "projects") {
      continue;
    }
    if (listTableColumns(db, tableName).some((column) => column.name === "project_id")) {
      db.prepare(`UPDATE ${quoteIdentifier(tableName)} SET project_id = ? WHERE project_id = ?`).run(copyProjectId, sourceProjectId);
    }
  }
  db.prepare("UPDATE projects SET id = ?, root_path = NULL WHERE id = ?").run(copyProjectId, sourceProjectId);
}

function collectPathFragments(db: SqliteDatabase): readonly string[] {
  const fragments = new Set<string>();
  const projectRows = db.prepare("SELECT root_path FROM projects WHERE root_path IS NOT NULL").all() as ProjectPathRow[];
  for (const row of projectRows) {
    if (row.root_path) {
      fragments.add(path.resolve(row.root_path));
      fragments.add(path.dirname(path.resolve(row.root_path)));
    }
  }

  if (tableExists(db, "import_jobs")) {
    const importRows = db.prepare("SELECT source_path AS value FROM import_jobs WHERE source_path IS NOT NULL").all() as TextValueRow[];
    for (const row of importRows) {
      if (row.value) {
        fragments.add(row.value);
        fragments.add(path.dirname(row.value));
      }
    }
  }

  if (tableExists(db, "settings")) {
    const settingRows = db.prepare("SELECT value_json AS value FROM settings").all() as TextValueRow[];
    for (const row of settingRows) {
      for (const match of row.value?.matchAll(new RegExp(LOCAL_PATH_PATTERN, "g")) ?? []) {
        fragments.add(match[0]);
      }
    }
  }

  return [...fragments].filter((fragment) => fragment.length >= 6);
}

function shouldAllowUserAuthoredLocalPath(tableName: string, columnName: string): boolean {
  return (
    (tableName === "chapters" && (columnName === "plain_text" || columnName === "content_json")) ||
    (tableName === "scratch_notes" && columnName === "content")
  );
}

function assertNoSensitiveText(value: string, context: string, privatePathFragments: readonly string[], scanGenericLocalPath: boolean): void {
  for (const { label, pattern } of SECRET_PATTERNS) {
    if (pattern.test(value)) {
      throw new Error(`可分享副本隐私扫描失败：${context} 仍包含 ${label}。`);
    }
  }
  for (const fragment of privatePathFragments) {
    if (value.includes(fragment)) {
      throw new Error(`可分享副本隐私扫描失败：${context} 仍包含本机路径。`);
    }
  }
  if (scanGenericLocalPath && LOCAL_PATH_PATTERN.test(value)) {
    throw new Error(`可分享副本隐私扫描失败：${context} 仍包含本机路径。`);
  }
}

function scanDatabaseRows(db: SqliteDatabase, privatePathFragments: readonly string[]): PrivacyScanResult {
  const tables = listUserTables(db);
  let scannedValueCount = 0;

  for (const tableName of tables) {
    const textColumns = listTableColumns(db, tableName).filter((column) => column.type.toUpperCase().includes("TEXT"));
    for (const column of textColumns) {
      const columnName = column.name;
      const scanGenericLocalPath = !shouldAllowUserAuthoredLocalPath(tableName, columnName);
      const statement = db.prepare(
        `SELECT ${quoteIdentifier(columnName)} AS value FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(columnName)} IS NOT NULL`
      );
      for (const row of statement.all() as TextValueRow[]) {
        scannedValueCount += 1;
        if (row.value) {
          assertNoSensitiveText(row.value, `${tableName}.${columnName}`, privatePathFragments, scanGenericLocalPath);
        }
      }
    }
  }

  return {
    scannedTableCount: tables.length,
    scannedValueCount
  };
}

function scanDatabaseFile(filePath: string, privatePathFragments: readonly string[]): void {
  const content = readFileSync(filePath).toString("utf8");
  assertNoSensitiveText(content, "导出文件", privatePathFragments, false);
}

function createTempOutputPath(filePath: string): string {
  return path.join(path.dirname(filePath), `.${path.basename(filePath, PROJECT_FILE_EXTENSION)}.${Date.now()}.${randomUUID()}.tmp${PROJECT_FILE_EXTENSION}`);
}

function removeIfExists(filePath: string): void {
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

export class ShareableProjectExporter {
  constructor(private readonly resolveProjectDb: ProjectDbResolver) {}

  async exportShareableProjectCopy(input: ExportShareableProjectCopyInput): Promise<ExportShareableProjectCopyResult> {
    const filePath = ensureProjectFilePath(input.filePath);
    const sourceDb = this.resolveProjectDb(input.projectId);
    const privatePathFragments = collectPathFragments(sourceDb);
    const rootPath = (sourceDb.prepare("SELECT root_path FROM projects WHERE id = ?").get(input.projectId) as ProjectPathRow | undefined)?.root_path;
    if (rootPath && path.resolve(rootPath) === filePath) {
      throw new Error("可分享副本不能覆盖当前项目文件。");
    }

    mkdirSync(path.dirname(filePath), { recursive: true });
    const tempOutputPath = createTempOutputPath(filePath);

    try {
      await (sourceDb as BackupCapableDatabase).backup(tempOutputPath);
      const privacyScan = this.sanitizeAndScanCopy(tempOutputPath, input, privatePathFragments);
      renameSync(tempOutputPath, filePath);

      return {
        filePath,
        exportedAt: new Date().toISOString(),
        included: this.getIncludedLabels(input),
        removed: this.getRemovedLabels(input),
        privacyScan
      };
    } catch (error) {
      removeIfExists(tempOutputPath);
      throw error;
    }
  }

  private sanitizeAndScanCopy(
    filePath: string,
    input: ExportShareableProjectCopyInput,
    privatePathFragments: readonly string[]
  ): PrivacyScanResult {
    const db = openExistingProjectDatabase(filePath);
    let closed = false;
    try {
      db.pragma("secure_delete = ON");
      db.pragma("foreign_keys = OFF");
      try {
        db.transaction(() => {
          rewriteProjectId(db, input.projectId, createId("project"));
          deleteFromTableIfExists(db, "settings");
          deleteFromTableIfExists(db, "import_jobs");
          deleteFromTableIfExists(db, "chapter_snapshots");
          deleteFromTableIfExists(db, "ai_task_candidates");
          deleteFromTableIfExists(db, "ai_tasks");
          deleteFromTableIfExists(db, "ai_chat_messages");
          deleteFromTableIfExists(db, "ai_chat_sessions");
          deleteFromTableIfExists(db, "summary_jobs");

          if (!input.includeScratchNotes) {
            deleteFromTableIfExists(db, "scratch_notes");
          }
          if (!input.includePromptPresets) {
            deleteFromTableIfExists(db, "prompt_presets");
          }
          if (!input.includeSummaryCache) {
            deleteFromTableIfExists(db, "chapter_ai_summary_chunks");
            deleteFromTableIfExists(db, "chapter_ai_summaries");
            deleteFromTableIfExists(db, "arc_ai_summaries");
            deleteFromTableIfExists(db, "book_ai_summaries");
          } else {
            if (tableExists(db, "chapter_ai_summary_chunks")) {
              db.prepare("DELETE FROM chapter_ai_summary_chunks WHERE status <> 'ready'").run();
            }
            if (tableExists(db, "chapter_ai_summaries")) {
              db.prepare("DELETE FROM chapter_ai_summaries WHERE status NOT IN ('ready', 'skipped_too_short')").run();
            }
            if (tableExists(db, "arc_ai_summaries")) {
              db.prepare("DELETE FROM arc_ai_summaries WHERE status <> 'ready'").run();
            }
            if (tableExists(db, "book_ai_summaries")) {
              db.prepare("DELETE FROM book_ai_summaries WHERE status <> 'ready'").run();
            }
          }
        })();
      } finally {
        db.pragma("foreign_keys = ON");
      }
      const foreignKeyErrors = db.prepare("PRAGMA foreign_key_check").all();
      if (foreignKeyErrors.length > 0) {
        throw new Error("可分享副本生成失败：项目引用重写后存在无效外键。");
      }
      db.exec("VACUUM;");
      const result = scanDatabaseRows(db, privatePathFragments);
      db.close();
      closed = true;
      scanDatabaseFile(filePath, privatePathFragments);
      return result;
    } catch (error) {
      if (!closed) {
        db.close();
      }
      throw error;
    }
  }

  private getIncludedLabels(input: ExportShareableProjectCopyInput): readonly string[] {
    return [
      "章节正文",
      "人物关系设定",
      ...(input.includeScratchNotes ? ["草稿纸/素材"] : []),
      ...(input.includePromptPresets ? ["提示词预设"] : []),
      ...(input.includeSummaryCache ? ["章节索引缓存"] : [])
    ];
  }

  private getRemovedLabels(input: ExportShareableProjectCopyInput): readonly string[] {
    return [
      ...ALWAYS_REMOVED_LABELS,
      ...(!input.includeScratchNotes ? ["草稿纸/素材"] : []),
      ...(!input.includePromptPresets ? ["提示词预设"] : []),
      ...(!input.includeSummaryCache ? ["章节索引缓存"] : [])
    ];
  }
}
