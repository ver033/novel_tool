import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import path from "node:path";
import { OutlineService } from "../outline/outline-service";
import { allowSelectedOutlineImportFilePath } from "../security/file-access";
import {
  outlineConfirmBulkImportInputSchema,
  outlineCreateEventInputSchema,
  outlineCreateThreadInputSchema,
  outlineClearImportedEventsInputSchema,
  outlineDeleteEventInputSchema,
  outlineDeleteThreadInputSchema,
  outlineGetChapterNoteInputSchema,
  outlineGetOverviewInputSchema,
  outlineImportLegacyChapterNoteInputSchema,
  outlineListEventsInputSchema,
  outlineListThreadsInputSchema,
  outlinePreviewBulkImportInputSchema,
  outlinePreviewImportFileInputSchema,
  outlineReorderEventsInputSchema,
  outlineSaveChapterNoteInputSchema,
  outlineUndoImportBatchInputSchema,
  outlineUpdateEventInputSchema,
  outlineUpdateThreadInputSchema
} from "../shared/schemas";
import { ipcChannels } from "../shared/types";
import { createIpcHandler, createValidatedIpcHandler } from "./register-ipc";

export function registerOutlineIpc(serviceFactory: (projectId: string) => OutlineService): void {
  ipcMain.handle(
    ipcChannels.outline.selectImportFile,
    createIpcHandler(async (event) => {
      const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const options: OpenDialogOptions = {
        title: "选择大纲文件",
        properties: ["openFile"],
        filters: [{ name: "大纲文件", extensions: ["xlsx", "csv"] }]
      };
      const result = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);

      if (result.canceled || !result.filePaths[0]) {
        return null;
      }

      const filePath = allowSelectedOutlineImportFilePath(result.filePaths[0]);
      return {
        filePath,
        fileName: path.basename(filePath)
      };
    })
  );
  ipcMain.handle(
    ipcChannels.outline.getOverview,
    createValidatedIpcHandler(outlineGetOverviewInputSchema, (input) => serviceFactory(input.projectId).getOverview(input))
  );
  ipcMain.handle(
    ipcChannels.outline.listEvents,
    createValidatedIpcHandler(outlineListEventsInputSchema, (input) => serviceFactory(input.projectId).listEvents(input))
  );
  ipcMain.handle(
    ipcChannels.outline.createEvent,
    createValidatedIpcHandler(outlineCreateEventInputSchema, (input) => serviceFactory(input.projectId).createEvent(input))
  );
  ipcMain.handle(
    ipcChannels.outline.updateEvent,
    createValidatedIpcHandler(outlineUpdateEventInputSchema, (input) => serviceFactory(input.projectId).updateEvent(input))
  );
  ipcMain.handle(
    ipcChannels.outline.deleteEvent,
    createValidatedIpcHandler(outlineDeleteEventInputSchema, (input) => serviceFactory(input.projectId).deleteEvent(input))
  );
  ipcMain.handle(
    ipcChannels.outline.reorderEvents,
    createValidatedIpcHandler(outlineReorderEventsInputSchema, (input) => serviceFactory(input.projectId).reorderEvents(input))
  );
  ipcMain.handle(
    ipcChannels.outline.listThreads,
    createValidatedIpcHandler(outlineListThreadsInputSchema, (input) => serviceFactory(input.projectId).listThreads(input))
  );
  ipcMain.handle(
    ipcChannels.outline.createThread,
    createValidatedIpcHandler(outlineCreateThreadInputSchema, (input) => serviceFactory(input.projectId).createThread(input))
  );
  ipcMain.handle(
    ipcChannels.outline.updateThread,
    createValidatedIpcHandler(outlineUpdateThreadInputSchema, (input) => serviceFactory(input.projectId).updateThread(input))
  );
  ipcMain.handle(
    ipcChannels.outline.deleteThread,
    createValidatedIpcHandler(outlineDeleteThreadInputSchema, (input) => serviceFactory(input.projectId).deleteThread(input))
  );
  ipcMain.handle(
    ipcChannels.outline.getChapterNote,
    createValidatedIpcHandler(outlineGetChapterNoteInputSchema, (input) => serviceFactory(input.projectId).getChapterNote(input))
  );
  ipcMain.handle(
    ipcChannels.outline.saveChapterNote,
    createValidatedIpcHandler(outlineSaveChapterNoteInputSchema, (input) => serviceFactory(input.projectId).saveChapterNote(input))
  );
  ipcMain.handle(
    ipcChannels.outline.importLegacyChapterNote,
    createValidatedIpcHandler(outlineImportLegacyChapterNoteInputSchema, (input) => serviceFactory(input.projectId).importLegacyChapterNote(input))
  );
  ipcMain.handle(
    ipcChannels.outline.previewImportFile,
    createValidatedIpcHandler(outlinePreviewImportFileInputSchema, (input) => serviceFactory(input.projectId).previewImportFile(input))
  );
  ipcMain.handle(
    ipcChannels.outline.previewBulkImport,
    createValidatedIpcHandler(outlinePreviewBulkImportInputSchema, (input) => serviceFactory(input.projectId).previewBulkImport(input))
  );
  ipcMain.handle(
    ipcChannels.outline.confirmBulkImport,
    createValidatedIpcHandler(outlineConfirmBulkImportInputSchema, (input) => serviceFactory(input.projectId).confirmBulkImport(input))
  );
  ipcMain.handle(
    ipcChannels.outline.undoImportBatch,
    createValidatedIpcHandler(outlineUndoImportBatchInputSchema, (input) => serviceFactory(input.projectId).undoImportBatch(input))
  );
  ipcMain.handle(
    ipcChannels.outline.clearImportedEvents,
    createValidatedIpcHandler(outlineClearImportedEventsInputSchema, (input) => serviceFactory(input.projectId).clearImportedEvents(input))
  );
}
