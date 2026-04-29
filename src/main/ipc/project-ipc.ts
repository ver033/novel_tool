import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import path from "node:path";
import { ProjectService } from "../project/project-service";
import { allowSelectedProjectFilePath, assertSelectedProjectFilePathAllowed } from "../security/file-access";
import {
  projectCreateInputSchema,
  projectDeleteInputSchema,
  projectOpenFileInputSchema,
  projectOpenInputSchema,
  projectRenameInputSchema,
  projectSelectSavePathInputSchema,
  projectSuggestFilePathInputSchema
} from "../shared/schemas";
import { ipcChannels } from "../shared/types";
import { createValidatedIpcHandler } from "./register-ipc";

function ensureProjectFileExtension(filePath: string): string {
  return filePath.endsWith(".noveltool") ? filePath : `${filePath}.noveltool`;
}

export function registerProjectIpc(projectService: ProjectService): void {
  ipcMain.handle(
    ipcChannels.project.createProject,
    createValidatedIpcHandler(projectCreateInputSchema, (input) =>
      projectService.createProject({
        ...input,
        rootPath: input.rootPath ? assertSelectedProjectFilePathAllowed(input.rootPath) : input.rootPath
      })
    )
  );
  ipcMain.handle(ipcChannels.project.openProject, createValidatedIpcHandler(projectOpenInputSchema, (input) => projectService.openProject(input)));
  ipcMain.handle(ipcChannels.project.selectProjectFile, async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options: OpenDialogOptions = {
      title: "选择墨枢项目文件",
      properties: ["openFile"],
      filters: [{ name: "墨枢项目文件", extensions: ["noveltool"] }]
    };
    const result = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    return {
      filePath: allowSelectedProjectFilePath(result.filePaths[0])
    };
  });
  ipcMain.handle(
    ipcChannels.project.selectProjectSavePath,
    createValidatedIpcHandler(projectSelectSavePathInputSchema, async (input, event) => {
      const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const suggestedName = input.suggestedName ?? "我的小说";
      const options: SaveDialogOptions = {
        title: "选择墨枢项目文件保存位置",
        defaultPath: projectService.getSuggestedProjectFilePath(suggestedName),
        filters: [{ name: "墨枢项目文件", extensions: ["noveltool"] }]
      };
      const result = parentWindow ? await dialog.showSaveDialog(parentWindow, options) : await dialog.showSaveDialog(options);

      if (result.canceled || !result.filePath) {
        return null;
      }

      return {
        filePath: allowSelectedProjectFilePath(path.resolve(ensureProjectFileExtension(result.filePath)))
      };
    })
  );
  ipcMain.handle(
    ipcChannels.project.suggestProjectPath,
    createValidatedIpcHandler(projectSuggestFilePathInputSchema, (input) => ({
      filePath: projectService.getSuggestedProjectFilePath(input.suggestedName ?? "我的小说")
    }))
  );
  ipcMain.handle(
    ipcChannels.project.openProjectFile,
    createValidatedIpcHandler(projectOpenFileInputSchema, (input) =>
      projectService.openProjectFile({
        filePath: assertSelectedProjectFilePathAllowed(input.filePath)
      })
    )
  );
  ipcMain.handle(
    ipcChannels.project.renameProject,
    createValidatedIpcHandler(projectRenameInputSchema, (input) => projectService.renameProject(input))
  );
  ipcMain.handle(
    ipcChannels.project.deleteProject,
    createValidatedIpcHandler(projectDeleteInputSchema, (input) => projectService.deleteProject(input))
  );
  ipcMain.handle(ipcChannels.project.getCurrentProject, () => projectService.getCurrentProject());
  ipcMain.handle(ipcChannels.project.listRecentProjects, () => projectService.listRecentProjects());
}
