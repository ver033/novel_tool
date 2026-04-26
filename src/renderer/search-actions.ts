export function buildSearchJumpStatus(friendlyLocation: string): string {
  return `已定位：${friendlyLocation}`;
}

export function isHighlightedParagraph(highlightedParagraphId: string | null, paragraphId: string): boolean {
  return highlightedParagraphId === paragraphId;
}

export function buildReferenceRouteStatus(referenceCount: number, targetLabel: string): string {
  return `已带 ${referenceCount} 条引用到${targetLabel}`;
}
