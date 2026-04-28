import { ipcMain } from "electron";
import { AiTaskService } from "../ai/ai-task-service";
import {
  aiApplyCandidateInputSchema,
  aiCreateTaskInputSchema,
  aiGeneratePreviewInputSchema,
  aiRejectCandidateInputSchema,
  aiSaveCandidateToScratchpadInputSchema,
  aiSendChatMessageInputSchema,
  aiUpdateTaskInputSchema
} from "../shared/schemas";
import { ipcChannels } from "../shared/types";
import { createValidatedIpcHandler } from "./register-ipc";

export function registerAiIpc(aiTaskService: AiTaskService): void {
  ipcMain.handle(ipcChannels.ai.createTask, createValidatedIpcHandler(aiCreateTaskInputSchema, (input) => aiTaskService.createTask(input)));
  ipcMain.handle(ipcChannels.ai.updateTask, createValidatedIpcHandler(aiUpdateTaskInputSchema, (input) => aiTaskService.updateTask(input)));
  ipcMain.handle(ipcChannels.ai.generatePreview, createValidatedIpcHandler(aiGeneratePreviewInputSchema, (input) => aiTaskService.generatePreview(input)));
  ipcMain.handle(ipcChannels.ai.applyCandidate, createValidatedIpcHandler(aiApplyCandidateInputSchema, (input) => aiTaskService.applyCandidate(input)));
  ipcMain.handle(
    ipcChannels.ai.saveCandidateToScratchpad,
    createValidatedIpcHandler(aiSaveCandidateToScratchpadInputSchema, (input) => aiTaskService.saveCandidateToScratchpad(input))
  );
  ipcMain.handle(ipcChannels.ai.sendChatMessage, createValidatedIpcHandler(aiSendChatMessageInputSchema, (input) => aiTaskService.sendChatMessage(input)));
  ipcMain.handle(ipcChannels.ai.rejectCandidate, createValidatedIpcHandler(aiRejectCandidateInputSchema, (input) => aiTaskService.rejectCandidate(input)));
}
