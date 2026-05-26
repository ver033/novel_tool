import { ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  AiApplyCandidateInput,
  AiCancelStreamInput,
  AiClearChatInput,
  AiCreateChatSessionInput,
  AiCreateTaskInput,
  AiDeleteChatSessionInput,
  AiGeneratePreviewStreamInput,
  AiGetChatSessionInput,
  AiListChatSessionsInput,
  AiListChatMessagesInput,
  AiRegenerateChatMessageStreamInput,
  AiRenameChatSessionInput,
  AiRejectCandidateInput,
  AiSaveCandidateToScratchpadInput,
  AiSendChatMessageStreamInput,
  AiStreamChunkEvent,
  AiStreamContextEvent,
  AiStreamDoneEvent,
  AiStreamErrorEvent,
  AiStreamReasoningEvent,
  AiUpdateTaskInput,
  AuthorRelationshipCreateCharacterInput,
  AuthorRelationshipCreateRelationshipInput,
  AuthorRelationshipDeleteCharacterInput,
  AuthorRelationshipDeleteRelationshipInput,
  AuthorRelationshipGetGraphInput,
  AuthorRelationshipUpdateCharacterInput,
  AuthorRelationshipUpdateCharacterLayoutInput,
  AuthorRelationshipUpdateRelationshipInput,
  ChapterCreateInput,
  ChapterCreateSnapshotInput,
  ChapterDeleteInput,
  ChapterGetContentInput,
  ChapterListInput,
  ChapterRenameInput,
  ChapterSaveContentInput,
  ChapterUpdateTargetWordCountInput,
  ExportSelectShareableProjectFilePathInput,
  ExportSelectTxtFilePathInput,
  ExportShareableProjectCopyInput,
  ExportTxtInput,
  ExternalBookScanProgress,
  ExternalBookSyncCancelScanInput,
  ExternalBookSyncCandidate,
  ExternalBookSyncForgetSourceInput,
  ExternalBookSyncPreviewCandidateInput,
  ExternalBookSyncScanInput,
  ExternalBookSyncScanResult,
  ExternalBookSyncSendResult,
  ExternalBookSyncSendToAiInput,
  ExternalBookSyncStatus,
  ExternalBookSyncStatusInput,
  ImportConfirmTxtInput,
  ImportPreviewTxtInput,
  ImportUpdatePreviewInput,
  OutlineConfirmBulkImportInput,
  OutlineClearImportedEventsInput,
  OutlineCreateEventInput,
  OutlineCreateThreadInput,
  OutlineDeleteEventInput,
  OutlineDeleteThreadInput,
  OutlineGetChapterNoteInput,
  OutlineGetOverviewInput,
  OutlineImportLegacyChapterNoteInput,
  OutlineListEventsInput,
  OutlineListThreadsInput,
  OutlinePreviewBulkImportInput,
  OutlinePreviewImportFileInput,
  OutlineReorderEventsInput,
  OutlineSaveChapterNoteInput,
  OutlineUndoImportBatchInput,
  OutlineUpdateEventInput,
  OutlineUpdateThreadInput,
  ProjectDeleteInput,
  ProjectOpenFileInput,
  ProjectOpenInput,
  ProjectCreateInput,
  ProjectRenameInput,
  ProjectSelectSavePathInput,
  ProjectSuggestFilePathInput,
  RelationshipGraphGetInput,
  RelationshipGraphSourceStatusInput,
  ScratchCreateInput,
  ScratchDeleteInput,
  ScratchListInput,
  ScratchUpdateInput,
  SettingsListModelsInput,
  SettingsSaveInput,
  SettingsTestConnectionInput,
  StartupLaunchStatus,
  StartupLaunchUpdateInput,
  SummaryCancelCurrentJobInput,
  SummaryClearAndRetryArcCacheInput,
  SummaryClearAndRetryBookCacheInput,
  SummaryClearAndRetryChapterCacheInput,
  SummaryGetArcCacheInput,
  SummaryGetBookCacheInput,
  SummaryGetChapterCacheInput,
  SummaryIndexStatusInput,
  SummaryListCacheEntriesInput,
  SummaryRebuildProjectIndexInput,
  UsageAnalyticsRecordEventInput,
  UsageAnalyticsReportRun,
  UsageAnalyticsStatus,
  UsageAnalyticsUpdateSettingsInput,
  WritingGoalCreateInput,
  WritingGoalDayDetailInput,
  WritingGoalListDailyStatsInput,
  WritingGoalOverviewInput,
  WritingGoalStatusInput,
  WritingGoalUpdateInput
} from "../main/shared/types";
import { ipcChannels } from "../main/shared/types";

type AiStreamHandlers = {
  readonly onChunk?: (event: AiStreamChunkEvent) => void;
  readonly onReasoning?: (event: AiStreamReasoningEvent) => void;
  readonly onContext?: (event: AiStreamContextEvent) => void;
  readonly onDone?: (event: AiStreamDoneEvent) => void;
  readonly onError?: (event: AiStreamErrorEvent) => void;
};

type ExternalBookSyncScanProgressEvent = ExternalBookScanProgress & {
  readonly requestId: string;
};

type ExternalBookSyncScanErrorEvent = {
  readonly requestId: string;
  readonly error: string;
};

type ExternalBookSyncScanDoneEvent = ExternalBookSyncScanResult & {
  readonly requestId: string;
};

type ExternalBookSyncScanHandlers = {
  readonly onProgress?: (event: ExternalBookSyncScanProgressEvent) => void;
  readonly onDone?: (event: ExternalBookSyncScanDoneEvent) => void;
  readonly onError?: (event: ExternalBookSyncScanErrorEvent) => void;
};

export type NovelToolApi = {
  readonly platform: {
    readonly isDesktop: true;
    readonly appName: "novel-tool";
  };
  readonly system: {
    readonly getDatabaseStatus: () => Promise<unknown>;
  };
  readonly project: {
    readonly createProject: (input: ProjectCreateInput) => Promise<unknown>;
    readonly openProject: (input: ProjectOpenInput) => Promise<unknown>;
    readonly selectProjectFile: () => Promise<unknown>;
    readonly selectProjectSavePath: (input: ProjectSelectSavePathInput) => Promise<unknown>;
    readonly suggestProjectPath: (input: ProjectSuggestFilePathInput) => Promise<unknown>;
    readonly openProjectFile: (input: ProjectOpenFileInput) => Promise<unknown>;
    readonly renameProject: (input: ProjectRenameInput) => Promise<unknown>;
    readonly deleteProject: (input: ProjectDeleteInput) => Promise<unknown>;
    readonly getCurrentProject: () => Promise<unknown>;
    readonly listRecentProjects: () => Promise<unknown>;
  };
  readonly chapter: {
    readonly list: (input: ChapterListInput) => Promise<unknown>;
    readonly create: (input: ChapterCreateInput) => Promise<unknown>;
    readonly rename: (input: ChapterRenameInput) => Promise<unknown>;
    readonly delete: (input: ChapterDeleteInput) => Promise<unknown>;
    readonly getContent: (input: ChapterGetContentInput) => Promise<unknown>;
    readonly saveContent: (input: ChapterSaveContentInput) => Promise<unknown>;
    readonly updateTargetWordCount: (input: ChapterUpdateTargetWordCountInput) => Promise<unknown>;
    readonly createSnapshot: (input: ChapterCreateSnapshotInput) => Promise<unknown>;
  };
  readonly settings: {
    readonly get: () => Promise<unknown>;
    readonly save: (input: SettingsSaveInput) => Promise<unknown>;
    readonly testConnection: (input?: SettingsTestConnectionInput) => Promise<unknown>;
    readonly listModels: (input?: SettingsListModelsInput) => Promise<unknown>;
  };
  readonly startupLaunch: {
    readonly getStatus: () => Promise<StartupLaunchStatus>;
    readonly updateSettings: (input: StartupLaunchUpdateInput) => Promise<StartupLaunchStatus>;
  };
  readonly usageAnalytics: {
    readonly getStatus: () => Promise<UsageAnalyticsStatus>;
    readonly updateSettings: (input: UsageAnalyticsUpdateSettingsInput) => Promise<unknown>;
    readonly recordEvent: (input: UsageAnalyticsRecordEventInput) => Promise<unknown>;
    readonly sendReportNow: () => Promise<UsageAnalyticsReportRun>;
  };
  readonly summary: {
    readonly getIndexStatus: (input: SummaryIndexStatusInput) => Promise<unknown>;
    readonly rebuildProjectIndex: (input: SummaryRebuildProjectIndexInput) => Promise<unknown>;
    readonly cancelCurrentJob: (input: SummaryCancelCurrentJobInput) => Promise<unknown>;
    readonly listCacheEntries: (input: SummaryListCacheEntriesInput) => Promise<unknown>;
    readonly getChapterCache: (input: SummaryGetChapterCacheInput) => Promise<unknown>;
    readonly clearAndRetryChapterCache: (input: SummaryClearAndRetryChapterCacheInput) => Promise<unknown>;
    readonly listArcCacheEntries: (input: SummaryListCacheEntriesInput) => Promise<unknown>;
    readonly getArcCache: (input: SummaryGetArcCacheInput) => Promise<unknown>;
    readonly clearAndRetryArcCache: (input: SummaryClearAndRetryArcCacheInput) => Promise<unknown>;
    readonly getBookCache: (input: SummaryGetBookCacheInput) => Promise<unknown>;
    readonly clearAndRetryBookCache: (input: SummaryClearAndRetryBookCacheInput) => Promise<unknown>;
  };
  readonly relationshipGraph: {
    readonly getGraph: (input: RelationshipGraphGetInput) => Promise<unknown>;
    readonly getSourceStatus: (input: RelationshipGraphSourceStatusInput) => Promise<unknown>;
  };
  readonly authorRelationship: {
    readonly getGraph: (input: AuthorRelationshipGetGraphInput) => Promise<unknown>;
    readonly createCharacter: (input: AuthorRelationshipCreateCharacterInput) => Promise<unknown>;
    readonly updateCharacter: (input: AuthorRelationshipUpdateCharacterInput) => Promise<unknown>;
    readonly updateCharacterLayout: (input: AuthorRelationshipUpdateCharacterLayoutInput) => Promise<unknown>;
    readonly createRelationship: (input: AuthorRelationshipCreateRelationshipInput) => Promise<unknown>;
    readonly updateRelationship: (input: AuthorRelationshipUpdateRelationshipInput) => Promise<unknown>;
    readonly deleteCharacter: (input: AuthorRelationshipDeleteCharacterInput) => Promise<unknown>;
    readonly deleteRelationship: (input: AuthorRelationshipDeleteRelationshipInput) => Promise<unknown>;
  };
  readonly outline: {
    readonly selectImportFile: () => Promise<unknown>;
    readonly getOverview: (input: OutlineGetOverviewInput) => Promise<unknown>;
    readonly listEvents: (input: OutlineListEventsInput) => Promise<unknown>;
    readonly createEvent: (input: OutlineCreateEventInput) => Promise<unknown>;
    readonly updateEvent: (input: OutlineUpdateEventInput) => Promise<unknown>;
    readonly deleteEvent: (input: OutlineDeleteEventInput) => Promise<unknown>;
    readonly reorderEvents: (input: OutlineReorderEventsInput) => Promise<unknown>;
    readonly listThreads: (input: OutlineListThreadsInput) => Promise<unknown>;
    readonly createThread: (input: OutlineCreateThreadInput) => Promise<unknown>;
    readonly updateThread: (input: OutlineUpdateThreadInput) => Promise<unknown>;
    readonly deleteThread: (input: OutlineDeleteThreadInput) => Promise<unknown>;
    readonly getChapterNote: (input: OutlineGetChapterNoteInput) => Promise<unknown>;
    readonly saveChapterNote: (input: OutlineSaveChapterNoteInput) => Promise<unknown>;
    readonly importLegacyChapterNote: (input: OutlineImportLegacyChapterNoteInput) => Promise<unknown>;
    readonly previewImportFile: (input: OutlinePreviewImportFileInput) => Promise<unknown>;
    readonly previewBulkImport: (input: OutlinePreviewBulkImportInput) => Promise<unknown>;
    readonly confirmBulkImport: (input: OutlineConfirmBulkImportInput) => Promise<unknown>;
    readonly undoImportBatch: (input: OutlineUndoImportBatchInput) => Promise<unknown>;
    readonly clearImportedEvents: (input: OutlineClearImportedEventsInput) => Promise<unknown>;
  };
  readonly writingGoals: {
    readonly getOverview: (input: WritingGoalOverviewInput) => Promise<unknown>;
    readonly createGoal: (input: WritingGoalCreateInput) => Promise<unknown>;
    readonly updateGoal: (input: WritingGoalUpdateInput) => Promise<unknown>;
    readonly pauseGoal: (input: WritingGoalStatusInput) => Promise<unknown>;
    readonly resumeGoal: (input: WritingGoalStatusInput) => Promise<unknown>;
    readonly archiveGoal: (input: WritingGoalStatusInput) => Promise<unknown>;
    readonly listDailyStats: (input: WritingGoalListDailyStatsInput) => Promise<unknown>;
    readonly getDayDetail: (input: WritingGoalDayDetailInput) => Promise<unknown>;
  };
  readonly ai: {
    readonly createTask: (input: AiCreateTaskInput) => Promise<unknown>;
    readonly updateTask: (input: AiUpdateTaskInput) => Promise<unknown>;
    readonly generatePreviewStream: (input: AiGeneratePreviewStreamInput) => Promise<unknown>;
    readonly continuePreviewStream: (input: AiGeneratePreviewStreamInput) => Promise<unknown>;
    readonly applyCandidate: (input: AiApplyCandidateInput) => Promise<unknown>;
    readonly saveCandidateToScratchpad: (input: AiSaveCandidateToScratchpadInput) => Promise<unknown>;
    readonly getChatSession: (input: AiGetChatSessionInput) => Promise<unknown>;
    readonly listChatSessions: (input: AiListChatSessionsInput) => Promise<unknown>;
    readonly createChatSession: (input: AiCreateChatSessionInput) => Promise<unknown>;
    readonly renameChatSession: (input: AiRenameChatSessionInput) => Promise<unknown>;
    readonly deleteChatSession: (input: AiDeleteChatSessionInput) => Promise<unknown>;
    readonly listChatMessages: (input: AiListChatMessagesInput) => Promise<unknown>;
    readonly clearChat: (input: AiClearChatInput) => Promise<unknown>;
    readonly sendChatMessageStream: (input: AiSendChatMessageStreamInput) => Promise<unknown>;
    readonly regenerateChatMessageStream: (input: AiRegenerateChatMessageStreamInput) => Promise<unknown>;
    readonly cancelStream: (input: AiCancelStreamInput) => Promise<unknown>;
    readonly subscribeAiStream: (requestId: string, handlers: AiStreamHandlers) => () => void;
    readonly rejectCandidate: (input: AiRejectCandidateInput) => Promise<unknown>;
  };
  readonly scratch: {
    readonly list: (input: ScratchListInput) => Promise<unknown>;
    readonly create: (input: ScratchCreateInput) => Promise<unknown>;
    readonly update: (input: ScratchUpdateInput) => Promise<unknown>;
    readonly delete: (input: ScratchDeleteInput) => Promise<unknown>;
  };
  readonly import: {
    readonly selectTxtFile: () => Promise<unknown>;
    readonly previewTxt: (input: ImportPreviewTxtInput) => Promise<unknown>;
    readonly updatePreview: (input: ImportUpdatePreviewInput) => Promise<unknown>;
    readonly confirmTxtImport: (input: ImportConfirmTxtInput) => Promise<unknown>;
  };
  readonly externalBookSync: {
    readonly getStatus: (input: ExternalBookSyncStatusInput) => Promise<ExternalBookSyncStatus>;
    readonly scan: (input: ExternalBookSyncScanInput) => Promise<ExternalBookSyncScanResult>;
    readonly cancelScan: (input: ExternalBookSyncCancelScanInput) => Promise<unknown>;
    readonly selectDirectory: () => Promise<{ readonly directoryPath: string } | null>;
    readonly previewCandidate: (input: ExternalBookSyncPreviewCandidateInput) => Promise<ExternalBookSyncCandidate>;
    readonly sendMissingChaptersToAi: (input: ExternalBookSyncSendToAiInput) => Promise<ExternalBookSyncSendResult>;
    readonly forgetSource: (input: ExternalBookSyncForgetSourceInput) => Promise<unknown>;
    readonly subscribeScan: (requestId: string, handlers: ExternalBookSyncScanHandlers) => () => void;
  };
  readonly export: {
    readonly selectTxtFilePath: (input: ExportSelectTxtFilePathInput) => Promise<unknown>;
    readonly exportTxt: (input: ExportTxtInput) => Promise<unknown>;
    readonly selectShareableProjectFilePath: (input: ExportSelectShareableProjectFilePathInput) => Promise<unknown>;
    readonly exportShareableProjectCopy: (input: ExportShareableProjectCopyInput) => Promise<unknown>;
  };
};

export const novelToolApi: NovelToolApi = Object.freeze({
  platform: Object.freeze({
    isDesktop: true,
    appName: "novel-tool"
  }),
  system: Object.freeze({
    getDatabaseStatus: () => ipcRenderer.invoke(ipcChannels.system.getDatabaseStatus)
  }),
  project: Object.freeze({
    createProject: (input: ProjectCreateInput) => ipcRenderer.invoke(ipcChannels.project.createProject, input),
    openProject: (input: ProjectOpenInput) => ipcRenderer.invoke(ipcChannels.project.openProject, input),
    selectProjectFile: () => ipcRenderer.invoke(ipcChannels.project.selectProjectFile),
    selectProjectSavePath: (input: ProjectSelectSavePathInput) => ipcRenderer.invoke(ipcChannels.project.selectProjectSavePath, input),
    suggestProjectPath: (input: ProjectSuggestFilePathInput) => ipcRenderer.invoke(ipcChannels.project.suggestProjectPath, input),
    openProjectFile: (input: ProjectOpenFileInput) => ipcRenderer.invoke(ipcChannels.project.openProjectFile, input),
    renameProject: (input: ProjectRenameInput) => ipcRenderer.invoke(ipcChannels.project.renameProject, input),
    deleteProject: (input: ProjectDeleteInput) => ipcRenderer.invoke(ipcChannels.project.deleteProject, input),
    getCurrentProject: () => ipcRenderer.invoke(ipcChannels.project.getCurrentProject),
    listRecentProjects: () => ipcRenderer.invoke(ipcChannels.project.listRecentProjects)
  }),
  chapter: Object.freeze({
    list: (input: ChapterListInput) => ipcRenderer.invoke(ipcChannels.chapter.list, input),
    create: (input: ChapterCreateInput) => ipcRenderer.invoke(ipcChannels.chapter.create, input),
    rename: (input: ChapterRenameInput) => ipcRenderer.invoke(ipcChannels.chapter.rename, input),
    delete: (input: ChapterDeleteInput) => ipcRenderer.invoke(ipcChannels.chapter.delete, input),
    getContent: (input: ChapterGetContentInput) => ipcRenderer.invoke(ipcChannels.chapter.getContent, input),
    saveContent: (input: ChapterSaveContentInput) => ipcRenderer.invoke(ipcChannels.chapter.saveContent, input),
    updateTargetWordCount: (input: ChapterUpdateTargetWordCountInput) => ipcRenderer.invoke(ipcChannels.chapter.updateTargetWordCount, input),
    createSnapshot: (input: ChapterCreateSnapshotInput) => ipcRenderer.invoke(ipcChannels.chapter.createSnapshot, input)
  }),
  settings: Object.freeze({
    get: () => ipcRenderer.invoke(ipcChannels.settings.get),
    save: (input: SettingsSaveInput) => ipcRenderer.invoke(ipcChannels.settings.save, input),
    testConnection: (input?: SettingsTestConnectionInput) => ipcRenderer.invoke(ipcChannels.settings.testConnection, input),
    listModels: (input?: SettingsListModelsInput) => ipcRenderer.invoke(ipcChannels.settings.listModels, input)
  }),
  startupLaunch: Object.freeze({
    getStatus: () => ipcRenderer.invoke(ipcChannels.startupLaunch.getStatus),
    updateSettings: (input: StartupLaunchUpdateInput) => ipcRenderer.invoke(ipcChannels.startupLaunch.updateSettings, input)
  }),
  usageAnalytics: Object.freeze({
    getStatus: () => ipcRenderer.invoke(ipcChannels.usageAnalytics.getStatus),
    updateSettings: (input: UsageAnalyticsUpdateSettingsInput) => ipcRenderer.invoke(ipcChannels.usageAnalytics.updateSettings, input),
    recordEvent: (input: UsageAnalyticsRecordEventInput) => ipcRenderer.invoke(ipcChannels.usageAnalytics.recordEvent, input),
    sendReportNow: () => ipcRenderer.invoke(ipcChannels.usageAnalytics.sendReportNow)
  }),
  summary: Object.freeze({
    getIndexStatus: (input: SummaryIndexStatusInput) => ipcRenderer.invoke(ipcChannels.summary.getIndexStatus, input),
    rebuildProjectIndex: (input: SummaryRebuildProjectIndexInput) => ipcRenderer.invoke(ipcChannels.summary.rebuildProjectIndex, input),
    cancelCurrentJob: (input: SummaryCancelCurrentJobInput) => ipcRenderer.invoke(ipcChannels.summary.cancelCurrentJob, input),
    listCacheEntries: (input: SummaryListCacheEntriesInput) => ipcRenderer.invoke(ipcChannels.summary.listCacheEntries, input),
    getChapterCache: (input: SummaryGetChapterCacheInput) => ipcRenderer.invoke(ipcChannels.summary.getChapterCache, input),
    clearAndRetryChapterCache: (input: SummaryClearAndRetryChapterCacheInput) => ipcRenderer.invoke(ipcChannels.summary.clearAndRetryChapterCache, input),
    listArcCacheEntries: (input: SummaryListCacheEntriesInput) => ipcRenderer.invoke(ipcChannels.summary.listArcCacheEntries, input),
    getArcCache: (input: SummaryGetArcCacheInput) => ipcRenderer.invoke(ipcChannels.summary.getArcCache, input),
    clearAndRetryArcCache: (input: SummaryClearAndRetryArcCacheInput) => ipcRenderer.invoke(ipcChannels.summary.clearAndRetryArcCache, input),
    getBookCache: (input: SummaryGetBookCacheInput) => ipcRenderer.invoke(ipcChannels.summary.getBookCache, input),
    clearAndRetryBookCache: (input: SummaryClearAndRetryBookCacheInput) => ipcRenderer.invoke(ipcChannels.summary.clearAndRetryBookCache, input)
  }),
  relationshipGraph: Object.freeze({
    getGraph: (input: RelationshipGraphGetInput) => ipcRenderer.invoke(ipcChannels.relationshipGraph.getGraph, input),
    getSourceStatus: (input: RelationshipGraphSourceStatusInput) => ipcRenderer.invoke(ipcChannels.relationshipGraph.getSourceStatus, input)
  }),
  authorRelationship: Object.freeze({
    getGraph: (input: AuthorRelationshipGetGraphInput) => ipcRenderer.invoke(ipcChannels.authorRelationship.getGraph, input),
    createCharacter: (input: AuthorRelationshipCreateCharacterInput) => ipcRenderer.invoke(ipcChannels.authorRelationship.createCharacter, input),
    updateCharacter: (input: AuthorRelationshipUpdateCharacterInput) => ipcRenderer.invoke(ipcChannels.authorRelationship.updateCharacter, input),
    updateCharacterLayout: (input: AuthorRelationshipUpdateCharacterLayoutInput) =>
      ipcRenderer.invoke(ipcChannels.authorRelationship.updateCharacterLayout, input),
    createRelationship: (input: AuthorRelationshipCreateRelationshipInput) => ipcRenderer.invoke(ipcChannels.authorRelationship.createRelationship, input),
    updateRelationship: (input: AuthorRelationshipUpdateRelationshipInput) => ipcRenderer.invoke(ipcChannels.authorRelationship.updateRelationship, input),
    deleteCharacter: (input: AuthorRelationshipDeleteCharacterInput) => ipcRenderer.invoke(ipcChannels.authorRelationship.deleteCharacter, input),
    deleteRelationship: (input: AuthorRelationshipDeleteRelationshipInput) => ipcRenderer.invoke(ipcChannels.authorRelationship.deleteRelationship, input)
  }),
  outline: Object.freeze({
    selectImportFile: () => ipcRenderer.invoke(ipcChannels.outline.selectImportFile),
    getOverview: (input: OutlineGetOverviewInput) => ipcRenderer.invoke(ipcChannels.outline.getOverview, input),
    listEvents: (input: OutlineListEventsInput) => ipcRenderer.invoke(ipcChannels.outline.listEvents, input),
    createEvent: (input: OutlineCreateEventInput) => ipcRenderer.invoke(ipcChannels.outline.createEvent, input),
    updateEvent: (input: OutlineUpdateEventInput) => ipcRenderer.invoke(ipcChannels.outline.updateEvent, input),
    deleteEvent: (input: OutlineDeleteEventInput) => ipcRenderer.invoke(ipcChannels.outline.deleteEvent, input),
    reorderEvents: (input: OutlineReorderEventsInput) => ipcRenderer.invoke(ipcChannels.outline.reorderEvents, input),
    listThreads: (input: OutlineListThreadsInput) => ipcRenderer.invoke(ipcChannels.outline.listThreads, input),
    createThread: (input: OutlineCreateThreadInput) => ipcRenderer.invoke(ipcChannels.outline.createThread, input),
    updateThread: (input: OutlineUpdateThreadInput) => ipcRenderer.invoke(ipcChannels.outline.updateThread, input),
    deleteThread: (input: OutlineDeleteThreadInput) => ipcRenderer.invoke(ipcChannels.outline.deleteThread, input),
    getChapterNote: (input: OutlineGetChapterNoteInput) => ipcRenderer.invoke(ipcChannels.outline.getChapterNote, input),
    saveChapterNote: (input: OutlineSaveChapterNoteInput) => ipcRenderer.invoke(ipcChannels.outline.saveChapterNote, input),
    importLegacyChapterNote: (input: OutlineImportLegacyChapterNoteInput) => ipcRenderer.invoke(ipcChannels.outline.importLegacyChapterNote, input),
    previewImportFile: (input: OutlinePreviewImportFileInput) => ipcRenderer.invoke(ipcChannels.outline.previewImportFile, input),
    previewBulkImport: (input: OutlinePreviewBulkImportInput) => ipcRenderer.invoke(ipcChannels.outline.previewBulkImport, input),
    confirmBulkImport: (input: OutlineConfirmBulkImportInput) => ipcRenderer.invoke(ipcChannels.outline.confirmBulkImport, input),
    undoImportBatch: (input: OutlineUndoImportBatchInput) => ipcRenderer.invoke(ipcChannels.outline.undoImportBatch, input),
    clearImportedEvents: (input: OutlineClearImportedEventsInput) => ipcRenderer.invoke(ipcChannels.outline.clearImportedEvents, input)
  }),
  writingGoals: Object.freeze({
    getOverview: (input: WritingGoalOverviewInput) => ipcRenderer.invoke(ipcChannels.writingGoals.getOverview, input),
    createGoal: (input: WritingGoalCreateInput) => ipcRenderer.invoke(ipcChannels.writingGoals.createGoal, input),
    updateGoal: (input: WritingGoalUpdateInput) => ipcRenderer.invoke(ipcChannels.writingGoals.updateGoal, input),
    pauseGoal: (input: WritingGoalStatusInput) => ipcRenderer.invoke(ipcChannels.writingGoals.pauseGoal, input),
    resumeGoal: (input: WritingGoalStatusInput) => ipcRenderer.invoke(ipcChannels.writingGoals.resumeGoal, input),
    archiveGoal: (input: WritingGoalStatusInput) => ipcRenderer.invoke(ipcChannels.writingGoals.archiveGoal, input),
    listDailyStats: (input: WritingGoalListDailyStatsInput) => ipcRenderer.invoke(ipcChannels.writingGoals.listDailyStats, input),
    getDayDetail: (input: WritingGoalDayDetailInput) => ipcRenderer.invoke(ipcChannels.writingGoals.getDayDetail, input)
  }),
  ai: Object.freeze({
    createTask: (input: AiCreateTaskInput) => ipcRenderer.invoke(ipcChannels.ai.createTask, input),
    updateTask: (input: AiUpdateTaskInput) => ipcRenderer.invoke(ipcChannels.ai.updateTask, input),
    generatePreviewStream: (input: AiGeneratePreviewStreamInput) => ipcRenderer.invoke(ipcChannels.ai.generatePreviewStream, input),
    continuePreviewStream: (input: AiGeneratePreviewStreamInput) => ipcRenderer.invoke(ipcChannels.ai.continuePreviewStream, input),
    applyCandidate: (input: AiApplyCandidateInput) => ipcRenderer.invoke(ipcChannels.ai.applyCandidate, input),
    saveCandidateToScratchpad: (input: AiSaveCandidateToScratchpadInput) => ipcRenderer.invoke(ipcChannels.ai.saveCandidateToScratchpad, input),
    getChatSession: (input: AiGetChatSessionInput) => ipcRenderer.invoke(ipcChannels.ai.getChatSession, input),
    listChatSessions: (input: AiListChatSessionsInput) => ipcRenderer.invoke(ipcChannels.ai.listChatSessions, input),
    createChatSession: (input: AiCreateChatSessionInput) => ipcRenderer.invoke(ipcChannels.ai.createChatSession, input),
    renameChatSession: (input: AiRenameChatSessionInput) => ipcRenderer.invoke(ipcChannels.ai.renameChatSession, input),
    deleteChatSession: (input: AiDeleteChatSessionInput) => ipcRenderer.invoke(ipcChannels.ai.deleteChatSession, input),
    listChatMessages: (input: AiListChatMessagesInput) => ipcRenderer.invoke(ipcChannels.ai.listChatMessages, input),
    clearChat: (input: AiClearChatInput) => ipcRenderer.invoke(ipcChannels.ai.clearChat, input),
    sendChatMessageStream: (input: AiSendChatMessageStreamInput) => ipcRenderer.invoke(ipcChannels.ai.sendChatMessageStream, input),
    regenerateChatMessageStream: (input: AiRegenerateChatMessageStreamInput) => ipcRenderer.invoke(ipcChannels.ai.regenerateChatMessageStream, input),
    cancelStream: (input: AiCancelStreamInput) => ipcRenderer.invoke(ipcChannels.ai.cancelStream, input),
    subscribeAiStream: (requestId: string, handlers: AiStreamHandlers) => {
      const onChunk = (_event: IpcRendererEvent, payload: AiStreamChunkEvent) => {
        if (payload.requestId === requestId) {
          handlers.onChunk?.(payload);
        }
      };
      const onDone = (_event: IpcRendererEvent, payload: AiStreamDoneEvent) => {
        if (payload.requestId === requestId) {
          handlers.onDone?.(payload);
        }
      };
      const onReasoning = (_event: IpcRendererEvent, payload: AiStreamReasoningEvent) => {
        if (payload.requestId === requestId) {
          handlers.onReasoning?.(payload);
        }
      };
      const onContext = (_event: IpcRendererEvent, payload: AiStreamContextEvent) => {
        if (payload.requestId === requestId) {
          handlers.onContext?.(payload);
        }
      };
      const onError = (_event: IpcRendererEvent, payload: AiStreamErrorEvent) => {
        if (payload.requestId === requestId) {
          handlers.onError?.(payload);
        }
      };
      ipcRenderer.on(ipcChannels.ai.streamChunk, onChunk);
      ipcRenderer.on(ipcChannels.ai.streamReasoning, onReasoning);
      ipcRenderer.on(ipcChannels.ai.streamContext, onContext);
      ipcRenderer.on(ipcChannels.ai.streamDone, onDone);
      ipcRenderer.on(ipcChannels.ai.streamError, onError);
      return () => {
        ipcRenderer.off(ipcChannels.ai.streamChunk, onChunk);
        ipcRenderer.off(ipcChannels.ai.streamReasoning, onReasoning);
        ipcRenderer.off(ipcChannels.ai.streamContext, onContext);
        ipcRenderer.off(ipcChannels.ai.streamDone, onDone);
        ipcRenderer.off(ipcChannels.ai.streamError, onError);
      };
    },
    rejectCandidate: (input: AiRejectCandidateInput) => ipcRenderer.invoke(ipcChannels.ai.rejectCandidate, input)
  }),
  scratch: Object.freeze({
    list: (input: ScratchListInput) => ipcRenderer.invoke(ipcChannels.scratch.list, input),
    create: (input: ScratchCreateInput) => ipcRenderer.invoke(ipcChannels.scratch.create, input),
    update: (input: ScratchUpdateInput) => ipcRenderer.invoke(ipcChannels.scratch.update, input),
    delete: (input: ScratchDeleteInput) => ipcRenderer.invoke(ipcChannels.scratch.delete, input)
  }),
  import: Object.freeze({
    selectTxtFile: () => ipcRenderer.invoke(ipcChannels.import.selectTxtFile),
    previewTxt: (input: ImportPreviewTxtInput) => ipcRenderer.invoke(ipcChannels.import.previewTxt, input),
    updatePreview: (input: ImportUpdatePreviewInput) => ipcRenderer.invoke(ipcChannels.import.updatePreview, input),
    confirmTxtImport: (input: ImportConfirmTxtInput) => ipcRenderer.invoke(ipcChannels.import.confirmTxtImport, input)
  }),
  externalBookSync: Object.freeze({
    getStatus: (input: ExternalBookSyncStatusInput) => ipcRenderer.invoke(ipcChannels.externalBookSync.getStatus, input),
    scan: (input: ExternalBookSyncScanInput) => ipcRenderer.invoke(ipcChannels.externalBookSync.scan, input),
    cancelScan: (input: ExternalBookSyncCancelScanInput) => ipcRenderer.invoke(ipcChannels.externalBookSync.cancelScan, input),
    selectDirectory: () => ipcRenderer.invoke(ipcChannels.externalBookSync.selectDirectory),
    previewCandidate: (input: ExternalBookSyncPreviewCandidateInput) => ipcRenderer.invoke(ipcChannels.externalBookSync.previewCandidate, input),
    sendMissingChaptersToAi: (input: ExternalBookSyncSendToAiInput) => ipcRenderer.invoke(ipcChannels.externalBookSync.sendMissingChaptersToAi, input),
    forgetSource: (input: ExternalBookSyncForgetSourceInput) => ipcRenderer.invoke(ipcChannels.externalBookSync.forgetSource, input),
    subscribeScan: (requestId: string, handlers: ExternalBookSyncScanHandlers) => {
      const onProgress = (_event: IpcRendererEvent, payload: ExternalBookSyncScanProgressEvent) => {
        if (payload.requestId === requestId) {
          handlers.onProgress?.(payload);
        }
      };
      const onDone = (_event: IpcRendererEvent, payload: ExternalBookSyncScanResult) => {
        if (payload.requestId === requestId) {
          handlers.onDone?.(payload);
        }
      };
      const onError = (_event: IpcRendererEvent, payload: ExternalBookSyncScanErrorEvent) => {
        if (payload.requestId === requestId) {
          handlers.onError?.(payload);
        }
      };
      ipcRenderer.on(ipcChannels.externalBookSync.scanProgress, onProgress);
      ipcRenderer.on(ipcChannels.externalBookSync.scanDone, onDone);
      ipcRenderer.on(ipcChannels.externalBookSync.scanError, onError);
      return () => {
        ipcRenderer.off(ipcChannels.externalBookSync.scanProgress, onProgress);
        ipcRenderer.off(ipcChannels.externalBookSync.scanDone, onDone);
        ipcRenderer.off(ipcChannels.externalBookSync.scanError, onError);
      };
    }
  }),
  export: Object.freeze({
    selectTxtFilePath: (input: ExportSelectTxtFilePathInput) => ipcRenderer.invoke(ipcChannels.export.selectTxtFilePath, input),
    exportTxt: (input: ExportTxtInput) => ipcRenderer.invoke(ipcChannels.export.exportTxt, input),
    selectShareableProjectFilePath: (input: ExportSelectShareableProjectFilePathInput) =>
      ipcRenderer.invoke(ipcChannels.export.selectShareableProjectFilePath, input),
    exportShareableProjectCopy: (input: ExportShareableProjectCopyInput) => ipcRenderer.invoke(ipcChannels.export.exportShareableProjectCopy, input)
  })
});
