import { emptyChapterContent } from "./default-content";
import { ChapterRepository } from "../db/repositories/chapter-repo";
import { createId } from "../shared/ids";
import { countWritingUnits } from "../shared/text";
import type { WritingGoalRecordDeltaInput } from "../writing-goals/writing-goal-service";
import type {
  ChapterContent,
  ChapterCreateInput,
  ChapterCreateSnapshotInput,
  ChapterDeleteInput,
  ChapterGetContentInput,
  ChapterListInput,
  ChapterRenameInput,
  ChapterSaveContentInput,
  ChapterSnapshot,
  ChapterSummary,
  ChapterUpdateTargetWordCountInput
} from "../shared/types";

type ChapterRepositoryResolver = (projectId?: string) => ChapterRepository;

export type SummaryIndexInvalidationInput = {
  readonly projectId: string;
  readonly chapterId: string;
  readonly previousPlainText: string;
  readonly nextPlainText: string;
  readonly previousWordCount: number;
  readonly nextWordCount: number;
  readonly updatedAt: string;
};

export type SummaryIndexInvalidator = {
  readonly markChapterContentChanged: (input: SummaryIndexInvalidationInput) => void;
};

export type WritingGoalDeltaRecorder = {
  readonly recordWordDelta: (input: WritingGoalRecordDeltaInput) => void;
};

export type ChapterContentUpdateRecordInput = {
  readonly projectId: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly chapterSortOrder: number;
  readonly source: "manual" | "ai_apply" | "system";
  readonly previousWordCount: number;
  readonly nextWordCount: number;
  readonly updatedAt: string;
};

export type ChapterContentUpdateRecorder = {
  readonly recordChapterContentUpdate: (input: ChapterContentUpdateRecordInput) => void;
};

type WritingGoalDeltaRecorderResolver = (projectId: string) => WritingGoalDeltaRecorder;

type ChapterServiceOptions = {
  readonly summaryIndexInvalidator?: SummaryIndexInvalidator;
  readonly writingGoalRecorder?: WritingGoalDeltaRecorder | WritingGoalDeltaRecorderResolver;
  readonly contentUpdateRecorder?: ChapterContentUpdateRecorder;
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseIsoTime(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nextIsoAfter(...values: Array<string | null | undefined>): string {
  const now = Date.now();
  const previous = Math.max(0, ...values.map(parseIsoTime));
  return new Date(Math.max(now, previous + 1)).toISOString();
}

function localDateKey(value: Date = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function assertChapterBelongsToProject(content: ChapterContent, projectId?: string): void {
  if (!projectId) {
    return;
  }
  if (content.projectId !== projectId) {
    throw new Error("章节不属于当前项目。");
  }
}

export class ChapterService {
  private readonly resolveChapterRepo: ChapterRepositoryResolver;
  private readonly summaryIndexInvalidator?: SummaryIndexInvalidator;
  private readonly resolveWritingGoalRecorder?: WritingGoalDeltaRecorderResolver;
  private readonly contentUpdateRecorder?: ChapterContentUpdateRecorder;

  constructor(chapterRepo: ChapterRepository | ChapterRepositoryResolver, options: ChapterServiceOptions = {}) {
    this.resolveChapterRepo = typeof chapterRepo === "function" ? chapterRepo : () => chapterRepo;
    this.summaryIndexInvalidator = options.summaryIndexInvalidator;
    this.contentUpdateRecorder = options.contentUpdateRecorder;
    const writingGoalRecorder = options.writingGoalRecorder;
    if (typeof writingGoalRecorder === "function") {
      this.resolveWritingGoalRecorder = writingGoalRecorder as WritingGoalDeltaRecorderResolver;
    } else if (writingGoalRecorder) {
      this.resolveWritingGoalRecorder = () => writingGoalRecorder;
    }
  }

  listChapters(input: ChapterListInput): ChapterSummary[] {
    return this.resolveChapterRepo(input.projectId).listByProject(input.projectId);
  }

  createChapter(input: ChapterCreateInput): ChapterSummary {
    const chapterRepo = this.resolveChapterRepo(input.projectId);
    const createdAt = nowIso();
    const sortOrder = input.sortOrder ?? chapterRepo.nextSortOrder(input.projectId);
    return chapterRepo.create({
      id: createId("chapter"),
      projectId: input.projectId,
      title: input.title,
      volumeTitle: input.volumeTitle ?? "第一卷",
      sortOrder,
      contentJson: emptyChapterContent,
      plainText: "",
      wordCount: 0,
      dailyWordCount: 0,
      dailyWordCountDate: null,
      targetWordCount: input.targetWordCount ?? null,
      status: "draft",
      createdAt,
      updatedAt: createdAt,
      contentUpdatedAt: createdAt
    }, { shiftExistingAtSortOrder: input.sortOrder !== undefined });
  }

  renameChapter(input: ChapterRenameInput): ChapterSummary {
    const chapterRepo = this.resolveChapterRepo(input.projectId);
    const content = chapterRepo.getContent(input.chapterId);
    if (!content) {
      throw new Error("Chapter not found");
    }
    assertChapterBelongsToProject(content, input.projectId);
    return chapterRepo.rename(input.chapterId, input.title, nextIsoAfter(content.updatedAt));
  }

  deleteChapter(input: ChapterDeleteInput): void {
    const chapterRepo = this.resolveChapterRepo(input.projectId);
    const content = chapterRepo.getContent(input.chapterId);
    if (!content) {
      throw new Error("Chapter not found");
    }
    assertChapterBelongsToProject(content, input.projectId);
    const previousProjectWordCount = chapterRepo.getProjectWordCount(content.projectId);
    chapterRepo.delete(input.chapterId);
    this.recordWritingGoalDelta({
      projectId: content.projectId,
      chapterId: null,
      chapterTitle: content.title,
      chapterSortOrder: content.sortOrder,
      previousWordCount: content.wordCount,
      nextWordCount: 0,
      previousProjectWordCount,
      nextProjectWordCount: previousProjectWordCount - content.wordCount,
      source: "chapter_delete",
      now: nowIso()
    });
  }

  getContent(input: ChapterGetContentInput): ChapterContent {
    const content = this.resolveChapterRepo(input.projectId).getContent(input.chapterId);
    if (!content) {
      throw new Error("Chapter not found");
    }
    assertChapterBelongsToProject(content, input.projectId);
    return content;
  }

  saveContent(input: ChapterSaveContentInput): ChapterContent {
    const chapterRepo = this.resolveChapterRepo(input.projectId);
    const previousContent = chapterRepo.getContent(input.chapterId);
    if (!previousContent) {
      throw new Error("Chapter not found");
    }
    assertChapterBelongsToProject(previousContent, input.projectId);

    const nextWordCount = countWritingUnits(input.plainText);
    const today = localDateKey();
    const wordCountDelta = nextWordCount - previousContent.wordCount;
    const nextDailyWordCount =
      previousContent.dailyWordCountDate === today ? Math.max(0, previousContent.dailyWordCount + wordCountDelta) : Math.max(0, wordCountDelta);

    const updatedAt = nextIsoAfter(previousContent.updatedAt, previousContent.contentUpdatedAt);
    const saved = chapterRepo.saveContent(
      input.chapterId,
      input.contentJson,
      input.plainText,
      nextWordCount,
      nextDailyWordCount,
      today,
      updatedAt,
      input.expectedUpdatedAt ?? previousContent.contentUpdatedAt ?? previousContent.updatedAt
    );

    if (previousContent.plainText !== saved.plainText) {
      this.recordChapterContentUpdate({
        projectId: saved.projectId,
        chapterId: saved.id,
        chapterTitle: saved.title,
        chapterSortOrder: saved.sortOrder,
        source: input.saveSource ?? "manual",
        previousWordCount: previousContent.wordCount,
        nextWordCount: saved.wordCount,
        updatedAt
      });
      try {
        this.summaryIndexInvalidator?.markChapterContentChanged({
          projectId: saved.projectId,
          chapterId: saved.id,
          previousPlainText: previousContent.plainText,
          nextPlainText: saved.plainText,
          previousWordCount: previousContent.wordCount,
          nextWordCount: saved.wordCount,
          updatedAt
        });
      } catch (reason) {
        console.warn("Failed to invalidate chapter summary cache after content save", reason);
      }
    }

    if (wordCountDelta !== 0) {
      const nextProjectWordCount = chapterRepo.getProjectWordCount(saved.projectId);
      this.recordWritingGoalDelta({
        projectId: saved.projectId,
        chapterId: saved.id,
        chapterTitle: saved.title,
        chapterSortOrder: saved.sortOrder,
        previousWordCount: previousContent.wordCount,
        nextWordCount: saved.wordCount,
        previousProjectWordCount: nextProjectWordCount - wordCountDelta,
        nextProjectWordCount,
        source: input.saveSource ?? "manual",
        now: updatedAt
      });
    }

    return saved;
  }

  updateTargetWordCount(input: ChapterUpdateTargetWordCountInput): ChapterSummary {
    const chapterRepo = this.resolveChapterRepo(input.projectId);
    const content = chapterRepo.getContent(input.chapterId);
    if (!content) {
      throw new Error("Chapter not found");
    }
    assertChapterBelongsToProject(content, input.projectId);
    return chapterRepo.updateTargetWordCount(input.chapterId, input.targetWordCount, nextIsoAfter(content.updatedAt));
  }

  createSnapshot(input: ChapterCreateSnapshotInput): ChapterSnapshot {
    const content = this.getContent({ projectId: input.projectId, chapterId: input.chapterId });
    return this.resolveChapterRepo(input.projectId).createSnapshot({
      id: createId("snapshot"),
      chapterId: input.chapterId,
      contentJson: content.contentJson,
      plainText: content.plainText,
      reason: input.reason,
      createdAt: nowIso()
    });
  }

  private recordWritingGoalDelta(input: WritingGoalRecordDeltaInput): void {
    try {
      this.resolveWritingGoalRecorder?.(input.projectId).recordWordDelta(input);
    } catch (reason) {
      console.warn("Failed to record writing goal word delta", reason);
    }
  }

  private recordChapterContentUpdate(input: ChapterContentUpdateRecordInput): void {
    try {
      this.contentUpdateRecorder?.recordChapterContentUpdate(input);
    } catch (reason) {
      console.warn("Failed to record chapter content update for usage analytics", reason);
    }
  }
}
