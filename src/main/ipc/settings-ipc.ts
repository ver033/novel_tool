import { ipcMain } from "electron";
import { SettingsService } from "../settings/settings-service";
import { settingsListModelsInputSchema, settingsSaveInputSchema, settingsTestConnectionInputSchema, startupLaunchUpdateInputSchema } from "../shared/schemas";
import { ipcChannels } from "../shared/types";
import type { StartupLaunchService } from "../startup/startup-launch-service";
import { createIpcHandler, createValidatedIpcHandler } from "./register-ipc";

export function registerSettingsIpc(settingsService: SettingsService, startupLaunchService: StartupLaunchService): void {
  ipcMain.handle(ipcChannels.settings.get, createIpcHandler(() => settingsService.getSettings()));
  ipcMain.handle(ipcChannels.settings.save, createValidatedIpcHandler(settingsSaveInputSchema, (input) => settingsService.saveSettings(input)));
  ipcMain.handle(
    ipcChannels.settings.testConnection,
    createValidatedIpcHandler(settingsTestConnectionInputSchema, (input) => settingsService.testConnection(input))
  );
  ipcMain.handle(
    ipcChannels.settings.listModels,
    createValidatedIpcHandler(settingsListModelsInputSchema, (input) => settingsService.listAiModels(input))
  );
  ipcMain.handle(ipcChannels.startupLaunch.getStatus, createIpcHandler(() => startupLaunchService.getStatus()));
  ipcMain.handle(
    ipcChannels.startupLaunch.updateSettings,
    createValidatedIpcHandler(startupLaunchUpdateInputSchema, (input) => startupLaunchService.setEnabled(input.enabled))
  );
}
