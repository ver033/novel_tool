import { ipcMain } from "electron";
import { usageAnalyticsRecordEventInputSchema, usageAnalyticsUpdateSettingsInputSchema } from "../shared/schemas";
import { ipcChannels } from "../shared/types";
import type { UsageAnalyticsService } from "../usage/usage-analytics-service";
import { createIpcHandler, createValidatedIpcHandler } from "./register-ipc";

function parseOptionalDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("使用统计事件时间无效。");
  }
  return date;
}

export function registerUsageAnalyticsIpc(service: UsageAnalyticsService): void {
  ipcMain.handle(ipcChannels.usageAnalytics.getStatus, createIpcHandler(() => service.getStatus()));
  ipcMain.handle(
    ipcChannels.usageAnalytics.updateSettings,
    createValidatedIpcHandler(usageAnalyticsUpdateSettingsInputSchema, (input) => service.updateSettings(input))
  );
  ipcMain.handle(
    ipcChannels.usageAnalytics.recordEvent,
    createValidatedIpcHandler(usageAnalyticsRecordEventInputSchema, (input) =>
      service.recordEvent({
        eventType: input.eventType,
        feature: input.feature,
        durationMs: input.durationMs,
        occurredAt: parseOptionalDate(input.occurredAt)
      })
    )
  );
  ipcMain.handle(ipcChannels.usageAnalytics.sendReportNow, createIpcHandler(() => service.sendReportNow()));
}
