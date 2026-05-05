import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChapterContent, ChapterSummary, EditorSettings, SettingsState } from "../../main/shared/types";
import { countWritingUnits } from "../../main/shared/text";
import { getNovelToolApi } from "./app-store";
import {
  createTiptapDocumentFromPlainText,
  extractPlainTextFromTiptapJson,
  normalizeTiptapDocument,
  type TiptapDocument
} from "../editor/tiptap/converters";
import { createDraftTextHash, draftRecoveryStore, shouldOfferDraftRecovery, type EditorDraftRecord } from "./draft-recovery-store";

export const AUTOSAVE_DEBOUNCE_MS = 1000;

const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontSize: 20,
  lineHeight: 2.08,
  autosaveMs: AUTOSAVE_DEBOUNCE_MS,
  layoutPreset: "immersive",
  pageWidth: "medium",
  fontFamily: "system",
  paragraphSpacing: "standard",
  firstLineIndent: "two",
  theme: "light"
};

export type SaveStatus = "saved" | "dirty" | "saving" | "failed";

export type SavedChapterVersion = {
  readonly chapterId: string;
  readonly projectId: string;
  readonly updatedAt: string | null;
};

function formatSavedAt(value: Date | null): string {
  if (!value) {
    return "已保存";
  }

  return `已保存 ${value.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
}

function formatError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function statusLabel(status: SaveStatus, savedAt: Date | null, errorMessage: string | null): string {
  if (status === "dirty") {
    return "等待保存";
  }
  if (status === "saving") {
    return "保存中";
  }
  if (status === "failed") {
    return errorMessage ? `错误：${errorMessage}` : "保存失败";
  }
  return formatSavedAt(savedAt);
}

function localDateKey(value: Date = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getVisibleDailyWordCount(input: {
  readonly dailyWordCount: number;
  readonly dailyWordCountDate: string | null;
  readonly savedWordCount: number;
  readonly saveStatus: SaveStatus;
  readonly today?: string;
  readonly wordCount: number;
}): number {
  const baseDailyWordCount = input.dailyWordCountDate === (input.today ?? localDateKey()) ? input.dailyWordCount : 0;
  if (input.saveStatus !== "dirty" && input.saveStatus !== "saving") {
    return baseDailyWordCount;
  }

  return Math.max(0, baseDailyWordCount + input.wordCount - input.savedWordCount);
}

export function resolveSaveCompletionStatus(input: {
  readonly currentRevision: number;
  readonly saveStartedAtRevision: number;
}): SaveStatus {
  return input.currentRevision === input.saveStartedAtRevision ? "saved" : "dirty";
}

type SaveSnapshot = {
  readonly chapterId: string | null;
  readonly contentJson: TiptapDocument;
  readonly plainText: string;
  readonly projectId: string | null;
  readonly scopeId: number;
  readonly wordCount: number;
};

type DraftWriteContext = {
  readonly chapterId: string | null;
  readonly chapterTitle: string;
  readonly dbUpdatedAt: string | null;
  readonly projectId: string | null;
};

export function useEditorStore(activeChapter: ChapterSummary | null, onChapterSaved?: (content: ChapterContent) => void) {
  const api = useMemo(getNovelToolApi, []);
  const [contentJson, setContentJson] = useState<TiptapDocument>(() => createTiptapDocumentFromPlainText(""));
  const [contentVersion, setContentVersion] = useState(0);
  const [loadedChapterId, setLoadedChapterId] = useState<string | null>(null);
  const [plainText, setPlainText] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(DEFAULT_EDITOR_SETTINGS);
  const [wordCount, setWordCount] = useState(0);
  const [dailyWordCount, setDailyWordCount] = useState(0);
  const [dailyWordCountDate, setDailyWordCountDate] = useState<string | null>(null);
  const [savedWordCount, setSavedWordCount] = useState(0);
  const [pendingDraftRecovery, setPendingDraftRecovery] = useState<EditorDraftRecord | null>(null);
  const saveInFlight = useRef<Promise<SavedChapterVersion | null> | null>(null);
  const editRevision = useRef(0);
  const savedRevision = useRef(0);
  const editorScope = useRef(0);
  const savedDbUpdatedAt = useRef<string | null>(null);
  const draftWriteTimer = useRef<number | null>(null);

  const chapterId = activeChapter?.id ?? null;
  const projectId = activeChapter?.projectId ?? null;
  const draftWriteContext = useRef<DraftWriteContext>({
    chapterId,
    chapterTitle: activeChapter?.title ?? "未命名章节",
    dbUpdatedAt: savedDbUpdatedAt.current,
    projectId
  });
  draftWriteContext.current = {
    chapterId,
    chapterTitle: activeChapter?.title ?? "未命名章节",
    dbUpdatedAt: savedDbUpdatedAt.current,
    projectId
  };
  const latestSaveSnapshot = useRef<SaveSnapshot>({
    chapterId,
    contentJson,
    plainText,
    projectId,
    scopeId: editorScope.current,
    wordCount
  });
  latestSaveSnapshot.current = {
    chapterId,
    contentJson,
    plainText,
    projectId,
    scopeId: editorScope.current,
    wordCount
  };

  useEffect(() => {
    let cancelled = false;
    async function loadEditorSettings() {
      try {
        const settings = (await api.settings.get()) as SettingsState;
        if (!cancelled) {
          setEditorSettings(settings.editor);
        }
      } catch (reason) {
        if (!cancelled) {
          setErrorMessage(formatError(reason));
          setSaveStatus("failed");
        }
      }
    }

    void loadEditorSettings();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    editorScope.current += 1;
    editRevision.current = 0;
    savedRevision.current = 0;

    if (!chapterId || !projectId) {
      const emptyDocument = createTiptapDocumentFromPlainText("");
      setContentJson(emptyDocument);
      setContentVersion((current) => current + 1);
      setLoadedChapterId(null);
      setPlainText("");
      setWordCount(0);
      setDailyWordCount(0);
      setDailyWordCountDate(null);
      setSavedWordCount(0);
      setSaveStatus("saved");
      setLastSavedAt(null);
      savedDbUpdatedAt.current = null;
      setErrorMessage(null);
      setPendingDraftRecovery(null);
      return;
    }

    const currentChapterId = chapterId;
    const currentProjectId = projectId;
    const currentScopeId = editorScope.current;
    let cancelled = false;
    setLoadedChapterId(null);

    async function loadChapterContent() {
      setSaveStatus("saved");
      setErrorMessage(null);
      try {
        const content = (await api.chapter.getContent({ projectId: currentProjectId, chapterId: currentChapterId })) as ChapterContent | undefined;
        if (cancelled) {
          return;
        }
        if (editorScope.current !== currentScopeId) {
          return;
        }
        if (!content) {
          throw new Error(`章节内容不存在：${currentChapterId}`);
        }
        editRevision.current = 0;
        savedRevision.current = 0;
        const nextPlainText = content.plainText;
        const nextDocument = normalizeTiptapDocument(content.contentJson, nextPlainText);
        setContentJson(nextDocument);
        setContentVersion((current) => current + 1);
        setLoadedChapterId(currentChapterId);
        const nextWordCount = countWritingUnits(nextPlainText);
        setPlainText(nextPlainText);
        setWordCount(nextWordCount);
        setDailyWordCount(content.dailyWordCount ?? 0);
        setDailyWordCountDate(content.dailyWordCountDate ?? null);
        setSavedWordCount(nextWordCount);
        setLastSavedAt(content.updatedAt ? new Date(content.updatedAt) : null);
        savedDbUpdatedAt.current = content.updatedAt ?? null;
        try {
          const draft = await draftRecoveryStore.getDraft(currentProjectId, currentChapterId);
          if (cancelled || editorScope.current !== currentScopeId) {
            return;
          }
          if (
            draft &&
            shouldOfferDraftRecovery({
              draftStatus: draft.status,
              draftUpdatedAt: draft.updatedAt,
              dbUpdatedAt: content.updatedAt ?? null,
              draftContentHash: draft.contentHash,
              dbContentHash: createDraftTextHash(nextPlainText)
            })
          ) {
            setPendingDraftRecovery(draft);
          } else {
            setPendingDraftRecovery(null);
          }
        } catch (draftReason) {
          console.warn("Failed to inspect local editor draft", draftReason);
          if (!cancelled && editorScope.current === currentScopeId) {
            setPendingDraftRecovery(null);
          }
        }
      } catch (reason) {
        if (cancelled) {
          return;
        }
        if (editorScope.current !== currentScopeId) {
          return;
        }
        editRevision.current = 0;
        savedRevision.current = 0;
        const nextDocument = createTiptapDocumentFromPlainText("");
        setContentJson(nextDocument);
        setContentVersion((current) => current + 1);
        setLoadedChapterId(null);
        setPlainText("");
        setWordCount(0);
        setDailyWordCount(0);
        setDailyWordCountDate(null);
        setSavedWordCount(0);
        savedDbUpdatedAt.current = null;
        setPendingDraftRecovery(null);
        setErrorMessage(formatError(reason));
        setSaveStatus("failed");
      }
    }

    void loadChapterContent();

    return () => {
      cancelled = true;
    };
  }, [api, chapterId, projectId]);

  useEffect(() => {
    if (activeChapter?.id !== loadedChapterId || !activeChapter.updatedAt) {
      return;
    }
    if (!savedDbUpdatedAt.current || activeChapter.updatedAt > savedDbUpdatedAt.current) {
      savedDbUpdatedAt.current = activeChapter.updatedAt;
    }
  }, [activeChapter?.id, activeChapter?.updatedAt, loadedChapterId]);

  const handleContentChange = useCallback((nextContentJson: TiptapDocument) => {
    editRevision.current += 1;
    const nextPlainText = extractPlainTextFromTiptapJson(nextContentJson);
    const nextWordCount = countWritingUnits(nextPlainText);
    setContentJson(nextContentJson);
    setPlainText(nextPlainText);
    setWordCount(nextWordCount);
    setErrorMessage(null);
    setSaveStatus("dirty");
    const draftContext = draftWriteContext.current;
    if (draftWriteTimer.current !== null) {
      window.clearTimeout(draftWriteTimer.current);
    }
    if (draftContext.projectId && draftContext.chapterId) {
      draftRecoveryStore.putEmergencyDraft({
        projectId: draftContext.projectId,
        chapterId: draftContext.chapterId,
        chapterTitle: draftContext.chapterTitle,
        contentJson: nextContentJson,
        plainText: nextPlainText,
        wordCount: nextWordCount,
        dbUpdatedAt: draftContext.dbUpdatedAt,
        status: "dirty"
      });
    }
    draftWriteTimer.current = window.setTimeout(() => {
      if (!draftContext.projectId || !draftContext.chapterId) {
        return;
      }
      void draftRecoveryStore.putDraft({
          projectId: draftContext.projectId,
          chapterId: draftContext.chapterId,
          chapterTitle: draftContext.chapterTitle,
          contentJson: nextContentJson,
          plainText: nextPlainText,
          wordCount: nextWordCount,
          dbUpdatedAt: draftContext.dbUpdatedAt,
          status: "dirty"
        })
        .catch((reason) => console.warn("Failed to write local editor draft", reason));
    }, 500);
  }, []);

  const updateEditorSettings = useCallback(
    async (patch: Partial<EditorSettings>) => {
      try {
        const settings = (await api.settings.save({ editor: patch })) as SettingsState;
        setEditorSettings(settings.editor);
        setErrorMessage(null);
      } catch (reason) {
        setErrorMessage(formatError(reason));
        setSaveStatus("failed");
        throw reason;
      }
    },
    [api]
  );

  const flushPendingSave = useCallback(async (): Promise<SavedChapterVersion | null> => {
    if (saveInFlight.current) {
      await saveInFlight.current;
    }

    while (savedRevision.current < editRevision.current) {
      const snapshot = latestSaveSnapshot.current;
      if (!snapshot.chapterId || !snapshot.projectId) {
        return null;
      }

      const snapshotChapterId = snapshot.chapterId;
      const snapshotProjectId = snapshot.projectId;
      const snapshotDraftContext = draftWriteContext.current;
      const saveStartedAtRevision = editRevision.current;
      setSaveStatus("saving");
      const savePromise = (async () => {
        draftRecoveryStore.appendEmergencyJournalEntry({
          projectId: snapshotProjectId,
          chapterId: snapshotChapterId,
          chapterTitle: snapshotDraftContext.chapterId === snapshotChapterId ? snapshotDraftContext.chapterTitle : "未命名章节",
          plainText: snapshot.plainText,
          wordCount: snapshot.wordCount,
          dbUpdatedAt: snapshotDraftContext.chapterId === snapshotChapterId ? snapshotDraftContext.dbUpdatedAt : savedDbUpdatedAt.current,
          reason: "before_save"
        });

        const content = (await api.chapter.saveContent({
          projectId: snapshotProjectId,
          chapterId: snapshotChapterId,
          contentJson: snapshot.contentJson,
          plainText: snapshot.plainText,
          wordCount: snapshot.wordCount,
          expectedUpdatedAt: savedDbUpdatedAt.current ?? undefined
        })) as ChapterContent | undefined;
        if (content) {
          onChapterSaved?.(content);
        }

        void draftRecoveryStore.markDraftSaved(snapshotProjectId, snapshotChapterId, content?.updatedAt ?? new Date().toISOString())
          .catch((reason) => console.warn("Failed to mark local editor draft saved", reason));

        if (editorScope.current !== snapshot.scopeId) {
          return null;
        }

        savedRevision.current = Math.max(savedRevision.current, saveStartedAtRevision);
        const savedContentWordCount = content?.wordCount ?? countWritingUnits(snapshot.plainText);
        if (editRevision.current === saveStartedAtRevision) {
          setWordCount(savedContentWordCount);
        }
        setDailyWordCount(content?.dailyWordCount ?? 0);
        setDailyWordCountDate(content?.dailyWordCountDate ?? localDateKey());
        setSavedWordCount(savedContentWordCount);
        setLastSavedAt(content?.updatedAt ? new Date(content.updatedAt) : new Date());
        savedDbUpdatedAt.current = content?.updatedAt ?? null;
        setSaveStatus(
          resolveSaveCompletionStatus({
            currentRevision: editRevision.current,
            saveStartedAtRevision
          })
        );
        return content ? { chapterId: content.id, projectId: content.projectId, updatedAt: content.updatedAt ?? null } : null;
      })();

      saveInFlight.current = savePromise;
      try {
        await savePromise;
      } catch (reason) {
        if (editorScope.current === snapshot.scopeId) {
          setErrorMessage(formatError(reason));
          setSaveStatus("failed");
        }
        throw reason;
      } finally {
        if (saveInFlight.current === savePromise) {
          saveInFlight.current = null;
        }
      }
    }
    const snapshot = latestSaveSnapshot.current;
    if (!snapshot.chapterId || !snapshot.projectId) {
      return null;
    }
    return {
      chapterId: snapshot.chapterId,
      projectId: snapshot.projectId,
      updatedAt: savedDbUpdatedAt.current
    };
  }, [api, onChapterSaved]);

  useEffect(() => {
    if (!chapterId || saveStatus !== "dirty") {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      void flushPendingSave();
    }, editorSettings.autosaveMs);

    return () => window.clearTimeout(timer);
  }, [chapterId, editorSettings.autosaveMs, flushPendingSave, saveStatus]);

  const recoverDraft = useCallback(() => {
    const draft = pendingDraftRecovery;
    if (!draft) {
      return;
    }
    editRevision.current += 1;
    const nextDocument = normalizeTiptapDocument(draft.contentJson, draft.plainText);
    setContentJson(nextDocument);
    setContentVersion((current) => current + 1);
    setPlainText(draft.plainText);
    setWordCount(countWritingUnits(draft.plainText));
    setErrorMessage(null);
    setSaveStatus("dirty");
    setPendingDraftRecovery(null);
  }, [pendingDraftRecovery]);

  const dismissDraftRecovery = useCallback(() => {
    const draft = pendingDraftRecovery;
    if (!draft) {
      return;
    }
    setPendingDraftRecovery(null);
    void draftRecoveryStore
      .dismissDraft(draft.projectId, draft.chapterId)
      .catch((reason) => console.warn("Failed to dismiss local editor draft", reason));
  }, [pendingDraftRecovery]);

  const visibleDailyWordCount = getVisibleDailyWordCount({ dailyWordCount, dailyWordCountDate, savedWordCount, saveStatus, wordCount });

  return {
    contentJson,
    contentVersion,
    loadedChapterId,
    editorSettings,
    dailyWordCount: visibleDailyWordCount,
    dismissDraftRecovery,
    flushPendingSave,
    handleContentChange,
    pendingDraftRecovery,
    plainText,
    recoverDraft,
    saveStatus,
    saveStatusLabel: statusLabel(saveStatus, lastSavedAt, errorMessage),
    updateEditorSettings,
    wordCount
  };
}
