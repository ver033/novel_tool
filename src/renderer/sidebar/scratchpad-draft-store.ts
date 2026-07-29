export type ScratchpadDraftScope = {
  readonly chapterId: string | null;
  readonly kind: "quick-note" | "floating-note";
  readonly noteId?: string | null;
  readonly projectId: string | null;
};

const scratchpadDraftPrefix = "moshu-scratchpad-draft:v1";

function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function scratchpadDraftStorageKey(scope: ScratchpadDraftScope): string | null {
  if (!scope.projectId) {
    return null;
  }
  return [
    scratchpadDraftPrefix,
    scope.kind,
    encodeURIComponent(scope.projectId),
    encodeURIComponent(scope.chapterId ?? "global"),
    encodeURIComponent(scope.noteId ?? "new")
  ].join(":");
}

export function readScratchpadDraft(scope: ScratchpadDraftScope, storage: Storage | null = getStorage()): string {
  const key = scratchpadDraftStorageKey(scope);
  if (!key || !storage) {
    return "";
  }
  try {
    return storage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeScratchpadDraft(
  scope: ScratchpadDraftScope,
  content: string,
  storage: Storage | null = getStorage()
): void {
  const key = scratchpadDraftStorageKey(scope);
  if (!key || !storage) {
    return;
  }
  try {
    if (content) {
      storage.setItem(key, content);
    } else {
      storage.removeItem(key);
    }
  } catch {
    // Draft recovery is best effort and must never block normal scratchpad editing.
  }
}

export function clearScratchpadDraft(scope: ScratchpadDraftScope, storage: Storage | null = getStorage()): void {
  const key = scratchpadDraftStorageKey(scope);
  if (!key || !storage) {
    return;
  }
  try {
    storage.removeItem(key);
  } catch {
    // A successful database save remains authoritative when local storage is unavailable.
  }
}
