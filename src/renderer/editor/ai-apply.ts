import type { Editor } from "@tiptap/react";
import { countWritingUnits } from "../../main/shared/text";
import type {
  AiApplyCandidateInput,
  AiTaskCandidateRecord,
  AiTaskRecord,
  ChapterCreateSnapshotInput,
  ChapterSaveContentInput
} from "../../main/shared/types";
import { createTiptapDocumentFromPlainText, extractPlainTextFromTiptapJson, type TiptapDocument } from "./tiptap/converters";
import { createSelectionHash } from "./tiptap/selection-utils";
import { appendEmergencyJournalEntry } from "../state/draft-recovery-store";

type ApplyResult = {
  readonly task: AiTaskRecord;
  readonly candidate: AiTaskCandidateRecord;
};

type AiApplyApi = {
  readonly chapter: {
    readonly createSnapshot: (input: ChapterCreateSnapshotInput) => Promise<unknown>;
    readonly saveContent: (input: ChapterSaveContentInput) => Promise<unknown>;
  };
  readonly ai: {
    readonly applyCandidate: (input: AiApplyCandidateInput) => Promise<unknown>;
  };
};

type SavedChapterVersion = {
  readonly chapterId: string;
  readonly projectId: string;
  readonly updatedAt: string | null;
};

type ApplyAiCandidateInput = {
  readonly api: AiApplyApi;
  readonly editor: Editor;
  readonly task: AiTaskRecord;
  readonly candidate: AiTaskCandidateRecord;
  readonly applyMode: AiApplyCandidateInput["applyMode"];
  readonly currentChapterId: string | null;
  readonly flushPendingSave: () => Promise<SavedChapterVersion | null | void>;
};

function assertSelectionStillMatches(editor: Editor, task: AiTaskRecord): void {
  if (!task.selection) {
    return;
  }

  let currentText = "";
  try {
    currentText = editor.state.doc.textBetween(task.selection.from, task.selection.to, "\n", "\n").trim();
  } catch {
    throw new Error("原选区已变化，请重新选择文本后再应用。");
  }

  if (createSelectionHash(currentText, task.selection.paragraphIds) !== task.selection.selectionHash) {
    throw new Error("原选区已变化，请重新选择文本后再应用。");
  }
}

function getInsertionContent(text: string): TiptapDocument["content"] {
  const content = createTiptapDocumentFromPlainText(text).content;
  if (content.length === 0) {
    throw new Error("AI 候选内容为空，不能应用。");
  }
  return content;
}

function resolveContainingParagraphEnd(editor: Editor, position: number): number {
  const resolved = editor.state.doc.resolve(position);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    if (resolved.node(depth).type.name === "paragraph") {
      return resolved.after(depth);
    }
  }
  return position;
}

function writeCandidateToEditor(editor: Editor, task: AiTaskRecord, candidate: AiTaskCandidateRecord, applyMode: AiApplyCandidateInput["applyMode"]): void {
  const content = getInsertionContent(candidate.generatedText);
  const chain = editor.chain().focus();

  if (applyMode === "insert_at_cursor") {
    const position = task.selection?.to ?? editor.state.selection.to;
    chain.insertContentAt(position, content).run();
    return;
  }

  if (!task.selection) {
    throw new Error("当前 AI 任务缺少选区，不能应用到正文。");
  }

  if (applyMode === "insert_below") {
    chain.insertContentAt(resolveContainingParagraphEnd(editor, task.selection.to), content).run();
    return;
  }

  chain
    .insertContentAt(
      {
        from: task.selection.from,
        to: task.selection.to
      },
      content
    )
    .run();
}

export async function applyAiCandidateToEditor({
  api,
  editor,
  task,
  candidate,
  applyMode,
  currentChapterId,
  flushPendingSave
}: ApplyAiCandidateInput): Promise<ApplyResult> {
  if (!task.chapterId) {
    throw new Error("当前 AI 任务没有关联章节，不能应用到正文。");
  }
  if (currentChapterId !== task.chapterId) {
    throw new Error("当前章节已切换，请重新生成 AI 结果后再应用。");
  }

  assertSelectionStillMatches(editor, task);
  const savedVersion = await flushPendingSave();
  await api.chapter.createSnapshot({
    projectId: task.projectId,
    chapterId: task.chapterId,
    reason: `apply_ai_${task.taskType}`
  });

  writeCandidateToEditor(editor, task, candidate, applyMode);

  const contentJson = editor.getJSON() as TiptapDocument;
  const plainText = extractPlainTextFromTiptapJson(contentJson);
  appendEmergencyJournalEntry({
    projectId: task.projectId,
    chapterId: task.chapterId,
    chapterTitle: task.chapterId,
    plainText,
    wordCount: countWritingUnits(plainText),
    dbUpdatedAt: null,
    reason: "before_ai_apply"
  });
  await api.chapter.saveContent({
    projectId: task.projectId,
    chapterId: task.chapterId,
    contentJson,
    plainText,
    wordCount: countWritingUnits(plainText),
    expectedUpdatedAt: savedVersion?.projectId === task.projectId && savedVersion.chapterId === task.chapterId ? savedVersion.updatedAt ?? undefined : undefined
  });

  return (await api.ai.applyCandidate({
    projectId: task.projectId,
    candidateId: candidate.id,
    applyMode,
    selectionHash: task.selection?.selectionHash,
    writebackConfirmed: true
  })) as ApplyResult;
}
