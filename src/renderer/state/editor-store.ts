import { useCallback, useEffect, useMemo, useState } from "react";
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

  const chapterId = activeChapter?.id ?? null;

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
    if (!chapterId) {
      const emptyDocument = createTiptapDocumentFromPlainText("");
      setContentJson(emptyDocument);
      setContentVersion((current) => current + 1);
      setPlainText("");
      setWordCount(0);
      setSaveStatus("saved");
      setLastSavedAt(null);
      setErrorMessage(null);
      return;
    }

    const currentChapterId = chapterId;
    let cancelled = false;

    async function loadChapterContent() {
      setSaveStatus("saved");
      setErrorMessage(null);
      try {
        const content = (await api.chapter.getContent({ chapterId: currentChapterId })) as ChapterContent | undefined;
        if (cancelled) {
          return;
        }
        if (!content) {
          throw new Error(`章节内容不存在：${currentChapterId}`);
        }
        const nextPlainText = content.plainText;
        const nextDocument = normalizeTiptapDocument(content.contentJson, nextPlainText);
        setContentJson(nextDocument);
        setContentVersion((current) => current + 1);
        setPlainText(nextPlainText);
        setWordCount(content.wordCount ?? countWritingUnits(nextPlainText));
        setLastSavedAt(content.updatedAt ? new Date(content.updatedAt) : null);
      } catch (reason) {
        if (cancelled) {
          return;
        }
        const nextDocument = createTiptapDocumentFromPlainText("");
        setContentJson(nextDocument);
        setContentVersion((current) => current + 1);
        setPlainText("");
        setWordCount(0);
        setErrorMessage(formatError(reason));
        setSaveStatus("failed");
      }
    }

    void loadChapterContent();

    return () => {
      cancelled = true;
    };
  }, [api, chapterId]);

  const handleContentChange = useCallback((nextContentJson: TiptapDocument) => {
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
    if (!chapterId || saveStatus !== "dirty") {
      return;
    }

    setSaveStatus("saving");
    try {
      const content = (await api.chapter.saveContent({
        chapterId,
        contentJson,
        plainText,
        wordCount
      })) as ChapterContent | undefined;
      setSaveStatus("saved");
      setLastSavedAt(content?.updatedAt ? new Date(content.updatedAt) : new Date());
    } catch (reason) {
      setErrorMessage(formatError(reason));
      setSaveStatus("failed");
      throw reason;
    }
  }, [api, chapterId, contentJson, plainText, saveStatus, wordCount]);

  useEffect(() => {
    if (!chapterId || saveStatus !== "dirty") {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      void flushPendingSave();
    }, editorSettings.autosaveMs);

    return () => window.clearTimeout(timer);
  }, [chapterId, editorSettings.autosaveMs, flushPendingSave, saveStatus]);

  return {
    contentJson,
    contentVersion,
    editorSettings,
    flushPendingSave,
    handleContentChange,
    plainText,
    saveStatus,
    saveStatusLabel: statusLabel(saveStatus, lastSavedAt, errorMessage),
    updateEditorSettings,
    wordCount
  };
}
