import type { SqliteDatabase } from "../database";
import type { OutlineChapterNoteRecord, OutlineDaySegment, OutlineEventRecord, OutlineEventStatus, OutlineThreadRecord } from "../../shared/types";

type OutlineThreadRow = {
  readonly id: string;
  readonly project_id: string;
  readonly name: string;
  readonly color: string;
  readonly sort_order: number;
  readonly created_at: string;
  readonly updated_at: string;
};

type OutlineEventRow = {
  readonly id: string;
  readonly project_id: string;
  readonly chapter_id: string | null;
  readonly title: string;
  readonly summary: string;
  readonly story_date: string | null;
  readonly story_time_label: string;
  readonly weekday_label: string;
  readonly story_time_order: number | null;
  readonly day_segment: OutlineDaySegment;
  readonly custom_day_segment: string | null;
  readonly location: string;
  readonly pov_character: string;
  readonly characters_json: string;
  readonly goal: string;
  readonly conflict: string;
  readonly outcome: string;
  readonly foreshadowing: string;
  readonly notes: string;
  readonly status: OutlineEventStatus;
  readonly event_order: number;
  readonly import_batch_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

type OutlineChapterNoteRow = {
  readonly project_id: string;
  readonly chapter_id: string;
  readonly content: string;
  readonly created_at: string;
  readonly updated_at: string;
};

export type OutlineThreadCreateData = OutlineThreadRecord;
export type OutlineThreadUpdateData = {
  readonly projectId: string;
  readonly threadId: string;
  readonly name?: string;
  readonly color?: string;
  readonly sortOrder?: number;
  readonly updatedAt: string;
};

export type OutlineListEventsData = {
  readonly projectId: string;
  readonly chapterId?: string;
  readonly threadId?: string;
  readonly status?: OutlineEventStatus;
  readonly query?: string;
};

export type OutlineEventCreateData = Omit<OutlineEventRecord, "threadIds"> & {
  readonly threadIds: readonly string[];
};
export type OutlineEventUpdateData = {
  readonly projectId: string;
  readonly eventId: string;
  readonly patch: Partial<Omit<OutlineEventCreateData, "id" | "projectId" | "createdAt">> & { readonly updatedAt: string };
};
export type OutlineChapterNoteSaveData = OutlineChapterNoteRecord;

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function mapThread(row: OutlineThreadRow): OutlineThreadRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    color: row.color,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapChapterNote(row: OutlineChapterNoteRow): OutlineChapterNoteRecord {
  return {
    projectId: row.project_id,
    chapterId: row.chapter_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEvent(row: OutlineEventRow, threadIds: readonly string[]): OutlineEventRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id,
    title: row.title,
    summary: row.summary,
    storyDate: row.story_date,
    storyTimeLabel: row.story_time_label,
    weekdayLabel: row.weekday_label,
    storyTimeOrder: row.story_time_order,
    daySegment: row.day_segment,
    customDaySegment: row.custom_day_segment,
    location: row.location,
    povCharacter: row.pov_character,
    characters: parseJsonArray(row.characters_json),
    goal: row.goal,
    conflict: row.conflict,
    outcome: row.outcome,
    foreshadowing: row.foreshadowing,
    notes: row.notes,
    status: row.status,
    eventOrder: row.event_order,
    importBatchId: row.import_batch_id,
    threadIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class OutlineRepository {
  constructor(private readonly db: SqliteDatabase) {}

  runInTransaction<T>(callback: () => T): T {
    return this.db.transaction(callback)();
  }

  listThreads(projectId: string): OutlineThreadRecord[] {
    return (this.db.prepare("SELECT * FROM outline_threads WHERE project_id = ? ORDER BY sort_order ASC, name ASC").all(projectId) as OutlineThreadRow[]).map(
      mapThread
    );
  }

  createThread(input: OutlineThreadCreateData): OutlineThreadRecord {
    this.db
      .prepare(
        `INSERT INTO outline_threads (id, project_id, name, color, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(input.id, input.projectId, input.name, input.color, input.sortOrder, input.createdAt, input.updatedAt);
    return this.getThread(input.projectId, input.id) ?? input;
  }

  updateThread(input: OutlineThreadUpdateData): OutlineThreadRecord {
    const current = this.getThread(input.projectId, input.threadId);
    if (!current) {
      throw new Error("大纲情节线不存在。");
    }
    this.db
      .prepare("UPDATE outline_threads SET name = ?, color = ?, sort_order = ?, updated_at = ? WHERE project_id = ? AND id = ?")
      .run(input.name ?? current.name, input.color ?? current.color, input.sortOrder ?? current.sortOrder, input.updatedAt, input.projectId, input.threadId);
    const updated = this.getThread(input.projectId, input.threadId);
    if (!updated) {
      throw new Error("大纲情节线更新失败。");
    }
    return updated;
  }

  deleteThread(projectId: string, threadId: string): void {
    this.db.prepare("DELETE FROM outline_threads WHERE project_id = ? AND id = ?").run(projectId, threadId);
  }

  getThread(projectId: string, threadId: string): OutlineThreadRecord | null {
    const row = this.db.prepare("SELECT * FROM outline_threads WHERE project_id = ? AND id = ?").get(projectId, threadId) as OutlineThreadRow | undefined;
    return row ? mapThread(row) : null;
  }

  listEvents(input: OutlineListEventsData): OutlineEventRecord[] {
    const clauses = ["e.project_id = ?"];
    const params: Array<string | number | null> = [input.projectId];
    if (input.chapterId) {
      clauses.push("e.chapter_id = ?");
      params.push(input.chapterId);
    }
    if (input.status) {
      clauses.push("e.status = ?");
      params.push(input.status);
    }
    if (input.query?.trim()) {
      clauses.push("(e.title LIKE ? OR e.summary LIKE ? OR e.location LIKE ? OR e.characters_json LIKE ? OR e.notes LIKE ?)");
      const query = `%${input.query.trim()}%`;
      params.push(query, query, query, query, query);
    }
    if (input.threadId) {
      clauses.push("EXISTS (SELECT 1 FROM outline_event_threads et WHERE et.event_id = e.id AND et.thread_id = ?)");
      params.push(input.threadId);
    }
    const rows = this.db
      .prepare(`SELECT e.* FROM outline_events e WHERE ${clauses.join(" AND ")} ORDER BY e.event_order ASC, e.created_at ASC`)
      .all(...params) as OutlineEventRow[];
    return rows.map((row) => mapEvent(row, this.listThreadIdsForEvent(row.id)));
  }

  getEvent(projectId: string, eventId: string): OutlineEventRecord | null {
    const row = this.db.prepare("SELECT * FROM outline_events WHERE project_id = ? AND id = ?").get(projectId, eventId) as OutlineEventRow | undefined;
    return row ? mapEvent(row, this.listThreadIdsForEvent(row.id)) : null;
  }

  createEvent(input: OutlineEventCreateData): OutlineEventRecord {
    this.insertEvent(input);
    const created = this.getEvent(input.projectId, input.id);
    if (!created) {
      throw new Error("大纲事件创建失败。");
    }
    return created;
  }

  createEventsBulk(inputs: readonly OutlineEventCreateData[]): OutlineEventRecord[] {
    const insertMany = this.db.transaction(() => {
      for (const input of inputs) {
        this.insertEvent(input);
      }
    });
    insertMany();
    return inputs.map((input) => {
      const created = this.getEvent(input.projectId, input.id);
      if (!created) {
        throw new Error("大纲事件批量创建失败。");
      }
      return created;
    });
  }

  updateEvent(input: OutlineEventUpdateData): OutlineEventRecord {
    const current = this.getEvent(input.projectId, input.eventId);
    if (!current) {
      throw new Error("大纲事件不存在。");
    }
    const patch = input.patch;
    const hasPatch = (key: keyof typeof patch): boolean => Object.prototype.hasOwnProperty.call(patch, key);
    const updated: OutlineEventCreateData = {
      ...current,
      chapterId: hasPatch("chapterId") ? (patch.chapterId ?? null) : current.chapterId,
      title: patch.title ?? current.title,
      summary: patch.summary ?? current.summary,
      storyDate: hasPatch("storyDate") ? (patch.storyDate ?? null) : current.storyDate,
      storyTimeLabel: patch.storyTimeLabel ?? current.storyTimeLabel,
      weekdayLabel: patch.weekdayLabel ?? current.weekdayLabel,
      storyTimeOrder: hasPatch("storyTimeOrder") ? (patch.storyTimeOrder ?? null) : current.storyTimeOrder,
      daySegment: patch.daySegment ?? current.daySegment,
      customDaySegment: hasPatch("customDaySegment") ? (patch.customDaySegment ?? null) : current.customDaySegment,
      location: patch.location ?? current.location,
      povCharacter: patch.povCharacter ?? current.povCharacter,
      characters: patch.characters ?? current.characters,
      goal: patch.goal ?? current.goal,
      conflict: patch.conflict ?? current.conflict,
      outcome: patch.outcome ?? current.outcome,
      foreshadowing: patch.foreshadowing ?? current.foreshadowing,
      notes: patch.notes ?? current.notes,
      status: patch.status ?? current.status,
      eventOrder: patch.eventOrder ?? current.eventOrder,
      importBatchId: hasPatch("importBatchId") ? (patch.importBatchId ?? null) : current.importBatchId,
      threadIds: patch.threadIds ?? current.threadIds,
      updatedAt: patch.updatedAt
    };
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE outline_events
           SET chapter_id = ?, title = ?, summary = ?, story_date = ?, story_time_label = ?, weekday_label = ?, story_time_order = ?,
             day_segment = ?, custom_day_segment = ?, location = ?, pov_character = ?, characters_json = ?, goal = ?, conflict = ?,
             outcome = ?, foreshadowing = ?, notes = ?, status = ?, event_order = ?, import_batch_id = ?, updated_at = ?
           WHERE project_id = ? AND id = ?`
        )
        .run(
          updated.chapterId,
          updated.title,
          updated.summary,
          updated.storyDate,
          updated.storyTimeLabel,
          updated.weekdayLabel,
          updated.storyTimeOrder,
          updated.daySegment,
          updated.customDaySegment,
          updated.location,
          updated.povCharacter,
          JSON.stringify([...updated.characters]),
          updated.goal,
          updated.conflict,
          updated.outcome,
          updated.foreshadowing,
          updated.notes,
          updated.status,
          updated.eventOrder,
          updated.importBatchId,
          updated.updatedAt,
          updated.projectId,
          updated.id
        );
      this.replaceEventThreads(updated.id, updated.threadIds);
    })();
    const result = this.getEvent(input.projectId, input.eventId);
    if (!result) {
      throw new Error("大纲事件更新失败。");
    }
    return result;
  }

  deleteEvent(projectId: string, eventId: string): void {
    this.db.prepare("DELETE FROM outline_events WHERE project_id = ? AND id = ?").run(projectId, eventId);
  }

  deleteImportBatch(projectId: string, importBatchId: string): number {
    const result = this.db.prepare("DELETE FROM outline_events WHERE project_id = ? AND import_batch_id = ?").run(projectId, importBatchId);
    return result.changes;
  }

  reorderEvents(projectId: string, orderedEventIds: readonly string[]): void {
    this.db.transaction(() => {
      orderedEventIds.forEach((eventId, index) => {
        this.db.prepare("UPDATE outline_events SET event_order = ? WHERE project_id = ? AND id = ?").run(index + 1, projectId, eventId);
      });
    })();
  }

  getChapterNote(projectId: string, chapterId: string): OutlineChapterNoteRecord | null {
    const row = this.db
      .prepare("SELECT * FROM outline_chapter_notes WHERE project_id = ? AND chapter_id = ?")
      .get(projectId, chapterId) as OutlineChapterNoteRow | undefined;
    return row ? mapChapterNote(row) : null;
  }

  listChapterNotes(projectId: string): OutlineChapterNoteRecord[] {
    return (this.db.prepare("SELECT * FROM outline_chapter_notes WHERE project_id = ? ORDER BY updated_at DESC").all(projectId) as OutlineChapterNoteRow[]).map(
      mapChapterNote
    );
  }

  saveChapterNote(input: OutlineChapterNoteSaveData): OutlineChapterNoteRecord {
    this.db
      .prepare(
        `INSERT INTO outline_chapter_notes (project_id, chapter_id, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, chapter_id) DO UPDATE SET
           content = excluded.content,
           updated_at = excluded.updated_at`
      )
      .run(input.projectId, input.chapterId, input.content, input.createdAt, input.updatedAt);
    const saved = this.getChapterNote(input.projectId, input.chapterId);
    if (!saved) {
      throw new Error("章节细纲保存失败。");
    }
    return saved;
  }

  private insertEvent(input: OutlineEventCreateData): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO outline_events (
            id, project_id, chapter_id, title, summary, story_date, story_time_label, weekday_label, story_time_order,
            day_segment, custom_day_segment, location, pov_character, characters_json, goal, conflict, outcome, foreshadowing,
            notes, status, event_order, import_batch_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.id,
          input.projectId,
          input.chapterId,
          input.title,
          input.summary,
          input.storyDate,
          input.storyTimeLabel,
          input.weekdayLabel,
          input.storyTimeOrder,
          input.daySegment,
          input.customDaySegment,
          input.location,
          input.povCharacter,
          JSON.stringify([...input.characters]),
          input.goal,
          input.conflict,
          input.outcome,
          input.foreshadowing,
          input.notes,
          input.status,
          input.eventOrder,
          input.importBatchId,
          input.createdAt,
          input.updatedAt
        );
      this.replaceEventThreads(input.id, input.threadIds);
    })();
  }

  private replaceEventThreads(eventId: string, threadIds: readonly string[]): void {
    this.db.prepare("DELETE FROM outline_event_threads WHERE event_id = ?").run(eventId);
    const insertLink = this.db.prepare("INSERT OR IGNORE INTO outline_event_threads (event_id, thread_id, created_at) VALUES (?, ?, ?)");
    const now = new Date().toISOString();
    for (const threadId of threadIds) {
      insertLink.run(eventId, threadId, now);
    }
  }

  private listThreadIdsForEvent(eventId: string): string[] {
    return (this.db.prepare("SELECT thread_id FROM outline_event_threads WHERE event_id = ? ORDER BY thread_id ASC").all(eventId) as { thread_id: string }[]).map(
      (row) => row.thread_id
    );
  }
}
