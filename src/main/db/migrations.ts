import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const schemaSql = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  language TEXT NOT NULL DEFAULT 'zh-CN',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  book_id TEXT,
  title TEXT NOT NULL,
  chapter_index INTEGER NOT NULL,
  source_type TEXT,
  source_href TEXT,
  summary TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  scene_index INTEGER NOT NULL,
  title TEXT,
  summary TEXT,
  start_paragraph_id TEXT,
  end_paragraph_id TEXT,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS paragraphs (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  scene_id TEXT,
  paragraph_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  char_start INTEGER,
  char_end INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS paragraph_versions (
  id TEXT PRIMARY KEY,
  paragraph_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  text TEXT NOT NULL,
  change_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  before_text TEXT NOT NULL,
  after_text TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  source_task_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  explanation TEXT NOT NULL,
  suggestion TEXT,
  status TEXT NOT NULL,
  current_paragraph_id TEXT,
  source_task_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issue_evidence (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  paragraph_id TEXT,
  quote TEXT NOT NULL,
  role TEXT NOT NULL,
  note TEXT,
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_aliases (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  source_paragraph_id TEXT,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  subject_entity_id TEXT,
  predicate TEXT NOT NULL,
  object_text TEXT NOT NULL,
  fact_type TEXT NOT NULL,
  source_paragraph_id TEXT,
  quote TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  valid_from_event_id TEXT,
  valid_to_event_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  chapter_id TEXT,
  scene_id TEXT,
  paragraph_id TEXT,
  event_order INTEGER,
  time_expression TEXT,
  normalized_time TEXT,
  location_entity_id TEXT,
  summary TEXT NOT NULL,
  participants_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  entity_a_id TEXT NOT NULL,
  entity_b_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  state TEXT NOT NULL,
  source_paragraph_id TEXT,
  quote TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS props (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  owner_entity_id TEXT,
  location_entity_id TEXT,
  state TEXT NOT NULL,
  source_paragraph_id TEXT,
  quote TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS world_rules (
  id TEXT PRIMARY KEY,
  rule_text TEXT NOT NULL,
  scope TEXT NOT NULL,
  source_paragraph_id TEXT,
  quote TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS foreshadowings (
  id TEXT PRIMARY KEY,
  setup_paragraph_id TEXT,
  expected_payoff TEXT NOT NULL,
  payoff_paragraph_id TEXT,
  status TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS style_guides (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  features_json TEXT NOT NULL,
  sample_paragraph_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canon_sources (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  content_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outline_records (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  heading_path TEXT NOT NULL,
  record_type TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES canon_sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT,
  model_provider TEXT,
  model_name TEXT,
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  parent_task_id TEXT
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  chat_session_id TEXT,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  details_json TEXT,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  artifact_id TEXT,
  decision TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  source_list_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  cancellable INTEGER NOT NULL DEFAULT 0,
  input_summary_json TEXT NOT NULL,
  result_json TEXT,
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT,
  data_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS paragraphs_fts USING fts5(
  paragraph_id UNINDEXED,
  chapter_id UNINDEXED,
  chapter_title,
  friendly_location,
  text
);

CREATE INDEX IF NOT EXISTS idx_chapters_book ON chapters(book_id, chapter_index);
CREATE INDEX IF NOT EXISTS idx_paragraphs_chapter ON paragraphs(chapter_id, paragraph_index);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, type);
CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, created_at);
`;

export function initializeDatabase(dbPath: string): void {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.pragma("foreign_keys = ON");
    db.exec(schemaSql);
    db.pragma("user_version = 1");
  } finally {
    db.close();
  }
}
