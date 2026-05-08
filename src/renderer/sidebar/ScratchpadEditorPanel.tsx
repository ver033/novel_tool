import { useEffect, useMemo, useState } from "react";
import type { ScratchNoteRecord } from "../../main/shared/types";
import { Button } from "../components/Button";
import { getNovelToolApi } from "../state/app-store";

type ScratchpadEditorPanelProps = {
  readonly chapterId: string | null;
  readonly currentChapterTitle: string | null;
  readonly onNotesChanged?: () => void;
  readonly onScratchNoteSaved?: (panelId: string, noteId: string) => void;
  readonly panelId: string;
  readonly projectId: string | null;
  readonly scratchNoteId?: string | null;
};

export function ScratchpadEditorPanel({
  chapterId,
  currentChapterTitle,
  onNotesChanged,
  onScratchNoteSaved,
  panelId,
  projectId,
  scratchNoteId = null
}: ScratchpadEditorPanelProps) {
  const api = useMemo(getNovelToolApi, []);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [savedNoteId, setSavedNoteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const scopeKey = `${projectId ?? "none"}:${chapterId ?? "global"}:${scratchNoteId ?? "new"}`;
  const statusText = error ?? (notice || "这张草稿纸保存后会在右侧栏汇总中出现。");

  useEffect(() => {
    let cancelled = false;
    setContent("");
    setError(null);
    setNotice("");
    setSavedNoteId(scratchNoteId);

    if (!projectId || !scratchNoteId) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    void api.scratch.list({
      projectId,
      chapterId: chapterId ?? undefined
    })
      .then((result) => {
        if (cancelled) {
          return;
        }
        const note = (result as ScratchNoteRecord[]).find((item) => item.id === scratchNoteId) ?? null;
        if (!note) {
          setError("没有找到这条草稿。");
          return;
        }
        setContent(note.content);
        setNotice("已打开已有草稿。");
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "读取草稿失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, chapterId, projectId, scopeKey, scratchNoteId]);

  async function saveScratchpadPage(): Promise<void> {
    if (!projectId) {
      setError("当前项目不可用，无法保存草稿。");
      return;
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      setError("草稿纸内容不能为空。");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (savedNoteId) {
        const updated = (await api.scratch.update({
          projectId,
          noteId: savedNoteId,
          patch: {
            content: trimmedContent
          }
        })) as ScratchNoteRecord;
        setContent(updated.content);
        setNotice("草稿已更新。");
      } else {
        const created = (await api.scratch.create({
          projectId,
          chapterId: chapterId ?? undefined,
          content: trimmedContent,
          pinned: false
        })) as ScratchNoteRecord;
        setContent(created.content);
        setSavedNoteId(created.id);
        onScratchNoteSaved?.(panelId, created.id);
        setNotice("草稿已保存到右栏汇总。");
      }
      onNotesChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存草稿失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="scratchpad-editor-page aux-editor-page">
      <div className="aux-editor-head">
        <div>
          <h2 className="task-title">{currentChapterTitle ? `${currentChapterTitle} · 草稿纸` : "本章草稿纸"}</h2>
          <p className="muted">单张草稿编辑页。保存后会进入右侧栏草稿纸汇总，不写入正文。</p>
        </div>
      </div>
      <textarea
        className="scratchpad-page-editor ruled-aux-editor"
        disabled={!projectId || loading}
        onChange={(event) => {
          setContent(event.target.value);
          setError(null);
          setNotice("");
        }}
        placeholder="写下本章备用段落、灵感、废稿或临时想法..."
        value={content}
      />
      <div className="aux-editor-footer">
        <span className={error ? "inline-error-text" : "muted"}>{loading ? "正在读取草稿..." : statusText}</span>
        <Button disabled={!projectId || !content.trim() || loading || saving} onClick={() => void saveScratchpadPage()} variant="secondary">
          {savedNoteId ? "更新草稿" : "保存草稿"}
        </Button>
      </div>
    </section>
  );
}
