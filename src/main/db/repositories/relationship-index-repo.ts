import { z } from "zod";
import type { SqliteDatabase } from "../database";
import { createId } from "../../shared/ids";
import {
  relationshipDimensionListSchema,
  relationshipEntityImportanceSchema,
  relationshipEntityKindSchema,
  relationshipIndexChapterStatusSchema,
  relationshipIndexJobStatusSchema,
  relationshipMentionDirectionSchema,
  relationshipMentionPolaritySchema,
  relationshipEvidenceSourceSchema,
  relationshipExtractionSourceSchema,
  normalizeRelationshipCharacterName,
  relationshipEntityLookupKeys,
  type RelationshipDimension,
  type RelationshipEntityImportance,
  type RelationshipEntityKind,
  type RelationshipEvidenceSource,
  type RelationshipExtractionCharacter,
  type RelationshipExtractionSource,
  type RelationshipIndexChapterStatus,
  type RelationshipIndexExtractionPayload,
  type RelationshipIndexJobStatus,
  type RelationshipMentionDirection,
  type RelationshipMentionPolarity,
  type RelationshipGraphIndexStatus
} from "../../shared/relationship-index";

type RelationshipIndexChapterRow = {
  readonly id: string;
  readonly project_id: string;
  readonly chapter_id: string;
  readonly chapter_title: string;
  readonly chapter_order: number;
  readonly content_hash: string;
  readonly status: string;
  readonly eligible_at: string | null;
  readonly indexed_at: string | null;
  readonly stable_after_ms: number;
  readonly extractor_version: string;
  readonly extraction_source: string;
  readonly token_count: number;
  readonly error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

type RelationshipIndexJobRow = {
  readonly id: string;
  readonly project_id: string;
  readonly chapter_id: string;
  readonly source_hash: string;
  readonly status: string;
  readonly priority: number;
  readonly attempt_count: number;
  readonly eligible_at: string | null;
  readonly next_run_at: string | null;
  readonly error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly started_at: string | null;
  readonly finished_at: string | null;
};

type RelationshipEntityRow = {
  readonly id: string;
  readonly project_id: string;
  readonly canonical_name: string;
  readonly aliases_json: string;
  readonly entity_kind: string;
  readonly importance: string;
  readonly role_summary: string | null;
  readonly faction: string | null;
  readonly first_chapter_order: number | null;
  readonly latest_chapter_order: number | null;
  readonly source_chapter_ids_json: string;
  readonly confidence: number;
  readonly created_at: string;
  readonly updated_at: string;
};

type RelationshipMentionRow = {
  readonly id: string;
  readonly project_id: string;
  readonly chapter_id: string;
  readonly chapter_title: string;
  readonly chapter_order: number;
  readonly source_hash: string;
  readonly source_name: string;
  readonly target_name: string;
  readonly source_entity_id: string | null;
  readonly target_entity_id: string | null;
  readonly base_relation_label: string;
  readonly base_relation_summary: string | null;
  readonly plot_relation_label: string;
  readonly plot_relation_summary: string;
  readonly primary_dimension_name: string;
  readonly relationship_dimensions_json: string;
  readonly semantic_markers_json: string;
  readonly direction: string;
  readonly polarity: string;
  readonly intensity: number;
  readonly change_summary: string;
  readonly start_state: string | null;
  readonly end_state: string | null;
  readonly reason: string | null;
  readonly evidence_quote: string;
  readonly evidence_source: string;
  readonly confidence: number;
  readonly uncertainty: string | null;
  readonly created_at: string;
};

export type RelationshipIndexChapterRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly chapterOrder: number;
  readonly contentHash: string;
  readonly status: RelationshipIndexChapterStatus;
  readonly eligibleAt: string | null;
  readonly indexedAt: string | null;
  readonly stableAfterMs: number;
  readonly extractorVersion: string;
  readonly extractionSource: RelationshipExtractionSource;
  readonly tokenCount: number;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type RelationshipIndexJobRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly chapterId: string;
  readonly sourceHash: string;
  readonly status: RelationshipIndexJobStatus;
  readonly priority: number;
  readonly attemptCount: number;
  readonly eligibleAt: string | null;
  readonly nextRunAt: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
};

export type RelationshipEntityRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly canonicalName: string;
  readonly aliases: string[];
  readonly entityKind: RelationshipEntityKind;
  readonly importance: RelationshipEntityImportance;
  readonly roleSummary: string | null;
  readonly faction: string | null;
  readonly firstChapterOrder: number | null;
  readonly latestChapterOrder: number | null;
  readonly sourceChapterIds: string[];
  readonly confidence: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type RelationshipMentionRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly chapterOrder: number;
  readonly sourceHash: string;
  readonly sourceName: string;
  readonly targetName: string;
  readonly sourceEntityId: string | null;
  readonly targetEntityId: string | null;
  readonly baseRelationLabel: string;
  readonly baseRelationSummary: string | null;
  readonly plotRelationLabel: string;
  readonly plotRelationSummary: string;
  readonly primaryDimensionName: string;
  readonly relationshipDimensions: RelationshipDimension[];
  readonly semanticMarkers: string[];
  readonly direction: RelationshipMentionDirection;
  readonly polarity: RelationshipMentionPolarity;
  readonly intensity: number;
  readonly changeSummary: string;
  readonly startState: string | null;
  readonly endState: string | null;
  readonly reason: string | null;
  readonly evidenceQuote: string;
  readonly evidenceSource: RelationshipEvidenceSource;
  readonly confidence: number;
  readonly uncertainty: string | null;
  readonly createdAt: string;
};

export type MarkRelationshipChapterWaitingStableInput = {
  readonly projectId: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly chapterOrder: number;
  readonly contentHash: string;
  readonly stableAfterMs: number;
  readonly extractorVersion: string;
  readonly eligibleAt: string | null;
  readonly now: string;
};

export type MarkRelationshipChapterLegacyMissingInput = {
  readonly projectId: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly chapterOrder: number;
  readonly contentHash: string;
  readonly extractorVersion: string;
  readonly now: string;
};

export type MarkRelationshipChapterStaleInput = {
  readonly projectId: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly chapterOrder: number;
  readonly contentHash: string;
  readonly extractorVersion: string;
  readonly now: string;
};

export type MarkRelationshipChapterMaterializationFailedInput = {
  readonly projectId: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly chapterOrder: number;
  readonly contentHash: string;
  readonly extractorVersion: string;
  readonly error: string;
  readonly now: string;
};

export type EnqueueRelationshipChapterJobInput = {
  readonly projectId: string;
  readonly chapterId: string;
  readonly sourceHash: string;
  readonly priority: number;
  readonly eligibleAt?: string | null;
  readonly nextRunAt?: string | null;
  readonly attemptCount?: number;
  readonly now: string;
};

export type ReplaceRelationshipChapterExtractionInput = {
  readonly projectId: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly chapterOrder: number;
  readonly sourceHash: string;
  readonly payload: RelationshipIndexExtractionPayload;
  readonly tokenCount: number;
  readonly stableAfterMs: number;
  readonly extractorVersion: string;
  readonly extractionSource?: RelationshipExtractionSource;
  readonly evidenceSource?: RelationshipEvidenceSource;
  readonly indexedAt: string;
  readonly now: string;
};

export type MarkRelationshipChapterSkippedTooShortInput = {
  readonly projectId: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly chapterOrder: number;
  readonly contentHash: string;
  readonly stableAfterMs: number;
  readonly extractorVersion: string;
  readonly now: string;
};

const stringListSchema = z.array(z.string());

function parseJson<T>(value: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(value));
}

function uniqueStrings(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = normalizeRelationshipCharacterName(value);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
  }
  return result;
}

function addEntityLookupKeys(entityIdByKey: Map<string, string | null>, name: string, entityId: string): void {
  for (const key of relationshipEntityLookupKeys(name)) {
    const existing = entityIdByKey.get(key);
    if (existing === undefined || existing === entityId) {
      entityIdByKey.set(key, entityId);
      continue;
    }
    entityIdByKey.set(key, null);
  }
}

function resolveEntityIdByName(entityIdByKey: ReadonlyMap<string, string | null>, name: string): string | null {
  const candidates = new Set<string>();
  for (const key of relationshipEntityLookupKeys(name)) {
    const entityId = entityIdByKey.get(key);
    if (entityId === null) {
      return null;
    }
    if (entityId) {
      candidates.add(entityId);
    }
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

function addEntityResolutionCandidateKeys(candidateKeys: Set<string>, name: string, options: { readonly allowAddressKeys: boolean }): void {
  for (const key of relationshipEntityLookupKeys(name)) {
    if (!options.allowAddressKeys && key.startsWith("address:")) {
      continue;
    }
    candidateKeys.add(key);
  }
}

function isAddressLookupKey(key: string): boolean {
  return key.startsWith("address:");
}

function isRelationshipAddressTerm(name: string): boolean {
  return relationshipEntityLookupKeys(name).some(isAddressLookupKey);
}

function isAddressOnlyEntity(entity: RelationshipEntityRecord): boolean {
  return isRelationshipAddressTerm(entity.canonicalName) && entity.aliases.every(isRelationshipAddressTerm);
}

function relationshipAddressLookupKeys(names: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const name of names) {
    for (const key of relationshipEntityLookupKeys(name)) {
      if (isAddressLookupKey(key)) {
        keys.add(key);
      }
    }
  }
  return keys;
}

function mapChapter(row: RelationshipIndexChapterRow): RelationshipIndexChapterRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    chapterOrder: row.chapter_order,
    contentHash: row.content_hash,
    status: relationshipIndexChapterStatusSchema.parse(row.status),
    eligibleAt: row.eligible_at,
    indexedAt: row.indexed_at,
    stableAfterMs: row.stable_after_ms,
    extractorVersion: row.extractor_version,
    extractionSource: relationshipExtractionSourceSchema.parse(row.extraction_source),
    tokenCount: row.token_count,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapJob(row: RelationshipIndexJobRow): RelationshipIndexJobRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id,
    sourceHash: row.source_hash,
    status: relationshipIndexJobStatusSchema.parse(row.status),
    priority: row.priority,
    attemptCount: row.attempt_count,
    eligibleAt: row.eligible_at,
    nextRunAt: row.next_run_at,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

function mapEntity(row: RelationshipEntityRow): RelationshipEntityRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    canonicalName: row.canonical_name,
    aliases: parseJson(row.aliases_json, stringListSchema),
    entityKind: relationshipEntityKindSchema.parse(row.entity_kind),
    importance: relationshipEntityImportanceSchema.parse(row.importance),
    roleSummary: row.role_summary,
    faction: row.faction,
    firstChapterOrder: row.first_chapter_order,
    latestChapterOrder: row.latest_chapter_order,
    sourceChapterIds: parseJson(row.source_chapter_ids_json, stringListSchema),
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMention(row: RelationshipMentionRow): RelationshipMentionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    chapterOrder: row.chapter_order,
    sourceHash: row.source_hash,
    sourceName: row.source_name,
    targetName: row.target_name,
    sourceEntityId: row.source_entity_id,
    targetEntityId: row.target_entity_id,
    baseRelationLabel: row.base_relation_label,
    baseRelationSummary: row.base_relation_summary,
    plotRelationLabel: row.plot_relation_label,
    plotRelationSummary: row.plot_relation_summary,
    primaryDimensionName: row.primary_dimension_name,
    relationshipDimensions: parseJson(row.relationship_dimensions_json, relationshipDimensionListSchema),
    semanticMarkers: parseJson(row.semantic_markers_json, stringListSchema),
    direction: relationshipMentionDirectionSchema.parse(row.direction),
    polarity: relationshipMentionPolaritySchema.parse(row.polarity),
    intensity: row.intensity,
    changeSummary: row.change_summary,
    startState: row.start_state,
    endState: row.end_state,
    reason: row.reason,
    evidenceQuote: row.evidence_quote,
    evidenceSource: relationshipEvidenceSourceSchema.parse(row.evidence_source),
    confidence: row.confidence,
    uncertainty: row.uncertainty,
    createdAt: row.created_at
  };
}

export class RelationshipIndexRepository {
  constructor(private readonly db: SqliteDatabase) {}

  markChapterWaitingStable(input: MarkRelationshipChapterWaitingStableInput): RelationshipIndexChapterRecord {
    const id = createId("relationship_chapter");
    this.db
      .prepare(
        `INSERT INTO relationship_index_chapters
         (id, project_id, chapter_id, chapter_title, chapter_order, content_hash, status, eligible_at, indexed_at,
          stable_after_ms, extractor_version, token_count, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'waiting_stable', ?, NULL, ?, ?, 0, NULL, ?, ?)
         ON CONFLICT(project_id, chapter_id) DO UPDATE SET
           chapter_title = excluded.chapter_title,
           chapter_order = excluded.chapter_order,
           content_hash = excluded.content_hash,
           status = 'waiting_stable',
           eligible_at = excluded.eligible_at,
           indexed_at = NULL,
           stable_after_ms = excluded.stable_after_ms,
           extractor_version = excluded.extractor_version,
           token_count = 0,
           error = NULL,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        input.projectId,
        input.chapterId,
        input.chapterTitle,
        input.chapterOrder,
        input.contentHash,
        input.eligibleAt,
        input.stableAfterMs,
        input.extractorVersion,
        input.now,
        input.now
      );

    const record = this.getChapterIndexState(input.projectId, input.chapterId);
    if (!record) {
      throw new Error("人物关系章节索引状态写入失败。");
    }
    return record;
  }

  markChapterLegacyMissingRelationships(input: MarkRelationshipChapterLegacyMissingInput): RelationshipIndexChapterRecord {
    this.db
      .prepare(
        `INSERT INTO relationship_index_chapters
         (id, project_id, chapter_id, chapter_title, chapter_order, content_hash, status, eligible_at, indexed_at,
          stable_after_ms, extractor_version, extraction_source, token_count, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'legacy_missing_relationships', NULL, NULL, 0, ?, 'summary_payload', 0, NULL, ?, ?)
         ON CONFLICT(project_id, chapter_id) DO UPDATE SET
           chapter_title = excluded.chapter_title,
           chapter_order = excluded.chapter_order,
           content_hash = excluded.content_hash,
           status = 'legacy_missing_relationships',
           eligible_at = NULL,
           indexed_at = NULL,
           stable_after_ms = 0,
           extractor_version = excluded.extractor_version,
           extraction_source = 'summary_payload',
           token_count = 0,
           error = NULL,
           updated_at = excluded.updated_at`
      )
      .run(
        createId("relationship_chapter"),
        input.projectId,
        input.chapterId,
        input.chapterTitle,
        input.chapterOrder,
        input.contentHash,
        input.extractorVersion,
        input.now,
        input.now
      );
    const record = this.getChapterIndexState(input.projectId, input.chapterId);
    if (!record) {
      throw new Error("旧章节人物关系缺失状态写入失败。");
    }
    return record;
  }

  markChapterStale(input: MarkRelationshipChapterStaleInput): RelationshipIndexChapterRecord {
    this.db
      .prepare(
        `INSERT INTO relationship_index_chapters
         (id, project_id, chapter_id, chapter_title, chapter_order, content_hash, status, eligible_at, indexed_at,
          stable_after_ms, extractor_version, extraction_source, token_count, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'stale', NULL, NULL, 0, ?, 'summary_payload', 0, NULL, ?, ?)
         ON CONFLICT(project_id, chapter_id) DO UPDATE SET
           chapter_title = excluded.chapter_title,
           chapter_order = excluded.chapter_order,
           content_hash = excluded.content_hash,
           status = 'stale',
           eligible_at = NULL,
           indexed_at = NULL,
           stable_after_ms = 0,
           extractor_version = excluded.extractor_version,
           extraction_source = 'summary_payload',
           token_count = 0,
           error = NULL,
           updated_at = excluded.updated_at`
      )
      .run(
        createId("relationship_chapter"),
        input.projectId,
        input.chapterId,
        input.chapterTitle,
        input.chapterOrder,
        input.contentHash,
        input.extractorVersion,
        input.now,
        input.now
      );
    const record = this.getChapterIndexState(input.projectId, input.chapterId);
    if (!record) {
      throw new Error("人物关系章节过期状态写入失败。");
    }
    return record;
  }

  markChapterMaterializationFailed(input: MarkRelationshipChapterMaterializationFailedInput): RelationshipIndexChapterRecord {
    this.db
      .prepare(
        `INSERT INTO relationship_index_chapters
         (id, project_id, chapter_id, chapter_title, chapter_order, content_hash, status, eligible_at, indexed_at,
          stable_after_ms, extractor_version, extraction_source, token_count, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'failed', NULL, NULL, 0, ?, 'summary_payload', 0, ?, ?, ?)
         ON CONFLICT(project_id, chapter_id) DO UPDATE SET
           chapter_title = excluded.chapter_title,
           chapter_order = excluded.chapter_order,
           content_hash = excluded.content_hash,
           status = 'failed',
           eligible_at = NULL,
           indexed_at = NULL,
           stable_after_ms = 0,
           extractor_version = excluded.extractor_version,
           extraction_source = 'summary_payload',
           token_count = 0,
           error = excluded.error,
           updated_at = excluded.updated_at`
      )
      .run(
        createId("relationship_chapter"),
        input.projectId,
        input.chapterId,
        input.chapterTitle,
        input.chapterOrder,
        input.contentHash,
        input.extractorVersion,
        input.error,
        input.now,
        input.now
      );
    const record = this.getChapterIndexState(input.projectId, input.chapterId);
    if (!record) {
      throw new Error("人物关系章节失败状态写入失败。");
    }
    return record;
  }

  enqueueChapterJob(input: EnqueueRelationshipChapterJobInput): RelationshipIndexJobRecord {
    const existing = this.db
      .prepare(
        `SELECT * FROM relationship_index_jobs
         WHERE project_id = ? AND chapter_id = ? AND source_hash = ? AND status IN ('queued', 'running')
         ORDER BY CASE status WHEN 'queued' THEN 0 ELSE 1 END, updated_at DESC, rowid DESC
         LIMIT 1`
      )
      .get(input.projectId, input.chapterId, input.sourceHash) as RelationshipIndexJobRow | undefined;

    if (existing?.status === "running") {
      return mapJob(existing);
    }

    if (existing?.status === "queued") {
      const eligibleAt = input.eligibleAt === undefined ? existing.eligible_at : input.eligibleAt;
      const nextRunAt = input.nextRunAt === undefined ? existing.next_run_at : input.nextRunAt;
      this.db
        .prepare(
          `UPDATE relationship_index_jobs
           SET priority = ?, eligible_at = ?, next_run_at = ?, error = NULL, updated_at = ?
           WHERE id = ?`
        )
        .run(Math.max(existing.priority, input.priority), eligibleAt, nextRunAt, input.now, existing.id);
      const updated = this.getJobById(existing.id);
      if (!updated) {
        throw new Error("人物关系索引任务更新失败。");
      }
      return updated;
    }

    const job: RelationshipIndexJobRecord = {
      id: createId("relationship_job"),
      projectId: input.projectId,
      chapterId: input.chapterId,
      sourceHash: input.sourceHash,
      status: "queued",
      priority: input.priority,
      attemptCount: input.attemptCount ?? 0,
      eligibleAt: input.eligibleAt ?? null,
      nextRunAt: input.nextRunAt ?? null,
      error: null,
      createdAt: input.now,
      updatedAt: input.now,
      startedAt: null,
      finishedAt: null
    };

    this.db
      .prepare(
        `INSERT INTO relationship_index_jobs
         (id, project_id, chapter_id, source_hash, status, priority, attempt_count, eligible_at, next_run_at,
          error, created_at, updated_at, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        job.id,
        job.projectId,
        job.chapterId,
        job.sourceHash,
        job.status,
        job.priority,
        job.attemptCount,
        job.eligibleAt,
        job.nextRunAt,
        job.error,
        job.createdAt,
        job.updatedAt,
        job.startedAt,
        job.finishedAt
      );
    this.db
      .prepare(
        `UPDATE relationship_index_chapters
         SET status = 'queued', updated_at = ?
         WHERE project_id = ? AND chapter_id = ? AND content_hash = ?`
      )
      .run(input.now, input.projectId, input.chapterId, input.sourceHash);

    return job;
  }

  peekNextRelationshipJob(projectId: string, now: string): RelationshipIndexJobRecord | null {
    const row = this.findNextRunnableJobRow(projectId, now);
    return row ? mapJob(row) : null;
  }

  claimNextRelationshipJob(projectId: string, now: string): RelationshipIndexJobRecord | null {
    const row = this.findNextRunnableJobRow(projectId, now);
    if (!row) {
      return null;
    }

    this.db
      .prepare(
        `UPDATE relationship_index_jobs
         SET status = 'running', attempt_count = attempt_count + 1, error = NULL, started_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(now, now, row.id);
    this.db
      .prepare(
        `UPDATE relationship_index_chapters
         SET status = 'running', updated_at = ?
         WHERE project_id = ? AND chapter_id = ? AND content_hash = ?`
      )
      .run(now, row.project_id, row.chapter_id, row.source_hash);
    return this.getJobById(row.id);
  }

  completeRelationshipJob(jobId: string, now: string): void {
    this.db
      .prepare("UPDATE relationship_index_jobs SET status = 'completed', finished_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, jobId);
  }

  failRelationshipJob(jobId: string, error: string, nextRunAt: string | null, now: string): void {
    const job = this.getJobById(jobId);
    this.db
      .prepare("UPDATE relationship_index_jobs SET status = 'failed', error = ?, next_run_at = ?, finished_at = ?, updated_at = ? WHERE id = ?")
      .run(error, nextRunAt, now, now, jobId);
    if (job) {
      this.db
        .prepare(
          `UPDATE relationship_index_chapters
           SET status = 'failed', error = ?, updated_at = ?
           WHERE project_id = ? AND chapter_id = ? AND content_hash = ? AND status = 'running'`
        )
        .run(error, now, job.projectId, job.chapterId, job.sourceHash);
    }
  }

  cancelRelationshipJob(jobId: string, error: string, now: string): void {
    const job = this.getJobById(jobId);
    this.db
      .prepare("UPDATE relationship_index_jobs SET status = 'cancelled', error = ?, next_run_at = NULL, finished_at = ?, updated_at = ? WHERE id = ?")
      .run(error, now, now, jobId);
    if (job) {
      this.db
        .prepare(
          `UPDATE relationship_index_chapters
           SET status = 'failed', error = ?, updated_at = ?
           WHERE project_id = ? AND chapter_id = ? AND content_hash = ? AND status = 'running'`
        )
        .run(error, now, job.projectId, job.chapterId, job.sourceHash);
    }
  }

  cancelQueuedChapterJobsExceptHash(projectId: string, chapterId: string, sourceHash: string, error: string, now: string): number {
    const result = this.db
      .prepare(
        `UPDATE relationship_index_jobs
         SET status = 'cancelled', error = ?, next_run_at = NULL, finished_at = ?, updated_at = ?
         WHERE project_id = ? AND chapter_id = ? AND source_hash != ? AND status = 'queued'`
      )
      .run(error, now, now, projectId, chapterId, sourceHash);
    return result.changes;
  }

  resetRunningJobs(projectId: string, now: string): void {
    this.db
      .prepare(
        `UPDATE relationship_index_jobs
         SET status = 'queued', started_at = NULL, updated_at = ?
         WHERE project_id = ? AND status = 'running'`
      )
      .run(now, projectId);
    this.db
      .prepare(
        `UPDATE relationship_index_chapters
         SET status = 'queued', updated_at = ?
         WHERE project_id = ? AND status = 'running'`
      )
      .run(now, projectId);
  }

  replaceChapterExtraction(input: ReplaceRelationshipChapterExtractionInput): void {
    const transaction = this.db.transaction(() => {
      const extractionSource = input.extractionSource ?? "summary_payload";
      const evidenceSource = input.evidenceSource ?? "summary_payload";
      const entityIdByKey = new Map<string, string | null>();
      for (const character of input.payload.characters) {
        const entity = this.upsertEntityFromCharacter(input, character);
        addEntityLookupKeys(entityIdByKey, entity.canonicalName, entity.id);
        for (const alias of entity.aliases) {
          addEntityLookupKeys(entityIdByKey, alias, entity.id);
        }
      }

      this.db.prepare("DELETE FROM relationship_mentions WHERE project_id = ? AND chapter_id = ?").run(input.projectId, input.chapterId);

      for (const mention of input.payload.mentions) {
        const sourceName = normalizeRelationshipCharacterName(mention.sourceName);
        const targetName = normalizeRelationshipCharacterName(mention.targetName);
        this.db
          .prepare(
            `INSERT INTO relationship_mentions
             (id, project_id, chapter_id, chapter_title, chapter_order, source_hash, source_name, target_name,
              source_entity_id, target_entity_id, base_relation_label, base_relation_summary, plot_relation_label,
              plot_relation_summary, primary_dimension_name, relationship_dimensions_json, semantic_markers_json,
              direction, polarity, intensity, change_summary, start_state, end_state, reason, evidence_quote,
              evidence_source, confidence, uncertainty, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            createId("relationship_mention"),
            input.projectId,
            input.chapterId,
            input.chapterTitle,
            input.chapterOrder,
            input.sourceHash,
            sourceName,
            targetName,
            resolveEntityIdByName(entityIdByKey, sourceName),
            resolveEntityIdByName(entityIdByKey, targetName),
            mention.baseRelationLabel,
            mention.baseRelationSummary,
            mention.plotRelationLabel,
            mention.plotRelationSummary,
            mention.primaryDimensionName,
            JSON.stringify(mention.relationshipDimensions),
            JSON.stringify(mention.semanticMarkers),
            mention.direction,
            mention.polarity,
            mention.intensity,
            mention.changeSummary,
            mention.startState,
            mention.endState,
            mention.reason,
            mention.evidenceQuote,
            evidenceSource,
            mention.confidence,
            mention.uncertainty,
            input.now
          );
      }

      this.db
        .prepare(
          `INSERT INTO relationship_index_chapters
           (id, project_id, chapter_id, chapter_title, chapter_order, content_hash, status, eligible_at, indexed_at,
            stable_after_ms, extractor_version, extraction_source, token_count, error, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'ready', NULL, ?, ?, ?, ?, ?, NULL, ?, ?)
           ON CONFLICT(project_id, chapter_id) DO UPDATE SET
             chapter_title = excluded.chapter_title,
             chapter_order = excluded.chapter_order,
             content_hash = excluded.content_hash,
             status = 'ready',
             eligible_at = NULL,
             indexed_at = excluded.indexed_at,
             stable_after_ms = excluded.stable_after_ms,
             extractor_version = excluded.extractor_version,
             extraction_source = excluded.extraction_source,
             token_count = excluded.token_count,
             error = NULL,
             updated_at = excluded.updated_at`
        )
        .run(
          createId("relationship_chapter"),
          input.projectId,
          input.chapterId,
          input.chapterTitle,
          input.chapterOrder,
          input.sourceHash,
          input.indexedAt,
          input.stableAfterMs,
          input.extractorVersion,
          extractionSource,
          input.tokenCount,
          input.now,
          input.now
        );
      this.rebuildProjectEntityReferences(input.projectId, input.now);
    });

    transaction();
  }

  markChapterSkippedTooShort(input: MarkRelationshipChapterSkippedTooShortInput): RelationshipIndexChapterRecord {
    this.db
      .prepare(
        `INSERT INTO relationship_index_chapters
         (id, project_id, chapter_id, chapter_title, chapter_order, content_hash, status, eligible_at, indexed_at,
          stable_after_ms, extractor_version, token_count, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'skipped_too_short', NULL, NULL, ?, ?, 0, NULL, ?, ?)
         ON CONFLICT(project_id, chapter_id) DO UPDATE SET
           chapter_title = excluded.chapter_title,
           chapter_order = excluded.chapter_order,
           content_hash = excluded.content_hash,
           status = 'skipped_too_short',
           eligible_at = NULL,
           indexed_at = NULL,
           stable_after_ms = excluded.stable_after_ms,
           extractor_version = excluded.extractor_version,
           token_count = 0,
           error = NULL,
           updated_at = excluded.updated_at`
      )
      .run(
        createId("relationship_chapter"),
        input.projectId,
        input.chapterId,
        input.chapterTitle,
        input.chapterOrder,
        input.contentHash,
        input.stableAfterMs,
        input.extractorVersion,
        input.now,
        input.now
      );
    const record = this.getChapterIndexState(input.projectId, input.chapterId);
    if (!record) {
      throw new Error("人物关系章节短章状态写入失败。");
    }
    return record;
  }

  getChapterIndexState(projectId: string, chapterId: string): RelationshipIndexChapterRecord | null {
    const row = this.db
      .prepare("SELECT * FROM relationship_index_chapters WHERE project_id = ? AND chapter_id = ?")
      .get(projectId, chapterId) as RelationshipIndexChapterRow | undefined;
    return row ? mapChapter(row) : null;
  }

  listChapterIndexStates(projectId: string): RelationshipIndexChapterRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM relationship_index_chapters WHERE project_id = ? ORDER BY chapter_order ASC, rowid ASC")
        .all(projectId) as RelationshipIndexChapterRow[]
    ).map(mapChapter);
  }

  listRelationshipJobs(projectId: string): RelationshipIndexJobRecord[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM relationship_index_jobs
           WHERE project_id = ?
           ORDER BY
             CASE status
               WHEN 'running' THEN 0
               WHEN 'queued' THEN 1
               WHEN 'failed' THEN 2
               ELSE 3
             END,
             priority DESC,
             updated_at DESC,
             rowid DESC`
        )
        .all(projectId) as RelationshipIndexJobRow[]
    ).map(mapJob);
  }

  listEntities(projectId: string): RelationshipEntityRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM relationship_entities WHERE project_id = ? ORDER BY canonical_name ASC, rowid ASC")
        .all(projectId) as RelationshipEntityRow[]
    ).map(mapEntity);
  }

  listMentions(projectId: string): RelationshipMentionRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM relationship_mentions WHERE project_id = ? ORDER BY chapter_order ASC, rowid ASC")
        .all(projectId) as RelationshipMentionRow[]
    ).map(mapMention);
  }

  getIndexStatus(projectId: string): RelationshipGraphIndexStatus {
    const counts = new Map<string, number>();
    const rows = this.db
      .prepare("SELECT status, COUNT(*) AS count FROM relationship_index_chapters WHERE project_id = ? GROUP BY status")
      .all(projectId) as Array<{ readonly status: string; readonly count: number }>;
    for (const row of rows) {
      counts.set(relationshipIndexChapterStatusSchema.parse(row.status), row.count);
    }
    const ready = counts.get("ready") ?? 0;
    const stale = counts.get("stale") ?? 0;
    const legacyMissingRelationships = counts.get("legacy_missing_relationships") ?? 0;
    const waitingStable = counts.get("waiting_stable") ?? 0;
    const queued = counts.get("queued") ?? 0;
    const running = counts.get("running") ?? 0;
    const failed = counts.get("failed") ?? 0;
    const skippedTooShort = counts.get("skipped_too_short") ?? 0;
    return {
      ready,
      stale,
      legacyMissingRelationships,
      waitingStable,
      queued,
      running,
      failed,
      skippedTooShort,
      total: ready + stale + legacyMissingRelationships + waitingStable + queued + running + failed + skippedTooShort
    };
  }

  private upsertEntityFromCharacter(input: ReplaceRelationshipChapterExtractionInput, character: RelationshipExtractionCharacter): RelationshipEntityRecord {
    const canonicalName = normalizeRelationshipCharacterName(character.name);
    const existing = this.resolveExistingEntityForCharacter(input.projectId, canonicalName, character.aliases);

    if (existing) {
      const shouldPromoteAddressPlaceholder = isAddressOnlyEntity(existing) && !isRelationshipAddressTerm(canonicalName);
      const nextCanonicalName = shouldPromoteAddressPlaceholder ? canonicalName : existing.canonicalName;
      const aliases = shouldPromoteAddressPlaceholder
        ? [existing.canonicalName, ...existing.aliases, ...character.aliases]
        : canonicalName === existing.canonicalName
          ? character.aliases
          : [canonicalName, ...character.aliases];
      this.db
        .prepare(
          `UPDATE relationship_entities
           SET canonical_name = ?,
               aliases_json = ?,
               entity_kind = ?,
               importance = ?,
               role_summary = ?,
               faction = ?,
               first_chapter_order = ?,
               latest_chapter_order = ?,
               source_chapter_ids_json = ?,
               confidence = ?,
               updated_at = ?
           WHERE id = ?`
        )
        .run(
          nextCanonicalName,
          JSON.stringify(uniqueStrings([...existing.aliases, ...aliases])),
          character.entityKind,
          character.importance,
          character.roleSummary || null,
          character.faction,
          existing.firstChapterOrder === null ? input.chapterOrder : Math.min(existing.firstChapterOrder, input.chapterOrder),
          existing.latestChapterOrder === null ? input.chapterOrder : Math.max(existing.latestChapterOrder, input.chapterOrder),
          JSON.stringify(uniqueStrings([...existing.sourceChapterIds, input.chapterId])),
          character.confidence,
          input.now,
          existing.id
        );
      const updated = this.getEntityById(existing.id);
      if (!updated) {
        throw new Error("人物关系实体更新失败。");
      }
      return updated;
    }

    const entity: RelationshipEntityRecord = {
      id: createId("relationship_entity"),
      projectId: input.projectId,
      canonicalName,
      aliases: uniqueStrings(character.aliases),
      entityKind: character.entityKind,
      importance: character.importance,
      roleSummary: character.roleSummary || null,
      faction: character.faction,
      firstChapterOrder: input.chapterOrder,
      latestChapterOrder: input.chapterOrder,
      sourceChapterIds: [input.chapterId],
      confidence: character.confidence,
      createdAt: input.now,
      updatedAt: input.now
    };

    this.db
      .prepare(
        `INSERT INTO relationship_entities
         (id, project_id, canonical_name, aliases_json, entity_kind, importance, role_summary, faction,
          first_chapter_order, latest_chapter_order, source_chapter_ids_json, confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entity.id,
        entity.projectId,
        entity.canonicalName,
        JSON.stringify(entity.aliases),
        entity.entityKind,
        entity.importance,
        entity.roleSummary,
        entity.faction,
        entity.firstChapterOrder,
        entity.latestChapterOrder,
        JSON.stringify(entity.sourceChapterIds),
        entity.confidence,
        entity.createdAt,
        entity.updatedAt
      );

    return entity;
  }

  private resolveExistingEntityForCharacter(projectId: string, canonicalName: string, aliases: readonly string[]): RelationshipEntityRecord | null {
    const canonicalRow = this.db
      .prepare("SELECT * FROM relationship_entities WHERE project_id = ? AND canonical_name = ?")
      .get(projectId, canonicalName) as RelationshipEntityRow | undefined;
    if (canonicalRow) {
      return mapEntity(canonicalRow);
    }

    const candidateKeys = new Set<string>();
    addEntityResolutionCandidateKeys(candidateKeys, canonicalName, { allowAddressKeys: true });
    for (const alias of aliases) {
      addEntityResolutionCandidateKeys(candidateKeys, alias, { allowAddressKeys: false });
    }
    if (candidateKeys.size === 0) {
      return null;
    }

    const matches = new Map<string, RelationshipEntityRecord>();
    for (const entity of this.listEntities(projectId)) {
      const entityKeys = new Set<string>();
      for (const name of [entity.canonicalName, ...entity.aliases]) {
        for (const key of relationshipEntityLookupKeys(name)) {
          entityKeys.add(key);
        }
      }
      if ([...candidateKeys].some((key) => entityKeys.has(key))) {
        matches.set(entity.id, entity);
      }
    }

    if (matches.size === 1) {
      return [...matches.values()][0];
    }
    if (matches.size > 1 || isRelationshipAddressTerm(canonicalName)) {
      return null;
    }

    const addressKeys = relationshipAddressLookupKeys(aliases);
    if (addressKeys.size === 0) {
      return null;
    }

    const addressOnlyMatches = new Map<string, RelationshipEntityRecord>();
    for (const entity of this.listEntities(projectId)) {
      if (!isAddressOnlyEntity(entity)) {
        continue;
      }
      const entityAddressKeys = relationshipAddressLookupKeys([entity.canonicalName, ...entity.aliases]);
      if ([...addressKeys].some((key) => entityAddressKeys.has(key))) {
        addressOnlyMatches.set(entity.id, entity);
      }
    }

    return addressOnlyMatches.size === 1 ? [...addressOnlyMatches.values()][0] : null;
  }

  private getEntityById(entityId: string): RelationshipEntityRecord | null {
    const row = this.db.prepare("SELECT * FROM relationship_entities WHERE id = ?").get(entityId) as RelationshipEntityRow | undefined;
    return row ? mapEntity(row) : null;
  }

  private getJobById(jobId: string): RelationshipIndexJobRecord | null {
    const row = this.db.prepare("SELECT * FROM relationship_index_jobs WHERE id = ?").get(jobId) as RelationshipIndexJobRow | undefined;
    return row ? mapJob(row) : null;
  }

  private rebuildProjectEntityReferences(projectId: string, now: string): void {
    const references = this.db
      .prepare(
        `SELECT relationship_mentions.source_entity_id AS entity_id,
                relationship_mentions.chapter_id AS chapter_id,
                relationship_mentions.chapter_order AS chapter_order
         FROM relationship_mentions
         INNER JOIN relationship_index_chapters
           ON relationship_index_chapters.project_id = relationship_mentions.project_id
          AND relationship_index_chapters.chapter_id = relationship_mentions.chapter_id
          AND relationship_index_chapters.content_hash = relationship_mentions.source_hash
          AND relationship_index_chapters.status = 'ready'
         WHERE relationship_mentions.project_id = ?
           AND relationship_mentions.source_entity_id IS NOT NULL
         UNION ALL
         SELECT relationship_mentions.target_entity_id AS entity_id,
                relationship_mentions.chapter_id AS chapter_id,
                relationship_mentions.chapter_order AS chapter_order
         FROM relationship_mentions
         INNER JOIN relationship_index_chapters
           ON relationship_index_chapters.project_id = relationship_mentions.project_id
          AND relationship_index_chapters.chapter_id = relationship_mentions.chapter_id
          AND relationship_index_chapters.content_hash = relationship_mentions.source_hash
          AND relationship_index_chapters.status = 'ready'
         WHERE relationship_mentions.project_id = ?
           AND relationship_mentions.target_entity_id IS NOT NULL`
      )
      .all(projectId, projectId) as Array<{ readonly entity_id: string; readonly chapter_id: string; readonly chapter_order: number }>;

    const refsByEntity = new Map<string, { readonly chapterIds: Set<string>; readonly chapterOrders: number[] }>();
    for (const reference of references) {
      const existing = refsByEntity.get(reference.entity_id);
      if (existing) {
        existing.chapterIds.add(reference.chapter_id);
        existing.chapterOrders.push(reference.chapter_order);
        continue;
      }
      refsByEntity.set(reference.entity_id, {
        chapterIds: new Set([reference.chapter_id]),
        chapterOrders: [reference.chapter_order]
      });
    }

    const entities = this.db.prepare("SELECT id FROM relationship_entities WHERE project_id = ?").all(projectId) as Array<{ readonly id: string }>;
    for (const entity of entities) {
      const refs = refsByEntity.get(entity.id);
      if (!refs) {
        this.db.prepare("DELETE FROM relationship_entities WHERE id = ?").run(entity.id);
        continue;
      }
      this.db
        .prepare(
          `UPDATE relationship_entities
           SET source_chapter_ids_json = ?,
               first_chapter_order = ?,
               latest_chapter_order = ?,
               updated_at = ?
           WHERE id = ?`
        )
        .run(JSON.stringify([...refs.chapterIds].sort()), Math.min(...refs.chapterOrders), Math.max(...refs.chapterOrders), now, entity.id);
    }
  }

  private findNextRunnableJobRow(projectId: string, now: string): RelationshipIndexJobRow | null {
    const row = this.db
      .prepare(
        `SELECT *
         FROM relationship_index_jobs
         WHERE project_id = ?
           AND status = 'queued'
           AND (eligible_at IS NULL OR eligible_at <= ?)
           AND (next_run_at IS NULL OR next_run_at <= ?)
         ORDER BY priority DESC, COALESCE(eligible_at, ''), created_at ASC, rowid ASC
         LIMIT 1`
      )
      .get(projectId, now, now) as RelationshipIndexJobRow | undefined;
    return row ?? null;
  }
}
