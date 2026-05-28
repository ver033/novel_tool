import { ipcMain } from "electron";
import type { ChapterReviewService } from "../chapter-review/chapter-review-service";
import {
  chapterReviewDeleteRunInputSchema,
  chapterReviewGetRunInputSchema,
  chapterReviewListRunsInputSchema,
  chapterReviewStartInputSchema
} from "../shared/schemas";
import { ipcChannels } from "../shared/types";
import { createValidatedIpcHandler } from "./register-ipc";

export function registerChapterReviewIpc(service: ChapterReviewService): void {
  ipcMain.handle(
    ipcChannels.chapterReview.startReview,
    createValidatedIpcHandler(chapterReviewStartInputSchema, (input, event) =>
      service.startReview(input, (progress) => {
        event.sender.send(ipcChannels.chapterReview.progress, progress);
      })
    )
  );
  ipcMain.handle(
    ipcChannels.chapterReview.listRuns,
    createValidatedIpcHandler(chapterReviewListRunsInputSchema, (input) => service.listRuns(input))
  );
  ipcMain.handle(
    ipcChannels.chapterReview.getRun,
    createValidatedIpcHandler(chapterReviewGetRunInputSchema, (input) => service.getRun(input))
  );
  ipcMain.handle(
    ipcChannels.chapterReview.deleteRun,
    createValidatedIpcHandler(chapterReviewDeleteRunInputSchema, (input) => {
      service.deleteRun(input);
      return { ok: true };
    })
  );
}
