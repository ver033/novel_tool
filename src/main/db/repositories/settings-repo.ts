import type { SqliteDatabase } from "../database";

type SettingsRow = {
  readonly key: string;
  readonly value_json: string;
  readonly updated_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

export class SettingsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getJson<TValue>(key: string): TValue | null {
    const row = this.db.prepare("SELECT * FROM settings WHERE key = ?").get(key) as SettingsRow | undefined;
    if (!row) {
      return null;
    }
    return JSON.parse(row.value_json) as TValue;
  }

  setJson(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value), nowIso());
  }
}
