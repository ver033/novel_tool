import { ipcMain } from "electron";
import { relationshipGraphGetInputSchema, relationshipGraphSourceStatusInputSchema } from "../shared/schemas";
import { ipcChannels, type RelationshipGraphGetInput, type RelationshipGraphSourceStatusInput } from "../shared/types";
import { createValidatedIpcHandler } from "./register-ipc";

export type RelationshipGraphIpcService = {
  readonly getGraph: (input: RelationshipGraphGetInput) => unknown;
  readonly getSourceStatus: (input: RelationshipGraphSourceStatusInput) => unknown;
};

export function registerRelationshipGraphIpc(serviceFactory: (projectId: string) => RelationshipGraphIpcService): void {
  ipcMain.handle(
    ipcChannels.relationshipGraph.getGraph,
    createValidatedIpcHandler(relationshipGraphGetInputSchema, (input) => serviceFactory(input.projectId).getGraph(input))
  );
  ipcMain.handle(
    ipcChannels.relationshipGraph.getSourceStatus,
    createValidatedIpcHandler(relationshipGraphSourceStatusInputSchema, (input) => serviceFactory(input.projectId).getSourceStatus(input))
  );
}
