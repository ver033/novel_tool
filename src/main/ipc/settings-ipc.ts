import { ipcMain } from "electron";
import { SettingsService } from "../settings/settings-service";
import { settingsListModelsInputSchema, settingsSaveInputSchema, settingsTestConnectionInputSchema } from "../shared/schemas";
import { ipcChannels } from "../shared/types";
import { createValidatedIpcHandler } from "./register-ipc";

export function registerSettingsIpc(settingsService: SettingsService): void {
  ipcMain.handle(ipcChannels.settings.get, () => settingsService.getSettings());
  ipcMain.handle(ipcChannels.settings.save, createValidatedIpcHandler(settingsSaveInputSchema, (input) => settingsService.saveSettings(input)));
  ipcMain.handle(
    ipcChannels.settings.testConnection,
    createValidatedIpcHandler(settingsTestConnectionInputSchema, (input) => settingsService.testConnection(input))
  );
  ipcMain.handle(
    ipcChannels.settings.listModels,
    createValidatedIpcHandler(settingsListModelsInputSchema, (input) => settingsService.listOpenRouterModels(input))
  );
}
