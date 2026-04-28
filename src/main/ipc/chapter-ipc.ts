import { ipcMain } from "electron";
import { ChapterService } from "../chapter/chapter-service";
import {
  chapterCreateInputSchema,
  chapterCreateSnapshotInputSchema,
  chapterDeleteInputSchema,
  chapterGetContentInputSchema,
  chapterListInputSchema,
  chapterRenameInputSchema,
  chapterSaveContentInputSchema
} from "../shared/schemas";
import { ipcChannels } from "../shared/types";
import { createValidatedIpcHandler } from "./register-ipc";

export function registerChapterIpc(chapterService: ChapterService): void {
  ipcMain.handle(ipcChannels.chapter.list, createValidatedIpcHandler(chapterListInputSchema, (input) => chapterService.listChapters(input)));
  ipcMain.handle(ipcChannels.chapter.create, createValidatedIpcHandler(chapterCreateInputSchema, (input) => chapterService.createChapter(input)));
  ipcMain.handle(ipcChannels.chapter.rename, createValidatedIpcHandler(chapterRenameInputSchema, (input) => chapterService.renameChapter(input)));
  ipcMain.handle(ipcChannels.chapter.delete, createValidatedIpcHandler(chapterDeleteInputSchema, (input) => chapterService.deleteChapter(input)));
  ipcMain.handle(ipcChannels.chapter.getContent, createValidatedIpcHandler(chapterGetContentInputSchema, (input) => chapterService.getContent(input)));
  ipcMain.handle(ipcChannels.chapter.saveContent, createValidatedIpcHandler(chapterSaveContentInputSchema, (input) => chapterService.saveContent(input)));
  ipcMain.handle(
    ipcChannels.chapter.createSnapshot,
    createValidatedIpcHandler(chapterCreateSnapshotInputSchema, (input) => chapterService.createSnapshot(input))
  );
}
