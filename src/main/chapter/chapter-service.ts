import { emptyChapterContent } from "./default-content";
import { ChapterRepository } from "../db/repositories/chapter-repo";
import { createId } from "../shared/ids";
import { countWritingUnits } from "../shared/text";
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
  ChapterSummary
} from "../shared/types";

type ChapterRepositoryResolver = (projectId?: string) => ChapterRepository;

function nowIso(): string {
  return new Date().toISOString();
}

export class ChapterService {
  private readonly resolveChapterRepo: ChapterRepositoryResolver;

  constructor(chapterRepo: ChapterRepository | ChapterRepositoryResolver) {
    this.resolveChapterRepo = typeof chapterRepo === "function" ? chapterRepo : () => chapterRepo;
  }

  listChapters(input: ChapterListInput): ChapterSummary[] {
    return this.resolveChapterRepo(input.projectId).listByProject(input.projectId);
  }

  createChapter(input: ChapterCreateInput): ChapterSummary {
    const chapterRepo = this.resolveChapterRepo(input.projectId);
    const createdAt = nowIso();
    return chapterRepo.create({
      id: createId("chapter"),
      projectId: input.projectId,
      title: input.title,
      volumeTitle: input.volumeTitle ?? "第一卷",
      sortOrder: input.sortOrder ?? chapterRepo.nextSortOrder(input.projectId),
      contentJson: emptyChapterContent,
      plainText: "",
      wordCount: 0,
      dailyWordCount: 0,
      targetWordCount: null,
      status: "draft",
      createdAt,
      updatedAt: createdAt
    });
  }

  renameChapter(input: ChapterRenameInput): ChapterSummary {
    return this.resolveChapterRepo().rename(input.chapterId, input.title, nowIso());
  }

  deleteChapter(input: ChapterDeleteInput): void {
    this.resolveChapterRepo().delete(input.chapterId);
  }

  getContent(input: ChapterGetContentInput): ChapterContent {
    const content = this.resolveChapterRepo().getContent(input.chapterId);
    if (!content) {
      throw new Error("Chapter not found");
    }
    return content;
  }

  saveContent(input: ChapterSaveContentInput): ChapterContent {
    return this.resolveChapterRepo().saveContent(
      input.chapterId,
      input.contentJson,
      input.plainText,
      input.wordCount ?? countWritingUnits(input.plainText),
      nowIso()
    );
  }

  createSnapshot(input: ChapterCreateSnapshotInput): ChapterSnapshot {
    const content = this.getContent({ chapterId: input.chapterId });
    return this.resolveChapterRepo().createSnapshot({
      id: createId("snapshot"),
      chapterId: input.chapterId,
      contentJson: content.contentJson,
      plainText: content.plainText,
      reason: input.reason,
      createdAt: nowIso()
    });
  }
}
