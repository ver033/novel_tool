import { createId } from "../../shared/ids";
import { parseAiCandidateMetadata, stringifyAiCandidateMetadata } from "../../shared/ai-candidate-metadata";
import type {
  AiTaskCandidateRecord,
  AiTaskRecord,
  AiTaskStatus,
  CandidateStatus,
  SelectionSnapshot,
  TaskType
} from "../../shared/types";
import type { SqliteDatabase } from "../database";

type AiTaskRow = {
  readonly id: string;
  readonly project_id: string;
  readonly chapter_id: string | null;
  readonly task_type: TaskType;
  readonly status: AiTaskStatus;
  readonly selection_json: string | null;
  readonly input_text: string | null;
  readonly instruction: string | null;
  readonly preset_id: string | null;
  readonly output_text: string | null;
  readonly error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

type AiTaskCandidateRow = {
  readonly id: string;
  readonly task_id: string;
  readonly kind: string;
  readonly original_text: string | null;
  readonly generated_text: string;
  readonly change_summary: string | null;
  readonly metadata_json: string | null;
  readonly status: CandidateStatus;
  readonly created_at: string;
  readonly updated_at: string;
};

type CreateTaskRecord = Omit<AiTaskRecord, "id" | "createdAt" | "updatedAt">;

type CreateCandidateInput = {
  readonly taskId: string;
  readonly kind: TaskType | string;
  readonly originalText: string | null;
  readonly generatedText: string;
  readonly changeSummary?: string | null;
  readonly proofreadIssues?: AiTaskCandidateRecord["proofreadIssues"];
  readonly writingContextPlan?: AiTaskCandidateRecord["writingContextPlan"];
};

type TaskPatch = {
  readonly status?: AiTaskStatus;
  readonly instruction?: string | null;
  readonly presetId?: string | null;
  readonly outputText?: string | null;
  readonly error?: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseSelectionSnapshot(value: string | null): SelectionSnapshot | null {
  return value ? (JSON.parse(value) as SelectionSnapshot) : null;
}

function mapTask(row: AiTaskRow): AiTaskRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id,
    taskType: row.task_type,
    status: row.status,
    selection: parseSelectionSnapshot(row.selection_json),
    inputText: row.input_text ?? "",
    instruction: row.instruction,
    presetId: row.preset_id,
    outputText: row.output_text,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapCandidate(row: AiTaskCandidateRow): AiTaskCandidateRecord {
  const metadata = parseAiCandidateMetadata(row.metadata_json);
  return {
    id: row.id,
    taskId: row.task_id,
    kind: row.kind,
    originalText: row.original_text,
    generatedText: row.generated_text,
    changeSummary: row.change_summary,
    proofreadIssues: metadata?.proofreadIssues ?? null,
    writingContextPlan: metadata?.writingContextPlan ?? null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class AiTaskRepository {
  constructor(private readonly db: SqliteDatabase) {}

  createTask(input: CreateTaskRecord): AiTaskRecord {
    const createdAt = nowIso();
    const task = {
      ...input,
      id: createId("task"),
      createdAt,
      updatedAt: createdAt
    } satisfies AiTaskRecord;

    this.db
      .prepare(
        `INSERT INTO ai_tasks (
          id, project_id, chapter_id, task_type, status, selection_json, input_text,
          instruction, preset_id, output_text, error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        task.id,
        task.projectId,
        task.chapterId,
        task.taskType,
        task.status,
        task.selection ? JSON.stringify(task.selection) : null,
        task.inputText,
        task.instruction,
        task.presetId,
        task.outputText,
        task.error,
        task.createdAt,
        task.updatedAt
      );

    return this.findTaskById(task.id);
  }

  findTaskById(taskId: string): AiTaskRecord {
    const row = this.db.prepare("SELECT * FROM ai_tasks WHERE id = ?").get(taskId) as AiTaskRow | undefined;
    if (!row) {
      throw new Error("AI task not found");
    }
    return mapTask(row);
  }

  updateTask(taskId: string, patch: TaskPatch): AiTaskRecord {
    const current = this.findTaskById(taskId);
    const next = {
      status: patch.status ?? current.status,
      instruction: patch.instruction === undefined ? current.instruction : patch.instruction,
      presetId: patch.presetId === undefined ? current.presetId : patch.presetId,
      outputText: patch.outputText === undefined ? current.outputText : patch.outputText,
      error: patch.error === undefined ? current.error : patch.error,
      updatedAt: nowIso()
    };

    this.db
      .prepare("UPDATE ai_tasks SET status = ?, instruction = ?, preset_id = ?, output_text = ?, error = ?, updated_at = ? WHERE id = ?")
      .run(next.status, next.instruction, next.presetId, next.outputText, next.error, next.updatedAt, taskId);

    return this.findTaskById(taskId);
  }

  createCandidate(input: CreateCandidateInput): AiTaskCandidateRecord {
    const createdAt = nowIso();
    const candidate = {
      id: createId("candidate"),
      taskId: input.taskId,
      kind: input.kind,
      originalText: input.originalText,
      generatedText: input.generatedText,
      changeSummary: input.changeSummary ?? null,
      proofreadIssues: input.proofreadIssues ?? null,
      writingContextPlan: input.writingContextPlan ?? null,
      status: "preview",
      createdAt,
      updatedAt: createdAt
    } satisfies AiTaskCandidateRecord;

    this.db
      .prepare(
        `INSERT INTO ai_task_candidates (
          id, task_id, kind, original_text, generated_text, change_summary, metadata_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        candidate.id,
        candidate.taskId,
        candidate.kind,
        candidate.originalText,
        candidate.generatedText,
        candidate.changeSummary,
        stringifyAiCandidateMetadata({
          proofreadIssues: candidate.proofreadIssues,
          writingContextPlan: candidate.writingContextPlan
        }),
        candidate.status,
        candidate.createdAt,
        candidate.updatedAt
      );

    return this.findCandidateById(candidate.id);
  }

  findCandidateById(candidateId: string): AiTaskCandidateRecord {
    const row = this.db.prepare("SELECT * FROM ai_task_candidates WHERE id = ?").get(candidateId) as AiTaskCandidateRow | undefined;
    if (!row) {
      throw new Error("AI task candidate not found");
    }
    return mapCandidate(row);
  }

  updateCandidateStatus(candidateId: string, status: CandidateStatus): AiTaskCandidateRecord {
    this.db.prepare("UPDATE ai_task_candidates SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), candidateId);
    return this.findCandidateById(candidateId);
  }
}
