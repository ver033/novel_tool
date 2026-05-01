import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScratchNoteRecord } from "../../main/shared/types";
import { Button } from "../components/Button";
import { getNovelToolApi } from "../state/app-store";
import { filterScratchNotes, getScratchNoteSourceLabel, scratchpadFilters, sortScratchNotes } from "./scratchpad-utils";

type ScratchpadTabProps = {
  readonly chapterId: string | null;
  readonly projectId: string | null;
  readonly refreshToken: number;
};

export function ScratchpadTab({ chapterId, projectId, refreshToken }: ScratchpadTabProps) {
  const api = useMemo(getNovelToolApi, []);
  const [activeFilter, setActiveFilter] = useState<(typeof scratchpadFilters)[number]>("全部");
  const [draft, setDraft] = useState("");
  const [notes, setNotes] = useState<ScratchNoteRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const latestProjectId = useRef(projectId);

  useEffect(() => {
    latestProjectId.current = projectId;
  }, [projectId]);

  const loadNotes = useCallback(async () => {
    if (!projectId) {
      setNotes([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const result = (await api.scratch.list({ projectId })) as ScratchNoteRecord[];
      if (latestProjectId.current !== projectId) {
        return;
      }
      setNotes(sortScratchNotes(result));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取草稿纸失败");
    } finally {
      if (latestProjectId.current === projectId) {
        setLoading(false);
      }
    }
  }, [api, projectId]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes, refreshToken]);

  async function createNote(): Promise<void> {
    if (!projectId || !draft.trim()) {
      return;
    }

    const targetProjectId = projectId;
    try {
      const created = (await api.scratch.create({
        projectId: targetProjectId,
        chapterId: chapterId ?? undefined,
        content: draft.trim(),
        pinned: false
      })) as ScratchNoteRecord;
      if (latestProjectId.current !== targetProjectId) {
        return;
      }
      setNotes((current) => sortScratchNotes([created, ...current]));
      setDraft("");
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建草稿失败");
    }
  }

  async function togglePin(note: ScratchNoteRecord): Promise<void> {
    const targetProjectId = projectId;
    if (!targetProjectId) {
      return;
    }
    try {
      const updated = (await api.scratch.update({
        projectId: targetProjectId,
        noteId: note.id,
        patch: {
          pinned: !note.pinned
        }
      })) as ScratchNoteRecord;
      if (latestProjectId.current !== targetProjectId) {
        return;
      }
      setNotes((current) => sortScratchNotes(current.map((item) => (item.id === updated.id ? updated : item))));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "更新草稿失败");
    }
  }

  async function deleteNote(note: ScratchNoteRecord): Promise<void> {
    const targetProjectId = projectId;
    if (!targetProjectId) {
      return;
    }
    if (!window.confirm("删除这条草稿？")) {
      return;
    }

    try {
      await api.scratch.delete({ projectId: targetProjectId, noteId: note.id });
      if (latestProjectId.current !== targetProjectId) {
        return;
      }
      setNotes((current) => current.filter((item) => item.id !== note.id));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除草稿失败");
    }
  }

  const visibleNotes = useMemo(() => filterScratchNotes(notes, activeFilter), [activeFilter, notes]);

  return (
    <section className="scratch">
      <div className="scratch-head">
        <div>
          <h2 className="task-title">草稿纸</h2>
          <p className="muted">临时存放灵感、AI 输出、扩写要求和场景备注，不会自动写入正文。</p>
        </div>
        <span className="count-pill">{visibleNotes.length} 条</span>
      </div>
      <div className="scratch-compose">
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="快速记录灵感、场景或细节..." />
        <div className="scratch-compose-bottom">
          <span className="muted">{error ?? "默认保存为灵感便签"}</span>
          <Button disabled={!projectId || !draft.trim()} onClick={() => void createNote()} variant="secondary">
            记录
          </Button>
        </div>
      </div>
      <div className="scratch-filter">
        {scratchpadFilters.map((filter) => (
          <button className={`filter-chip ${activeFilter === filter ? "active" : ""}`} key={filter} onClick={() => setActiveFilter(filter)} type="button">
            {filter}
          </button>
        ))}
      </div>
      <div className="scratch-list">
        {loading ? (
          <div className="scratch-empty" role="status">
            正在读取草稿纸...
          </div>
        ) : null}
        {!loading ? visibleNotes.map((note) => (
          <div className="note" key={note.id}>
            <div className="note-head">
              <span className="note-tags">
                <span className={`mini-tag ${getScratchNoteSourceLabel(note) === "AI 输出" ? "green" : ""}`}>{getScratchNoteSourceLabel(note)}</span>
                {note.pinned ? <span className="mini-tag orange">置顶</span> : null}
              </span>
              <span className="note-time">{new Date(note.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <div className="note-body">{note.content}</div>
            <div className="note-actions">
              <button className="note-action" onClick={() => void togglePin(note)} type="button">{note.pinned ? "取消置顶" : "置顶"}</button>
              <button className="note-action" onClick={() => void deleteNote(note)} type="button">删除</button>
            </div>
          </div>
        )) : null}
        {!loading && notes.length === 0 ? <div className="scratch-empty">暂无草稿。记录灵感后会随项目保存。</div> : null}
        {!loading && notes.length > 0 && visibleNotes.length === 0 ? <div className="scratch-empty">当前筛选下暂无草稿。</div> : null}
      </div>
    </section>
  );
}
