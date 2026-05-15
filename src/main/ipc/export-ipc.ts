import { BrowserWindow, dialog, ipcMain, type SaveDialogOptions } from "electron";
import path from "node:path";
import { ShareableProjectExporter } from "../export/shareable-project-exporter";
import { TxtExporter } from "../export/txt-exporter";
import {
  allowSelectedProjectExportFilePath,
  allowSelectedTxtExportFilePath,
  assertSelectedProjectExportFilePathAllowed,
  assertSelectedTxtExportFilePathAllowed
} from "../security/file-access";
import {
  exportSelectShareableProjectFilePathInputSchema,
  exportSelectTxtFilePathInputSchema,
  exportShareableProjectCopyInputSchema,
  exportTxtInputSchema
} from "../shared/schemas";
import { ipcChannels } from "../shared/types";
import { createValidatedIpcHandler } from "./register-ipc";

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim() || "未命名小说";
}

function ensureTxtExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase() === ".txt" ? filePath : `${filePath}.txt`;
}

function ensureProjectExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase() === ".noveltool" ? filePath : `${filePath}.noveltool`;
}

export function registerExportIpc(txtExporter: TxtExporter, shareableProjectExporter: ShareableProjectExporter): void {
  ipcMain.handle(
    ipcChannels.export.selectTxtFilePath,
    createValidatedIpcHandler(exportSelectTxtFilePathInputSchema, async (input, event) => {
      const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const options: SaveDialogOptions = {
        title: "导出 TXT",
        defaultPath: `${sanitizeFileName(input.suggestedName ?? "未命名小说")}.txt`,
        filters: [{ name: "TXT 文本文件", extensions: ["txt"] }]
      };
      const result = parentWindow ? await dialog.showSaveDialog(parentWindow, options) : await dialog.showSaveDialog(options);

      if (result.canceled || !result.filePath) {
        return null;
      }

      return {
        filePath: allowSelectedTxtExportFilePath(ensureTxtExtension(result.filePath))
      };
    })
  );
  ipcMain.handle(
    ipcChannels.export.selectShareableProjectFilePath,
    createValidatedIpcHandler(exportSelectShareableProjectFilePathInputSchema, async (input, event) => {
      const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const options: SaveDialogOptions = {
        title: "导出可分享副本",
        defaultPath: `${sanitizeFileName(input.suggestedName ?? "未命名小说")}-可分享副本.noveltool`,
        filters: [{ name: "墨枢项目文件", extensions: ["noveltool"] }]
      };
      const result = parentWindow ? await dialog.showSaveDialog(parentWindow, options) : await dialog.showSaveDialog(options);

      if (result.canceled || !result.filePath) {
        return null;
      }

      return {
        filePath: allowSelectedProjectExportFilePath(ensureProjectExtension(result.filePath))
      };
    })
  );
  ipcMain.handle(
    ipcChannels.export.exportTxt,
    createValidatedIpcHandler(exportTxtInputSchema, (input) =>
      txtExporter.exportTxt({
        ...input,
        filePath: assertSelectedTxtExportFilePathAllowed(input.filePath)
      })
    )
  );
  ipcMain.handle(
    ipcChannels.export.exportShareableProjectCopy,
    createValidatedIpcHandler(exportShareableProjectCopyInputSchema, (input) =>
      shareableProjectExporter.exportShareableProjectCopy({
        ...input,
        filePath: assertSelectedProjectExportFilePathAllowed(input.filePath)
      })
    )
  );
}
