import type { SqliteDatabase } from "./database";

type Migration = {
  readonly version: number;
  readonly name: string;
  readonly up: (db: SqliteDatabase) => void;
};

const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "v1_foundation",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          root_path TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chapters (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          volume_title TEXT,
          sort_order INTEGER NOT NULL,
          content_json TEXT NOT NULL,
          plain_text TEXT NOT NULL,
          word_count INTEGER NOT NULL DEFAULT 0,
          daily_word_count INTEGER NOT NULL DEFAULT 0,
          target_word_count INTEGER,
          status TEXT NOT NULL DEFAULT 'draft',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_chapters_project_sort
          ON chapters(project_id, sort_order);

        CREATE TABLE IF NOT EXISTS chapter_snapshots (
          id TEXT PRIMARY KEY,
          chapter_id TEXT NOT NULL,
          content_json TEXT NOT NULL,
          plain_text TEXT NOT NULL,
          reason TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_chapter_snapshots_chapter_created
          ON chapter_snapshots(chapter_id, created_at);

        CREATE TABLE IF NOT EXISTS ai_tasks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          chapter_id TEXT,
          task_type TEXT NOT NULL CHECK (task_type IN ('polish', 'expand', 'proofread', 'continue')),
          status TEXT NOT NULL CHECK (status IN ('empty', 'configured', 'generating', 'preview_ready', 'failed', 'applied', 'inserted', 'saved_to_scratchpad')),
          selection_json TEXT,
          input_text TEXT,
          instruction TEXT,
          preset_id TEXT,
          output_text TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ai_tasks_project_created
          ON ai_tasks(project_id, created_at);

        CREATE TABLE IF NOT EXISTS ai_task_candidates (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          original_text TEXT,
          generated_text TEXT NOT NULL,
          change_summary TEXT,
          status TEXT NOT NULL DEFAULT 'preview'
            CHECK (status IN ('preview', 'applied', 'inserted', 'rejected', 'copied', 'inserted_to_scratchpad')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (task_id) REFERENCES ai_tasks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_ai_task_candidates_task_created
          ON ai_task_candidates(task_id, created_at);

        CREATE TABLE IF NOT EXISTS scratch_notes (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          chapter_id TEXT,
          content TEXT NOT NULL,
          pinned INTEGER NOT NULL DEFAULT 0,
          source_task_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL,
          FOREIGN KEY (source_task_id) REFERENCES ai_tasks(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_scratch_notes_project_updated
          ON scratch_notes(project_id, updated_at);

        CREATE TABLE IF NOT EXISTS prompt_presets (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          task_type TEXT NOT NULL CHECK (task_type IN ('polish', 'expand', 'proofread', 'continue')),
          description TEXT,
          system_prompt TEXT NOT NULL,
          user_template TEXT NOT NULL,
          constraints TEXT,
          is_builtin INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_prompt_presets_project_task
          ON prompt_presets(project_id, task_type);

        CREATE TABLE IF NOT EXISTS import_jobs (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          source_path TEXT NOT NULL,
          source_type TEXT NOT NULL CHECK (source_type IN ('txt')),
          status TEXT NOT NULL CHECK (status IN ('idle', 'reading', 'parsing', 'preview', 'editing_split', 'writing', 'completed', 'failed', 'cancelled')),
          parsed_json TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    }
  }
];

export function runMigrations(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedVersions = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => Number(row.version))
  );

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    const applyMigration = db.transaction(() => {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        new Date().toISOString()
      );
    });

    applyMigration();
  }
}
