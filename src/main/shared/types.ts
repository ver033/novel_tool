import type { z } from "zod";
import type { RelationshipEntityImportance, RelationshipEntityKind } from "./relationship-graph";
import type {
  aiCreateTaskInputSchema,
  aiCreateChatSessionInputSchema,
  aiApplyCandidateInputSchema,
  aiProviderSettingsSchema,
  aiClearChatInputSchema,
  aiCancelStreamInputSchema,
  aiDeleteChatSessionInputSchema,
  aiGeneratePreviewStreamInputSchema,
  aiGetChatSessionInputSchema,
  aiListChatSessionsInputSchema,
  aiListChatMessagesInputSchema,
  aiRegenerateChatMessageStreamInputSchema,
  aiRenameChatSessionInputSchema,
  aiRejectCandidateInputSchema,
  aiSaveCandidateToScratchpadInputSchema,
  aiSendChatMessageStreamInputSchema,
  aiUpdateTaskInputSchema,
  authorRelationshipCreateCharacterInputSchema,
  authorRelationshipCreateRelationshipInputSchema,
  authorRelationshipDeleteCharacterInputSchema,
  authorRelationshipDeleteRelationshipInputSchema,
  authorRelationshipGetGraphInputSchema,
  authorRelationshipUpdateCharacterInputSchema,
  authorRelationshipUpdateCharacterLayoutInputSchema,
  chapterCreateInputSchema,
  chapterCreateSnapshotInputSchema,
  chapterDeleteInputSchema,
  chapterGetContentInputSchema,
  chapterListInputSchema,
  chapterRenameInputSchema,
  chapterSaveContentInputSchema,
  chapterUpdateTargetWordCountInputSchema,
  chapterCacheBuildOrderSchema,
  editorSettingsSchema,
  exportSelectShareableProjectFilePathInputSchema,
  exportSelectTxtFilePathInputSchema,
  exportShareableProjectCopyInputSchema,
  exportTxtInputSchema,
  externalBookSyncCancelScanInputSchema,
  externalBookSyncForgetSourceInputSchema,
  externalBookSyncPreviewCandidateInputSchema,
  externalBookSyncScanInputSchema,
  externalBookSyncSendToAiInputSchema,
  externalBookSyncStatusInputSchema,
  importConfirmTxtInputSchema,
  importPreviewTxtInputSchema,
  importUpdatePreviewInputSchema,
  projectCreateInputSchema,
  projectDeleteInputSchema,
  projectOpenFileInputSchema,
  projectOpenInputSchema,
  projectRenameInputSchema,
  projectSelectSavePathInputSchema,
  projectSuggestFilePathInputSchema,
  relationshipGraphGetInputSchema,
  relationshipGraphSourceStatusInputSchema,
  relationshipGraphStatusInputSchema,
  scratchCreateInputSchema,
  scratchDeleteInputSchema,
  scratchListInputSchema,
  scratchUpdateInputSchema,
  settingsSaveInputSchema,
  settingsListModelsInputSchema,
  settingsTestConnectionInputSchema,
  summaryCancelCurrentJobInputSchema,
  summaryClearAndRetryArcCacheInputSchema,
  summaryClearAndRetryBookCacheInputSchema,
  summaryClearAndRetryChapterCacheInputSchema,
  summaryGetArcCacheInputSchema,
  summaryGetBookCacheInputSchema,
  summaryGetChapterCacheInputSchema,
  summaryIndexStatusInputSchema,
  summaryListCacheEntriesInputSchema,
  summaryRebuildProjectIndexInputSchema,
  taskPromptPresetSchema,
  writingGoalCreateInputSchema,
  writingGoalDayDetailInputSchema,
  writingGoalListDailyStatsInputSchema,
  writingGoalOverviewInputSchema,
  writingGoalStatusInputSchema,
  writingGoalStatusSchema,
  writingGoalTypeSchema,
  writingGoalUpdateInputSchema,
  writingWordEventSourceSchema,
  usageAnalyticsRecordEventInputSchema,
  usageAnalyticsUpdateSettingsInputSchema
} from "./schemas";
import type { ProofreadIssue } from "./proofread";
import type { RelationshipGraphPosition, RelationshipGraphResult, RelationshipGraphSourceStatus } from "./relationship-graph";
import type { WritingContextPlanMetadata } from "./ai-candidate-metadata";
import type { ArcAiSummaryPayload, BookAiSummaryPayload, ChapterAiSummaryChunkPayload, ChapterAiSummaryPayload, SummaryJobStatus, SummaryJobType, SummaryStatus } from "./summary-index";

export type TaskType = "polish" | "expand" | "proofread" | "continue";
export type PromptPresetTaskType = "polish" | "expand" | "continue";
export type AiTaskStatus = "empty" | "configured" | "generating" | "preview_ready" | "failed" | "applied" | "inserted" | "saved_to_scratchpad";
export type CandidateStatus = "preview" | "applied" | "inserted" | "rejected" | "copied" | "inserted_to_scratchpad";
export type AiChatSessionStatus = "active" | "deleted";
export type AiChatMessageRole = "user" | "assistant" | "tool" | "error";

export type SelectionSnapshot = {
  readonly chapterId: string;
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly paragraphIds: readonly string[];
  readonly createdAt: string;
  readonly selectionHash: string;
};

export type AiTaskRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly chapterId: string | null;
  readonly taskType: TaskType;
  readonly status: AiTaskStatus;
  readonly selection: SelectionSnapshot | null;
  readonly inputText: string;
  readonly instruction: string | null;
  readonly presetId: string | null;
  readonly outputText: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AiTaskCandidateRecord = {
  readonly id: string;
  readonly taskId: string;
  readonly kind: TaskType | string;
  readonly originalText: string | null;
  readonly generatedText: string;
  readonly changeSummary: string | null;
  readonly proofreadIssues: readonly ProofreadIssue[] | null;
  readonly writingContextPlan: WritingContextPlanMetadata | null;
  readonly status: CandidateStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ScratchNoteRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly chapterId: string | null;
  readonly content: string;
  readonly pinned: boolean;
  readonly sourceTaskId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AuthorRelationshipCharacterRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly aliases: readonly string[];
  readonly entityKind: RelationshipEntityKind;
  readonly importance: RelationshipEntityImportance;
  readonly roleSummary: string | null;
  readonly faction: string | null;
  readonly notes: string | null;
  readonly layoutPosition: RelationshipGraphPosition | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AuthorRelationshipRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly sourceCharacterId: string;
  readonly targetCharacterId: string;
  readonly sourceToTargetLabel: string;
  readonly targetToSourceLabel: string | null;
  readonly normalizedRelationKey: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AuthorRelationshipCreateResult = {
  readonly relationship: AuthorRelationshipRecord;
  readonly sourceCharacter: AuthorRelationshipCharacterRecord;
  readonly targetCharacter: AuthorRelationshipCharacterRecord;
};

export type AiChatAction =
  | {
      readonly type: "none";
    }
  | {
      readonly type: "add_to_scratchpad";
      readonly content: string;
      readonly chapterId: string | null;
    };

export type AiChatSessionRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: AiChatSessionStatus;
  readonly lastContextUsage: AiStreamContextEvent | null;
  readonly compactedMemorySummary: string | null;
  readonly compactedMemoryThroughMessageId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AiChatMessageRecord = {
  readonly id: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly role: AiChatMessageRole;
  readonly content: string;
  readonly action: AiChatAction | null;
  readonly createdAt: string;
};

export type AiStreamChunkEvent = {
  readonly requestId: string;
  readonly content: string;
};

export type AiStreamReasoningEvent = {
  readonly requestId: string;
  readonly content: string;
};

export type AiContextIndexMode = "raw" | "raw_small_project" | "summary_cache" | "hybrid" | "missing" | "stale";

export type AiStreamContextEvent = {
  readonly requestId: string;
  readonly estimatedInputTokens: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly modelContextTokens: number | null;
  readonly modelName: string;
  readonly contextMode: "direct" | "summarized" | "mixed";
  readonly scopeLabel: string;
  readonly indexMode?: AiContextIndexMode;
  readonly indexedChapterCount?: number;
  readonly totalChapterCount?: number;
  readonly staleChapterCount?: number;
  readonly skippedTooShortChapterCount?: number;
  readonly memoryCompacted?: boolean;
  readonly memoryCompactedThisRun?: boolean;
};

export type AiStreamDoneEvent = {
  readonly requestId: string;
  readonly payload: unknown;
};

export type AiStreamErrorEvent = {
  readonly requestId: string;
  readonly error: string;
};

export type ImportPreviewChapter = {
  readonly title: string;
  readonly text: string;
  readonly order: number;
  readonly wordCount: number;
  readonly lineStart: number;
  readonly lineEnd: number;
};

export type ImportPreview = {
  readonly importJobId: string;
  readonly filePath: string;
  readonly fileName: string;
  readonly encoding: string;
  readonly totalWordCount: number;
  readonly chapters: readonly ImportPreviewChapter[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ExternalBookSyncSource = {
  readonly id: string;
  readonly projectId: string;
  readonly bookFilePath: string;
  readonly displayName: string;
  readonly lastKnownSize: number;
  readonly lastModifiedAt: string | null;
  readonly lastContentHash: string | null;
  readonly lastScanAt: string;
  readonly confirmedAt: string | null;
};

export type ExternalBookMissingChapter = Omit<ImportPreviewChapter, "text"> & {
  readonly ordinal: number | null;
  readonly key: string;
  readonly textLength: number;
};

export type ExternalBookReferenceChapter = Omit<ImportPreviewChapter, "text"> & {
  readonly ordinal: number | null;
  readonly key: string;
  readonly projectChapterTitle: string;
  readonly textLength: number;
};

export type ExternalBookComparisonResult = {
  readonly currentLatestOrdinal: number | null;
  readonly currentChapterCount: number;
  readonly externalLatestOrdinal: number | null;
  readonly externalChapterCount: number;
  readonly latestProjectChapterInExternal: ExternalBookReferenceChapter | null;
  readonly missingChapters: readonly ExternalBookMissingChapter[];
  readonly warnings: readonly string[];
};

export type ExternalBookSyncCandidate = {
  readonly id: string;
  readonly projectId: string;
  readonly filePath: string;
  readonly fileName: string;
  readonly size: number;
  readonly modifiedAt: string | null;
  readonly contentHash: string;
  readonly encoding: string;
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
  readonly detectedChapterCount: number;
  readonly comparison: ExternalBookComparisonResult;
};

export type ExternalBookSyncStatus = {
  readonly projectId: string;
  readonly sources: readonly ExternalBookSyncSource[];
};

export type ExternalBookScanProgress = {
  readonly phase: "scanning";
  readonly currentRoot: string | null;
  readonly checkedDirectories: number;
  readonly checkedFiles: number;
  readonly candidatesFound: number;
  readonly skippedErrors: number;
  readonly elapsedMs: number;
};

export type ExternalBookSyncScanResult = {
  readonly requestId: string;
  readonly projectId: string;
  readonly candidates: readonly ExternalBookSyncCandidate[];
  readonly scan: {
    readonly files: readonly { readonly path: string; readonly size: number; readonly modifiedAt: string | null }[];
    readonly checkedDirectories: number;
    readonly checkedFiles: number;
    readonly skippedErrors: number;
    readonly timedOut: boolean;
    readonly cancelled: boolean;
    readonly elapsedMs: number;
  } | null;
  readonly warnings: readonly string[];
  readonly searchedRoots: readonly string[];
  readonly completedAt: string;
};

export type ExternalBookSyncSendResult = {
  readonly sessionId: string;
  readonly sessionTitle: string;
  readonly sentMessageCount: number;
  readonly sentChapterCount: number;
};

export type ImportConfirmResult = {
  readonly project: ProjectRecord;
  readonly chapters: readonly ChapterSummary[];
  readonly firstChapterId: string | null;
};

export type ProjectRecord = {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type RecentProjectAvailability = "available" | "missing" | "invalid_path";

export type RecentProjectEntry = {
  readonly project: ProjectRecord;
  readonly availability: RecentProjectAvailability;
};

export type ChapterSummary = {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly volumeTitle: string | null;
  readonly sortOrder: number;
  readonly wordCount: number;
  readonly dailyWordCount: number;
  readonly dailyWordCountDate: string | null;
  readonly targetWordCount: number | null;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly contentUpdatedAt?: string;
};

export type ChapterContent = ChapterSummary & {
  readonly contentJson: unknown;
  readonly plainText: string;
};

export type ChapterSnapshot = {
  readonly id: string;
  readonly chapterId: string;
  readonly contentJson: unknown;
  readonly plainText: string;
  readonly reason: string | null;
  readonly createdAt: string;
};

export type WritingGoalStatus = z.output<typeof writingGoalStatusSchema>;
export type WritingGoalType = z.output<typeof writingGoalTypeSchema>;
export type WritingWordEventSource = z.output<typeof writingWordEventSourceSchema>;

export type WritingGoalRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly goalType: WritingGoalType;
  readonly targetWordCount: number;
  readonly baselineWordCount: number;
  readonly startDate: string;
  readonly deadlineDate: string;
  readonly activeWeekdays: readonly number[];
  readonly restDates: readonly string[];
  readonly status: WritingGoalStatus;
  readonly completedAt: string | null;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type WritingWordEventRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly goalId: string | null;
  readonly chapterId: string | null;
  readonly chapterTitle: string | null;
  readonly chapterSortOrder: number | null;
  readonly localDate: string;
  readonly deltaWords: number;
  readonly addedWords: number;
  readonly deletedWords: number;
  readonly previousWordCount: number;
  readonly nextWordCount: number;
  readonly previousProjectWordCount: number;
  readonly nextProjectWordCount: number;
  readonly source: WritingWordEventSource;
  readonly createdAt: string;
};

export type WritingDailyStat = {
  readonly projectId: string;
  readonly localDate: string;
  readonly addedWords: number;
  readonly deletedWords: number;
  readonly netWords: number;
  readonly eventCount: number;
  readonly startingTotalWordCount: number;
  readonly endingTotalWordCount: number;
  readonly firstWriteAt: string | null;
  readonly lastWriteAt: string | null;
  readonly updatedAt: string;
};

export type WritingDailyPlan = {
  readonly goalId: string;
  readonly projectId: string;
  readonly localDate: string;
  readonly plannedWords: number;
  readonly isWritingDay: boolean;
  readonly isRestDay: boolean;
  readonly generatedAt: string;
  readonly updatedAt: string;
};

export type WritingCalendarDay = {
  readonly localDate: string;
  readonly plannedWords: number;
  readonly netWords: number;
  readonly addedWords: number;
  readonly deletedWords: number;
  readonly eventCount: number;
  readonly isWritingDay: boolean;
  readonly isRestDay: boolean;
  readonly status: "no-data" | "rest" | "missed" | "partial" | "done" | "over" | "deadline" | "system-adjusted";
};

export type WritingGoalOverview = {
  readonly projectId: string;
  readonly currentTotalWordCount: number;
  readonly goal: WritingGoalRecord | null;
  readonly progressWords: number;
  readonly remainingWords: number;
  readonly completionRatio: number;
  readonly today: {
    readonly localDate: string;
    readonly plannedWords: number;
    readonly netWords: number;
    readonly addedWords: number;
    readonly deletedWords: number;
    readonly remainingTodayWords: number;
  };
  readonly remainingWritingDays: number;
  readonly requiredPerDay: number;
  readonly futureRequiredPerDay: number;
  readonly paceStatus: "no_goal" | "ahead" | "on_track" | "behind" | "completed" | "overdue" | "paused";
  readonly estimatedCompletionDate: string | null;
  readonly recentStats: readonly WritingDailyStat[];
  readonly calendarDays: readonly WritingCalendarDay[];
  readonly warning: string | null;
};

export type WritingDayDetail = {
  readonly projectId: string;
  readonly localDate: string;
  readonly plan: WritingDailyPlan | null;
  readonly stat: WritingDailyStat | null;
  readonly events: readonly WritingWordEventRecord[];
  readonly chapterSummaries: readonly {
    readonly chapterId: string | null;
    readonly chapterTitle: string;
    readonly addedWords: number;
    readonly deletedWords: number;
    readonly netWords: number;
    readonly eventCount: number;
    readonly sources: readonly WritingWordEventSource[];
  }[];
};

export type EditorSettings = Required<z.output<typeof editorSettingsSchema>>;
export type ChapterCacheBuildOrder = z.output<typeof chapterCacheBuildOrderSchema>;
export type CacheSettings = {
  readonly chapterCacheBuildOrder: ChapterCacheBuildOrder;
};
export type AiProviderSettingsState = Omit<z.output<typeof aiProviderSettingsSchema>, "apiKey"> & {
  readonly apiKeyConfigured: boolean;
};
export type SettingsState = {
  readonly editor: EditorSettings;
  readonly aiProvider: AiProviderSettingsState | null;
  readonly projectPath: string | null;
  readonly taskPromptPresets: readonly TaskPromptPreset[];
  readonly cache: CacheSettings;
};

export type TaskPromptPreset = z.output<typeof taskPromptPresetSchema>;

export type OpenRouterModelSummary = {
  readonly id: string;
  readonly name: string;
  readonly contextLength: number | null;
  readonly supportsTools?: boolean | null;
};

export type ProjectCreateInput = z.input<typeof projectCreateInputSchema>;
export type ProjectOpenInput = z.input<typeof projectOpenInputSchema>;
export type ProjectOpenFileInput = z.input<typeof projectOpenFileInputSchema>;
export type ProjectSelectSavePathInput = z.input<typeof projectSelectSavePathInputSchema>;
export type ProjectSuggestFilePathInput = z.input<typeof projectSuggestFilePathInputSchema>;
export type ProjectRenameInput = z.input<typeof projectRenameInputSchema>;
export type ProjectDeleteInput = z.input<typeof projectDeleteInputSchema>;
export type ChapterListInput = z.input<typeof chapterListInputSchema>;
export type ChapterCreateInput = z.input<typeof chapterCreateInputSchema>;
export type ChapterRenameInput = z.input<typeof chapterRenameInputSchema>;
export type ChapterDeleteInput = z.input<typeof chapterDeleteInputSchema>;
export type ChapterGetContentInput = z.input<typeof chapterGetContentInputSchema>;
export type ChapterSaveContentInput = z.input<typeof chapterSaveContentInputSchema>;
export type ChapterCreateSnapshotInput = z.input<typeof chapterCreateSnapshotInputSchema>;
export type ChapterUpdateTargetWordCountInput = z.input<typeof chapterUpdateTargetWordCountInputSchema>;
export type WritingGoalOverviewInput = z.input<typeof writingGoalOverviewInputSchema>;
export type WritingGoalCreateInput = z.input<typeof writingGoalCreateInputSchema>;
export type WritingGoalUpdateInput = z.input<typeof writingGoalUpdateInputSchema>;
export type WritingGoalStatusInput = z.input<typeof writingGoalStatusInputSchema>;
export type WritingGoalListDailyStatsInput = z.input<typeof writingGoalListDailyStatsInputSchema>;
export type WritingGoalDayDetailInput = z.input<typeof writingGoalDayDetailInputSchema>;
export type SettingsSaveInput = z.input<typeof settingsSaveInputSchema>;
export type SettingsTestConnectionInput = z.input<typeof settingsTestConnectionInputSchema>;
export type SettingsListModelsInput = z.input<typeof settingsListModelsInputSchema>;
export type UsageAnalyticsRecordEventInput = z.input<typeof usageAnalyticsRecordEventInputSchema>;
export type UsageAnalyticsUpdateSettingsInput = z.input<typeof usageAnalyticsUpdateSettingsInputSchema>;
export type UsageAnalyticsStatus = {
  readonly automaticReportsEnabled: boolean;
  readonly scheduleLocalTimes: readonly string[];
  readonly reportRangeDays: number;
  readonly nextScheduledAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastError: string | null;
  readonly latestReportText: string | null;
};
export type UsageAnalyticsReportRun = {
  readonly id: string;
  readonly trigger: "automatic" | "manual";
  readonly scheduledSlotKey: string | null;
  readonly scheduledLocalTime: string | null;
  readonly status: "running" | "completed" | "failed";
  readonly snapshotJson: string | null;
  readonly reportText: string | null;
  readonly error: string | null;
  readonly requestedAt: string;
  readonly completedAt: string | null;
};
export type AiCreateTaskInput = z.input<typeof aiCreateTaskInputSchema>;
export type AiUpdateTaskInput = z.input<typeof aiUpdateTaskInputSchema>;
export type AiGeneratePreviewStreamInput = z.input<typeof aiGeneratePreviewStreamInputSchema>;
export type AiContinuePreviewStreamInput = AiGeneratePreviewStreamInput;
export type AiCancelStreamInput = z.input<typeof aiCancelStreamInputSchema>;
export type AiApplyCandidateInput = z.input<typeof aiApplyCandidateInputSchema>;
export type AiSaveCandidateToScratchpadInput = z.input<typeof aiSaveCandidateToScratchpadInputSchema>;
export type AiGetChatSessionInput = z.input<typeof aiGetChatSessionInputSchema>;
export type AiListChatSessionsInput = z.input<typeof aiListChatSessionsInputSchema>;
export type AiCreateChatSessionInput = z.input<typeof aiCreateChatSessionInputSchema>;
export type AiRenameChatSessionInput = z.input<typeof aiRenameChatSessionInputSchema>;
export type AiDeleteChatSessionInput = z.input<typeof aiDeleteChatSessionInputSchema>;
export type AiListChatMessagesInput = z.input<typeof aiListChatMessagesInputSchema>;
export type AiClearChatInput = z.input<typeof aiClearChatInputSchema>;
export type AiSendChatMessageStreamInput = z.input<typeof aiSendChatMessageStreamInputSchema>;
export type AiRegenerateChatMessageStreamInput = z.input<typeof aiRegenerateChatMessageStreamInputSchema>;
export type AiRejectCandidateInput = z.input<typeof aiRejectCandidateInputSchema>;
export type ScratchListInput = z.input<typeof scratchListInputSchema>;
export type ScratchCreateInput = z.input<typeof scratchCreateInputSchema>;
export type ScratchUpdateInput = z.input<typeof scratchUpdateInputSchema>;
export type ScratchDeleteInput = z.input<typeof scratchDeleteInputSchema>;
export type ImportPreviewTxtInput = z.input<typeof importPreviewTxtInputSchema>;
export type ImportUpdatePreviewInput = z.input<typeof importUpdatePreviewInputSchema>;
export type ImportConfirmTxtInput = z.input<typeof importConfirmTxtInputSchema>;
export type ExternalBookSyncStatusInput = z.input<typeof externalBookSyncStatusInputSchema>;
export type ExternalBookSyncScanInput = z.input<typeof externalBookSyncScanInputSchema>;
export type ExternalBookSyncCancelScanInput = z.input<typeof externalBookSyncCancelScanInputSchema>;
export type ExternalBookSyncPreviewCandidateInput = z.input<typeof externalBookSyncPreviewCandidateInputSchema>;
export type ExternalBookSyncSendToAiInput = z.input<typeof externalBookSyncSendToAiInputSchema>;
export type ExternalBookSyncForgetSourceInput = z.input<typeof externalBookSyncForgetSourceInputSchema>;
export type ExportSelectTxtFilePathInput = z.input<typeof exportSelectTxtFilePathInputSchema>;
export type ExportTxtInput = z.input<typeof exportTxtInputSchema>;
export type ExportTxtResult = {
  readonly filePath: string;
  readonly chapterCount: number;
  readonly wordCount: number;
  readonly exportedAt: string;
};
export type ExportSelectShareableProjectFilePathInput = z.input<typeof exportSelectShareableProjectFilePathInputSchema>;
export type ExportShareableProjectCopyInput = z.input<typeof exportShareableProjectCopyInputSchema>;
export type ExportShareableProjectCopyResult = {
  readonly filePath: string;
  readonly exportedAt: string;
  readonly included: readonly string[];
  readonly removed: readonly string[];
  readonly privacyScan: {
    readonly scannedTableCount: number;
    readonly scannedValueCount: number;
  };
};
export type SummaryIndexStatusInput = z.input<typeof summaryIndexStatusInputSchema>;
export type SummaryRebuildProjectIndexInput = z.input<typeof summaryRebuildProjectIndexInputSchema>;
export type SummaryCancelCurrentJobInput = z.input<typeof summaryCancelCurrentJobInputSchema>;
export type SummaryListCacheEntriesInput = z.input<typeof summaryListCacheEntriesInputSchema>;
export type SummaryGetChapterCacheInput = z.input<typeof summaryGetChapterCacheInputSchema>;
export type SummaryClearAndRetryChapterCacheInput = z.input<typeof summaryClearAndRetryChapterCacheInputSchema>;
export type SummaryGetArcCacheInput = z.input<typeof summaryGetArcCacheInputSchema>;
export type SummaryClearAndRetryArcCacheInput = z.input<typeof summaryClearAndRetryArcCacheInputSchema>;
export type SummaryGetBookCacheInput = z.input<typeof summaryGetBookCacheInputSchema>;
export type SummaryClearAndRetryBookCacheInput = z.input<typeof summaryClearAndRetryBookCacheInputSchema>;
export type RelationshipGraphGetInput = z.input<typeof relationshipGraphGetInputSchema>;
export type RelationshipGraphStatusInput = z.input<typeof relationshipGraphStatusInputSchema>;
export type RelationshipGraphSourceStatusInput = z.input<typeof relationshipGraphSourceStatusInputSchema>;
export type AuthorRelationshipGetGraphInput = z.input<typeof authorRelationshipGetGraphInputSchema>;
export type AuthorRelationshipCreateCharacterInput = z.input<typeof authorRelationshipCreateCharacterInputSchema>;
export type AuthorRelationshipUpdateCharacterInput = z.input<typeof authorRelationshipUpdateCharacterInputSchema>;
export type AuthorRelationshipUpdateCharacterLayoutInput = z.input<typeof authorRelationshipUpdateCharacterLayoutInputSchema>;
export type AuthorRelationshipCreateRelationshipInput = z.input<typeof authorRelationshipCreateRelationshipInputSchema>;
export type AuthorRelationshipDeleteCharacterInput = z.input<typeof authorRelationshipDeleteCharacterInputSchema>;
export type AuthorRelationshipDeleteRelationshipInput = z.input<typeof authorRelationshipDeleteRelationshipInputSchema>;
export type { RelationshipGraphResult, RelationshipGraphSourceStatus };
export type SummaryIndexPausedReason = "ai_not_configured" | "foreground_ai_active" | "background_disabled" | null;
export type SummaryChapterCacheState = SummaryStatus | "missing" | "queued" | "running" | "cancelled";
export type SummaryChapterCacheEntry = {
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly chapterOrder: number;
  readonly wordCount: number;
  readonly cacheState: SummaryChapterCacheState;
  readonly summaryShort: string | null;
  readonly summaryUpdatedAt: string | null;
  readonly contentHash: string | null;
  readonly jobStatus: SummaryJobStatus | null;
  readonly jobError: string | null;
  readonly jobFailureCategory: string | null;
  readonly jobActionHint: string | null;
  readonly nextRunAt: string | null;
};
export type SummaryChapterCacheDetail = SummaryChapterCacheEntry & {
  readonly summary: {
    readonly summaryShort: string;
    readonly summaryLong: string;
    readonly structured: ChapterAiSummaryPayload;
    readonly tokenCount: number;
    readonly status: SummaryStatus;
    readonly error: string | null;
    readonly updatedAt: string;
  } | null;
  readonly chunks: readonly {
    readonly chunkIndex: number;
    readonly chunkCount: number;
    readonly textStart: number;
    readonly textEnd: number;
    readonly summaryShort: string;
    readonly structured: ChapterAiSummaryChunkPayload;
    readonly tokenCount: number;
    readonly status: Exclude<SummaryStatus, "skipped_too_short">;
    readonly error: string | null;
    readonly updatedAt: string;
  }[];
};
export type SummaryArcCacheState = Exclude<SummaryStatus, "skipped_too_short"> | "missing" | "queued" | "running" | "cancelled";
export type SummaryArcCacheEntry = {
  readonly arcKey: string;
  readonly label: string;
  readonly chapterFrom: number;
  readonly chapterTo: number;
  readonly chapterCount: number;
  readonly readyChapterCount: number;
  readonly cacheState: SummaryArcCacheState;
  readonly summary: string | null;
  readonly summaryUpdatedAt: string | null;
  readonly sourceHash: string | null;
  readonly jobStatus: SummaryJobStatus | null;
  readonly jobError: string | null;
  readonly jobFailureCategory: string | null;
  readonly jobActionHint: string | null;
  readonly nextRunAt: string | null;
};
export type SummaryArcCacheDetail = Omit<SummaryArcCacheEntry, "summary"> & {
  readonly summary: {
    readonly summary: string;
    readonly structured: ArcAiSummaryPayload;
    readonly status: Exclude<SummaryStatus, "skipped_too_short">;
    readonly error: string | null;
    readonly updatedAt: string;
  } | null;
};
export type SummaryBookCacheState = Exclude<SummaryStatus, "skipped_too_short"> | "missing" | "queued" | "running" | "cancelled";
export type SummaryBookCacheDetail = {
  readonly cacheState: SummaryBookCacheState;
  readonly summaryShort: string | null;
  readonly summaryLong: string | null;
  readonly summaryUpdatedAt: string | null;
  readonly sourceHash: string | null;
  readonly jobStatus: SummaryJobStatus | null;
  readonly jobError: string | null;
  readonly jobFailureCategory: string | null;
  readonly jobActionHint: string | null;
  readonly nextRunAt: string | null;
  readonly summary: {
    readonly summaryShort: string;
    readonly summaryLong: string;
    readonly structured: BookAiSummaryPayload;
    readonly status: Exclude<SummaryStatus, "skipped_too_short">;
    readonly error: string | null;
    readonly updatedAt: string;
  } | null;
};
export type SummaryIndexJobDetail = {
  readonly jobId: string;
  readonly jobType: SummaryJobType;
  readonly targetId: string | null;
  readonly label: string;
  readonly error: string | null;
  readonly failureCategory: string | null;
  readonly actionHint: string | null;
  readonly attemptCount: number;
  readonly nextRunAt: string | null;
};
export type SummaryIndexStatus = {
  readonly projectId: string;
  readonly totalChapterCount: number;
  readonly readyChapterCount: number;
  readonly staleChapterCount: number;
  readonly missingChapterCount: number;
  readonly skippedTooShortChapterCount: number;
  readonly failedJobCount: number;
  readonly cancelledJobCount: number;
  readonly queuedJobCount: number;
  readonly runningJobLabel: string | null;
  readonly nextRetryAt: string | null;
  readonly nextRetryJobLabel: string | null;
  readonly backgroundEnabled: boolean;
  readonly retryingJobs: readonly SummaryIndexJobDetail[];
  readonly recentFailedJobs: readonly SummaryIndexJobDetail[];
  readonly pausedReason: SummaryIndexPausedReason;
  readonly updatedAt: string;
};

export const ipcChannels = {
  system: {
    getDatabaseStatus: "novelTool:system:getDatabaseStatus"
  },
  project: {
    createProject: "novelTool:project:createProject",
    openProject: "novelTool:project:openProject",
    selectProjectFile: "novelTool:project:selectProjectFile",
    selectProjectSavePath: "novelTool:project:selectProjectSavePath",
    suggestProjectPath: "novelTool:project:suggestProjectPath",
    openProjectFile: "novelTool:project:openProjectFile",
    renameProject: "novelTool:project:renameProject",
    deleteProject: "novelTool:project:deleteProject",
    getCurrentProject: "novelTool:project:getCurrentProject",
    listRecentProjects: "novelTool:project:listRecentProjects"
  },
  chapter: {
    list: "novelTool:chapter:list",
    create: "novelTool:chapter:create",
    rename: "novelTool:chapter:rename",
    delete: "novelTool:chapter:delete",
    getContent: "novelTool:chapter:getContent",
    saveContent: "novelTool:chapter:saveContent",
    updateTargetWordCount: "novelTool:chapter:updateTargetWordCount",
    createSnapshot: "novelTool:chapter:createSnapshot"
  },
  settings: {
    get: "novelTool:settings:get",
    save: "novelTool:settings:save",
    testConnection: "novelTool:settings:testConnection",
    listModels: "novelTool:settings:listModels"
  },
  usageAnalytics: {
    getStatus: "novelTool:usageAnalytics:getStatus",
    updateSettings: "novelTool:usageAnalytics:updateSettings",
    recordEvent: "novelTool:usageAnalytics:recordEvent",
    sendReportNow: "novelTool:usageAnalytics:sendReportNow"
  },
  ai: {
    createTask: "novelTool:ai:createTask",
    updateTask: "novelTool:ai:updateTask",
    generatePreviewStream: "novelTool:ai:generatePreviewStream",
    continuePreviewStream: "novelTool:ai:continuePreviewStream",
    applyCandidate: "novelTool:ai:applyCandidate",
    saveCandidateToScratchpad: "novelTool:ai:saveCandidateToScratchpad",
    getChatSession: "novelTool:ai:getChatSession",
    listChatSessions: "novelTool:ai:listChatSessions",
    createChatSession: "novelTool:ai:createChatSession",
    renameChatSession: "novelTool:ai:renameChatSession",
    deleteChatSession: "novelTool:ai:deleteChatSession",
    listChatMessages: "novelTool:ai:listChatMessages",
    clearChat: "novelTool:ai:clearChat",
    sendChatMessageStream: "novelTool:ai:sendChatMessageStream",
    regenerateChatMessageStream: "novelTool:ai:regenerateChatMessageStream",
    cancelStream: "novelTool:ai:cancelStream",
    streamChunk: "novelTool:ai:streamChunk",
    streamReasoning: "novelTool:ai:streamReasoning",
    streamContext: "novelTool:ai:streamContext",
    streamDone: "novelTool:ai:streamDone",
    streamError: "novelTool:ai:streamError",
    rejectCandidate: "novelTool:ai:rejectCandidate"
  },
  summary: {
    getIndexStatus: "novelTool:summary:getIndexStatus",
    rebuildProjectIndex: "novelTool:summary:rebuildProjectIndex",
    cancelCurrentJob: "novelTool:summary:cancelCurrentJob",
    listCacheEntries: "novelTool:summary:listCacheEntries",
    getChapterCache: "novelTool:summary:getChapterCache",
    clearAndRetryChapterCache: "novelTool:summary:clearAndRetryChapterCache",
    listArcCacheEntries: "novelTool:summary:listArcCacheEntries",
    getArcCache: "novelTool:summary:getArcCache",
    clearAndRetryArcCache: "novelTool:summary:clearAndRetryArcCache",
    getBookCache: "novelTool:summary:getBookCache",
    clearAndRetryBookCache: "novelTool:summary:clearAndRetryBookCache"
  },
  relationshipGraph: {
    getGraph: "novelTool:relationshipGraph:getGraph",
    getSourceStatus: "novelTool:relationshipGraph:getSourceStatus"
  },
  authorRelationship: {
    getGraph: "novelTool:authorRelationship:getGraph",
    createCharacter: "novelTool:authorRelationship:createCharacter",
    updateCharacter: "novelTool:authorRelationship:updateCharacter",
    updateCharacterLayout: "novelTool:authorRelationship:updateCharacterLayout",
    createRelationship: "novelTool:authorRelationship:createRelationship",
    deleteCharacter: "novelTool:authorRelationship:deleteCharacter",
    deleteRelationship: "novelTool:authorRelationship:deleteRelationship"
  },
  writingGoals: {
    getOverview: "novelTool:writingGoals:getOverview",
    createGoal: "novelTool:writingGoals:createGoal",
    updateGoal: "novelTool:writingGoals:updateGoal",
    pauseGoal: "novelTool:writingGoals:pauseGoal",
    resumeGoal: "novelTool:writingGoals:resumeGoal",
    archiveGoal: "novelTool:writingGoals:archiveGoal",
    listDailyStats: "novelTool:writingGoals:listDailyStats",
    getDayDetail: "novelTool:writingGoals:getDayDetail"
  },
  scratch: {
    list: "novelTool:scratch:list",
    create: "novelTool:scratch:create",
    update: "novelTool:scratch:update",
    delete: "novelTool:scratch:delete"
  },
  import: {
    selectTxtFile: "novelTool:import:selectTxtFile",
    previewTxt: "novelTool:import:previewTxt",
    updatePreview: "novelTool:import:updatePreview",
    confirmTxtImport: "novelTool:import:confirmTxtImport"
  },
  externalBookSync: {
    getStatus: "novelTool:externalBookSync:getStatus",
    scan: "novelTool:externalBookSync:scan",
    cancelScan: "novelTool:externalBookSync:cancelScan",
    selectDirectory: "novelTool:externalBookSync:selectDirectory",
    previewCandidate: "novelTool:externalBookSync:previewCandidate",
    sendMissingChaptersToAi: "novelTool:externalBookSync:sendMissingChaptersToAi",
    forgetSource: "novelTool:externalBookSync:forgetSource",
    scanProgress: "novelTool:externalBookSync:scanProgress",
    scanDone: "novelTool:externalBookSync:scanDone",
    scanError: "novelTool:externalBookSync:scanError"
  },
  export: {
    selectTxtFilePath: "novelTool:export:selectTxtFilePath",
    exportTxt: "novelTool:export:exportTxt",
    selectShareableProjectFilePath: "novelTool:export:selectShareableProjectFilePath",
    exportShareableProjectCopy: "novelTool:export:exportShareableProjectCopy"
  }
} as const;
