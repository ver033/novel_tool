import type { z } from "zod";
import type {
  aiCreateTaskInputSchema,
  aiApplyCandidateInputSchema,
  aiProviderSettingsSchema,
  aiGeneratePreviewInputSchema,
  aiRejectCandidateInputSchema,
  aiSaveCandidateToScratchpadInputSchema,
  aiSendChatMessageInputSchema,
  aiUpdateTaskInputSchema,
  chapterCreateInputSchema,
  chapterCreateSnapshotInputSchema,
  chapterDeleteInputSchema,
  chapterGetContentInputSchema,
  chapterListInputSchema,
  chapterRenameInputSchema,
  chapterSaveContentInputSchema,
  editorSettingsSchema,
  importConfirmTxtInputSchema,
  importPreviewTxtInputSchema,
  importUpdatePreviewInputSchema,
  projectCreateInputSchema,
  projectDeleteInputSchema,
  projectOpenFileInputSchema,
  projectOpenInputSchema,
  projectRenameInputSchema,
  scratchCreateInputSchema,
  scratchDeleteInputSchema,
  scratchListInputSchema,
  scratchUpdateInputSchema,
  settingsSaveInputSchema,
  settingsListModelsInputSchema,
  settingsTestConnectionInputSchema
} from "./schemas";

export type TaskType = "polish" | "expand" | "proofread" | "continue";
export type AiTaskStatus = "empty" | "configured" | "generating" | "preview_ready" | "failed" | "applied" | "inserted" | "saved_to_scratchpad";
export type CandidateStatus = "preview" | "applied" | "inserted" | "rejected" | "copied" | "inserted_to_scratchpad";

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

export type ChapterSummary = {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly volumeTitle: string | null;
  readonly sortOrder: number;
  readonly wordCount: number;
  readonly dailyWordCount: number;
  readonly targetWordCount: number | null;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
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

export type EditorSettings = Required<z.output<typeof editorSettingsSchema>>;
export type AiProviderSettingsState = Omit<z.output<typeof aiProviderSettingsSchema>, "apiKey"> & {
  readonly apiKeyConfigured: boolean;
};
export type SettingsState = {
  readonly editor: EditorSettings;
  readonly aiProvider: AiProviderSettingsState | null;
  readonly projectPath: string | null;
};

export type OpenRouterModelSummary = {
  readonly id: string;
  readonly name: string;
  readonly contextLength: number | null;
};

export type ProjectCreateInput = z.input<typeof projectCreateInputSchema>;
export type ProjectOpenInput = z.input<typeof projectOpenInputSchema>;
export type ProjectOpenFileInput = z.input<typeof projectOpenFileInputSchema>;
export type ProjectRenameInput = z.input<typeof projectRenameInputSchema>;
export type ProjectDeleteInput = z.input<typeof projectDeleteInputSchema>;
export type ChapterListInput = z.input<typeof chapterListInputSchema>;
export type ChapterCreateInput = z.input<typeof chapterCreateInputSchema>;
export type ChapterRenameInput = z.input<typeof chapterRenameInputSchema>;
export type ChapterDeleteInput = z.input<typeof chapterDeleteInputSchema>;
export type ChapterGetContentInput = z.input<typeof chapterGetContentInputSchema>;
export type ChapterSaveContentInput = z.input<typeof chapterSaveContentInputSchema>;
export type ChapterCreateSnapshotInput = z.input<typeof chapterCreateSnapshotInputSchema>;
export type SettingsSaveInput = z.input<typeof settingsSaveInputSchema>;
export type SettingsTestConnectionInput = z.input<typeof settingsTestConnectionInputSchema>;
export type SettingsListModelsInput = z.input<typeof settingsListModelsInputSchema>;
export type AiCreateTaskInput = z.input<typeof aiCreateTaskInputSchema>;
export type AiUpdateTaskInput = z.input<typeof aiUpdateTaskInputSchema>;
export type AiGeneratePreviewInput = z.input<typeof aiGeneratePreviewInputSchema>;
export type AiApplyCandidateInput = z.input<typeof aiApplyCandidateInputSchema>;
export type AiSaveCandidateToScratchpadInput = z.input<typeof aiSaveCandidateToScratchpadInputSchema>;
export type AiSendChatMessageInput = z.input<typeof aiSendChatMessageInputSchema>;
export type AiRejectCandidateInput = z.input<typeof aiRejectCandidateInputSchema>;
export type ScratchListInput = z.input<typeof scratchListInputSchema>;
export type ScratchCreateInput = z.input<typeof scratchCreateInputSchema>;
export type ScratchUpdateInput = z.input<typeof scratchUpdateInputSchema>;
export type ScratchDeleteInput = z.input<typeof scratchDeleteInputSchema>;
export type ImportPreviewTxtInput = z.input<typeof importPreviewTxtInputSchema>;
export type ImportUpdatePreviewInput = z.input<typeof importUpdatePreviewInputSchema>;
export type ImportConfirmTxtInput = z.input<typeof importConfirmTxtInputSchema>;

export const ipcChannels = {
  system: {
    getDatabaseStatus: "novelTool:system:getDatabaseStatus"
  },
  project: {
    createProject: "novelTool:project:createProject",
    openProject: "novelTool:project:openProject",
    selectProjectFile: "novelTool:project:selectProjectFile",
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
    createSnapshot: "novelTool:chapter:createSnapshot"
  },
  settings: {
    get: "novelTool:settings:get",
    save: "novelTool:settings:save",
    testConnection: "novelTool:settings:testConnection",
    listModels: "novelTool:settings:listModels"
  },
  ai: {
    createTask: "novelTool:ai:createTask",
    updateTask: "novelTool:ai:updateTask",
    generatePreview: "novelTool:ai:generatePreview",
    applyCandidate: "novelTool:ai:applyCandidate",
    saveCandidateToScratchpad: "novelTool:ai:saveCandidateToScratchpad",
    sendChatMessage: "novelTool:ai:sendChatMessage",
    rejectCandidate: "novelTool:ai:rejectCandidate"
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
  }
} as const;
