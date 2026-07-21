import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  aiCreateTaskInputSchema,
  aiApplyCandidateInputSchema,
  aiClearChatInputSchema,
  aiCreateChatSessionInputSchema,
  aiDeleteChatSessionInputSchema,
  aiGetChatSessionInputSchema,
  aiListChatSessionsInputSchema,
  aiListChatMessagesInputSchema,
  aiRenameChatSessionInputSchema,
  aiRejectCandidateInputSchema,
  aiSaveCandidateToScratchpadInputSchema,
  aiSendChatMessageStreamInputSchema,
  aiUpdateTaskInputSchema,
  chapterCreateInputSchema,
  chapterCreateSnapshotInputSchema,
  chapterDeleteInputSchema,
  chapterGetContentInputSchema,
  chapterListInputSchema,
  chapterRenameInputSchema,
  importPreviewTxtInputSchema,
  importConfirmTxtInputSchema,
  importUpdatePreviewInputSchema,
  parseIpcPayload,
  projectCreateInputSchema,
  projectOpenInputSchema,
  projectSuggestFilePathInputSchema,
  scratchCreateInputSchema,
  scratchDeleteInputSchema,
  scratchListInputSchema,
  scratchUpdateInputSchema,
  settingsSaveInputSchema,
  startupLaunchUpdateInputSchema,
  usageAnalyticsRecordEventInputSchema,
  usageAnalyticsUpdateSettingsInputSchema
} from "../../src/main/shared/schemas";

const rootDir = process.cwd();

describe("phase 2 ipc schemas", () => {
  it("accepts valid v1 ipc payloads for each namespace", () => {
    expect(parseIpcPayload(projectCreateInputSchema, { name: "归途", targetWordCount: 3200 })).toEqual({
      name: "归途",
      targetWordCount: 3200
    });
    expect(parseIpcPayload(projectSuggestFilePathInputSchema, { suggestedName: "归途" })).toEqual({ suggestedName: "归途" });
    expect(parseIpcPayload(projectOpenInputSchema, { projectId: "project_1" })).toEqual({ projectId: "project_1" });
    expect(parseIpcPayload(chapterListInputSchema, { projectId: "project_1" })).toEqual({ projectId: "project_1" });
    expect(parseIpcPayload(chapterCreateInputSchema, { projectId: "project_1", title: "第1章", sortOrder: 1, targetWordCount: 3200 })).toMatchObject({
      projectId: "project_1",
      title: "第1章",
      targetWordCount: 3200
    });
    expect(parseIpcPayload(chapterRenameInputSchema, { chapterId: "chapter_1", title: "第2章" })).toMatchObject({ title: "第2章" });
    expect(parseIpcPayload(chapterDeleteInputSchema, { chapterId: "chapter_1" })).toMatchObject({ chapterId: "chapter_1" });
    expect(parseIpcPayload(chapterGetContentInputSchema, { chapterId: "chapter_1" })).toMatchObject({ chapterId: "chapter_1" });
    expect(parseIpcPayload(chapterCreateSnapshotInputSchema, { chapterId: "chapter_1", reason: "manual_snapshot" })).toMatchObject({
      reason: "manual_snapshot"
    });
    expect(parseIpcPayload(settingsSaveInputSchema, { editor: { fontSize: 18, lineHeight: 2, autosaveMs: 1000 } })).toMatchObject({
      editor: { fontSize: 18, lineHeight: 2, autosaveMs: 1000 }
    });
    expect(parseIpcPayload(usageAnalyticsRecordEventInputSchema, { eventType: "page_active", feature: "writing", durationMs: 60000 })).toEqual({
      eventType: "page_active",
      feature: "writing",
      durationMs: 60000
    });
    expect(parseIpcPayload(usageAnalyticsUpdateSettingsInputSchema, { automaticReportsEnabled: false })).toEqual({
      automaticReportsEnabled: false
    });
    expect(parseIpcPayload(startupLaunchUpdateInputSchema, { enabled: true })).toEqual({
      enabled: true
    });
    expect(
      parseIpcPayload(settingsSaveInputSchema, {
        taskPromptPresets: [
          {
            id: "preset_polish_classic",
            name: "古风润色",
            taskType: "polish",
            instruction: "让表达更古雅，但不改变事实。",
            showInSelectionMenu: true
          },
          {
            id: "preset_continue_dialogue",
            name: "承接对白",
            taskType: "continue",
            instruction: "沿着当前对白继续推进。",
            showInSelectionMenu: false
          }
        ]
      })
    ).toMatchObject({
      taskPromptPresets: [
        {
          taskType: "polish",
          showInSelectionMenu: true
        },
        {
          taskType: "continue",
          showInSelectionMenu: false
        }
      ]
    });
    expect(
      parseIpcPayload(aiCreateTaskInputSchema, {
        projectId: "project_1",
        chapterId: "chapter_1",
        taskType: "polish",
        inputText: "他勒住马缰。",
        selection: {
          chapterId: "chapter_1",
          from: 1,
          to: 8,
          text: "他勒住马缰。",
          paragraphIds: ["p_1"],
          createdAt: "2026-04-27T00:00:00.000Z",
          selectionHash: "hash_1"
        }
      })
    ).toMatchObject({ taskType: "polish" });
    expect(parseIpcPayload(aiUpdateTaskInputSchema, { taskId: "task_1", patch: { instruction: "更古雅" } })).toMatchObject({
      taskId: "task_1"
    });
    expect(
      parseIpcPayload(aiApplyCandidateInputSchema, {
        projectId: "project_1",
        candidateId: "candidate_1",
        applyMode: "replace_selection",
        writebackConfirmed: true
      })
    ).toEqual({
      projectId: "project_1",
      candidateId: "candidate_1",
      applyMode: "replace_selection",
      writebackConfirmed: true
    });
    expect(parseIpcPayload(aiSaveCandidateToScratchpadInputSchema, { projectId: "project_1", candidateId: "candidate_1" })).toEqual({
      projectId: "project_1",
      candidateId: "candidate_1"
    });
    expect(parseIpcPayload(aiGetChatSessionInputSchema, { projectId: "project_1" })).toEqual({ projectId: "project_1" });
    expect(parseIpcPayload(aiListChatSessionsInputSchema, { projectId: "project_1" })).toEqual({ projectId: "project_1" });
    expect(parseIpcPayload(aiCreateChatSessionInputSchema, { projectId: "project_1" })).toEqual({ projectId: "project_1" });
    expect(parseIpcPayload(aiRenameChatSessionInputSchema, { projectId: "project_1", sessionId: "chat_1", title: "第 3 章讨论" })).toEqual({
      projectId: "project_1",
      sessionId: "chat_1",
      title: "第 3 章讨论"
    });
    expect(parseIpcPayload(aiDeleteChatSessionInputSchema, { projectId: "project_1", sessionId: "chat_1" })).toEqual({
      projectId: "project_1",
      sessionId: "chat_1"
    });
    expect(parseIpcPayload(aiListChatMessagesInputSchema, { projectId: "project_1", sessionId: "chat_1" })).toEqual({
      projectId: "project_1",
      sessionId: "chat_1"
    });
    expect(parseIpcPayload(aiClearChatInputSchema, { projectId: "project_1", sessionId: "chat_1" })).toEqual({
      projectId: "project_1",
      sessionId: "chat_1"
    });
    expect(
      parseIpcPayload(aiSendChatMessageStreamInputSchema, {
        requestId: "stream_1",
        projectId: "project_1",
        sessionId: "chat_1",
        message: "总结本章并加入草稿纸",
        chapterId: "chapter_1",
        currentChapterTitle: "第1章",
        chapterExcerpt: "雨一直下。"
      })
    ).toMatchObject({
      requestId: "stream_1",
      projectId: "project_1",
      sessionId: "chat_1"
    });
    expect(parseIpcPayload(aiRejectCandidateInputSchema, { projectId: "project_1", candidateId: "candidate_1" })).toEqual({
      projectId: "project_1",
      candidateId: "candidate_1"
    });
    expect(parseIpcPayload(scratchListInputSchema, { projectId: "project_1", chapterId: "chapter_1" })).toEqual({
      projectId: "project_1",
      chapterId: "chapter_1"
    });
    expect(parseIpcPayload(scratchCreateInputSchema, { projectId: "project_1", content: "村口老槐树" })).toMatchObject({
      content: "村口老槐树"
    });
    expect(parseIpcPayload(scratchUpdateInputSchema, { projectId: "project_1", noteId: "note_1", patch: { pinned: true } })).toMatchObject({
      projectId: "project_1",
      noteId: "note_1"
    });
    expect(parseIpcPayload(scratchDeleteInputSchema, { projectId: "project_1", noteId: "note_1" })).toEqual({
      projectId: "project_1",
      noteId: "note_1"
    });
    expect(parseIpcPayload(importPreviewTxtInputSchema, { filePath: "/tmp/novel.txt" })).toEqual({ filePath: "/tmp/novel.txt" });
    expect(
      parseIpcPayload(importUpdatePreviewInputSchema, {
        importJobId: "import_1",
        operations: [{ type: "rename_chapter", chapterIndex: 0, title: "楔子" }]
      })
    ).toMatchObject({ importJobId: "import_1" });
    expect(parseIpcPayload(importConfirmTxtInputSchema, { importJobId: "import_1", mode: "create_new_project" })).toEqual({
      importJobId: "import_1",
      mode: "create_new_project"
    });
  });

  it("rejects malformed or over-posted ipc payloads", () => {
    expect(() => parseIpcPayload(projectCreateInputSchema, { name: "" })).toThrow("IPC payload validation failed");
    expect(() => parseIpcPayload(chapterCreateInputSchema, { projectId: "", title: "第1章" })).toThrow("IPC payload validation failed");
    expect(() => parseIpcPayload(aiCreateTaskInputSchema, { projectId: "p", taskType: "rewrite", inputText: "x" })).toThrow(
      "IPC payload validation failed"
    );
    expect(() => parseIpcPayload(aiSendChatMessageStreamInputSchema, { projectId: "p", sessionId: "chat_1", message: "x" })).toThrow(
      "IPC payload validation failed"
    );
    expect(() =>
      parseIpcPayload(settingsSaveInputSchema, {
        taskPromptPresets: [
          {
            id: "preset_proofread",
            name: "只查错别字",
            taskType: "proofread",
            instruction: "只检查错别字。",
            showInSelectionMenu: true
          }
        ]
      })
    ).toThrow("IPC payload validation failed");
    expect(() => parseIpcPayload(scratchCreateInputSchema, { projectId: "p", content: "x", rawApiKey: "secret" })).toThrow(
      "IPC payload validation failed"
    );
    expect(() => parseIpcPayload(settingsSaveInputSchema, { provider: { apiKey: "secret" } })).toThrow("IPC payload validation failed");
    expect(() => parseIpcPayload(usageAnalyticsRecordEventInputSchema, { eventType: "page_active", feature: "writing", rawText: "正文" })).toThrow(
      "IPC payload validation failed"
    );
    expect(() => parseIpcPayload(usageAnalyticsUpdateSettingsInputSchema, {})).toThrow("IPC payload validation failed");
  });

  it("does not leave phase 2 preload namespaces with untyped unknown input payloads", () => {
    const preloadApi = readFileSync(join(rootDir, "src/preload/api.ts"), "utf8");

    expect(preloadApi).not.toContain("input: unknown");
  });
});
