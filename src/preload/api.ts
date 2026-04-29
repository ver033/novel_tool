import { ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  AiApplyCandidateInput,
  AiCancelStreamInput,
  AiClearChatInput,
  AiCreateChatSessionInput,
  AiCreateTaskInput,
  AiDeleteChatSessionInput,
  AiGeneratePreviewInput,
  AiGeneratePreviewStreamInput,
  AiGetChatSessionInput,
  AiListChatSessionsInput,
  AiListChatMessagesInput,
  AiRenameChatSessionInput,
  AiRejectCandidateInput,
  AiSaveCandidateToScratchpadInput,
  AiSendChatMessageInput,
  AiSendChatMessageStreamInput,
  AiStreamChunkEvent,
  AiStreamDoneEvent,
  AiStreamErrorEvent,
  AiUpdateTaskInput,
  ChapterCreateInput,
  ChapterCreateSnapshotInput,
  ChapterDeleteInput,
  ChapterGetContentInput,
  ChapterListInput,
  ChapterRenameInput,
  ChapterSaveContentInput,
  ChapterUpdateTargetWordCountInput,
  ImportConfirmTxtInput,
  ImportPreviewTxtInput,
  ImportUpdatePreviewInput,
  ProjectDeleteInput,
  ProjectOpenFileInput,
  ProjectOpenInput,
  ProjectCreateInput,
  ProjectRenameInput,
  ProjectSelectSavePathInput,
  ProjectSuggestFilePathInput,
  ScratchCreateInput,
  ScratchDeleteInput,
  ScratchListInput,
  ScratchUpdateInput,
  SettingsListModelsInput,
  SettingsSaveInput,
  SettingsTestConnectionInput
} from "../main/shared/types";
import { ipcChannels } from "../main/shared/types";

type AiStreamHandlers = {
  readonly onChunk?: (event: AiStreamChunkEvent) => void;
  readonly onDone?: (event: AiStreamDoneEvent) => void;
  readonly onError?: (event: AiStreamErrorEvent) => void;
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
  readonly ai: {
    readonly createTask: (input: AiCreateTaskInput) => Promise<unknown>;
    readonly updateTask: (input: AiUpdateTaskInput) => Promise<unknown>;
    readonly generatePreview: (input: AiGeneratePreviewInput) => Promise<unknown>;
    readonly generatePreviewStream: (input: AiGeneratePreviewStreamInput) => Promise<unknown>;
    readonly continuePreviewStream: (input: AiGeneratePreviewStreamInput) => Promise<unknown>;
    readonly applyCandidate: (input: AiApplyCandidateInput) => Promise<unknown>;
    readonly saveCandidateToScratchpad: (input: AiSaveCandidateToScratchpadInput) => Promise<unknown>;
    readonly sendChatMessage: (input: AiSendChatMessageInput) => Promise<unknown>;
    readonly getChatSession: (input: AiGetChatSessionInput) => Promise<unknown>;
    readonly listChatSessions: (input: AiListChatSessionsInput) => Promise<unknown>;
    readonly createChatSession: (input: AiCreateChatSessionInput) => Promise<unknown>;
    readonly renameChatSession: (input: AiRenameChatSessionInput) => Promise<unknown>;
    readonly deleteChatSession: (input: AiDeleteChatSessionInput) => Promise<unknown>;
    readonly listChatMessages: (input: AiListChatMessagesInput) => Promise<unknown>;
    readonly clearChat: (input: AiClearChatInput) => Promise<unknown>;
    readonly sendChatMessageStream: (input: AiSendChatMessageStreamInput) => Promise<unknown>;
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
  ai: Object.freeze({
    createTask: (input: AiCreateTaskInput) => ipcRenderer.invoke(ipcChannels.ai.createTask, input),
    updateTask: (input: AiUpdateTaskInput) => ipcRenderer.invoke(ipcChannels.ai.updateTask, input),
    generatePreview: (input: AiGeneratePreviewInput) => ipcRenderer.invoke(ipcChannels.ai.generatePreview, input),
    generatePreviewStream: (input: AiGeneratePreviewStreamInput) => ipcRenderer.invoke(ipcChannels.ai.generatePreviewStream, input),
    continuePreviewStream: (input: AiGeneratePreviewStreamInput) => ipcRenderer.invoke(ipcChannels.ai.continuePreviewStream, input),
    applyCandidate: (input: AiApplyCandidateInput) => ipcRenderer.invoke(ipcChannels.ai.applyCandidate, input),
    saveCandidateToScratchpad: (input: AiSaveCandidateToScratchpadInput) => ipcRenderer.invoke(ipcChannels.ai.saveCandidateToScratchpad, input),
    sendChatMessage: (input: AiSendChatMessageInput) => ipcRenderer.invoke(ipcChannels.ai.sendChatMessage, input),
    getChatSession: (input: AiGetChatSessionInput) => ipcRenderer.invoke(ipcChannels.ai.getChatSession, input),
    listChatSessions: (input: AiListChatSessionsInput) => ipcRenderer.invoke(ipcChannels.ai.listChatSessions, input),
    createChatSession: (input: AiCreateChatSessionInput) => ipcRenderer.invoke(ipcChannels.ai.createChatSession, input),
    renameChatSession: (input: AiRenameChatSessionInput) => ipcRenderer.invoke(ipcChannels.ai.renameChatSession, input),
    deleteChatSession: (input: AiDeleteChatSessionInput) => ipcRenderer.invoke(ipcChannels.ai.deleteChatSession, input),
    listChatMessages: (input: AiListChatMessagesInput) => ipcRenderer.invoke(ipcChannels.ai.listChatMessages, input),
    clearChat: (input: AiClearChatInput) => ipcRenderer.invoke(ipcChannels.ai.clearChat, input),
    sendChatMessageStream: (input: AiSendChatMessageStreamInput) => ipcRenderer.invoke(ipcChannels.ai.sendChatMessageStream, input),
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
      const onError = (_event: IpcRendererEvent, payload: AiStreamErrorEvent) => {
        if (payload.requestId === requestId) {
          handlers.onError?.(payload);
        }
      };
      ipcRenderer.on(ipcChannels.ai.streamChunk, onChunk);
      ipcRenderer.on(ipcChannels.ai.streamDone, onDone);
      ipcRenderer.on(ipcChannels.ai.streamError, onError);
      return () => {
        ipcRenderer.off(ipcChannels.ai.streamChunk, onChunk);
        ipcRenderer.off(ipcChannels.ai.streamDone, onDone);
        ipcRenderer.off(ipcChannels.ai.streamError, onError);
        void ipcRenderer.invoke(ipcChannels.ai.cancelStream, { requestId });
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
  })
});
