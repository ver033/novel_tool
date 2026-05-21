import { z } from "zod";
import {
  relationshipEntityImportanceSchema,
  relationshipEntityKindSchema,
  relationshipGraphGetInputSchema as relationshipGraphGetInputBaseSchema
} from "./relationship-graph";

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
    expectedUpdatedAt: nonEmptyString.optional(),
    saveSource: z.enum(["manual", "ai_apply", "system"]).optional()
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

const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const writingGoalStatusSchema = z.enum(["active", "paused", "completed", "archived"]);
export const writingGoalTypeSchema = z.enum(["total_words", "added_words"]);
export const writingWordEventSourceSchema = z.enum(["manual", "ai_apply", "chapter_delete", "system"]);

export const writingGoalOverviewInputSchema = z
  .object({
    projectId: idSchema,
    today: localDateSchema.optional()
  })
  .strict();

export const writingGoalCreateInputSchema = z
  .object({
    projectId: idSchema,
    name: nonEmptyString.max(80).optional(),
    goalType: writingGoalTypeSchema,
    targetWordCount: z.number().int().min(100).max(50_000_000),
    startDate: localDateSchema,
    deadlineDate: localDateSchema,
    activeWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    restDates: z.array(localDateSchema).max(366).optional()
  })
  .strict()
  .refine((value) => value.deadlineDate >= value.startDate, {
    message: "deadlineDate must be greater than or equal to startDate",
    path: ["deadlineDate"]
  });

export const writingGoalUpdateInputSchema = z
  .object({
    projectId: idSchema,
    goalId: idSchema,
    patch: z
      .object({
        name: nonEmptyString.max(80).optional(),
        targetWordCount: z.number().int().min(100).max(50_000_000).optional(),
        deadlineDate: localDateSchema.optional(),
        activeWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
        restDates: z.array(localDateSchema).max(366).optional()
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, {
        message: "patch must include at least one field"
      })
  })
  .strict();

export const writingGoalStatusInputSchema = z
  .object({
    projectId: idSchema,
    goalId: idSchema
  })
  .strict();

export const writingGoalListDailyStatsInputSchema = z
  .object({
    projectId: idSchema,
    from: localDateSchema,
    to: localDateSchema
  })
  .strict()
  .refine((value) => value.to >= value.from, {
    message: "to must be greater than or equal to from",
    path: ["to"]
  });

export const writingGoalDayDetailInputSchema = z
  .object({
    projectId: idSchema,
    date: localDateSchema
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

export const chapterCacheBuildOrderSchema = z.enum(["latest_first", "front_to_back"]);

export const cacheSettingsSchema = z
  .object({
    chapterCacheBuildOrder: chapterCacheBuildOrderSchema.optional()
  })
  .strict();

export const usageAnalyticsEventTypeSchema = z.enum(["app_opened", "page_view", "page_active", "feature_used", "error"]);
export const usageAnalyticsFeatureSchema = z.enum([
  "app",
  "welcome",
  "writing",
  "relationshipGraph",
  "outline",
  "writingGoals",
  "settings",
  "import",
  "export",
  "newProject",
  "ai_task",
  "ai_chat",
  "scratchpad",
  "summary_cache",
  "relationship_graph",
  "external_book_sync",
  "shareable_export",
  "txt_import",
  "txt_export",
  "error"
]);

export const usageAnalyticsRecordEventInputSchema = z
  .object({
    eventType: usageAnalyticsEventTypeSchema,
    feature: usageAnalyticsFeatureSchema,
    durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
    occurredAt: nonEmptyString.max(80).optional()
  })
  .strict();

export const usageAnalyticsUpdateSettingsInputSchema = z
  .object({
    automaticReportsEnabled: z.boolean().optional()
  })
  .strict()
  .refine((value) => value.automaticReportsEnabled !== undefined, {
    message: "at least one usage analytics setting is required"
  });

export const settingsSaveInputSchema = z
  .object({
    editor: editorSettingsSchema.optional(),
    aiProvider: aiProviderSettingsSchema.optional(),
    projectPath: z.string().trim().min(1).optional(),
    taskPromptPresets: z.array(taskPromptPresetSchema).max(100).optional(),
    cache: cacheSettingsSchema.optional()
  })
  .strict()
  .refine((value) => Boolean(value.editor ?? value.aiProvider ?? value.projectPath ?? value.taskPromptPresets ?? value.cache), {
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

export const outlineDaySegmentSchema = z.enum(["day", "night", "custom", "unknown"]);
export const outlineEventStatusSchema = z.enum(["planned", "drafting", "written", "needs_revision", "done"]);
export const outlineViewModeSchema = z.enum(["chapter", "timeline", "plotline"]);

const outlineNullableIdSchema = idSchema.nullable().optional();
const outlineText80Schema = z.string().trim().max(80);
const outlineText120Schema = z.string().trim().max(120);
const outlineLongTextSchema = z.string().max(3000);

const outlineEventInputBaseSchema = z
  .object({
    projectId: idSchema,
    chapterId: outlineNullableIdSchema,
    title: outlineText120Schema,
    summary: z.string().trim().max(1000),
    storyDate: localDateSchema.nullable().optional(),
    storyTimeLabel: outlineText80Schema.optional(),
    weekdayLabel: outlineText80Schema.optional(),
    storyTimeOrder: z.number().int().nullable().optional(),
    daySegment: outlineDaySegmentSchema,
    customDaySegment: outlineText80Schema.nullable().optional(),
    location: outlineText120Schema.optional(),
    povCharacter: outlineText80Schema.optional(),
    characters: z.array(outlineText80Schema.min(1)).max(30).optional(),
    goal: outlineLongTextSchema.optional(),
    conflict: outlineLongTextSchema.optional(),
    outcome: outlineLongTextSchema.optional(),
    foreshadowing: outlineLongTextSchema.optional(),
    notes: outlineLongTextSchema.optional(),
    status: outlineEventStatusSchema,
    threadIds: z.array(idSchema).max(50).optional()
  })
  .strict();

export const outlineGetOverviewInputSchema = z
  .object({
    projectId: idSchema
  })
  .strict();

export const outlineListEventsInputSchema = z
  .object({
    projectId: idSchema,
    chapterId: optionalIdSchema,
    threadId: optionalIdSchema,
    status: outlineEventStatusSchema.optional(),
    query: z.string().trim().max(160).optional()
  })
  .strict();

export const outlineCreateEventInputSchema = outlineEventInputBaseSchema;
export const outlineUpdateEventInputSchema = z
  .object({
    projectId: idSchema,
    eventId: idSchema,
    patch: outlineEventInputBaseSchema.omit({ projectId: true }).partial().refine((value) => Object.keys(value).length > 0, {
      message: "patch must include at least one field"
    })
  })
  .strict();
export const outlineDeleteEventInputSchema = z
  .object({
    projectId: idSchema,
    eventId: idSchema
  })
  .strict();
export const outlineReorderEventsInputSchema = z
  .object({
    projectId: idSchema,
    orderedEventIds: z.array(idSchema).min(1),
    chapterId: outlineNullableIdSchema
  })
  .strict();

export const outlineListThreadsInputSchema = outlineGetOverviewInputSchema;
export const outlineCreateThreadInputSchema = z
  .object({
    projectId: idSchema,
    name: nonEmptyString.max(80),
    color: nonEmptyString.max(32).optional()
  })
  .strict();
export const outlineUpdateThreadInputSchema = z
  .object({
    projectId: idSchema,
    threadId: idSchema,
    patch: z
      .object({
        name: nonEmptyString.max(80).optional(),
        color: nonEmptyString.max(32).optional(),
        sortOrder: z.number().int().nonnegative().optional()
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, {
        message: "patch must include at least one field"
      })
  })
  .strict();
export const outlineDeleteThreadInputSchema = z
  .object({
    projectId: idSchema,
    threadId: idSchema
  })
  .strict();

export const outlineGetChapterNoteInputSchema = z
  .object({
    projectId: idSchema,
    chapterId: idSchema
  })
  .strict();
export const outlineSaveChapterNoteInputSchema = z
  .object({
    projectId: idSchema,
    chapterId: idSchema,
    content: z.string().max(20000)
  })
  .strict();
export const outlineImportLegacyChapterNoteInputSchema = outlineSaveChapterNoteInputSchema
  .extend({
    overwrite: z.boolean().optional()
  })
  .strict();

export const outlineImportColumnMappingSchema = z
  .object({
    chapter: z.string().trim().max(120).nullable().optional(),
    storyTimeLabel: z.string().trim().max(120).nullable().optional(),
    storyDate: z.string().trim().max(120).nullable().optional(),
    weekdayLabel: z.string().trim().max(120).nullable().optional(),
    daySegment: z.string().trim().max(120).nullable().optional(),
    thread: z.string().trim().max(120).nullable().optional(),
    summary: z.string().trim().max(120).nullable().optional(),
    characters: z.string().trim().max(120).nullable().optional(),
    location: z.string().trim().max(120).nullable().optional(),
    status: z.string().trim().max(120).nullable().optional()
  })
  .strict();

export const outlinePreviewImportFileInputSchema = z
  .object({
    projectId: idSchema,
    filePath: nonEmptyString.max(4096).refine((value) => /\.(xlsx|csv)$/i.test(value), {
      message: "outline import file must be .xlsx or .csv"
    }),
    mapping: outlineImportColumnMappingSchema.optional()
  })
  .strict();
export const outlinePreviewBulkImportInputSchema = z
  .object({
    projectId: idSchema,
    rawText: nonEmptyString.max(200000),
    mapping: outlineImportColumnMappingSchema.optional()
  })
  .strict();
export const outlineBulkImportPreviewRowSchema = z
  .object({
    rowNumber: z.number().int().positive(),
    chapterTitle: z.string().trim().max(160),
    chapterId: idSchema.nullable(),
    storyDate: localDateSchema.nullable().optional(),
    storyTimeLabel: outlineText80Schema,
    weekdayLabel: outlineText80Schema,
    storyTimeOrder: z.number().int().nullable().optional(),
    daySegment: outlineDaySegmentSchema,
    customDaySegment: outlineText80Schema.nullable().optional(),
    threadNames: z.array(nonEmptyString.max(80)).max(50),
    summary: z.string().trim().min(1).max(1000),
    characters: z.array(outlineText80Schema.min(1)).max(30),
    location: outlineText120Schema,
    status: outlineEventStatusSchema,
    warnings: z.array(z.string().trim().min(1).max(300)).max(20)
  })
  .strict();
export const outlineConfirmBulkImportInputSchema = z
  .object({
    projectId: idSchema,
    importBatchId: idSchema,
    rows: z.array(outlineBulkImportPreviewRowSchema).min(1).max(1000)
  })
  .strict();
export const outlineUndoImportBatchInputSchema = z
  .object({
    projectId: idSchema,
    importBatchId: idSchema
  })
  .strict();

export const externalBookSyncStatusInputSchema = z
  .object({
    projectId: idSchema
  })
  .strict();

export const externalBookSyncScanInputSchema = externalBookSyncStatusInputSchema
  .extend({
    requestId: idSchema.optional(),
    mode: z.enum(["quick", "global", "directory"]),
    directoryPath: z.string().trim().min(1).max(4096).optional()
  })
  .strict()
  .refine((value) => value.mode !== "directory" || Boolean(value.directoryPath?.trim()), {
    message: "directoryPath is required for directory scan",
    path: ["directoryPath"]
  });

export const externalBookSyncCancelScanInputSchema = z
  .object({
    requestId: idSchema
  })
  .strict();

export const externalBookSyncPreviewCandidateInputSchema = externalBookSyncStatusInputSchema
  .extend({
    candidateId: idSchema
  })
  .strict();

export const externalBookSyncSendToAiInputSchema = externalBookSyncPreviewCandidateInputSchema
  .extend({
    chapterKeys: z.array(nonEmptyString.max(200)).min(1).max(80)
  })
  .strict();

export const externalBookSyncForgetSourceInputSchema = externalBookSyncStatusInputSchema
  .extend({
    sourceId: idSchema
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

export const exportSelectShareableProjectFilePathInputSchema = z
  .object({
    projectId: idSchema,
    suggestedName: nonEmptyString.max(120).optional()
  })
  .strict();

export const exportShareableProjectCopyInputSchema = z
  .object({
    projectId: idSchema,
    filePath: nonEmptyString.max(4096),
    includeScratchNotes: z.boolean(),
    includePromptPresets: z.boolean(),
    includeSummaryCache: z.boolean(),
    includeWritingGoalsAndStats: z.boolean()
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
export const summaryGetArcCacheInputSchema = summaryIndexStatusInputSchema
  .extend({
    arcKey: idSchema
  })
  .strict();
export const summaryClearAndRetryArcCacheInputSchema = summaryGetArcCacheInputSchema;
export const summaryGetBookCacheInputSchema = summaryIndexStatusInputSchema;
export const summaryClearAndRetryBookCacheInputSchema = summaryGetBookCacheInputSchema;

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

export const relationshipGraphSourceStatusInputSchema = relationshipGraphStatusInputSchema;

export const authorRelationshipGetGraphInputSchema = relationshipGraphGetInputSchema;
export const authorRelationshipCreateCharacterInputSchema = z
  .object({
    projectId: idSchema,
    name: nonEmptyString.max(80)
  })
  .strict();
export const authorRelationshipUpdateCharacterInputSchema = z
  .object({
    projectId: idSchema,
    characterId: idSchema,
    name: nonEmptyString.max(80),
    aliases: z.array(z.string().trim().min(1).max(80)).max(20),
    entityKind: relationshipEntityKindSchema,
    importance: relationshipEntityImportanceSchema,
    roleSummary: z.string().trim().max(300).nullable().optional(),
    faction: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional()
  })
  .strict();
const authorRelationshipLayoutPositionSchema = z
  .object({
    x: z.number().finite().min(-100000).max(100000),
    y: z.number().finite().min(-100000).max(100000)
  })
  .strict();
export const authorRelationshipUpdateCharacterLayoutInputSchema = z
  .object({
    projectId: idSchema,
    characterId: idSchema,
    layoutPosition: authorRelationshipLayoutPositionSchema.nullable()
  })
  .strict();
export const authorRelationshipCreateRelationshipInputSchema = z
  .object({
    projectId: idSchema,
    sourceCharacterName: nonEmptyString.max(80),
    targetCharacterName: nonEmptyString.max(80),
    sourceToTargetLabel: nonEmptyString.max(120),
    targetToSourceLabel: z.string().trim().max(120).nullable().optional()
  })
  .strict();
export const authorRelationshipUpdateRelationshipInputSchema = z
  .object({
    projectId: idSchema,
    relationshipId: idSchema,
    sourceToTargetLabel: nonEmptyString.max(120),
    targetToSourceLabel: z.string().trim().max(120).nullable().optional()
  })
  .strict();
export const authorRelationshipDeleteCharacterInputSchema = z
  .object({
    projectId: idSchema,
    characterId: idSchema
  })
  .strict();
export const authorRelationshipDeleteRelationshipInputSchema = z
  .object({
    projectId: idSchema,
    relationshipId: idSchema
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
