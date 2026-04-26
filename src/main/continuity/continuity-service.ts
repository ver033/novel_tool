import crypto from 'node:crypto';
import Database from 'better-sqlite3';

import type { IssueCard, IssueEvidenceCard } from '../proofread/proofread-service';

type SqliteDb = InstanceType<typeof Database>;

interface ContinuityFactRow {
  id: string;
  subjectEntityId: string | null;
  subjectName: string;
  predicate: string;
  objectText: string;
  factType: string;
  sourceParagraphId: string | null;
  quote: string;
  confidence: number;
  status: string;
  createdAt: string;
  chapterTitle: string | null;
  chapterIndex: number | null;
  paragraphIndex: number | null;
}

export interface RunFactContinuityInput {
  paragraphIds?: string[];
  sourceTaskId?: string;
}

export interface RunFactContinuityResult {
  issues: IssueCard[];
  checkedFactCount: number;
}

function openDb(dbPath: string): SqliteDb {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  return db;
}

function shortHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 14);
}

function evidenceIdFor(issueId: string, role: IssueEvidenceCard['role'], paragraphId: string | null, quote: string): string {
  return `iev-${shortHash(`${issueId}:${role}:${paragraphId ?? ''}:${quote}`)}`;
}

function normalizeObjectText(value: string): string {
  return value.replace(/\s+/g, '').replace(/[，。！？；：、“”‘’"']/g, '').trim();
}

function factGroupKey(fact: ContinuityFactRow): string {
  return `${fact.subjectEntityId ?? fact.subjectName}:${fact.predicate}:${fact.factType}`;
}

function issueTypeFor(factType: string, predicate: string): string {
  if (factType === 'prop') {
    return 'prop_state_conflict';
  }
  if (factType === 'timeline') {
    return 'timeline_conflict';
  }
  if (factType === 'relationship') {
    return 'relationship_conflict';
  }
  if (factType === 'world_rule') {
    return 'world_rule_conflict';
  }
  if (factType === 'knowledge') {
    return 'character_knowledge_conflict';
  }
  if (factType === 'injury') {
    return 'injury_or_body_state_conflict';
  }
  if (/位置|地点|所在地/.test(predicate)) {
    return 'location_conflict';
  }
  return 'continuity_fact_conflict';
}

function friendlyLocation(fact: ContinuityFactRow): string {
  if (fact.chapterTitle && fact.paragraphIndex != null) {
    return `${fact.chapterTitle} / 第 ${fact.paragraphIndex + 1} 段`;
  }
  return fact.sourceParagraphId ?? '未知段落';
}

function severityFor(first: ContinuityFactRow, second: ContinuityFactRow): IssueCard['severity'] {
  return [first.status, second.status].some((status) => status === 'user_confirmed' || status === 'confirmed') ? 'high' : 'medium';
}

function evidenceFor(first: ContinuityFactRow, second: ContinuityFactRow): IssueEvidenceCard[] {
  return [
    {
      paragraphId: first.sourceParagraphId,
      quote: first.quote,
      role: 'conflicting',
      note: `${friendlyLocation(first)}：${first.subjectName}${first.predicate}=${first.objectText}`,
    },
    {
      paragraphId: second.sourceParagraphId,
      quote: second.quote,
      role: 'current',
      note: `${friendlyLocation(second)}：${second.subjectName}${second.predicate}=${second.objectText}`,
    },
  ];
}

function makeIssue(first: ContinuityFactRow, second: ContinuityFactRow, sourceTaskId?: string): IssueCard {
  const timestamp = new Date().toISOString();
  const issueType = issueTypeFor(second.factType, second.predicate);
  const id = `issue-continuity-${shortHash(`${first.id}:${second.id}:${first.objectText}:${second.objectText}`)}`;
  return {
    id,
    type: issueType,
    severity: severityFor(first, second),
    title: `${second.subjectName}${second.predicate}前后不一致`,
    explanation: `${friendlyLocation(first)} 记录为“${first.objectText}”，但 ${friendlyLocation(second)} 又记录为“${second.objectText}”。请确认中间是否有明确转移、找回、撒谎或伏笔解释。`,
    suggestion: '如果这是剧情安排，请标记为伏笔、角色撒谎或作者确认例外；如果不是，请补写过渡或修改其中一处事实。',
    status: 'open',
    currentParagraphId: second.sourceParagraphId,
    sourceTaskId: sourceTaskId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    evidence: evidenceFor(first, second),
  };
}

function readFacts(db: SqliteDb): ContinuityFactRow[] {
  const rows = db
    .prepare(
      `SELECT facts.id,
              facts.subject_entity_id,
              COALESCE(entities.canonical_name, facts.subject_entity_id, '未知对象') AS subject_name,
              facts.predicate,
              facts.object_text,
              facts.fact_type,
              facts.source_paragraph_id,
              facts.quote,
              facts.confidence,
              facts.status,
              facts.created_at,
              chapters.title AS chapter_title,
              chapters.chapter_index,
              paragraphs.paragraph_index
       FROM facts
       LEFT JOIN entities ON entities.id = facts.subject_entity_id
       LEFT JOIN paragraphs ON paragraphs.id = facts.source_paragraph_id
       LEFT JOIN chapters ON chapters.id = paragraphs.chapter_id
       WHERE facts.status NOT IN ('rejected', 'retconned')
       ORDER BY chapters.chapter_index, paragraphs.paragraph_index, facts.created_at, facts.id`
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id),
    subjectEntityId: row.subject_entity_id == null ? null : String(row.subject_entity_id),
    subjectName: String(row.subject_name),
    predicate: String(row.predicate),
    objectText: String(row.object_text),
    factType: String(row.fact_type),
    sourceParagraphId: row.source_paragraph_id == null ? null : String(row.source_paragraph_id),
    quote: String(row.quote),
    confidence: Number(row.confidence),
    status: String(row.status),
    createdAt: String(row.created_at),
    chapterTitle: row.chapter_title == null ? null : String(row.chapter_title),
    chapterIndex: row.chapter_index == null ? null : Number(row.chapter_index),
    paragraphIndex: row.paragraph_index == null ? null : Number(row.paragraph_index),
  }));
}

function buildScopedIssue(group: ContinuityFactRow[], scopedParagraphIds: Set<string>, sourceTaskId?: string): IssueCard | null {
  const scopedFact = [...group]
    .reverse()
    .find((fact) => fact.sourceParagraphId != null && scopedParagraphIds.has(fact.sourceParagraphId));
  if (!scopedFact) {
    return null;
  }
  const scopedValue = normalizeObjectText(scopedFact.objectText);
  const conflictingFact = group.find((fact) => fact.id !== scopedFact.id && normalizeObjectText(fact.objectText) !== scopedValue);
  return conflictingFact ? makeIssue(conflictingFact, scopedFact, sourceTaskId) : null;
}

function buildIssues(facts: ContinuityFactRow[], scopedParagraphIds: Set<string>, sourceTaskId?: string): IssueCard[] {
  const groups = new Map<string, ContinuityFactRow[]>();
  for (const fact of facts) {
    const key = factGroupKey(fact);
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }

  const issues: IssueCard[] = [];
  for (const group of groups.values()) {
    if (scopedParagraphIds.size > 0) {
      const issue = buildScopedIssue(group, scopedParagraphIds, sourceTaskId);
      if (issue) {
        issues.push(issue);
      }
      continue;
    }
    const firstByObject = new Map<string, ContinuityFactRow>();
    for (const fact of group) {
      const normalized = normalizeObjectText(fact.objectText);
      if (!firstByObject.has(normalized)) {
        firstByObject.set(normalized, fact);
      }
    }
    if (firstByObject.size < 2) {
      continue;
    }
    const distinctFacts = [...firstByObject.values()];
    const first = distinctFacts[0];
    const latest = [...group].reverse().find((fact) => normalizeObjectText(fact.objectText) !== normalizeObjectText(first.objectText));
    if (latest) {
      issues.push(makeIssue(first, latest, sourceTaskId));
    }
  }
  return issues;
}

function persistIssues(db: SqliteDb, issues: IssueCard[]): void {
  const write = db.transaction(() => {
    for (const issue of issues) {
      db.prepare(
        `INSERT INTO issues
         (id, type, severity, title, explanation, suggestion, status, current_paragraph_id, source_task_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           severity = excluded.severity,
           title = excluded.title,
           explanation = excluded.explanation,
           suggestion = excluded.suggestion,
           current_paragraph_id = excluded.current_paragraph_id,
           source_task_id = excluded.source_task_id,
           status = 'open',
           updated_at = excluded.updated_at`
      ).run(
        issue.id,
        issue.type,
        issue.severity,
        issue.title,
        issue.explanation,
        issue.suggestion,
        issue.currentParagraphId,
        issue.sourceTaskId,
        issue.createdAt,
        issue.updatedAt
      );
      db.prepare('DELETE FROM issue_evidence WHERE issue_id = ?').run(issue.id);
      for (const evidence of issue.evidence) {
        db.prepare(
          `INSERT INTO issue_evidence
           (id, issue_id, paragraph_id, quote, role, note)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          evidenceIdFor(issue.id, evidence.role, evidence.paragraphId, evidence.quote),
          issue.id,
          evidence.paragraphId,
          evidence.quote,
          evidence.role,
          evidence.note
        );
      }
    }
  });
  write();
}

export function runFactContinuityCheck(dbPath: string, input: RunFactContinuityInput = {}): RunFactContinuityResult {
  const db = openDb(dbPath);
  try {
    const paragraphIds = [...new Set(input.paragraphIds ?? [])];
    const facts = readFacts(db);
    const issues = buildIssues(facts, new Set(paragraphIds), input.sourceTaskId);
    persistIssues(db, issues);
    return {
      issues,
      checkedFactCount: facts.length,
    };
  } finally {
    db.close();
  }
}
