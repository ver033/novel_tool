import { ipcMain } from "electron";
import { ScratchNoteRepository } from "../db/repositories/scratch-note-repo";
import {
  scratchCreateInputSchema,
  scratchDeleteInputSchema,
  scratchListInputSchema,
  scratchUpdateInputSchema
} from "../shared/schemas";
import { ipcChannels } from "../shared/types";
import { createValidatedIpcHandler } from "./register-ipc";

type ScratchRepositoryResolver = (projectId?: string) => ScratchNoteRepository;

export function registerScratchIpc(scratchRepo: ScratchNoteRepository | ScratchRepositoryResolver): void {
  const resolveScratchRepo: ScratchRepositoryResolver = typeof scratchRepo === "function" ? scratchRepo : () => scratchRepo;

  ipcMain.handle(ipcChannels.scratch.list, createValidatedIpcHandler(scratchListInputSchema, (input) => resolveScratchRepo(input.projectId).list(input)));
  ipcMain.handle(
    ipcChannels.scratch.create,
    createValidatedIpcHandler(scratchCreateInputSchema, (input) =>
      resolveScratchRepo(input.projectId).create({
        projectId: input.projectId,
        chapterId: input.chapterId ?? null,
        content: input.content,
        pinned: input.pinned ?? false,
        sourceTaskId: input.sourceTaskId ?? null
      })
    )
  );
  ipcMain.handle(
    ipcChannels.scratch.update,
    createValidatedIpcHandler(scratchUpdateInputSchema, (input) => resolveScratchRepo(input.projectId).update(input))
  );
  ipcMain.handle(
    ipcChannels.scratch.delete,
    createValidatedIpcHandler(scratchDeleteInputSchema, (input) => resolveScratchRepo(input.projectId).delete(input))
  );
}
