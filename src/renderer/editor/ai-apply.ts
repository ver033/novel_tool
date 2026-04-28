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

type ApplyAiCandidateInput = {
  readonly api: AiApplyApi;
  readonly editor: Editor;
  readonly task: AiTaskRecord;
  readonly candidate: AiTaskCandidateRecord;
  readonly applyMode: AiApplyCandidateInput["applyMode"];
  readonly flushPendingSave: () => Promise<void>;
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
    chain.insertContentAt(task.selection.to, content).run();
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
  flushPendingSave
}: ApplyAiCandidateInput): Promise<ApplyResult> {
  if (!task.chapterId) {
    throw new Error("当前 AI 任务没有关联章节，不能应用到正文。");
  }

  assertSelectionStillMatches(editor, task);
  await flushPendingSave();
  await api.chapter.createSnapshot({
    chapterId: task.chapterId,
    reason: `apply_ai_${task.taskType}`
  });

  writeCandidateToEditor(editor, task, candidate, applyMode);

  const contentJson = editor.getJSON() as TiptapDocument;
  const plainText = extractPlainTextFromTiptapJson(contentJson);
  await api.chapter.saveContent({
    chapterId: task.chapterId,
    contentJson,
    plainText,
    wordCount: countWritingUnits(plainText)
  });

  return (await api.ai.applyCandidate({
    candidateId: candidate.id,
    applyMode,
    selectionHash: task.selection?.selectionHash,
    writebackConfirmed: true
  })) as ApplyResult;
}
