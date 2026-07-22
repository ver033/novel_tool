import { useEffect, useMemo, useState } from "react";
import type { ScratchNoteRecord } from "../../main/shared/types";
import { Button } from "../components/Button";
import { getNovelToolApi } from "../state/app-store";
import { useI18n } from "../i18n";

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
  const { locale } = useI18n();
  const japanese = locale === "ja-JP";
  const api = useMemo(getNovelToolApi, []);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [savedNoteId, setSavedNoteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const scopeKey = `${projectId ?? "none"}:${chapterId ?? "global"}:${scratchNoteId ?? "new"}`;
  const statusText = error ?? (notice || (japanese ? "保存すると右サイドバーの下書きメモ一覧に表示されます。" : "这张草稿纸保存后会在右侧栏汇总中出现。"));

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
          setError(japanese ? "この下書きメモは見つかりませんでした。" : "没有找到这条草稿。");
          return;
        }
        setContent(note.content);
        setNotice(japanese ? "既存の下書きメモを開きました。" : "已打开已有草稿。");
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : japanese ? "下書きメモの読み込みに失敗しました" : "读取草稿失败");
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
  }, [api, chapterId, japanese, projectId, scopeKey, scratchNoteId]);

  async function saveScratchpadPage(): Promise<void> {
    if (!projectId) {
      setError(japanese ? "現在のプロジェクトを利用できないため、下書きメモを保存できません。" : "当前项目不可用，无法保存草稿。");
      return;
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      setError(japanese ? "下書きメモを入力してください。" : "草稿纸内容不能为空。");
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
        setNotice(japanese ? "下書きメモを更新しました。" : "草稿已更新。");
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
        setNotice(japanese ? "下書きメモを右サイドバーの一覧へ保存しました。" : "草稿已保存到右栏汇总。");
      }
      onNotesChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : japanese ? "下書きメモの保存に失敗しました" : "保存草稿失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="scratchpad-editor-page aux-editor-page">
      <div className="aux-editor-head">
        <div>
          <h2 className="task-title">{currentChapterTitle ? `${currentChapterTitle} · ${japanese ? "下書きメモ" : "草稿纸"}` : (japanese ? "この章の下書きメモ" : "本章草稿纸")}</h2>
          <p className="muted">{japanese ? "一件の下書きメモを編集します。保存後は右サイドバーの一覧に入り、本文には書き込みません。" : "单张草稿编辑页。保存后会进入右侧栏草稿纸汇总，不写入正文。"}</p>
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
        placeholder={japanese ? "この章の予備段落、アイデア、没案、一時的な考えを書く..." : "写下本章备用段落、灵感、废稿或临时想法..."}
        value={content}
      />
      <div className="aux-editor-footer">
        <span className={error ? "inline-error-text" : "muted"}>{loading ? (japanese ? "下書きメモを読み込んでいます..." : "正在读取草稿...") : statusText}</span>
        <Button disabled={!projectId || !content.trim() || loading || saving} onClick={() => void saveScratchpadPage()} variant="secondary">
          {savedNoteId ? (japanese ? "下書きメモを更新" : "更新草稿") : (japanese ? "下書きメモを保存" : "保存草稿")}
        </Button>
      </div>
    </section>
  );
}
