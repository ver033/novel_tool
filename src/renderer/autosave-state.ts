export function markParagraphDirty(current: string[], paragraphId: string): string[] {
  return current.includes(paragraphId) ? current : [...current, paragraphId];
}

export function clearParagraphDirty(current: string[], paragraphId: string): string[] {
  return current.filter((id) => id !== paragraphId);
}
