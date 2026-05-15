import { SummaryRepository, type SummaryJobRecord } from "../db/repositories/summary-repo";
import type { ChapterCacheBuildOrder } from "../shared/types";
import { OpenRouterError } from "./openrouter-error";
import { SummaryDependencyPendingError, SummarySourceChangedError } from "./summary-service";

type SummaryWorkerService = {
  readonly summarizeChapter: (projectId: string, chapterId: string, sourceHash: string, now: string, options?: { readonly signal?: AbortSignal }) => Promise<unknown>;
  readonly summarizeArc?: (
    projectId: string,
    arcKey: string,
    chapterFrom: number,
    chapterTo: number,
    sourceHash: string,
    now: string,
    options?: { readonly signal?: AbortSignal }
  ) => Promise<unknown>;
  readonly summarizeBook?: (projectId: string, sourceHash: string, now: string, options?: { readonly signal?: AbortSignal }) => Promise<unknown>;
};

type RetryPlan = {
  readonly delays: readonly number[];
};

export type SummaryWorkerRunResult =
  | { readonly status: "paused_foreground_ai" }
  | { readonly status: "paused_ai_unconfigured"; readonly error: string }
  | { readonly status: "idle" }
  | { readonly status: "completed"; readonly jobId: string }
  | { readonly status: "cancelled"; readonly jobId: string }
  | { readonly status: "retry_scheduled"; readonly jobId: string; readonly nextRunAt: string }
  | { readonly status: "failed"; readonly jobId: string; readonly error: string };

export type SummaryWorkerDeps = {
  readonly summaryRepo: SummaryRepository;
  readonly summaryService: SummaryWorkerService;
  readonly isForegroundAiActive: () => boolean;
  readonly ensureAiConfigured: () => Promise<void>;
  readonly chapterCacheBuildOrder?: () => ChapterCacheBuildOrder;
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
  if (reason instanceof OpenRouterError && reason.code === "canceled") {
    return true;
  }
  if (reason instanceof Error) {
    return reason.name === "AbortError" || reason.message === "canceled" || reason.message.includes("已取消");
  }
  return String(reason) === "canceled";
}

function parseArcRange(arcKey: string): { readonly from: number; readonly to: number } {
  const match = /^auto:(\d+)-(\d+)$/.exec(arcKey);
  if (!match) {
    throw new Error(`摘要阶段键格式无效：${arcKey}`);
  }
  const from = Number.parseInt(match[1], 10);
  const to = Number.parseInt(match[2], 10);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to < from) {
    throw new Error(`摘要阶段范围无效：${arcKey}`);
  }
  return { from, to };
}

export class SummaryWorker {
  constructor(private readonly deps: SummaryWorkerDeps) {}

  async runOnce(projectId: string, now: string, options: { readonly signal?: AbortSignal } = {}): Promise<SummaryWorkerRunResult> {
    if (this.deps.isForegroundAiActive()) {
      return { status: "paused_foreground_ai" };
    }

    const claimOptions = { chapterCacheBuildOrder: this.deps.chapterCacheBuildOrder?.() ?? "latest_first" };
    if (!this.deps.summaryRepo.peekNextSummaryJob(projectId, now, claimOptions)) {
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

    const job = this.deps.summaryRepo.claimNextSummaryJob(projectId, now, claimOptions);
    if (!job) {
      return { status: "idle" };
    }

    try {
      await this.runJob(job, now, options);
      if (options.signal?.aborted) {
        this.deps.summaryRepo.cancelSummaryJob(job.id, "摘要索引任务已取消。", now);
        return {
          status: "cancelled",
          jobId: job.id
        };
      }
      this.deps.summaryRepo.completeSummaryJob(job.id, now);
      return {
        status: "completed",
        jobId: job.id
      };
    } catch (error) {
      if (options.signal?.aborted || isCancellationReason(error)) {
        this.deps.summaryRepo.cancelSummaryJob(job.id, "摘要索引任务已取消。", now);
        return {
          status: "cancelled",
          jobId: job.id
        };
      }
      if (error instanceof SummarySourceChangedError) {
        this.deps.summaryRepo.completeSummaryJob(job.id, now);
        return {
          status: "completed",
          jobId: job.id
        };
      }
      if (error instanceof SummaryDependencyPendingError) {
        const nextRunAt = addMinutes(now, error.delayMinutes);
        this.deps.summaryRepo.deferSummaryJob(job.id, formatError(error), nextRunAt, now);
        return {
          status: "retry_scheduled",
          jobId: job.id,
          nextRunAt
        };
      }
      const retryPlan = retryPlanFor(error);
      const message = formatError(error);
      if (retryPlan && job.attemptCount <= retryPlan.delays.length) {
        const retryDelay = retryPlan.delays[job.attemptCount - 1] ?? retryPlan.delays[retryPlan.delays.length - 1];
        const nextRunAt = addMinutes(now, retryDelay);
        this.deps.summaryRepo.failSummaryJob(job.id, message, nextRunAt, now);
        this.deps.summaryRepo.enqueueSummaryJob({
          projectId: job.projectId,
          jobType: job.jobType,
          targetId: job.targetId,
          sourceHash: job.sourceHash,
          priority: job.priority,
          attemptCount: job.attemptCount,
          now,
          nextRunAt
        });
        return {
          status: "retry_scheduled",
          jobId: job.id,
          nextRunAt
        };
      }
      this.deps.summaryRepo.failSummaryJob(job.id, message, null, now);
      return {
        status: "failed",
        jobId: job.id,
        error: message
      };
    }
  }

  private async runJob(job: SummaryJobRecord, now: string, options: { readonly signal?: AbortSignal }): Promise<void> {
    if (job.jobType === "chapter_summary") {
      if (!job.targetId) {
        throw new Error("章节摘要任务缺少章节 ID。");
      }
      await this.deps.summaryService.summarizeChapter(job.projectId, job.targetId, job.sourceHash, now, options);
      return;
    }
    if (job.jobType === "arc_summary") {
      if (!job.targetId) {
        throw new Error("阶段摘要任务缺少阶段键。");
      }
      if (!this.deps.summaryService.summarizeArc) {
        throw new Error("AI 阶段摘要生成器未配置。");
      }
      const range = parseArcRange(job.targetId);
      await this.deps.summaryService.summarizeArc(job.projectId, job.targetId, range.from, range.to, job.sourceHash, now, options);
      return;
    }
    if (job.jobType === "book_summary") {
      if (!this.deps.summaryService.summarizeBook) {
        throw new Error("AI 全书摘要生成器未配置。");
      }
      await this.deps.summaryService.summarizeBook(job.projectId, job.sourceHash, now, options);
      return;
    }
    if (job.jobType === "rebuild_project_index") {
      throw new Error("重建全书索引任务尚未接入后台 worker。");
    }
  }
}
