import { OpenRouterClient, type OpenRouterProviderRouting } from "../ai/openrouter-client";
import { getTokenBudget } from "../ai/token-budget";
import { createId as defaultCreateId } from "../shared/ids";
import { countWritingUnits } from "../shared/text";
import type { ChapterRepository } from "../db/repositories/chapter-repo";
import type { ChapterReviewRepository } from "../db/repositories/chapter-review-repo";
import type { SettingsService } from "../settings/settings-service";
import type { ChapterReviewModelResponse, ChapterReviewProgressEvent, ChapterReviewProgressPhase, ChapterReviewRunRecord } from "../shared/chapter-review";
import type { ChapterContent, ChapterReviewCancelInput, ChapterReviewStartInput, ChapterReviewDeleteRunInput, ChapterReviewGetRunInput, ChapterReviewListRunsInput } from "../shared/types";
import { buildChapterReviewPrompt, parseChapterReviewModelResponse, splitChapterTextForReview } from "./chapter-review-prompt";

export type ChapterReviewClientInput = {
  readonly projectName: string;
  readonly chapterTitle: string;
  readonly chapterOrder: number;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly chapterText: string;
  readonly nearbyContext: string;
  readonly signal?: AbortSignal;
};

export type ChapterReviewClient = {
  readonly maxChunkTokens?: number;
  readonly review: (input: ChapterReviewClientInput) => Promise<ChapterReviewModelResponse>;
};

export type ChapterReviewProgressCallback = (event: ChapterReviewProgressEvent) => void;

type ChapterReviewServiceOptions = {
  readonly resolveChapterRepo: (projectId: string) => ChapterRepository;
  readonly resolveReviewRepo: (projectId: string) => ChapterReviewRepository;
  readonly getProjectName: (projectId: string) => string;
  readonly createClient: () => Promise<ChapterReviewClient>;
  readonly maxChunkTokens?: number;
  readonly now?: () => string;
  readonly createId?: (prefix: string) => string;
};

const DEFAULT_REVIEW_CHUNK_TOKENS = 32_000;
const MIN_REVIEW_CHUNK_TOKENS = 4_000;
const PREFERRED_REVIEW_CHAPTER_TOKENS = 24_000;
const MAX_REVIEW_CHUNK_TOKENS = 48_000;
const REVIEW_CHUNK_INPUT_RATIO = 1;
const MAX_REVIEW_COMPLETION_TOKENS = 4_000;
const MAX_PARALLEL_REVIEW_CHAPTERS = 2;
const REVIEW_CANCELLED_MESSAGE = "AI审稿已停止。";
const CHAPTER_REVIEW_PROVIDER_ROUTING = {
  sort: "throughput"
} as const satisfies OpenRouterProviderRouting;
const riskRank = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3
} as const satisfies Record<ChapterReviewModelResponse["aiToneRisk"], number>;

function nowIso(): string {
  return new Date().toISOString();
}

function riskFromRank(rank: number): ChapterReviewModelResponse["aiToneRisk"] {
  if (rank >= 3) {
    return "high";
  }
  if (rank === 2) {
    return "medium";
  }
  if (rank === 1) {
    return "low";
  }
  return "none";
}

function isReviewCanceledReason(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return String(error) === "canceled" || String(error) === REVIEW_CANCELLED_MESSAGE;
  }
  const record = error as { readonly code?: unknown; readonly isCanceled?: unknown; readonly message?: unknown; readonly name?: unknown };
  return (
    record.isCanceled === true ||
    record.code === "canceled" ||
    record.code === "ERR_CANCELED" ||
    record.name === "AbortError" ||
    record.name === "CanceledError" ||
    record.message === "canceled" ||
    record.message === "OpenRouter 请求已取消。" ||
    record.message === "DeepSeek 请求已取消。" ||
    record.message === REVIEW_CANCELLED_MESSAGE
  );
}

function assertReviewNotCanceled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error(REVIEW_CANCELLED_MESSAGE);
  }
}

function resolveReviewChunkTokens(maxInputTokens: number, options: { readonly enforceBudget?: boolean } = {}): number {
  if (!Number.isFinite(maxInputTokens) || maxInputTokens <= 0) {
    return DEFAULT_REVIEW_CHUNK_TOKENS;
  }
  const resolvedTokens = Math.min(MAX_REVIEW_CHUNK_TOKENS, Math.floor(maxInputTokens * REVIEW_CHUNK_INPUT_RATIO));
  return Math.max(options.enforceBudget ? MIN_REVIEW_CHUNK_TOKENS : PREFERRED_REVIEW_CHAPTER_TOKENS, resolvedTokens);
}

function progressPercent(completedChunks: number, totalChunks: number, phase: ChapterReviewProgressPhase): number {
  if (phase === "completed") {
    return 100;
  }
  if (phase === "failed") {
    return Math.max(1, Math.min(99, Math.round((completedChunks / Math.max(1, totalChunks)) * 100)));
  }
  return Math.max(1, Math.min(99, Math.round((completedChunks / Math.max(1, totalChunks)) * 100)));
}

function mergeChapterResults(results: readonly ChapterReviewModelResponse[]): Pick<ChapterReviewModelResponse, "summary" | "readabilityScore" | "aiToneRisk" | "issues"> {
  if (results.length === 0) {
    return {
      summary: "章节为空，未发现可审稿正文。",
      readabilityScore: 5,
      aiToneRisk: "none",
      issues: []
    };
  }

  const readabilityScore = Math.max(1, Math.min(5, Math.round(results.reduce((total, result) => total + result.readabilityScore, 0) / results.length)));
  const aiToneRisk = riskFromRank(Math.max(...results.map((result) => riskRank[result.aiToneRisk])));
  const issues = results.flatMap((result, index) =>
    result.issues.map((issue) => ({
      ...issue,
      locationHint: results.length > 1 ? `分段 ${index + 1}：${issue.locationHint}` : issue.locationHint
    }))
  );
  const summary = results.length === 1
    ? results[0].summary
    : results.map((result, index) => `分段 ${index + 1}：${result.summary}`).join("\n");

  return {
    summary,
    readabilityScore,
    aiToneRisk,
    issues
  };
}

async function runWithConcurrency<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const workerCount = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;
  let firstError: unknown = null;
  const workers = Array.from({ length: workerCount }, async () => {
    while (!firstError) {
      const itemIndex = nextIndex;
      nextIndex += 1;
      if (itemIndex >= items.length) {
        return;
      }
      try {
        await worker(items[itemIndex]);
      } catch (error) {
        firstError ??= error;
      }
    }
  });
  await Promise.all(workers);
  if (firstError) {
    throw firstError;
  }
}

export async function createOpenRouterChapterReviewClient(settingsService: SettingsService): Promise<ChapterReviewClient> {
  const config = await settingsService.getOpenRouterConfigWithModelMetadata();
  const budget = getTokenBudget("proofread", config.contextLength);
  const client = new OpenRouterClient({
    providerType: config.providerType,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    modelName: config.modelName
  });

  return {
    maxChunkTokens: resolveReviewChunkTokens(budget.maxInputTokens, { enforceBudget: Boolean(config.contextLength) }),
    async review(input) {
      const prompt = buildChapterReviewPrompt({
        ...input,
        maxCompletionTokens: Math.min(budget.maxOutputTokens, MAX_REVIEW_COMPLETION_TOKENS),
        tokenBudget: budget
      });
      const response = await client.createChatCompletion({
        messages: prompt.messages,
        maxCompletionTokens: prompt.maxCompletionTokens,
        temperature: prompt.temperature,
        responseFormat: prompt.responseFormat,
        reasoning: prompt.reasoning,
        provider: CHAPTER_REVIEW_PROVIDER_ROUTING,
        signal: input.signal
      });
      if (response.truncated) {
        throw new Error("AI审稿结果被截断，请缩小章节范围或换用输出额度更高的模型。");
      }
      return parseChapterReviewModelResponse(response.content);
    }
  };
}

export class ChapterReviewService {
  private readonly now: () => string;
  private readonly createId: (prefix: string) => string;
  private readonly activeReviews = new Map<string, AbortController>();

  constructor(private readonly options: ChapterReviewServiceOptions) {
    this.now = options.now ?? nowIso;
    this.createId = options.createId ?? defaultCreateId;
  }

  async startReview(input: ChapterReviewStartInput, onProgress?: ChapterReviewProgressCallback): Promise<ChapterReviewRunRecord> {
    const chapterRepo = this.options.resolveChapterRepo(input.projectId);
    const reviewRepo = this.options.resolveReviewRepo(input.projectId);
    const selectedIds = new Set(input.chapterIds);
    const selectedChapters = chapterRepo
      .listByProject(input.projectId)
      .filter((chapter) => selectedIds.has(chapter.id))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    if (selectedChapters.length === 0) {
      throw new Error("请选择要审稿的章节。");
    }

    const runId = this.createId("chapter_review_run");
    const run = reviewRepo.createRun({
      id: runId,
      projectId: input.projectId,
      chapterIds: selectedChapters.map((chapter) => chapter.id),
      status: "running",
      requestedAt: this.now()
    });

    try {
      const abortController = this.registerReview(input.requestId);
      const signal = abortController.signal;
      const client = await this.options.createClient();
      assertReviewNotCanceled(signal);
      const projectName = this.options.getProjectName(input.projectId);
      const maxChunkTokens = this.options.maxChunkTokens ?? client.maxChunkTokens ?? DEFAULT_REVIEW_CHUNK_TOKENS;
      const plannedChapters = selectedChapters.map((chapter) => {
        const content = chapterRepo.getContent(chapter.id);
        if (!content || content.projectId !== input.projectId) {
          throw new Error(`章节不存在：${chapter.title}`);
        }
        return {
          content,
          chunks: splitChapterTextForReview(content.plainText, maxChunkTokens)
        };
      });
      const totalChunks = plannedChapters.reduce((total, chapter) => total + Math.max(1, chapter.chunks.length), 0);
      let completedChapters = 0;
      let completedChunks = 0;
      const emitProgress = (phase: ChapterReviewProgressPhase, currentChapter: ChapterContent | null, message: string): void => {
        if (!input.requestId) {
          return;
        }
        onProgress?.({
          requestId: input.requestId,
          projectId: input.projectId,
          runId: run.id,
          phase,
          totalChapters: plannedChapters.length,
          completedChapters,
          currentChapterTitle: currentChapter?.title ?? null,
          totalChunks,
          completedChunks,
          progressPercent: progressPercent(completedChunks, totalChunks, phase),
          message
        });
      };

      emitProgress("preparing", plannedChapters[0]?.content ?? null, "正在准备章节正文");

      await runWithConcurrency(plannedChapters, MAX_PARALLEL_REVIEW_CHAPTERS, async ({ content, chunks }) => {
        assertReviewNotCanceled(signal);
        const results: ChapterReviewModelResponse[] = [];
        for (let index = 0; index < chunks.length; index += 1) {
          assertReviewNotCanceled(signal);
          emitProgress("reviewing", content, chunks.length > 1 ? `正在审稿：${content.title}（分段 ${index + 1}/${chunks.length}）` : `正在审稿：${content.title}`);
          results.push(await client.review({
            projectName,
            chapterTitle: content.title,
            chapterOrder: content.sortOrder,
            chunkIndex: index,
            chunkCount: chunks.length,
            chapterText: chunks[index],
            nearbyContext: this.nearbyContext(input.projectId, content.sortOrder, chapterRepo),
            signal
          }));
          completedChunks += 1;
          emitProgress("reviewing", content, chunks.length > 1 ? `已完成分段 ${index + 1}/${chunks.length}` : "已完成模型审稿");
        }
        assertReviewNotCanceled(signal);
        const merged = mergeChapterResults(results);
        emitProgress("saving", content, `正在保存：${content.title}`);
        reviewRepo.saveChapterResult({
          id: this.createId("chapter_review_chapter"),
          runId: run.id,
          projectId: input.projectId,
          chapterId: content.id,
          chapterTitle: content.title,
          chapterSortOrder: content.sortOrder,
          summary: merged.summary,
          readabilityScore: merged.readabilityScore,
          aiToneRisk: merged.aiToneRisk,
          issues: merged.issues,
          chunkCount: Math.max(1, chunks.length),
          reviewedAt: this.now()
        });
        completedChapters += 1;
        emitProgress("saving", content, `已保存：${content.title}`);
      });
      reviewRepo.completeRun(run.id, input.projectId, this.now());
      emitProgress("completed", null, "审稿完成");
      return this.requireRun(reviewRepo, input.projectId, run.id);
    } catch (error) {
      const errorMessage = isReviewCanceledReason(error) ? REVIEW_CANCELLED_MESSAGE : error instanceof Error ? error.message : String(error);
      reviewRepo.failRun(run.id, input.projectId, errorMessage, this.now());
      if (input.requestId) {
        onProgress?.({
          requestId: input.requestId,
          projectId: input.projectId,
          runId: run.id,
          phase: "failed",
          totalChapters: selectedChapters.length,
          completedChapters: 0,
          currentChapterTitle: null,
          totalChunks: 1,
          completedChunks: 0,
          progressPercent: 1,
          message: errorMessage
        });
      }
      throw new Error(errorMessage);
    } finally {
      this.unregisterReview(input.requestId);
    }
  }

  listRuns(input: ChapterReviewListRunsInput): ChapterReviewRunRecord[] {
    return this.options.resolveReviewRepo(input.projectId).listRuns(input.projectId, input.limit ?? 20);
  }

  getRun(input: ChapterReviewGetRunInput): ChapterReviewRunRecord {
    return this.requireRun(this.options.resolveReviewRepo(input.projectId), input.projectId, input.runId);
  }

  deleteRun(input: ChapterReviewDeleteRunInput): void {
    this.options.resolveReviewRepo(input.projectId).deleteRun(input.projectId, input.runId);
  }

  cancelReview(input: ChapterReviewCancelInput): void {
    const controller = this.activeReviews.get(input.requestId);
    if (!controller) {
      return;
    }
    controller.abort();
    this.activeReviews.delete(input.requestId);
  }

  private requireRun(reviewRepo: ChapterReviewRepository, projectId: string, runId: string): ChapterReviewRunRecord {
    const run = reviewRepo.getRun(projectId, runId);
    if (!run) {
      throw new Error("AI审稿记录不存在。");
    }
    return run;
  }

  private nearbyContext(projectId: string, sortOrder: number, chapterRepo: ChapterRepository): string {
    const chapters = chapterRepo.listByProject(projectId);
    return chapters
      .filter((chapter) => Math.abs(chapter.sortOrder - sortOrder) <= 1 && chapter.sortOrder !== sortOrder)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((chapter) => `${chapter.sortOrder < sortOrder ? "上一章" : "下一章"}：${chapter.title}，约 ${countWritingUnits(chapter.title)} 字标题线索。`)
      .join("\n");
  }

  private registerReview(requestId: string | undefined): AbortController {
    const controller = new AbortController();
    if (!requestId) {
      return controller;
    }
    this.cancelReview({ requestId });
    this.activeReviews.set(requestId, controller);
    return controller;
  }

  private unregisterReview(requestId: string | undefined): void {
    if (!requestId) {
      return;
    }
    this.activeReviews.delete(requestId);
  }
}
