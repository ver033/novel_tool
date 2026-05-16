import type { SqliteDatabase } from "./database";

type Migration = {
  readonly version: number;
  readonly name: string;
  readonly up: (db: SqliteDatabase) => void;
};

function tableHasColumn(db: SqliteDatabase, tableName: string, columnName: string): boolean {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((row) => row.name === columnName);
}

function tableExists(db: SqliteDatabase, tableName: string): boolean {
  const row = db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(tableName) as
    | { readonly found: number }
    | undefined;
  return Boolean(row);
}

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
          daily_word_count_date TEXT,
          target_word_count INTEGER,
          status TEXT NOT NULL DEFAULT 'draft',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          content_updated_at TEXT,
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
  },
  {
    version: 2,
    name: "ai_candidate_metadata",
    up(db) {
      if (!tableHasColumn(db, "ai_task_candidates", "metadata_json")) {
        db.exec("ALTER TABLE ai_task_candidates ADD COLUMN metadata_json TEXT;");
      }
    }
  },
  {
    version: 3,
    name: "ai_chat_persistence",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_chat_sessions (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'deleted')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_project_updated
          ON ai_chat_sessions(project_id, updated_at);

        CREATE TABLE IF NOT EXISTS ai_chat_messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'error')),
          content TEXT NOT NULL,
          action_json TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (session_id) REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session_created
          ON ai_chat_messages(session_id, created_at);
      `);
    }
  },
  {
    version: 4,
    name: "chapter_daily_word_count_date",
    up(db) {
      if (!tableHasColumn(db, "chapters", "daily_word_count_date")) {
        db.exec("ALTER TABLE chapters ADD COLUMN daily_word_count_date TEXT;");
      }
    }
  },
  {
    version: 5,
    name: "ai_chat_session_context_usage",
    up(db) {
      if (!tableHasColumn(db, "ai_chat_sessions", "context_usage_json")) {
        db.exec("ALTER TABLE ai_chat_sessions ADD COLUMN context_usage_json TEXT;");
      }
    }
  },
  {
    version: 6,
    name: "ai_chat_session_memory_compaction",
    up(db) {
      if (!tableHasColumn(db, "ai_chat_sessions", "memory_summary")) {
        db.exec("ALTER TABLE ai_chat_sessions ADD COLUMN memory_summary TEXT;");
      }
      if (!tableHasColumn(db, "ai_chat_sessions", "memory_compacted_through_message_id")) {
        db.exec("ALTER TABLE ai_chat_sessions ADD COLUMN memory_compacted_through_message_id TEXT;");
      }
      if (!tableHasColumn(db, "ai_chat_sessions", "memory_updated_at")) {
        db.exec("ALTER TABLE ai_chat_sessions ADD COLUMN memory_updated_at TEXT;");
      }
    }
  },
  {
    version: 7,
    name: "summary_index",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chapter_ai_summaries (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          chapter_id TEXT NOT NULL,
          chapter_title TEXT NOT NULL,
          chapter_order INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          summary_short TEXT NOT NULL,
          summary_long TEXT NOT NULL,
          structured_json TEXT NOT NULL,
          token_count INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL CHECK (status IN ('ready', 'stale', 'building', 'failed', 'skipped_too_short')),
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(project_id, chapter_id),
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_chapter_ai_summaries_project_order
          ON chapter_ai_summaries(project_id, chapter_order);

        CREATE TABLE IF NOT EXISTS arc_ai_summaries (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          arc_key TEXT NOT NULL,
          chapter_from INTEGER NOT NULL,
          chapter_to INTEGER NOT NULL,
          source_hash TEXT NOT NULL,
          summary TEXT NOT NULL,
          structured_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('ready', 'stale', 'building', 'failed')),
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(project_id, arc_key),
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_arc_ai_summaries_project_range
          ON arc_ai_summaries(project_id, chapter_from, chapter_to);

        CREATE TABLE IF NOT EXISTS book_ai_summaries (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          source_hash TEXT NOT NULL,
          summary_short TEXT NOT NULL,
          summary_long TEXT NOT NULL,
          structured_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('ready', 'stale', 'building', 'failed')),
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_book_ai_summaries_project_updated
          ON book_ai_summaries(project_id, updated_at);

        CREATE TABLE IF NOT EXISTS summary_jobs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          job_type TEXT NOT NULL CHECK (job_type IN ('chapter_summary', 'arc_summary', 'book_summary', 'rebuild_project_index')),
          target_id TEXT,
          source_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'skipped')),
          priority INTEGER NOT NULL DEFAULT 0,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          next_run_at TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_summary_jobs_project_status_priority
          ON summary_jobs(project_id, status, priority, created_at);
      `);
    }
  },
  {
    version: 8,
    name: "rebuild_chapter_fact_index_v2",
    up(db) {
      db.exec(`
        DELETE FROM summary_jobs;
        DELETE FROM book_ai_summaries;
        DELETE FROM arc_ai_summaries;
        DELETE FROM chapter_ai_summaries;
      `);
    }
  },
  {
    version: 9,
    name: "chapter_summary_chunks",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chapter_ai_summary_chunks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          chapter_id TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          chunk_count INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          text_start INTEGER NOT NULL,
          text_end INTEGER NOT NULL,
          summary_short TEXT NOT NULL,
          structured_json TEXT NOT NULL,
          token_count INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL CHECK (status IN ('ready', 'stale', 'building', 'failed')),
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(project_id, chapter_id, content_hash, chunk_index),
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_chapter_ai_summary_chunks_chapter
          ON chapter_ai_summary_chunks(project_id, chapter_id, content_hash, chunk_index);
      `);
    }
  },
  {
    version: 10,
    name: "rebuild_arc_book_fact_index_v2",
    up(db) {
      db.exec(`
        DELETE FROM summary_jobs WHERE job_type IN ('arc_summary', 'book_summary');
        DELETE FROM book_ai_summaries;
        DELETE FROM arc_ai_summaries;
      `);
    }
  },
  {
    version: 11,
    name: "invalidate_legacy_proofread_metadata",
    up(db) {
      db.prepare(
        `
          UPDATE ai_task_candidates
          SET
            metadata_json = NULL,
            status = 'rejected',
            change_summary = '旧版校对结果已失效，请重新生成。',
            updated_at = ?
          WHERE kind = 'proofread'
            AND metadata_json IS NOT NULL
            AND metadata_json LIKE '%"type"%'
            AND metadata_json LIKE '%"quote"%'
            AND metadata_json LIKE '%"suggestion"%'
        `
      ).run(new Date().toISOString());
    }
  },
  {
    version: 12,
    name: "chapter_content_updated_at",
    up(db) {
      if (!tableHasColumn(db, "chapters", "content_updated_at")) {
        db.exec("ALTER TABLE chapters ADD COLUMN content_updated_at TEXT;");
      }
      db.exec("UPDATE chapters SET content_updated_at = updated_at WHERE content_updated_at IS NULL;");
    }
  },
  {
    version: 15,
    name: "summary_jobs",
    up(db) {
      if (!tableExists(db, "summary_jobs")) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS summary_jobs (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            job_type TEXT NOT NULL CHECK (job_type IN ('chapter_summary', 'arc_summary', 'book_summary', 'rebuild_project_index')),
            target_id TEXT,
            source_hash TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'skipped')),
            priority INTEGER NOT NULL DEFAULT 0,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            next_run_at TEXT,
            error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
          );

          CREATE INDEX IF NOT EXISTS idx_summary_jobs_project_status_priority
            ON summary_jobs(project_id, status, priority, created_at);
        `);
        return;
      }
      db.exec("PRAGMA foreign_keys = OFF;");
      db.exec(`
        CREATE TABLE summary_jobs_new (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          job_type TEXT NOT NULL CHECK (job_type IN ('chapter_summary', 'arc_summary', 'book_summary', 'rebuild_project_index')),
          target_id TEXT,
          source_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'skipped')),
          priority INTEGER NOT NULL DEFAULT 0,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          next_run_at TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        INSERT INTO summary_jobs_new
          (id, project_id, job_type, target_id, source_hash, status, priority, attempt_count,
           next_run_at, error, created_at, updated_at, started_at, finished_at)
        SELECT
          id, project_id, job_type, target_id, source_hash, status, priority, attempt_count,
          next_run_at, error, created_at, updated_at, started_at, finished_at
        FROM summary_jobs
        WHERE job_type IN ('chapter_summary', 'arc_summary', 'book_summary', 'rebuild_project_index');

        DROP TABLE summary_jobs;
        ALTER TABLE summary_jobs_new RENAME TO summary_jobs;

        CREATE INDEX IF NOT EXISTS idx_summary_jobs_project_status_priority
          ON summary_jobs(project_id, status, priority, created_at);
      `);
      db.exec("PRAGMA foreign_keys = ON;");
    }
  },
  {
    version: 17,
    name: "remove_obsolete_relationship_indexes",
    up(db) {
      if (tableExists(db, "summary_jobs")) {
        db.exec("PRAGMA foreign_keys = OFF;");
        db.exec(`
          CREATE TABLE summary_jobs_new (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            job_type TEXT NOT NULL CHECK (job_type IN ('chapter_summary', 'arc_summary', 'book_summary', 'rebuild_project_index')),
            target_id TEXT,
            source_hash TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'skipped')),
            priority INTEGER NOT NULL DEFAULT 0,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            next_run_at TEXT,
            error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
          );

          INSERT INTO summary_jobs_new
            (id, project_id, job_type, target_id, source_hash, status, priority, attempt_count,
             next_run_at, error, created_at, updated_at, started_at, finished_at)
          SELECT
            id, project_id, job_type, target_id, source_hash, status, priority, attempt_count,
            next_run_at, error, created_at, updated_at, started_at, finished_at
          FROM summary_jobs
          WHERE job_type IN ('chapter_summary', 'arc_summary', 'book_summary', 'rebuild_project_index');

          DROP TABLE summary_jobs;
          ALTER TABLE summary_jobs_new RENAME TO summary_jobs;

          CREATE INDEX IF NOT EXISTS idx_summary_jobs_project_status_priority
            ON summary_jobs(project_id, status, priority, created_at);
        `);
        db.exec("PRAGMA foreign_keys = ON;");
      }
      db.exec(`
        DROP TABLE IF EXISTS relationship_identity_overrides;
        DROP TABLE IF EXISTS relationship_inferred_relations;
        DROP TABLE IF EXISTS relationship_identity_cluster_members;
        DROP TABLE IF EXISTS relationship_identity_clusters;
        DROP TABLE IF EXISTS relationship_identity_resolution_runs;
        DROP TABLE IF EXISTS relationship_mentions;
        DROP TABLE IF EXISTS relationship_entities;
        DROP TABLE IF EXISTS relationship_index_jobs;
        DROP TABLE IF EXISTS relationship_index_chapters;
      `);
    }
  },
  {
    version: 18,
    name: "author_relationship_layer",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS author_relationship_characters (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          normalized_name TEXT NOT NULL,
          aliases_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(project_id, normalized_name),
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_author_relationship_characters_project_updated
          ON author_relationship_characters(project_id, updated_at);

        CREATE TABLE IF NOT EXISTS author_relationships (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          source_character_id TEXT NOT NULL,
          target_character_id TEXT NOT NULL,
          source_to_target_label TEXT NOT NULL,
          target_to_source_label TEXT,
          normalized_relation_key TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (source_character_id <> target_character_id),
          UNIQUE(project_id, normalized_relation_key),
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (source_character_id) REFERENCES author_relationship_characters(id) ON DELETE CASCADE,
          FOREIGN KEY (target_character_id) REFERENCES author_relationship_characters(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_author_relationships_project_updated
          ON author_relationships(project_id, updated_at);
      `);
    }
  },
  {
    version: 19,
    name: "author_relationship_character_metadata",
    up(db) {
      const columns = db.prepare("PRAGMA table_info(author_relationship_characters)").all() as { name: string }[];
      const columnNames = new Set(columns.map((column) => column.name));
      if (!columnNames.has("entity_kind")) {
        db.exec("ALTER TABLE author_relationship_characters ADD COLUMN entity_kind TEXT NOT NULL DEFAULT 'person';");
      }
      if (!columnNames.has("importance")) {
        db.exec("ALTER TABLE author_relationship_characters ADD COLUMN importance TEXT NOT NULL DEFAULT 'supporting';");
      }
      if (!columnNames.has("role_summary")) {
        db.exec("ALTER TABLE author_relationship_characters ADD COLUMN role_summary TEXT;");
      }
      if (!columnNames.has("faction")) {
        db.exec("ALTER TABLE author_relationship_characters ADD COLUMN faction TEXT;");
      }
      if (!columnNames.has("notes")) {
        db.exec("ALTER TABLE author_relationship_characters ADD COLUMN notes TEXT;");
      }
    }
  },
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
