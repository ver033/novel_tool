import type { SummaryIndexInvalidationInput, SummaryIndexInvalidator } from "./chapter-service";

type ChapterContentInvalidatorOptions = {
  readonly summaryIndexInvalidator?: SummaryIndexInvalidator;
};

export function createChapterContentInvalidator(options: ChapterContentInvalidatorOptions): SummaryIndexInvalidator {
  return {
    markChapterContentChanged(input: SummaryIndexInvalidationInput) {
      try {
        options.summaryIndexInvalidator?.markChapterContentChanged(input);
      } catch (reason) {
        console.warn("Failed to invalidate chapter summary cache after content save", reason);
      }
    }
  };
}
