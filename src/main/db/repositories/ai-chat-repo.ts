import { createId } from "../../shared/ids";
import type { AiChatAction, AiChatMessageRecord, AiChatMessageRole, AiChatSessionRecord, AiChatSessionStatus } from "../../shared/types";
import type { SqliteDatabase } from "../database";

type AiChatSessionRow = {
  readonly id: string;
  readonly project_id: string;
  readonly title: string;
  readonly status: AiChatSessionStatus;
  readonly created_at: string;
  readonly updated_at: string;
};

type AiChatMessageRow = {
  readonly id: string;
  readonly session_id: string;
  readonly project_id: string;
  readonly role: AiChatMessageRole;
  readonly content: string;
  readonly action_json: string | null;
  readonly created_at: string;
};

type CreateMessageInput = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly role: AiChatMessageRole;
  readonly content: string;
  readonly action: AiChatAction | null;
};

type ListMessagesInput = {
  readonly projectId: string;
  readonly sessionId: string;
};

type ClearSessionInput = {
  readonly projectId: string;
  readonly sessionId: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseAction(value: string | null): AiChatAction | null {
  return value ? (JSON.parse(value) as AiChatAction) : null;
}

function stringifyAction(value: AiChatAction | null): string | null {
  return value ? JSON.stringify(value) : null;
}

function mapSession(row: AiChatSessionRow): AiChatSessionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMessage(row: AiChatMessageRow): AiChatMessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectId: row.project_id,
    role: row.role,
    content: row.content,
    action: parseAction(row.action_json),
    createdAt: row.created_at
  };
}

export class AiChatRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getOrCreateDefaultSession(projectId: string): AiChatSessionRecord {
    const existing = this.db
      .prepare("SELECT * FROM ai_chat_sessions WHERE project_id = ? AND status = 'active' ORDER BY created_at ASC LIMIT 1")
      .get(projectId) as AiChatSessionRow | undefined;
    if (existing) {
      return mapSession(existing);
    }

    const createdAt = nowIso();
    const session = {
      id: createId("chat"),
      projectId,
      title: "默认对话",
      status: "active",
      createdAt,
      updatedAt: createdAt
    } satisfies AiChatSessionRecord;

    this.db
      .prepare("INSERT INTO ai_chat_sessions (id, project_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(session.id, session.projectId, session.title, session.status, session.createdAt, session.updatedAt);

    return session;
  }

  listMessages(input: ListMessagesInput): AiChatMessageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM ai_chat_messages
         WHERE project_id = ? AND session_id = ?
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(input.projectId, input.sessionId) as AiChatMessageRow[];

    return rows.map(mapMessage);
  }

  createMessage(input: CreateMessageInput): AiChatMessageRecord {
    const createdAt = nowIso();
    const message = {
      id: createId("chatmsg"),
      sessionId: input.sessionId,
      projectId: input.projectId,
      role: input.role,
      content: input.content,
      action: input.action,
      createdAt
    } satisfies AiChatMessageRecord;

    this.db
      .prepare("INSERT INTO ai_chat_messages (id, session_id, project_id, role, content, action_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(message.id, message.sessionId, message.projectId, message.role, message.content, stringifyAction(message.action), message.createdAt);
    this.db.prepare("UPDATE ai_chat_sessions SET updated_at = ? WHERE id = ? AND project_id = ?").run(createdAt, message.sessionId, message.projectId);

    return message;
  }

  clearSession(input: ClearSessionInput): void {
    this.db.prepare("DELETE FROM ai_chat_messages WHERE project_id = ? AND session_id = ?").run(input.projectId, input.sessionId);
    this.db.prepare("UPDATE ai_chat_sessions SET updated_at = ? WHERE id = ? AND project_id = ?").run(nowIso(), input.sessionId, input.projectId);
  }
}
