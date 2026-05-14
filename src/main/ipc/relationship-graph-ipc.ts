import { ipcMain } from "electron";
import {
  relationshipGraphGetInputSchema,
  relationshipGraphRebuildInputSchema,
  relationshipGraphStatusInputSchema
} from "../shared/schemas";
import { ipcChannels, type RelationshipGraphGetInput, type RelationshipGraphRebuildInput, type RelationshipGraphStatusInput } from "../shared/types";
import { createValidatedIpcHandler } from "./register-ipc";

export type RelationshipGraphIpcService = {
  readonly getGraph: (input: RelationshipGraphGetInput) => unknown;
  readonly getStatus: (input: RelationshipGraphStatusInput) => unknown;
  readonly rebuild: (input: RelationshipGraphRebuildInput) => unknown;
};

export function registerRelationshipGraphIpc(serviceFactory: (projectId: string) => RelationshipGraphIpcService): void {
  ipcMain.handle(
    ipcChannels.relationshipGraph.getGraph,
    createValidatedIpcHandler(relationshipGraphGetInputSchema, (input) => serviceFactory(input.projectId).getGraph(input))
  );
  ipcMain.handle(
    ipcChannels.relationshipGraph.getStatus,
    createValidatedIpcHandler(relationshipGraphStatusInputSchema, (input) => serviceFactory(input.projectId).getStatus(input))
  );
  ipcMain.handle(
    ipcChannels.relationshipGraph.rebuild,
    createValidatedIpcHandler(relationshipGraphRebuildInputSchema, (input) => serviceFactory(input.projectId).rebuild(input))
  );
}
