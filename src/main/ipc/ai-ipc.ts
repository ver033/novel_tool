import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { AiTaskService } from "../ai/ai-task-service";
import {
  aiApplyCandidateInputSchema,
  aiCancelStreamInputSchema,
  aiClearChatInputSchema,
  aiCreateChatSessionInputSchema,
  aiCreateTaskInputSchema,
  aiDeleteChatSessionInputSchema,
  aiGeneratePreviewInputSchema,
  aiGeneratePreviewStreamInputSchema,
  aiGetChatSessionInputSchema,
  aiListChatSessionsInputSchema,
  aiListChatMessagesInputSchema,
  aiRenameChatSessionInputSchema,
  aiRejectCandidateInputSchema,
  aiSaveCandidateToScratchpadInputSchema,
  aiSendChatMessageInputSchema,
  aiSendChatMessageStreamInputSchema,
  aiUpdateTaskInputSchema
} from "../shared/schemas";
import { ipcChannels } from "../shared/types";
import { createValidatedIpcHandler } from "./register-ipc";

function sendToLiveSender(event: IpcMainInvokeEvent, channel: string, payload: unknown): void {
  if (event.sender.isDestroyed()) {
    return;
  }
  event.sender.send(channel, payload);
}

export function registerAiIpc(aiTaskService: AiTaskService): void {
  ipcMain.handle(ipcChannels.ai.createTask, createValidatedIpcHandler(aiCreateTaskInputSchema, (input) => aiTaskService.createTask(input)));
  ipcMain.handle(ipcChannels.ai.updateTask, createValidatedIpcHandler(aiUpdateTaskInputSchema, (input) => aiTaskService.updateTask(input)));
  ipcMain.handle(ipcChannels.ai.generatePreview, createValidatedIpcHandler(aiGeneratePreviewInputSchema, (input) => aiTaskService.generatePreview(input)));
  ipcMain.handle(
    ipcChannels.ai.generatePreviewStream,
    createValidatedIpcHandler(aiGeneratePreviewStreamInputSchema, (input, event) =>
      aiTaskService.generatePreviewStream(input, {
        onChunk(payload) {
          sendToLiveSender(event, ipcChannels.ai.streamChunk, payload);
        },
        onDone(payload) {
          sendToLiveSender(event, ipcChannels.ai.streamDone, payload);
        },
        onError(payload) {
          sendToLiveSender(event, ipcChannels.ai.streamError, payload);
        }
      })
    )
  );
  ipcMain.handle(
    ipcChannels.ai.continuePreviewStream,
    createValidatedIpcHandler(aiGeneratePreviewStreamInputSchema, (input, event) =>
      aiTaskService.continuePreviewStream(input, {
        onChunk(payload) {
          sendToLiveSender(event, ipcChannels.ai.streamChunk, payload);
        },
        onDone(payload) {
          sendToLiveSender(event, ipcChannels.ai.streamDone, payload);
        },
        onError(payload) {
          sendToLiveSender(event, ipcChannels.ai.streamError, payload);
        }
      })
    )
  );
  ipcMain.handle(ipcChannels.ai.applyCandidate, createValidatedIpcHandler(aiApplyCandidateInputSchema, (input) => aiTaskService.applyCandidate(input)));
  ipcMain.handle(
    ipcChannels.ai.saveCandidateToScratchpad,
    createValidatedIpcHandler(aiSaveCandidateToScratchpadInputSchema, (input) => aiTaskService.saveCandidateToScratchpad(input))
  );
  ipcMain.handle(ipcChannels.ai.sendChatMessage, createValidatedIpcHandler(aiSendChatMessageInputSchema, (input) => aiTaskService.sendChatMessage(input)));
  ipcMain.handle(ipcChannels.ai.getChatSession, createValidatedIpcHandler(aiGetChatSessionInputSchema, (input) => aiTaskService.getChatSession(input)));
  ipcMain.handle(ipcChannels.ai.listChatSessions, createValidatedIpcHandler(aiListChatSessionsInputSchema, (input) => aiTaskService.listChatSessions(input)));
  ipcMain.handle(ipcChannels.ai.createChatSession, createValidatedIpcHandler(aiCreateChatSessionInputSchema, (input) => aiTaskService.createChatSession(input)));
  ipcMain.handle(ipcChannels.ai.renameChatSession, createValidatedIpcHandler(aiRenameChatSessionInputSchema, (input) => aiTaskService.renameChatSession(input)));
  ipcMain.handle(ipcChannels.ai.deleteChatSession, createValidatedIpcHandler(aiDeleteChatSessionInputSchema, (input) => aiTaskService.deleteChatSession(input)));
  ipcMain.handle(ipcChannels.ai.listChatMessages, createValidatedIpcHandler(aiListChatMessagesInputSchema, (input) => aiTaskService.listChatMessages(input)));
  ipcMain.handle(ipcChannels.ai.clearChat, createValidatedIpcHandler(aiClearChatInputSchema, (input) => aiTaskService.clearChat(input)));
  ipcMain.handle(
    ipcChannels.ai.sendChatMessageStream,
    createValidatedIpcHandler(aiSendChatMessageStreamInputSchema, (input, event) =>
      aiTaskService.sendChatMessageStream(input, {
        onChunk(payload) {
          sendToLiveSender(event, ipcChannels.ai.streamChunk, payload);
        },
        onDone(payload) {
          sendToLiveSender(event, ipcChannels.ai.streamDone, payload);
        },
        onError(payload) {
          sendToLiveSender(event, ipcChannels.ai.streamError, payload);
        }
      })
    )
  );
  ipcMain.handle(ipcChannels.ai.cancelStream, createValidatedIpcHandler(aiCancelStreamInputSchema, (input) => aiTaskService.cancelStream(input)));
  ipcMain.handle(ipcChannels.ai.rejectCandidate, createValidatedIpcHandler(aiRejectCandidateInputSchema, (input) => aiTaskService.rejectCandidate(input)));
}
