import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendEmergencyJournalEntry,
  createDraftKey,
  createDraftTextHash,
  draftRecoveryStore,
  getEmergencyJournalEntries,
  shouldOfferDraftRecovery,
  shouldPruneDraft,
  type EditorDraftRecord
} from "../../src/renderer/state/draft-recovery-store";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function draftRecord(status: EditorDraftRecord["status"], updatedAt: string): EditorDraftRecord {
  return {
    key: "project_1:chapter_1",
    projectId: "project_1",
    chapterId: "chapter_1",
    chapterTitle: "第1章",
    contentJson: { type: "doc", content: [] },
    plainText: "草稿内容",
    wordCount: 4,
    contentHash: createDraftTextHash("草稿内容"),
    dbUpdatedAt: "2026-05-01T00:00:00.000Z",
    status,
    updatedAt
  };
}

describe("draft recovery store helpers", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage()
    });
  });

  afterEach(() => {
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("keys drafts by project and chapter", () => {
    expect(createDraftKey("project_1", "chapter_1")).toBe("project_1:chapter_1");
  });

  it("offers recovery when dirty draft differs from database content", () => {
    const draftHash = createDraftTextHash("用户刚写的新内容");
    const dbHash = createDraftTextHash("数据库旧内容");

    expect(
      shouldOfferDraftRecovery({
        draftStatus: "dirty",
        draftUpdatedAt: "2026-05-03T10:05:00.000Z",
        dbUpdatedAt: "2026-05-03T10:00:00.000Z",
        draftContentHash: draftHash,
        dbContentHash: dbHash
      })
    ).toBe(true);
  });

  it("does not offer recovery when saved draft matches database content", () => {
    const hash = createDraftTextHash("同一内容");

    expect(
      shouldOfferDraftRecovery({
        draftStatus: "saved",
        draftUpdatedAt: "2026-05-03T10:05:00.000Z",
        dbUpdatedAt: "2026-05-03T10:04:00.000Z",
        draftContentHash: hash,
        dbContentHash: hash
      })
    ).toBe(false);
  });

  it("only prunes old saved or dismissed drafts", () => {
    const nowIso = "2026-05-10T00:00:00.000Z";

    expect(shouldPruneDraft({ draft: draftRecord("saved", "2026-05-01T23:59:00.000Z"), nowIso, keepDays: 7 })).toBe(true);
    expect(shouldPruneDraft({ draft: draftRecord("dismissed", "2026-05-01T23:59:00.000Z"), nowIso, keepDays: 7 })).toBe(true);
    expect(shouldPruneDraft({ draft: draftRecord("dirty", "2026-05-01T23:59:00.000Z"), nowIso, keepDays: 7 })).toBe(false);
    expect(shouldPruneDraft({ draft: draftRecord("saved", "2026-05-08T00:00:00.000Z"), nowIso, keepDays: 7 })).toBe(false);
  });

  it("recovers the synchronous emergency draft even when IndexedDB is unavailable", async () => {
    draftRecoveryStore.putEmergencyDraft({
      projectId: "project_1",
      chapterId: "chapter_1",
      chapterTitle: "第1章",
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "立刻写下的新内容" }] }] },
      plainText: "立刻写下的新内容",
      wordCount: 8,
      dbUpdatedAt: "2026-05-03T10:00:00.000Z",
      status: "dirty"
    });

    await expect(draftRecoveryStore.getDraft("project_1", "chapter_1")).resolves.toMatchObject({
      chapterId: "chapter_1",
      plainText: "立刻写下的新内容",
      status: "dirty"
    });
  });

  it("marks only-local emergency drafts saved without hiding newer unsaved text", async () => {
    const dbText = "数据库旧内容";
    draftRecoveryStore.putEmergencyDraft({
      projectId: "project_1",
      chapterId: "chapter_1",
      chapterTitle: "第1章",
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "用户刚写的新内容" }] }] },
      plainText: "用户刚写的新内容",
      wordCount: 9,
      dbUpdatedAt: "2026-05-03T10:00:00.000Z",
      status: "dirty"
    });

    await draftRecoveryStore.markDraftSaved("project_1", "chapter_1", "2026-05-01T10:01:00.000Z");
    const draft = await draftRecoveryStore.getDraft("project_1", "chapter_1");

    expect(draft).toMatchObject({
      plainText: "用户刚写的新内容",
      status: "saved"
    });
    expect(
      shouldOfferDraftRecovery({
        draftStatus: draft!.status,
        draftUpdatedAt: draft!.updatedAt,
        dbUpdatedAt: draft!.dbUpdatedAt,
        draftContentHash: draft!.contentHash,
        dbContentHash: createDraftTextHash(dbText)
      })
    ).toBe(true);
  });

  it("dismisses only-local emergency drafts so they are not offered again", async () => {
    draftRecoveryStore.putEmergencyDraft({
      projectId: "project_1",
      chapterId: "chapter_1",
      chapterTitle: "第1章",
      contentJson: null,
      plainText: "不再恢复的内容",
      wordCount: 7,
      dbUpdatedAt: "2026-05-03T10:00:00.000Z",
      status: "dirty"
    });

    await draftRecoveryStore.dismissDraft("project_1", "chapter_1");
    const draft = await draftRecoveryStore.getDraft("project_1", "chapter_1");

    expect(draft?.status).toBe("dismissed");
    expect(
      shouldOfferDraftRecovery({
        draftStatus: draft!.status,
        draftUpdatedAt: draft!.updatedAt,
        dbUpdatedAt: draft!.dbUpdatedAt,
        draftContentHash: draft!.contentHash,
        dbContentHash: createDraftTextHash("数据库旧内容")
      })
    ).toBe(false);
  });

  it("keeps emergency drafts recoverable as plain text when formatted JSON is too large for localStorage", async () => {
    const oversizedText = "长章节正文".repeat(300_000);
    draftRecoveryStore.putEmergencyDraft({
      projectId: "project_1",
      chapterId: "chapter_1",
      chapterTitle: "第1章",
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: oversizedText }] }] },
      plainText: oversizedText,
      wordCount: oversizedText.length,
      dbUpdatedAt: "2026-05-03T10:00:00.000Z",
      status: "dirty"
    });

    const draft = await draftRecoveryStore.getDraft("project_1", "chapter_1");

    expect(draft?.plainText).toBe(oversizedText);
    expect(draft?.contentJson).toBeNull();
  });

  it("prunes old saved local emergency drafts but keeps dirty ones", async () => {
    draftRecoveryStore.putEmergencyDraft({
      projectId: "project_1",
      chapterId: "chapter_saved",
      chapterTitle: "已保存",
      contentJson: null,
      plainText: "已保存草稿",
      wordCount: 5,
      dbUpdatedAt: "2026-05-01T10:00:00.000Z",
      status: "dirty"
    });
    await draftRecoveryStore.markDraftSaved("project_1", "chapter_saved", "2026-05-01T10:01:00.000Z");
    draftRecoveryStore.putEmergencyDraft({
      projectId: "project_1",
      chapterId: "chapter_dirty",
      chapterTitle: "未保存",
      contentJson: null,
      plainText: "未保存草稿",
      wordCount: 5,
      dbUpdatedAt: "2026-05-01T10:00:00.000Z",
      status: "dirty"
    });

    const pruneNow = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();
    await draftRecoveryStore.pruneSavedDrafts(pruneNow, 7);

    await expect(draftRecoveryStore.getDraft("project_1", "chapter_saved")).resolves.toBeNull();
    await expect(draftRecoveryStore.getDraft("project_1", "chapter_dirty")).resolves.toMatchObject({ plainText: "未保存草稿" });
  });

  it("keeps a bounded per-chapter emergency journal for save checkpoints", () => {
    for (let index = 0; index < 8; index += 1) {
      appendEmergencyJournalEntry({
        projectId: "project_1",
        chapterId: "chapter_1",
        chapterTitle: "第1章",
        plainText: `保存前正文 ${index}`,
        wordCount: 6,
        dbUpdatedAt: "2026-05-03T10:00:00.000Z",
        reason: "before_save"
      });
    }

    const entries = getEmergencyJournalEntries("project_1", "chapter_1");

    expect(entries).toHaveLength(5);
    expect(entries[0]).toMatchObject({ plainText: "保存前正文 3", reason: "before_save" });
    expect(entries.at(-1)).toMatchObject({ plainText: "保存前正文 7", reason: "before_save" });
  });

  it("does not append duplicate emergency journal entries for the same content hash", () => {
    appendEmergencyJournalEntry({
      projectId: "project_1",
      chapterId: "chapter_1",
      chapterTitle: "第1章",
      plainText: "同一份正文",
      wordCount: 5,
      dbUpdatedAt: "2026-05-03T10:00:00.000Z",
      reason: "before_save"
    });
    appendEmergencyJournalEntry({
      projectId: "project_1",
      chapterId: "chapter_1",
      chapterTitle: "第1章",
      plainText: "同一份正文",
      wordCount: 5,
      dbUpdatedAt: "2026-05-03T10:00:00.000Z",
      reason: "before_save"
    });

    expect(getEmergencyJournalEntries("project_1", "chapter_1")).toHaveLength(1);
  });

  it("keeps emergency journal entries isolated by project and chapter", () => {
    appendEmergencyJournalEntry({
      projectId: "project_1",
      chapterId: "chapter_1",
      chapterTitle: "项目一第1章",
      plainText: "项目一正文",
      wordCount: 5,
      dbUpdatedAt: null,
      reason: "before_save"
    });
    appendEmergencyJournalEntry({
      projectId: "project_1",
      chapterId: "chapter_2",
      chapterTitle: "项目一第2章",
      plainText: "项目一第二章正文",
      wordCount: 8,
      dbUpdatedAt: null,
      reason: "before_save"
    });
    appendEmergencyJournalEntry({
      projectId: "project_2",
      chapterId: "chapter_1",
      chapterTitle: "项目二第1章",
      plainText: "项目二正文",
      wordCount: 5,
      dbUpdatedAt: null,
      reason: "before_ai_apply"
    });

    expect(getEmergencyJournalEntries("project_1", "chapter_1").map((entry) => entry.plainText)).toEqual(["项目一正文"]);
    expect(getEmergencyJournalEntries("project_1", "chapter_2").map((entry) => entry.plainText)).toEqual(["项目一第二章正文"]);
    expect(getEmergencyJournalEntries("project_2", "chapter_1").map((entry) => entry.reason)).toEqual(["before_ai_apply"]);
  });

  it("treats malformed emergency journal storage as empty instead of blocking recovery", () => {
    localStorage.setItem("moshu-editor-journal:project_1:chapter_1", "{ broken json");

    expect(getEmergencyJournalEntries("project_1", "chapter_1")).toEqual([]);
  });

  it("does not throw when emergency journal storage is unavailable", () => {
    Reflect.deleteProperty(globalThis, "localStorage");

    expect(() =>
      appendEmergencyJournalEntry({
        projectId: "project_1",
        chapterId: "chapter_1",
        chapterTitle: "第1章",
        plainText: "无法写入本地存储时的正文",
        wordCount: 12,
        dbUpdatedAt: null,
        reason: "before_save"
      })
    ).not.toThrow();
    expect(getEmergencyJournalEntries("project_1", "chapter_1")).toEqual([]);
  });
});
