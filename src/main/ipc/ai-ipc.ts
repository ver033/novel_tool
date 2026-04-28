import { ipcMain } from "electron";
import { AiTaskService } from "../ai/ai-task-service";
import {
  aiApplyCandidateInputSchema,
  aiClearChatInputSchema,
  aiCreateTaskInputSchema,
  aiGeneratePreviewInputSchema,
  aiGeneratePreviewStreamInputSchema,
  aiGetChatSessionInputSchema,
  aiListChatMessagesInputSchema,
  aiRejectCandidateInputSchema,
  aiSaveCandidateToScratchpadInputSchema,
  aiSendChatMessageInputSchema,
  aiSendChatMessageStreamInputSchema,
  aiUpdateTaskInputSchema
} from "../shared/schemas";
import { ipcChannels } from "../shared/types";
import { createValidatedIpcHandler } from "./register-ipc";

export function registerAiIpc(aiTaskService: AiTaskService): void {
  ipcMain.handle(ipcChannels.ai.createTask, createValidatedIpcHandler(aiCreateTaskInputSchema, (input) => aiTaskService.createTask(input)));
  ipcMain.handle(ipcChannels.ai.updateTask, createValidatedIpcHandler(aiUpdateTaskInputSchema, (input) => aiTaskService.updateTask(input)));
  ipcMain.handle(ipcChannels.ai.generatePreview, createValidatedIpcHandler(aiGeneratePreviewInputSchema, (input) => aiTaskService.generatePreview(input)));
  ipcMain.handle(
    ipcChannels.ai.generatePreviewStream,
    createValidatedIpcHandler(aiGeneratePreviewStreamInputSchema, (input, event) =>
      aiTaskService.generatePreviewStream(input, {
        onChunk(payload) {
          event.sender.send(ipcChannels.ai.streamChunk, payload);
        },
        onDone(payload) {
          event.sender.send(ipcChannels.ai.streamDone, payload);
        },
        onError(payload) {
          event.sender.send(ipcChannels.ai.streamError, payload);
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
  ipcMain.handle(ipcChannels.ai.listChatMessages, createValidatedIpcHandler(aiListChatMessagesInputSchema, (input) => aiTaskService.listChatMessages(input)));
  ipcMain.handle(ipcChannels.ai.clearChat, createValidatedIpcHandler(aiClearChatInputSchema, (input) => aiTaskService.clearChat(input)));
  ipcMain.handle(
    ipcChannels.ai.sendChatMessageStream,
    createValidatedIpcHandler(aiSendChatMessageStreamInputSchema, (input, event) =>
      aiTaskService.sendChatMessageStream(input, {
        onChunk(payload) {
          event.sender.send(ipcChannels.ai.streamChunk, payload);
        },
        onDone(payload) {
          event.sender.send(ipcChannels.ai.streamDone, payload);
        },
        onError(payload) {
          event.sender.send(ipcChannels.ai.streamError, payload);
        }
      })
    )
  );
  ipcMain.handle(ipcChannels.ai.rejectCandidate, createValidatedIpcHandler(aiRejectCandidateInputSchema, (input) => aiTaskService.rejectCandidate(input)));
}
