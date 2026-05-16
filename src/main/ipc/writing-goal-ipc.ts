import { ipcMain } from "electron";
import {
  writingGoalCreateInputSchema,
  writingGoalDayDetailInputSchema,
  writingGoalListDailyStatsInputSchema,
  writingGoalOverviewInputSchema,
  writingGoalStatusInputSchema,
  writingGoalUpdateInputSchema
} from "../shared/schemas";
import {
  ipcChannels,
  type WritingGoalCreateInput,
  type WritingGoalDayDetailInput,
  type WritingGoalListDailyStatsInput,
  type WritingGoalOverviewInput,
  type WritingGoalStatusInput,
  type WritingGoalUpdateInput
} from "../shared/types";
import { createValidatedIpcHandler } from "./register-ipc";

export type WritingGoalIpcService = {
  readonly getOverview: (input: WritingGoalOverviewInput) => unknown;
  readonly createGoal: (input: WritingGoalCreateInput) => unknown;
  readonly updateGoal: (input: WritingGoalUpdateInput) => unknown;
  readonly pauseGoal: (input: WritingGoalStatusInput) => unknown;
  readonly resumeGoal: (input: WritingGoalStatusInput) => unknown;
  readonly archiveGoal: (input: WritingGoalStatusInput) => unknown;
  readonly listDailyStats: (input: WritingGoalListDailyStatsInput) => unknown;
  readonly getDayDetail: (input: WritingGoalDayDetailInput) => unknown;
};

export function registerWritingGoalIpc(serviceFactory: (projectId: string) => WritingGoalIpcService): void {
  ipcMain.handle(
    ipcChannels.writingGoals.getOverview,
    createValidatedIpcHandler(writingGoalOverviewInputSchema, (input) => serviceFactory(input.projectId).getOverview(input))
  );
  ipcMain.handle(
    ipcChannels.writingGoals.createGoal,
    createValidatedIpcHandler(writingGoalCreateInputSchema, (input) => serviceFactory(input.projectId).createGoal(input))
  );
  ipcMain.handle(
    ipcChannels.writingGoals.updateGoal,
    createValidatedIpcHandler(writingGoalUpdateInputSchema, (input) => serviceFactory(input.projectId).updateGoal(input))
  );
  ipcMain.handle(
    ipcChannels.writingGoals.pauseGoal,
    createValidatedIpcHandler(writingGoalStatusInputSchema, (input) => serviceFactory(input.projectId).pauseGoal(input))
  );
  ipcMain.handle(
    ipcChannels.writingGoals.resumeGoal,
    createValidatedIpcHandler(writingGoalStatusInputSchema, (input) => serviceFactory(input.projectId).resumeGoal(input))
  );
  ipcMain.handle(
    ipcChannels.writingGoals.archiveGoal,
    createValidatedIpcHandler(writingGoalStatusInputSchema, (input) => serviceFactory(input.projectId).archiveGoal(input))
  );
  ipcMain.handle(
    ipcChannels.writingGoals.listDailyStats,
    createValidatedIpcHandler(writingGoalListDailyStatsInputSchema, (input) => serviceFactory(input.projectId).listDailyStats(input))
  );
  ipcMain.handle(
    ipcChannels.writingGoals.getDayDetail,
    createValidatedIpcHandler(writingGoalDayDetailInputSchema, (input) => serviceFactory(input.projectId).getDayDetail(input))
  );
}
