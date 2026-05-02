import { describe, expect, it } from "vitest";
import { applyAiCandidateToEditor } from "../../src/renderer/editor/ai-apply";
import { createSelectionHash } from "../../src/renderer/editor/tiptap/selection-utils";
import { createTiptapDocumentFromPlainText, extractPlainTextFromTiptapJson } from "../../src/renderer/editor/tiptap/converters";
import type { AiTaskCandidateRecord, AiTaskRecord } from "../../src/main/shared/types";
import type { Editor } from "@tiptap/react";

function createTask(selectionText = "他勒住马缰", taskType: AiTaskRecord["taskType"] = "polish"): AiTaskRecord {
  return {
    id: "task_1",
    projectId: "project_1",
    chapterId: "chapter_1",
    taskType,
    status: "preview_ready",
    selection: {
      chapterId: "chapter_1",
      from: 1,
      to: 6,
      text: selectionText,
      paragraphIds: ["p_1"],
      createdAt: "2026-04-28T00:00:00.000Z",
      selectionHash: createSelectionHash(selectionText, ["p_1"])
    },
    inputText: selectionText,
    instruction: null,
    presetId: null,
    outputText: null,
    error: null,
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z"
  };
}

function createCandidate(generatedText = "他轻轻勒住马缰。", kind: AiTaskCandidateRecord["kind"] = "polish"): AiTaskCandidateRecord {
  return {
    id: "candidate_1",
    taskId: "task_1",
    kind,
    originalText: "他勒住马缰",
    generatedText,
    changeSummary: "语言更顺滑",
    proofreadIssues: null,
    writingContextPlan: null,
    status: "preview",
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z"
  };
}

function createFakeEditor(currentSelectionText: string, options: { readonly paragraphEndPosition?: number } = {}): Editor {
  let plainText = `他勒住马缰。\n\n风从山口吹来。`;
  let json = createTiptapDocumentFromPlainText(plainText);
  const insertPositions: unknown[] = [];
  const chainApi = {
    focus() {
      return chainApi;
    },
    insertContentAt(rangeOrPosition: unknown, content: unknown) {
      insertPositions.push(rangeOrPosition);
      const inserted = extractPlainTextFromTiptapJson({
        type: "doc",
        content: Array.isArray(content) ? content : [content]
      });
      plainText = `${inserted}\n\n风从山口吹来。`;
      json = createTiptapDocumentFromPlainText(plainText);
      return chainApi;
    },
    run() {
      return true;
    }
  };

  return {
    state: {
      selection: {
        from: 1,
        to: 6
      },
      doc: {
        textBetween() {
          return currentSelectionText;
        },
        resolve() {
          return {
            depth: 1,
            node() {
              return {
                type: {
                  name: "paragraph"
                }
              };
            },
            after() {
              return options.paragraphEndPosition ?? 8;
            }
          };
        }
      }
    },
    chain() {
      return chainApi;
    },
    getJSON() {
      return json;
    },
    __insertPositions: insertPositions
  } as unknown as Editor & { readonly __insertPositions: unknown[] };
}

describe("applyAiCandidateToEditor", () => {
  it("creates a snapshot, writes generated text into Tiptap, saves the chapter, then confirms the AI candidate", async () => {
    const calls: string[] = [];
    const appliedInputs: unknown[] = [];
    const savedPlainTexts: string[] = [];
    const task = createTask();
    const candidate = createCandidate();

    const result = await applyAiCandidateToEditor({
      api: {
        chapter: {
          async createSnapshot() {
            calls.push("snapshot");
            return {};
          },
          async saveContent(input) {
            calls.push("save");
            savedPlainTexts.push(input.plainText);
            return {};
          }
        },
        ai: {
          async applyCandidate(input) {
            calls.push("confirm");
            appliedInputs.push(input);
            return {
              task: { ...task, status: "applied" },
              candidate: { ...candidate, status: "applied" }
            };
          }
        }
      },
      editor: createFakeEditor("他勒住马缰"),
      task,
      candidate,
      applyMode: "replace_selection",
      currentChapterId: "chapter_1",
      flushPendingSave: async () => {
        calls.push("flush");
      }
    });

    expect(calls).toEqual(["flush", "snapshot", "save", "confirm"]);
    expect(savedPlainTexts[0]).toContain("他轻轻勒住马缰。");
    expect(appliedInputs[0]).toMatchObject({
      projectId: task.projectId,
      candidateId: "candidate_1",
      applyMode: "replace_selection",
      selectionHash: task.selection?.selectionHash,
      writebackConfirmed: true
    });
    expect(result.task.status).toBe("applied");
    expect(result.candidate.status).toBe("applied");
  });

  it("refuses to write back if the original selection has changed", async () => {
    const task = createTask();
    const candidate = createCandidate();

    await expect(
      applyAiCandidateToEditor({
        api: {
          chapter: {
            async createSnapshot() {
              throw new Error("should not snapshot");
            },
            async saveContent() {
              throw new Error("should not save");
            }
          },
          ai: {
            async applyCandidate() {
              throw new Error("should not confirm");
            }
          }
        },
        editor: createFakeEditor("他松开马缰"),
        task,
        candidate,
        applyMode: "replace_selection",
        currentChapterId: "chapter_1",
        flushPendingSave: async () => undefined
      })
    ).rejects.toThrow("原选区已变化，请重新选择文本后再应用。");
  });

  it("inserts continuation output after the containing paragraph instead of directly after the selected words", async () => {
    const task = createTask("他勒住马缰", "continue");
    const candidate = createCandidate("风里带着潮湿的泥土气。", "continue");
    const editor = createFakeEditor("他勒住马缰", { paragraphEndPosition: 9 }) as Editor & { readonly __insertPositions: unknown[] };

    await applyAiCandidateToEditor({
      api: {
        chapter: {
          async createSnapshot() {
            return {};
          },
          async saveContent() {
            return {};
          }
        },
        ai: {
          async applyCandidate() {
            return {
              task: { ...task, status: "inserted" },
              candidate: { ...candidate, status: "inserted" }
            };
          }
        }
      },
      editor,
      task,
      candidate,
      applyMode: "insert_below",
      currentChapterId: "chapter_1",
      flushPendingSave: async () => undefined
    });

    expect(editor.__insertPositions[0]).toBe(9);
  });

  it("refuses to apply a stale task after the user switches chapters", async () => {
    const task = createTask();
    const candidate = createCandidate();

    await expect(
      applyAiCandidateToEditor({
        api: {
          chapter: {
            async createSnapshot() {
              throw new Error("should not snapshot");
            },
            async saveContent() {
              throw new Error("should not save");
            }
          },
          ai: {
            async applyCandidate() {
              throw new Error("should not confirm");
            }
          }
        },
        editor: createFakeEditor("他勒住马缰"),
        task,
        candidate,
        applyMode: "replace_selection",
        currentChapterId: "chapter_2",
        flushPendingSave: async () => undefined
      })
    ).rejects.toThrow("当前章节已切换，请重新生成 AI 结果后再应用。");
  });
});
