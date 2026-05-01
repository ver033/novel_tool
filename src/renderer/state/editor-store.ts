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

export function useEditorStore(activeChapter: ChapterSummary | null) {
  const api = useMemo(getNovelToolApi, []);
  const [contentJson, setContentJson] = useState<TiptapDocument>(() => createTiptapDocumentFromPlainText(""));
  const [contentVersion, setContentVersion] = useState(0);
  const [plainText, setPlainText] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(DEFAULT_EDITOR_SETTINGS);
  const [wordCount, setWordCount] = useState(0);
  const [dailyWordCount, setDailyWordCount] = useState(0);
  const [dailyWordCountDate, setDailyWordCountDate] = useState<string | null>(null);
  const [savedWordCount, setSavedWordCount] = useState(0);
  const saveInFlight = useRef<Promise<void> | null>(null);
  const editRevision = useRef(0);
  const savedRevision = useRef(0);
  const editorScope = useRef(0);

  const chapterId = activeChapter?.id ?? null;
  const projectId = activeChapter?.projectId ?? null;
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
      setPlainText("");
      setWordCount(0);
      setDailyWordCount(0);
      setDailyWordCountDate(null);
      setSavedWordCount(0);
      setSaveStatus("saved");
      setLastSavedAt(null);
      setErrorMessage(null);
      return;
    }

    const currentChapterId = chapterId;
    const currentProjectId = projectId;
    const currentScopeId = editorScope.current;
    let cancelled = false;

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
        setPlainText(nextPlainText);
        setWordCount(content.wordCount ?? countWritingUnits(nextPlainText));
        setDailyWordCount(content.dailyWordCount ?? 0);
        setDailyWordCountDate(content.dailyWordCountDate ?? null);
        setSavedWordCount(content.wordCount ?? countWritingUnits(nextPlainText));
        setLastSavedAt(content.updatedAt ? new Date(content.updatedAt) : null);
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
        setPlainText("");
        setWordCount(0);
        setDailyWordCount(0);
        setDailyWordCountDate(null);
        setSavedWordCount(0);
        setErrorMessage(formatError(reason));
        setSaveStatus("failed");
      }
    }

    void loadChapterContent();

    return () => {
      cancelled = true;
    };
  }, [api, chapterId, projectId]);

  const handleContentChange = useCallback((nextContentJson: TiptapDocument) => {
    editRevision.current += 1;
    const nextPlainText = extractPlainTextFromTiptapJson(nextContentJson);
    setContentJson(nextContentJson);
    setPlainText(nextPlainText);
    setWordCount(countWritingUnits(nextPlainText));
    setErrorMessage(null);
    setSaveStatus("dirty");
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

  const flushPendingSave = useCallback(async () => {
    if (saveInFlight.current) {
      await saveInFlight.current;
    }

    while (savedRevision.current < editRevision.current) {
      const snapshot = latestSaveSnapshot.current;
      if (!snapshot.chapterId || !snapshot.projectId) {
        return;
      }

      const snapshotChapterId = snapshot.chapterId;
      const snapshotProjectId = snapshot.projectId;
      const saveStartedAtRevision = editRevision.current;
      setSaveStatus("saving");
      const savePromise = (async () => {
        const content = (await api.chapter.saveContent({
          projectId: snapshotProjectId,
          chapterId: snapshotChapterId,
          contentJson: snapshot.contentJson,
          plainText: snapshot.plainText,
          wordCount: snapshot.wordCount
        })) as ChapterContent | undefined;

        if (editorScope.current !== snapshot.scopeId) {
          return;
        }

        savedRevision.current = Math.max(savedRevision.current, saveStartedAtRevision);
        setDailyWordCount(content?.dailyWordCount ?? 0);
        setDailyWordCountDate(content?.dailyWordCountDate ?? localDateKey());
        setSavedWordCount(content?.wordCount ?? snapshot.wordCount);
        setLastSavedAt(content?.updatedAt ? new Date(content.updatedAt) : new Date());
        setSaveStatus(
          resolveSaveCompletionStatus({
            currentRevision: editRevision.current,
            saveStartedAtRevision
          })
        );
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
  }, [api]);

  useEffect(() => {
    if (!chapterId || saveStatus !== "dirty") {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      void flushPendingSave();
    }, editorSettings.autosaveMs);

    return () => window.clearTimeout(timer);
  }, [chapterId, editorSettings.autosaveMs, flushPendingSave, saveStatus]);

  const visibleDailyWordCount = getVisibleDailyWordCount({ dailyWordCount, dailyWordCountDate, savedWordCount, saveStatus, wordCount });

  return {
    contentJson,
    contentVersion,
    editorSettings,
    dailyWordCount: visibleDailyWordCount,
    flushPendingSave,
    handleContentChange,
    plainText,
    saveStatus,
    saveStatusLabel: statusLabel(saveStatus, lastSavedAt, errorMessage),
    updateEditorSettings,
    wordCount
  };
}
