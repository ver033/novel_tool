import { z } from "zod";
import { relationshipGraphGetInputSchema as relationshipGraphGetInputBaseSchema } from "./relationship-index";

const nonEmptyString = z.string().trim().min(1);
const idSchema = nonEmptyString.max(128);
const optionalIdSchema = idSchema.optional();
const MAX_TIPTAP_JSON_CHARS = 2_000_000;
const MAX_CHAPTER_PLAIN_TEXT_CHARS = 1_000_000;

const tiptapJsonSchema = z
  .object({
    type: z.string().min(1)
  })
  .passthrough()
  .refine((value) => JSON.stringify(value).length <= MAX_TIPTAP_JSON_CHARS, {
    message: "contentJson is too large"
  });

export const taskTypeSchema = z.enum(["polish", "expand", "proofread", "continue"]);
export const promptPresetTaskTypeSchema = z.enum(["polish", "expand", "continue"]);

export const selectionSnapshotSchema = z
  .object({
    chapterId: idSchema,
    from: z.number().int().nonnegative(),
    to: z.number().int().positive(),
    text: nonEmptyString,
    paragraphIds: z.array(idSchema).min(1),
    createdAt: nonEmptyString,
    selectionHash: nonEmptyString
  })
  .strict()
  .refine((value) => value.to > value.from, {
    message: "selection.to must be greater than selection.from",
    path: ["to"]
  });

export const projectCreateInputSchema = z
  .object({
    name: nonEmptyString.max(120),
    rootPath: z.string().trim().min(1).optional(),
    targetWordCount: z.number().int().min(100).max(500_000).optional()
  })
  .strict();

export const projectSelectSavePathInputSchema = z
  .object({
    suggestedName: nonEmptyString.max(120).optional()
  })
  .strict();

export const projectSuggestFilePathInputSchema = projectSelectSavePathInputSchema;

export const projectOpenInputSchema = z
  .object({
    projectId: optionalIdSchema,
    rootPath: z.string().trim().min(1).optional()
  })
  .strict()
  .refine((value) => Boolean(value.projectId ?? value.rootPath), {
    message: "projectId or rootPath is required"
  });

export const projectOpenFileInputSchema = z
  .object({
    filePath: nonEmptyString.max(4096)
  })
  .strict();

export const projectRenameInputSchema = z
  .object({
    projectId: idSchema,
    name: nonEmptyString.max(120)
  })
  .strict();

export const projectDeleteInputSchema = z
  .object({
    projectId: idSchema
  })
  .strict();

export const chapterCreateInputSchema = z
  .object({
    projectId: idSchema,
    title: nonEmptyString.max(160),
    volumeTitle: z.string().trim().min(1).max(160).optional(),
    sortOrder: z.number().int().nonnegative().optional(),
    targetWordCount: z.number().int().min(100).max(500_000).nullable().optional()
  })
  .strict();

export const chapterRenameInputSchema = z
  .object({
    projectId: optionalIdSchema,
    chapterId: idSchema,
    title: nonEmptyString.max(160)
  })
  .strict();

export const chapterListInputSchema = z
  .object({
    projectId: idSchema
  })
  .strict();

export const chapterDeleteInputSchema = z
  .object({
    projectId: optionalIdSchema,
    chapterId: idSchema
  })
  .strict();

export const chapterGetContentInputSchema = chapterDeleteInputSchema;

export const chapterSaveContentInputSchema = z
  .object({
    projectId: optionalIdSchema,
    chapterId: idSchema,
    contentJson: tiptapJsonSchema,
    plainText: z.string().max(MAX_CHAPTER_PLAIN_TEXT_CHARS),
    wordCount: z.number().int().nonnegative().optional(),
    expectedUpdatedAt: nonEmptyString.optional()
  })
  .strict();

export const chapterUpdateTargetWordCountInputSchema = z
  .object({
    projectId: optionalIdSchema,
    chapterId: idSchema,
    targetWordCount: z.number().int().min(100).max(500_000).nullable()
  })
  .strict();

export const chapterCreateSnapshotInputSchema = z
  .object({
    projectId: optionalIdSchema,
    chapterId: idSchema,
    reason: nonEmptyString.max(120)
  })
  .strict();

export const editorSettingsSchema = z
  .object({
    fontSize: z.number().int().min(12).max(36).optional(),
    lineHeight: z.number().min(1.4).max(2.6).optional(),
    autosaveMs: z.number().int().min(800).max(5000).optional(),
    layoutPreset: z.enum(["immersive", "review", "reading", "custom"]).optional(),
    pageWidth: z.enum(["narrow", "medium", "wide", "screen"]).optional(),
    fontFamily: z.enum(["system", "song", "hei", "fangsong", "kai"]).optional(),
    editorPadding: z.enum(["compact", "standard", "relaxed"]).optional(),
    paragraphSpacing: z.enum(["compact", "standard", "loose"]).optional(),
    firstLineIndent: z.enum(["none", "two", "four"]).optional(),
    theme: z.enum(["light", "eye", "night"]).optional(),
    ruledPaper: z.boolean().optional(),
    ruledPaperIntensity: z.enum(["off", "soft", "standard", "strong"]).optional()
  })
  .strict();

export const aiProviderSettingsSchema = z
  .object({
    providerType: z.enum(["openrouter"]),
    baseUrl: nonEmptyString.max(2048),
    modelName: nonEmptyString.max(160),
    contextLength: z.number().int().positive().nullable().optional(),
    supportsTools: z.boolean().nullable().optional(),
    apiKey: z.string().min(1).max(4096).optional()
  })
  .strict();

export const aiProviderConnectionTestSchema = z
  .object({
    providerType: z.enum(["openrouter"]),
    baseUrl: nonEmptyString.max(2048),
    modelName: nonEmptyString.max(160).optional(),
    contextLength: z.number().int().positive().nullable().optional(),
    supportsTools: z.boolean().nullable().optional(),
    apiKey: z.string().min(1).max(4096).optional()
  })
  .strict();

export const taskPromptPresetSchema = z
  .object({
    id: idSchema,
    name: nonEmptyString.max(80),
    taskType: promptPresetTaskTypeSchema,
    instruction: nonEmptyString.max(4000),
    showInSelectionMenu: z.boolean()
  })
  .strict();

export const settingsSaveInputSchema = z
  .object({
    editor: editorSettingsSchema.optional(),
    aiProvider: aiProviderSettingsSchema.optional(),
    projectPath: z.string().trim().min(1).optional(),
    taskPromptPresets: z.array(taskPromptPresetSchema).max(100).optional()
  })
  .strict()
  .refine((value) => Boolean(value.editor ?? value.aiProvider ?? value.projectPath ?? value.taskPromptPresets), {
    message: "at least one settings section is required"
  });

export const settingsTestConnectionInputSchema = z
  .object({
    aiProvider: aiProviderConnectionTestSchema.optional()
  })
  .strict()
  .optional();

export const settingsListModelsInputSchema = z
  .object({
    query: z.string().trim().max(160).optional()
  })
  .strict()
  .optional();

export const aiCreateTaskInputSchema = z
  .object({
    projectId: idSchema,
    chapterId: optionalIdSchema,
    taskType: taskTypeSchema,
    inputText: nonEmptyString,
    instruction: z.string().max(4000).optional(),
    presetId: optionalIdSchema,
    selection: selectionSnapshotSchema.optional()
  })
  .strict();

export const aiTaskStatusSchema = z.enum(["empty", "configured", "generating", "preview_ready", "failed", "applied", "inserted", "saved_to_scratchpad"]);

export const aiUpdateTaskInputSchema = z
  .object({
    taskId: idSchema,
    patch: z
      .object({
        status: aiTaskStatusSchema.optional(),
        instruction: z.string().max(4000).optional(),
        presetId: optionalIdSchema,
        error: z.string().max(4000).optional()
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, {
        message: "patch must include at least one field"
      })
  })
  .strict();

export const aiGeneratePreviewStreamInputSchema = z
  .object({
    requestId: idSchema,
    taskId: idSchema
  })
  .strict();

export const aiCancelStreamInputSchema = z
  .object({
    requestId: idSchema
  })
  .strict();

export const aiApplyCandidateInputSchema = z
  .object({
    projectId: idSchema,
    candidateId: idSchema,
    applyMode: z.enum(["replace_selection", "insert_below", "insert_at_cursor"]),
    selectionHash: z.string().trim().min(1).optional(),
    writebackConfirmed: z.literal(true)
  })
  .strict();

export const aiSaveCandidateToScratchpadInputSchema = z
  .object({
    projectId: idSchema,
    candidateId: idSchema
  })
  .strict();

export const aiGetChatSessionInputSchema = z
  .object({
    projectId: idSchema
  })
  .strict();

export const aiListChatSessionsInputSchema = aiGetChatSessionInputSchema;

export const aiCreateChatSessionInputSchema = z
  .object({
    projectId: idSchema,
    title: z.string().trim().min(1).max(80).optional()
  })
  .strict();

export const aiRenameChatSessionInputSchema = z
  .object({
    projectId: idSchema,
    sessionId: idSchema,
    title: nonEmptyString.max(80)
  })
  .strict();

export const aiDeleteChatSessionInputSchema = z
  .object({
    projectId: idSchema,
    sessionId: idSchema
  })
  .strict();

export const aiListChatMessagesInputSchema = z
  .object({
    projectId: idSchema,
    sessionId: idSchema
  })
  .strict();

export const aiClearChatInputSchema = aiListChatMessagesInputSchema;

export const aiSendChatMessageStreamInputSchema = z
  .object({
    requestId: idSchema,
    projectId: idSchema,
    sessionId: idSchema,
    message: nonEmptyString.max(8000),
    chapterId: optionalIdSchema,
    currentChapterTitle: z.string().trim().min(1).max(160).optional(),
    selectionText: z.string().trim().min(1).max(20000).optional(),
    chapterExcerpt: z.string().trim().min(1).max(20000).optional()
  })
  .strict();

export const aiRegenerateChatMessageStreamInputSchema = aiSendChatMessageStreamInputSchema
  .omit({
    message: true
  })
  .extend({
    assistantMessageId: idSchema
  })
  .strict();

export const aiRejectCandidateInputSchema = z
  .object({
    projectId: idSchema,
    candidateId: idSchema
  })
  .strict();

export const scratchListInputSchema = z
  .object({
    projectId: idSchema,
    chapterId: optionalIdSchema
  })
  .strict();

export const scratchCreateInputSchema = z
  .object({
    projectId: idSchema,
    chapterId: optionalIdSchema,
    content: nonEmptyString.max(20000),
    sourceTaskId: optionalIdSchema,
    pinned: z.boolean().optional()
  })
  .strict();

export const scratchUpdateInputSchema = z
  .object({
    projectId: idSchema,
    noteId: idSchema,
    patch: z
      .object({
        content: nonEmptyString.max(20000).optional(),
        pinned: z.boolean().optional()
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, {
        message: "patch must include at least one field"
      })
  })
  .strict();

export const scratchDeleteInputSchema = z
  .object({
    projectId: idSchema,
    noteId: idSchema
  })
  .strict();

export const importPreviewTxtInputSchema = z
  .object({
    filePath: nonEmptyString
  })
  .strict();

const importPreviewOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("merge_with_previous"),
      chapterIndex: z.number().int().positive()
    })
    .strict(),
  z
    .object({
      type: z.literal("split_from_line"),
      chapterIndex: z.number().int().nonnegative(),
      lineNumber: z.number().int().positive()
    })
    .strict(),
  z
    .object({
      type: z.literal("rename_chapter"),
      chapterIndex: z.number().int().nonnegative(),
      title: nonEmptyString.max(160)
    })
    .strict(),
  z
    .object({
      type: z.literal("redetect")
    })
    .strict()
]);

export const importUpdatePreviewInputSchema = z
  .object({
    importJobId: idSchema,
    operations: z.array(importPreviewOperationSchema).min(1)
  })
  .strict();

export const importConfirmTxtInputSchema = z
  .object({
    importJobId: idSchema,
    mode: z.enum(["create_new_project", "import_into_current_project"]),
    projectId: optionalIdSchema,
    projectName: z.string().trim().min(1).max(120).optional()
  })
  .strict();

export const exportSelectTxtFilePathInputSchema = z
  .object({
    projectId: idSchema,
    suggestedName: nonEmptyString.max(120).optional()
  })
  .strict();

export const exportTxtInputSchema = z
  .object({
    projectId: idSchema,
    filePath: nonEmptyString.max(4096),
    range: z.literal("all_chapters"),
    includeChapterTitles: z.boolean()
  })
  .strict();

export const summaryIndexStatusInputSchema = z
  .object({
    projectId: idSchema
  })
  .strict();

export const summaryRebuildProjectIndexInputSchema = summaryIndexStatusInputSchema
  .extend({
    force: z.boolean().optional()
  })
  .strict();
export const summaryCancelCurrentJobInputSchema = summaryIndexStatusInputSchema;
export const summaryListCacheEntriesInputSchema = summaryIndexStatusInputSchema;
export const summaryGetChapterCacheInputSchema = summaryIndexStatusInputSchema
  .extend({
    chapterId: idSchema
  })
  .strict();
export const summaryClearAndRetryChapterCacheInputSchema = summaryGetChapterCacheInputSchema;

export const relationshipGraphGetInputSchema = z
  .object(relationshipGraphGetInputBaseSchema.shape)
  .strict()
  .refine((value) => !value.chapterFrom || !value.chapterTo || value.chapterFrom <= value.chapterTo, {
    message: "chapterFrom must be less than or equal to chapterTo",
    path: ["chapterFrom"]
  });

export const relationshipGraphStatusInputSchema = z
  .object({
    projectId: idSchema
  })
  .strict();

export const relationshipGraphRebuildInputSchema = relationshipGraphStatusInputSchema
  .extend({
    force: z.boolean().optional()
  })
  .strict();

export class IpcPayloadValidationError extends Error {
  constructor(readonly issues: z.ZodIssue[]) {
    super("IPC payload validation failed");
    this.name = "IpcPayloadValidationError";
  }
}

export function parseIpcPayload<TSchema extends z.ZodType>(schema: TSchema, payload: unknown): z.output<TSchema> {
  const result = schema.safeParse(payload);

  if (!result.success) {
    throw new IpcPayloadValidationError(result.error.issues);
  }

  return result.data;
}
