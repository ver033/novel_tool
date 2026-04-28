import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import { ProjectService } from "../project/project-service";
import { projectCreateInputSchema, projectDeleteInputSchema, projectOpenFileInputSchema, projectOpenInputSchema, projectRenameInputSchema } from "../shared/schemas";
import { ipcChannels } from "../shared/types";
import { createValidatedIpcHandler } from "./register-ipc";

export function registerProjectIpc(projectService: ProjectService): void {
  ipcMain.handle(
    ipcChannels.project.createProject,
    createValidatedIpcHandler(projectCreateInputSchema, (input) => projectService.createProject(input))
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
      filePath: result.filePaths[0]
    };
  });
  ipcMain.handle(
    ipcChannels.project.openProjectFile,
    createValidatedIpcHandler(projectOpenFileInputSchema, (input) => projectService.openProjectFile(input))
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
