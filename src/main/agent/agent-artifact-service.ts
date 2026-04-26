import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { z } from 'zod';

import {
  acceptExpansionRevisionCandidate,
  createExpansionRevisionCandidate,
  parseExpansionStructuredOutput,
} from '../ai/expansion-service';
import { acceptPolishRevisionCandidate, createPolishRevisionCandidate } from '../ai/polish-service';
import { updateIssueStatus, type IssueStatus } from '../proofread/proofread-service';

type SqliteDb = InstanceType<typeof Database>;

export type AgentArtifactAppliedType = 'polish_revision' | 'expansion_draft' | 'issue_action' | 'memory_update';

export interface AgentArtifactDecisionInput {
  artifactId: string;
}

export interface AgentArtifactDecisionResult {
  artifactId: string;
  status: 'approved' | 'rejected';
  decision: 'approved' | 'rejected';
  appliedType: AgentArtifactAppliedType | null;
  appliedResult: unknown;
}

const riskFlagSchema = z.object({
  type: z.string().min(1),
  description: z.string().min(1),
});

const polishPayloadSchema = z.object({
  paragraphId: z.string().min(1),
  beforeText: z.string(),
  afterText: z.string().min(1),
  editSummary: z.string().min(1),
  changedFacts: z.array(z.unknown()).default([]),
  riskFlags: z.array(riskFlagSchema).default([]),
});

const expansionPayloadSchema = z.object({
  anchorParagraphId: z.string().min(1),
  draftText: z.string().min(1),
  summary: z.string().default(''),
  coveredBeats: z
    .array(
      z.object({
        beat: z.string().min(1),
        covered: z.boolean(),
        note: z.string(),
      })
    )
    .default([]),
  newFacts: z
    .array(
      z.object({
        fact: z.string().min(1),
        importance: z.enum(['low', 'medium', 'high']),
      })
    )
    .default([]),
  riskFlags: z.array(riskFlagSchema).default([]),
});

const issueActionPayloadSchema = z.object({
  issueId: z.string().min(1),
  action: z.enum([
    'mark_fixed',
    'ignore',
    'false_positive',
    'mark_foreshadowing',
    'mark_lie',
    'mark_unreliable_narration',
    'author_confirmed_exception',
  ]),
  note: z.string().default(''),
});

const memoryUpdatePayloadSchema = z.object({
  cardType: z.enum(['character', 'location', 'prop', 'world_rule', 'timeline', 'foreshadowing', 'style']),
  title: z.string().min(1),
  content: z.string().min(1),
  sourceParagraphIds: z.array(z.string().min(1)).default([]),
});

const issueStatusByAction: Record<z.infer<typeof issueActionPayloadSchema>['action'], IssueStatus> = {
  mark_fixed: 'fixed',
  ignore: 'ignored',
  false_positive: 'false_positive',
  mark_foreshadowing: 'marked_as_foreshadowing',
  mark_lie: 'marked_as_lie',
  mark_unreliable_narration: 'marked_as_unreliable_narration',
  author_confirmed_exception: 'author_confirmed_exception',
};

interface StoredAgentArtifact {
  id: string;
  runId: string;
  artifactType: AgentArtifactAppliedType;
  payload: unknown;
}

function openDb(dbPath: string): SqliteDb {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  return db;
}

function approvalId(): string {
  return `agent-approval-${crypto.randomUUID()}`;
}

function readPendingArtifact(dbPath: string, artifactId: string): StoredAgentArtifact {
  const db = openDb(dbPath);
  try {
    const row = db
      .prepare('SELECT id, run_id, artifact_type, payload_json, status FROM agent_artifacts WHERE id = ?')
      .get(artifactId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error('Agent 候选不存在');
    }
    if (String(row.status) !== 'pending_approval') {
      throw new Error('Agent 候选已处理，不能重复确认');
    }
    return {
      id: String(row.id),
      runId: String(row.run_id),
      artifactType: String(row.artifact_type) as AgentArtifactAppliedType,
      payload: JSON.parse(String(row.payload_json)),
    };
  } finally {
    db.close();
  }
}

function writeDecision(dbPath: string, artifact: StoredAgentArtifact, decision: 'approved' | 'rejected'): void {
  const db = openDb(dbPath);
  try {
    const timestamp = new Date().toISOString();
    const write = db.transaction(() => {
      const result = db
        .prepare('UPDATE agent_artifacts SET status = ? WHERE id = ? AND status = ?')
        .run(decision, artifact.id, 'pending_approval');
      if (result.changes === 0) {
        throw new Error('Agent 候选已处理，不能重复确认');
      }
      db.prepare('INSERT INTO agent_approvals (id, run_id, artifact_id, decision, created_at) VALUES (?, ?, ?, ?, ?)').run(
        approvalId(),
        artifact.runId,
        artifact.id,
        decision,
        timestamp
      );
    });
    write();
  } finally {
    db.close();
  }
}

function assertCurrentParagraphMatches(dbPath: string, paragraphId: string, expectedText: string): void {
  const db = openDb(dbPath);
  try {
    const row = db.prepare('SELECT text FROM paragraphs WHERE id = ?').get(paragraphId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error('段落不存在，无法应用 Agent 润色候选');
    }
    if (String(row.text) !== expectedText) {
      throw new Error('正文已变化，请重新生成 Agent 润色候选');
    }
  } finally {
    db.close();
  }
}

function applyPolishArtifact(dbPath: string, artifact: StoredAgentArtifact): unknown {
  const payload = polishPayloadSchema.parse(artifact.payload);
  assertCurrentParagraphMatches(dbPath, payload.paragraphId, payload.beforeText);
  const candidate = createPolishRevisionCandidate(dbPath, {
    paragraphId: payload.paragraphId,
    sourceTaskId: artifact.runId,
    structuredOutput: {
      revisedText: payload.afterText,
      editSummary: payload.editSummary,
      changedFacts: payload.changedFacts,
      riskFlags: payload.riskFlags,
    },
  });
  return acceptPolishRevisionCandidate(dbPath, { revisionId: candidate.revisionId });
}

function applyExpansionArtifact(dbPath: string, artifact: StoredAgentArtifact): unknown {
  const payload = expansionPayloadSchema.parse(artifact.payload);
  const structuredOutput = parseExpansionStructuredOutput({
    draft_text: payload.draftText,
    covered_beats: payload.coveredBeats,
    new_facts: payload.newFacts,
    risk_flags: payload.riskFlags,
    revision_notes: payload.summary,
  });
  const candidate = createExpansionRevisionCandidate(dbPath, {
    anchorParagraphId: payload.anchorParagraphId,
    sourceTaskId: artifact.runId,
    structuredOutput,
  });
  return acceptExpansionRevisionCandidate(dbPath, { revisionId: candidate.revisionId });
}

function applyIssueActionArtifact(dbPath: string, artifact: StoredAgentArtifact): unknown {
  const payload = issueActionPayloadSchema.parse(artifact.payload);
  return updateIssueStatus(dbPath, {
    issueId: payload.issueId,
    status: issueStatusByAction[payload.action],
  });
}

function paragraphContext(db: SqliteDb, paragraphId: string | null): { chapterId: string | null; text: string } {
  if (!paragraphId) {
    return { chapterId: null, text: '' };
  }
  const row = db.prepare('SELECT chapter_id, text FROM paragraphs WHERE id = ?').get(paragraphId) as
    | Record<string, unknown>
    | undefined;
  return {
    chapterId: row?.chapter_id == null ? null : String(row.chapter_id),
    text: row?.text == null ? '' : String(row.text),
  };
}

function applyMemoryUpdateArtifact(dbPath: string, artifact: StoredAgentArtifact): unknown {
  const payload = memoryUpdatePayloadSchema.parse(artifact.payload);
  const db = openDb(dbPath);
  try {
    const timestamp = new Date().toISOString();
    const sourceParagraphId = payload.sourceParagraphIds[0] ?? null;
    const source = paragraphContext(db, sourceParagraphId);
    const quote = source.text ? source.text.slice(0, 160) : payload.content.slice(0, 160);
    const rawId = `agent-memory-${crypto.randomUUID()}`;
    const write = db.transaction(() => {
      if (payload.cardType === 'character' || payload.cardType === 'location' || payload.cardType === 'prop') {
        const entityType = payload.cardType === 'character' ? 'character' : payload.cardType === 'location' ? 'location' : 'prop';
        db.prepare(
          `INSERT INTO entities (id, type, canonical_name, description, status, confidence, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'user_confirmed', 1, ?, ?)`
        ).run(rawId, entityType, payload.title, payload.content, timestamp, timestamp);
        if (sourceParagraphId) {
          db.prepare('INSERT INTO entity_aliases (id, entity_id, alias, source_paragraph_id) VALUES (?, ?, ?, ?)').run(
            `alias-${rawId}`,
            rawId,
            payload.title,
            sourceParagraphId
          );
        }
        return { memoryCardId: `entity:${rawId}`, cardType: payload.cardType };
      }
      if (payload.cardType === 'world_rule') {
        db.prepare(
          `INSERT INTO world_rules (id, rule_text, scope, source_paragraph_id, quote, confidence, status)
           VALUES (?, ?, ?, ?, ?, 1, 'user_confirmed')`
        ).run(rawId, payload.content, payload.title, sourceParagraphId, quote);
        return { memoryCardId: `world_rule:${rawId}`, cardType: payload.cardType };
      }
      if (payload.cardType === 'timeline') {
        const eventOrderRow = db.prepare('SELECT COALESCE(MAX(event_order), -1) + 1 AS next_order FROM events').get() as Record<
          string,
          unknown
        >;
        db.prepare(
          `INSERT INTO events
           (id, chapter_id, scene_id, paragraph_id, event_order, time_expression, normalized_time, location_entity_id, summary, participants_json, confidence, status)
           VALUES (?, ?, NULL, ?, ?, ?, NULL, NULL, ?, '[]', 1, 'user_confirmed')`
        ).run(rawId, source.chapterId, sourceParagraphId, Number(eventOrderRow.next_order), payload.title, payload.content);
        return { memoryCardId: `event:${rawId}`, cardType: payload.cardType };
      }
      if (payload.cardType === 'foreshadowing') {
        db.prepare(
          `INSERT INTO foreshadowings (id, setup_paragraph_id, expected_payoff, payoff_paragraph_id, status, notes)
           VALUES (?, ?, ?, NULL, 'user_confirmed', ?)`
        ).run(rawId, sourceParagraphId, payload.content, payload.title);
        return { memoryCardId: `foreshadowing:${rawId}`, cardType: payload.cardType };
      }
      db.prepare(
        `INSERT INTO style_guides (id, scope_type, scope_id, features_json, sample_paragraph_ids_json, created_at)
         VALUES (?, 'project', ?, ?, ?, ?)`
      ).run(
        rawId,
        payload.title,
        JSON.stringify({ title: payload.title, content: payload.content }),
        JSON.stringify(payload.sourceParagraphIds),
        timestamp
      );
      return { memoryCardId: rawId, cardType: payload.cardType };
    });
    return write();
  } finally {
    db.close();
  }
}

export function applyAgentArtifact(dbPath: string, input: AgentArtifactDecisionInput): AgentArtifactDecisionResult {
  const artifact = readPendingArtifact(dbPath, input.artifactId);
  let appliedResult: unknown;
  if (artifact.artifactType === 'polish_revision') {
    appliedResult = applyPolishArtifact(dbPath, artifact);
  } else if (artifact.artifactType === 'expansion_draft') {
    appliedResult = applyExpansionArtifact(dbPath, artifact);
  } else if (artifact.artifactType === 'issue_action') {
    appliedResult = applyIssueActionArtifact(dbPath, artifact);
  } else {
    appliedResult = applyMemoryUpdateArtifact(dbPath, artifact);
  }
  writeDecision(dbPath, artifact, 'approved');
  return {
    artifactId: artifact.id,
    status: 'approved',
    decision: 'approved',
    appliedType: artifact.artifactType,
    appliedResult,
  };
}

export function rejectAgentArtifact(dbPath: string, input: AgentArtifactDecisionInput): AgentArtifactDecisionResult {
  const artifact = readPendingArtifact(dbPath, input.artifactId);
  writeDecision(dbPath, artifact, 'rejected');
  return {
    artifactId: artifact.id,
    status: 'rejected',
    decision: 'rejected',
    appliedType: null,
    appliedResult: null,
  };
}
