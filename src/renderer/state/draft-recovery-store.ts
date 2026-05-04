export type DraftStatus = "dirty" | "saved" | "dismissed";

export type EditorDraftRecord = {
  readonly key: string;
  readonly projectId: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly contentJson: unknown;
  readonly plainText: string;
  readonly wordCount: number;
  readonly contentHash: string;
  readonly dbUpdatedAt: string | null;
  readonly status: DraftStatus;
  readonly updatedAt: string;
};

export type EmergencyJournalReason = "before_ai_apply" | "before_save";

export type EmergencyJournalEntry = {
  readonly key: string;
  readonly projectId: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly plainText: string;
  readonly wordCount: number;
  readonly contentHash: string;
  readonly dbUpdatedAt: string | null;
  readonly reason: EmergencyJournalReason;
  readonly createdAt: string;
};

export type DraftRecoveryDecisionInput = {
  readonly draftStatus: DraftStatus;
  readonly draftUpdatedAt: string;
  readonly dbUpdatedAt: string | null;
  readonly draftContentHash: string;
  readonly dbContentHash: string;
};

type PutDraftInput = Omit<EditorDraftRecord, "key" | "contentHash" | "updatedAt">;
type PutEmergencyJournalInput = Omit<EmergencyJournalEntry, "contentHash" | "createdAt" | "key">;

const DATABASE_NAME = "moshu-draft-recovery";
const DATABASE_VERSION = 1;
const STORE_NAME = "editor_drafts";
const EMERGENCY_JOURNAL_LOCAL_STORAGE_PREFIX = "moshu-editor-journal:";
const LOCAL_STORAGE_PREFIX = "moshu-editor-draft:";
const LOCAL_STORAGE_CONTENT_JSON_LIMIT = 1_500_000;
const MAX_EMERGENCY_JOURNAL_ENTRIES_PER_CHAPTER = 5;
const SAVED_DRAFT_STATUSES = new Set<DraftStatus>(["saved", "dismissed"]);

let databasePromise: Promise<IDBDatabase> | null = null;

export function createDraftKey(projectId: string, chapterId: string): string {
  return `${projectId}:${chapterId}`;
}

export function createDraftTextHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function parseTime(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function localStorageKey(projectId: string, chapterId: string): string {
  return `${LOCAL_STORAGE_PREFIX}${createDraftKey(projectId, chapterId)}`;
}

function emergencyJournalLocalStorageKey(projectId: string, chapterId: string): string {
  return `${EMERGENCY_JOURNAL_LOCAL_STORAGE_PREFIX}${createDraftKey(projectId, chapterId)}`;
}

function createDraftRecord(input: PutDraftInput, updatedAt = new Date().toISOString()): EditorDraftRecord {
  return {
    ...input,
    key: createDraftKey(input.projectId, input.chapterId),
    contentHash: createDraftTextHash(input.plainText),
    updatedAt
  };
}

function createEmergencyJournalEntry(input: PutEmergencyJournalInput, createdAt = new Date().toISOString()): EmergencyJournalEntry {
  return {
    ...input,
    key: createDraftKey(input.projectId, input.chapterId),
    contentHash: createDraftTextHash(input.plainText),
    createdAt
  };
}

function recordForLocalStorage(record: EditorDraftRecord): EditorDraftRecord {
  try {
    const serializedContent = JSON.stringify(record.contentJson);
    if (serializedContent.length <= LOCAL_STORAGE_CONTENT_JSON_LIMIT) {
      return record;
    }
  } catch {
    // Fall through to plain-text recovery. The emergency draft must prefer text survival over formatting.
  }

  return {
    ...record,
    contentJson: null
  };
}

function putLocalDraft(record: EditorDraftRecord): void {
  const store = storage();
  if (!store) {
    return;
  }

  try {
    store.setItem(localStorageKey(record.projectId, record.chapterId), JSON.stringify(recordForLocalStorage(record)));
  } catch {
    // localStorage is an emergency best-effort layer. IndexedDB remains the full draft store.
  }
}

function getLocalDraft(projectId: string, chapterId: string): EditorDraftRecord | null {
  const store = storage();
  if (!store) {
    return null;
  }

  try {
    const raw = store.getItem(localStorageKey(projectId, chapterId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as EditorDraftRecord;
    return parsed && parsed.projectId === projectId && parsed.chapterId === chapterId ? parsed : null;
  } catch {
    return null;
  }
}

function getLocalEmergencyJournalEntries(projectId: string, chapterId: string): EmergencyJournalEntry[] {
  const store = storage();
  if (!store) {
    return [];
  }

  try {
    const raw = store.getItem(emergencyJournalLocalStorageKey(projectId, chapterId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as EmergencyJournalEntry[];
    return Array.isArray(parsed) ? parsed.filter((entry) => entry.projectId === projectId && entry.chapterId === chapterId) : [];
  } catch {
    return [];
  }
}

function putLocalEmergencyJournalEntries(projectId: string, chapterId: string, entries: EmergencyJournalEntry[]): void {
  const store = storage();
  if (!store) {
    return;
  }

  try {
    store.setItem(emergencyJournalLocalStorageKey(projectId, chapterId), JSON.stringify(entries));
  } catch {
    // The normal emergency draft is still the primary recovery layer. The append journal is best-effort.
  }
}

function pruneLocalDrafts(nowIso: string, keepDays: number): void {
  const store = storage();
  if (!store) {
    return;
  }

  const keys = Array.from({ length: store.length }, (_, index) => store.key(index)).filter((key): key is string => Boolean(key?.startsWith(LOCAL_STORAGE_PREFIX)));
  for (const key of keys) {
    try {
      const raw = store.getItem(key);
      if (!raw) {
        continue;
      }
      const draft = JSON.parse(raw) as EditorDraftRecord;
      if (shouldPruneDraft({ draft, nowIso, keepDays })) {
        store.removeItem(key);
      }
    } catch {
      store.removeItem(key);
    }
  }
}

export function appendEmergencyJournalEntry(input: PutEmergencyJournalInput): EmergencyJournalEntry | null {
  const entry = createEmergencyJournalEntry(input);
  const existingEntries = getLocalEmergencyJournalEntries(input.projectId, input.chapterId);
  const latestEntry = existingEntries.at(-1);
  if (latestEntry?.contentHash === entry.contentHash) {
    return latestEntry;
  }

  const nextEntries = [...existingEntries, entry].slice(-MAX_EMERGENCY_JOURNAL_ENTRIES_PER_CHAPTER);
  putLocalEmergencyJournalEntries(input.projectId, input.chapterId, nextEntries);
  return entry;
}

export function getEmergencyJournalEntries(projectId: string, chapterId: string): EmergencyJournalEntry[] {
  return getLocalEmergencyJournalEntries(projectId, chapterId);
}

function chooseDraft(indexedDraft: EditorDraftRecord | null, localDraft: EditorDraftRecord | null): EditorDraftRecord | null {
  if (!indexedDraft) {
    return localDraft;
  }
  if (!localDraft) {
    return indexedDraft;
  }
  return parseTime(localDraft.updatedAt) > parseTime(indexedDraft.updatedAt) ? localDraft : indexedDraft;
}

export function shouldOfferDraftRecovery(input: DraftRecoveryDecisionInput): boolean {
  if (input.draftStatus === "dismissed") {
    return false;
  }
  if (input.draftContentHash === input.dbContentHash) {
    return false;
  }
  if (input.draftStatus === "dirty") {
    return true;
  }
  return parseTime(input.draftUpdatedAt) > parseTime(input.dbUpdatedAt);
}

export function shouldPruneDraft(input: { readonly draft: EditorDraftRecord; readonly nowIso: string; readonly keepDays: number }): boolean {
  if (!SAVED_DRAFT_STATUSES.has(input.draft.status)) {
    return false;
  }
  const maxAgeMs = input.keepDays * 24 * 60 * 60 * 1000;
  return parseTime(input.nowIso) - parseTime(input.draft.updatedAt) > maxAgeMs;
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) {
    return databasePromise;
  }
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地草稿库。"));
  });
  return databasePromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("本地草稿操作失败。"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("本地草稿事务失败。"));
    transaction.onabort = () => reject(transaction.error ?? new Error("本地草稿事务已取消。"));
  });
}

async function getDraftByKey(key: string): Promise<EditorDraftRecord | null> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const store = transaction.objectStore(STORE_NAME);
  const draft = (await requestToPromise(store.get(key))) as EditorDraftRecord | undefined;
  return draft ?? null;
}

async function putRecord(record: EditorDraftRecord): Promise<EditorDraftRecord> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).put(record);
  await transactionDone(transaction);
  return record;
}

export const draftRecoveryStore = {
  appendEmergencyJournalEntry,

  getEmergencyJournalEntries,

  putEmergencyDraft(input: PutDraftInput): EditorDraftRecord {
    const record = createDraftRecord(input);
    putLocalDraft(record);
    return record;
  },

  async putDraft(input: PutDraftInput): Promise<EditorDraftRecord> {
    const record = createDraftRecord(input);
    putLocalDraft(record);
    return putRecord(record);
  },

  async getDraft(projectId: string, chapterId: string): Promise<EditorDraftRecord | null> {
    const localDraft = getLocalDraft(projectId, chapterId);
    try {
      return chooseDraft(await getDraftByKey(createDraftKey(projectId, chapterId)), localDraft);
    } catch {
      return localDraft;
    }
  },

  async markDraftSaved(projectId: string, chapterId: string, dbUpdatedAt: string | null): Promise<void> {
    let draft: EditorDraftRecord | null = null;
    try {
      draft = await getDraftByKey(createDraftKey(projectId, chapterId));
    } catch {
      draft = null;
    }
    const localDraft = getLocalDraft(projectId, chapterId);
    const selectedDraft = chooseDraft(draft, localDraft);
    if (!selectedDraft) {
      return;
    }
    const nextDraft = {
      ...selectedDraft,
      dbUpdatedAt,
      status: "saved",
      updatedAt: new Date().toISOString()
    } satisfies EditorDraftRecord;
    putLocalDraft(nextDraft);
    if (draft) {
      try {
        await putRecord(nextDraft);
      } catch {
        // The synchronous local draft has already been updated.
      }
    }
  },

  async dismissDraft(projectId: string, chapterId: string): Promise<void> {
    let draft: EditorDraftRecord | null = null;
    try {
      draft = await getDraftByKey(createDraftKey(projectId, chapterId));
    } catch {
      draft = null;
    }
    const localDraft = getLocalDraft(projectId, chapterId);
    const selectedDraft = chooseDraft(draft, localDraft);
    if (!selectedDraft) {
      return;
    }
    const nextDraft = {
      ...selectedDraft,
      status: "dismissed",
      updatedAt: new Date().toISOString()
    } satisfies EditorDraftRecord;
    putLocalDraft(nextDraft);
    if (draft) {
      try {
        await putRecord(nextDraft);
      } catch {
        // The synchronous local draft has already been updated.
      }
    }
  },

  async pruneSavedDrafts(nowIso: string, keepDays: number): Promise<void> {
    pruneLocalDrafts(nowIso, keepDays);
    let database: IDBDatabase;
    try {
      database = await openDatabase();
    } catch {
      return;
    }
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const allDrafts = (await requestToPromise(store.getAll())) as EditorDraftRecord[];
    for (const draft of allDrafts) {
      if (shouldPruneDraft({ draft, nowIso, keepDays })) {
        store.delete(draft.key);
      }
    }
    await transactionDone(transaction);
  }
};
