import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";
import { createId } from "../shared/ids";
import {
  externalBookSyncCancelScanInputSchema,
  externalBookSyncClearSentHistoryInputSchema,
  externalBookSyncForgetSourceInputSchema,
  externalBookSyncPreviewCandidateInputSchema,
  externalBookSyncScanInputSchema,
  externalBookSyncSendToAiInputSchema,
  externalBookSyncStatusInputSchema
} from "../shared/schemas";
import { ipcChannels } from "../shared/types";
import type { ExternalBookSyncService } from "../external-book-sync/external-book-sync-service";
import { createIpcHandler, createValidatedIpcHandler } from "./register-ipc";

function sendToLiveSender(event: IpcMainInvokeEvent, channel: string, payload: unknown): void {
  if (event.sender.isDestroyed()) {
    return;
  }
  event.sender.send(channel, payload);
}

export function registerExternalBookSyncIpc(service: ExternalBookSyncService): void {
  const activeScans = new Map<string, AbortController>();

  ipcMain.handle(ipcChannels.externalBookSync.getStatus, createValidatedIpcHandler(externalBookSyncStatusInputSchema, (input) => service.getStatus(input.projectId)));

  ipcMain.handle(
    ipcChannels.externalBookSync.scan,
    createValidatedIpcHandler(externalBookSyncScanInputSchema, async (input, event) => {
      const requestId = input.requestId ?? createId("external_book_scan");
      const controller = new AbortController();
      activeScans.set(requestId, controller);
      try {
        const result = await service.scanProject(input, {
          signal: controller.signal,
          onProgress(progress) {
            sendToLiveSender(event, ipcChannels.externalBookSync.scanProgress, {
              requestId,
              ...progress
            });
          }
        });
        const payload = {
          requestId,
          ...result
        };
        sendToLiveSender(event, ipcChannels.externalBookSync.scanDone, payload);
        return payload;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        sendToLiveSender(event, ipcChannels.externalBookSync.scanError, {
          requestId,
          error: message
        });
        throw reason;
      } finally {
        activeScans.delete(requestId);
      }
    })
  );

  ipcMain.handle(
    ipcChannels.externalBookSync.cancelScan,
    createValidatedIpcHandler(externalBookSyncCancelScanInputSchema, (input) => {
      activeScans.get(input.requestId)?.abort();
      activeScans.delete(input.requestId);
      return { ok: true };
    })
  );

  ipcMain.handle(ipcChannels.externalBookSync.selectDirectory, createIpcHandler(async (event) => {
    const options: OpenDialogOptions = {
      properties: ["openDirectory"],
      title: "选择包含项目同名文件夹的位置"
    };
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return {
      directoryPath: result.filePaths[0]
    };
  }));

  ipcMain.handle(
    ipcChannels.externalBookSync.previewCandidate,
    createValidatedIpcHandler(externalBookSyncPreviewCandidateInputSchema, (input) => service.previewCandidate(input.projectId, input.candidateId))
  );
  ipcMain.handle(
    ipcChannels.externalBookSync.sendMissingChaptersToAi,
    createValidatedIpcHandler(externalBookSyncSendToAiInputSchema, (input) => service.sendMissingChaptersToAi(input))
  );
  ipcMain.handle(
    ipcChannels.externalBookSync.forgetSource,
    createValidatedIpcHandler(externalBookSyncForgetSourceInputSchema, (input) => service.forgetSource(input.projectId, input.sourceId))
  );
  ipcMain.handle(
    ipcChannels.externalBookSync.clearSentHistory,
    createValidatedIpcHandler(externalBookSyncClearSentHistoryInputSchema, (input) => service.clearSentHistory(input.projectId))
  );
}
