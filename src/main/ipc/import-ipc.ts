import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import { TxtImporter } from "../import/txt-importer";
import { allowSelectedTxtFilePath, assertSelectedTxtFilePathAllowed } from "../security/file-access";
import { importConfirmTxtInputSchema, importPreviewTxtInputSchema, importUpdatePreviewInputSchema } from "../shared/schemas";
import { ipcChannels } from "../shared/types";
import { createValidatedIpcHandler } from "./register-ipc";

export function registerImportIpc(txtImporter: TxtImporter): void {
  ipcMain.handle(ipcChannels.import.selectTxtFile, async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options: OpenDialogOptions = {
      title: "选择 TXT 小说文件",
      properties: ["openFile"],
      filters: [{ name: "TXT 文本文件", extensions: ["txt"] }]
    };
    const result = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    return {
      filePath: allowSelectedTxtFilePath(result.filePaths[0])
    };
  });
  ipcMain.handle(
    ipcChannels.import.previewTxt,
    createValidatedIpcHandler(importPreviewTxtInputSchema, (input) =>
      txtImporter.previewTxt({
        filePath: assertSelectedTxtFilePathAllowed(input.filePath)
      })
    )
  );
  ipcMain.handle(ipcChannels.import.updatePreview, createValidatedIpcHandler(importUpdatePreviewInputSchema, (input) => txtImporter.updatePreview(input)));
  ipcMain.handle(ipcChannels.import.confirmTxtImport, createValidatedIpcHandler(importConfirmTxtInputSchema, (input) => txtImporter.confirmTxtImport(input)));
}
