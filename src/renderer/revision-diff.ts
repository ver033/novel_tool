import { diffChars } from 'diff';

export type RevisionDiffKind = 'unchanged' | 'added' | 'removed';

export interface RevisionDiffRow {
  kind: RevisionDiffKind;
  before: string;
  after: string;
}

export function buildRevisionDiffRows(beforeText: string, afterText: string): RevisionDiffRow[] {
  return diffChars(beforeText, afterText).map((part) => {
    if (part.added) {
      return { kind: 'added', before: '', after: part.value };
    }
    if (part.removed) {
      return { kind: 'removed', before: part.value, after: '' };
    }
    return { kind: 'unchanged', before: part.value, after: part.value };
  });
}

export function previewRevisionText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 82 ? `${normalized.slice(0, 82)}...` : normalized;
}
