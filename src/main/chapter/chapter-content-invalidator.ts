import type { SummaryIndexInvalidationInput, SummaryIndexInvalidator } from "./chapter-service";

type ChapterContentInvalidatorOptions = {
  readonly summaryIndexInvalidator?: SummaryIndexInvalidator;
  readonly relationshipIndexInvalidator?: SummaryIndexInvalidator;
};

export function createChapterContentInvalidator(options: ChapterContentInvalidatorOptions): SummaryIndexInvalidator {
  return {
    markChapterContentChanged(input: SummaryIndexInvalidationInput) {
      try {
        options.summaryIndexInvalidator?.markChapterContentChanged(input);
      } catch (reason) {
        console.warn("Failed to invalidate chapter summary cache after content save", reason);
      }

      try {
        options.relationshipIndexInvalidator?.markChapterContentChanged(input);
      } catch (reason) {
        console.warn("Failed to invalidate relationship index after content save", reason);
      }
    }
  };
}
