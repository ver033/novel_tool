export interface ChapterArtifactCandidate {
  paragraphCount: number;
  sourceType: string;
  title: string;
}

export function isLegacyEmptyEpubSpinePlaceholder(chapter: ChapterArtifactCandidate): boolean {
  return (
    chapter.paragraphCount === 0 &&
    chapter.sourceType === 'epub' &&
    /^第\s*\d+\s*章$/u.test(chapter.title.trim())
  );
}
