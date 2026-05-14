import { OpenRouterError } from "../ai/openrouter-error";
import { RelationshipSourceChangedError, type RelationshipIndexService } from "./relationship-index-service";
import type { RelationshipIndexJobRecord } from "../db/repositories/relationship-index-repo";

type RetryPlan = {
  readonly delays: readonly number[];
};

export type RelationshipWorkerRunResult =
  | { readonly status: "paused_foreground_ai" }
  | { readonly status: "paused_ai_unconfigured"; readonly error: string }
  | { readonly status: "idle" }
  | { readonly status: "completed"; readonly jobId: string }
  | { readonly status: "cancelled"; readonly jobId: string }
  | { readonly status: "retry_scheduled"; readonly jobId: string; readonly nextRunAt: string }
  | { readonly status: "failed"; readonly jobId: string; readonly error: string };

export type RelationshipWorkerDeps = {
  readonly relationshipService: RelationshipIndexService;
  readonly isForegroundAiActive: () => boolean;
  readonly ensureAiConfigured: () => Promise<void>;
};

function addMinutes(iso: string, minutes: number): string {
  const timestamp = Date.parse(iso);
  const base = Number.isFinite(timestamp) ? timestamp : Date.now();
  return new Date(base + minutes * 60_000).toISOString();
}

function formatError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function retryPlanFor(reason: unknown): RetryPlan | null {
  if (reason instanceof OpenRouterError) {
    if (reason.status === 429 || reason.code === "rate_limited") {
      return { delays: [15] };
    }
    if (reason.status === 503) {
      return { delays: [10] };
    }
    if (reason.code === "timeout" || reason.code === "network_error") {
      return { delays: [10] };
    }
  }
  return null;
}

function isCancellationReason(reason: unknown): boolean {
  if (reason instanceof OpenRouterError && (reason.code === "canceled" || reason.isCanceled)) {
    return true;
  }
  if (reason instanceof Error) {
    return reason.name === "AbortError" || reason.message === "canceled" || reason.message.includes("已取消");
  }
  return String(reason) === "canceled";
}

/**
 * Development fallback only. Production relationship cache is derived from SummaryService.
 */
export class RelationshipIndexWorker {
  constructor(private readonly deps: RelationshipWorkerDeps) {}

  async runOnce(projectId: string, now: string, options: { readonly signal?: AbortSignal } = {}): Promise<RelationshipWorkerRunResult> {
    if (this.deps.isForegroundAiActive()) {
      return { status: "paused_foreground_ai" };
    }

    if (!this.deps.relationshipService.peekNextRelationshipJob(projectId, now)) {
      return { status: "idle" };
    }

    try {
      await this.deps.ensureAiConfigured();
    } catch (error) {
      return {
        status: "paused_ai_unconfigured",
        error: formatError(error)
      };
    }

    const job = this.deps.relationshipService.claimNextRelationshipJob(projectId, now);
    if (!job) {
      return { status: "idle" };
    }

    try {
      await this.deps.relationshipService.indexRelationshipJob(job, now, options);
      if (options.signal?.aborted) {
        this.deps.relationshipService.cancelRelationshipJob(job.id, "人物关系索引任务已取消。", now);
        return {
          status: "cancelled",
          jobId: job.id
        };
      }
      this.deps.relationshipService.completeRelationshipJob(job.id, now);
      return {
        status: "completed",
        jobId: job.id
      };
    } catch (error) {
      return this.handleJobError(job, error, now, options);
    }
  }

  private handleJobError(
    job: RelationshipIndexJobRecord,
    error: unknown,
    now: string,
    options: { readonly signal?: AbortSignal }
  ): RelationshipWorkerRunResult {
    if (options.signal?.aborted || isCancellationReason(error)) {
      this.deps.relationshipService.cancelRelationshipJob(job.id, "人物关系索引任务已取消。", now);
      return {
        status: "cancelled",
        jobId: job.id
      };
    }

    if (error instanceof RelationshipSourceChangedError) {
      this.deps.relationshipService.completeRelationshipJob(job.id, now);
      return {
        status: "completed",
        jobId: job.id
      };
    }

    const retryPlan = retryPlanFor(error);
    const message = formatError(error);
    if (retryPlan && job.attemptCount <= retryPlan.delays.length) {
      const retryDelay = retryPlan.delays[job.attemptCount - 1] ?? retryPlan.delays[retryPlan.delays.length - 1];
      const nextRunAt = addMinutes(now, retryDelay);
      this.deps.relationshipService.failRelationshipJob(job.id, message, nextRunAt, now);
      this.deps.relationshipService.requeueRelationshipJob(job, nextRunAt, now);
      return {
        status: "retry_scheduled",
        jobId: job.id,
        nextRunAt
      };
    }

    this.deps.relationshipService.failRelationshipJob(job.id, message, null, now);
    return {
      status: "failed",
      jobId: job.id,
      error: message
    };
  }
}
