export type QuickActionKind = 'ask' | 'optimize' | 'proofread' | 'expand' | 'continuity';
export type QuickActionPage = 'chat' | 'polish' | 'proofread' | 'expand' | 'continuity';

export const editorQuickActionButtons: Array<{ kind: QuickActionKind; label: string }> = [
  { kind: 'ask', label: '问一下' },
  { kind: 'optimize', label: '润色' },
  { kind: 'proofread', label: '校对' },
  { kind: 'expand', label: '扩写' },
  { kind: 'continuity', label: '检查矛盾' },
];

export interface BuildTextScopeInput {
  paragraphId: string;
  friendlyLabel: string;
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface TextActionScope {
  kind: 'selection' | 'paragraph';
  paragraphId: string;
  friendlyLabel: string;
  scopeLabel: string;
  selectedText: string;
  startOffset: number;
  endOffset: number;
  tooLong: boolean;
}

export type QuickActionCheck = { ok: true } | { ok: false; reason: string };

const longSelectionLimit = 1800;
const longSelectionReason = '选区过长，请缩小到更具体的片段，或后续改用本章范围。';

export function buildTextScope(input: BuildTextScopeInput): TextActionScope {
  const start = Math.max(0, Math.min(input.selectionStart, input.selectionEnd));
  const end = Math.min(input.text.length, Math.max(input.selectionStart, input.selectionEnd));
  const hasSelection = end > start;
  const selectedText = hasSelection ? input.text.slice(start, end) : input.text;

  return {
    kind: hasSelection ? 'selection' : 'paragraph',
    paragraphId: input.paragraphId,
    friendlyLabel: input.friendlyLabel,
    scopeLabel: hasSelection ? `当前选段 · ${input.friendlyLabel}` : input.friendlyLabel,
    selectedText,
    startOffset: hasSelection ? start : 0,
    endOffset: hasSelection ? end : input.text.length,
    tooLong: selectedText.length > longSelectionLimit,
  };
}

export function routeQuickAction(action: QuickActionKind): QuickActionPage {
  const routes: Record<QuickActionKind, QuickActionPage> = {
    ask: 'chat',
    optimize: 'polish',
    proofread: 'proofread',
    expand: 'expand',
    continuity: 'continuity',
  };
  return routes[action];
}

export function canRunQuickAction(_action: QuickActionKind, scope: TextActionScope | null): QuickActionCheck {
  if (!scope) {
    return { ok: false, reason: '请先选择正文段落或文本。' };
  }
  if (scope.tooLong) {
    return { ok: false, reason: longSelectionReason };
  }
  return { ok: true };
}
