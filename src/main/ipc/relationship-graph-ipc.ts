import { ipcMain } from "electron";
import {
  relationshipGraphGetInputSchema,
  relationshipGraphRebuildInputSchema,
  relationshipGraphStatusInputSchema,
  relationshipGraphUpgradeMissingFromOriginalTextInputSchema
} from "../shared/schemas";
import {
  ipcChannels,
  type RelationshipGraphGetInput,
  type RelationshipGraphRebuildInput,
  type RelationshipGraphStatusInput,
  type RelationshipGraphUpgradeMissingFromOriginalTextInput
} from "../shared/types";
import { createValidatedIpcHandler } from "./register-ipc";

export type RelationshipGraphIpcService = {
  readonly getGraph: (input: RelationshipGraphGetInput) => unknown;
  readonly getStatus: (input: RelationshipGraphStatusInput) => unknown;
  readonly rebuild: (input: RelationshipGraphRebuildInput) => unknown;
  readonly refreshCacheStatus: (input: RelationshipGraphStatusInput) => unknown;
  readonly getCacheSettingsStatus: (input: RelationshipGraphStatusInput) => unknown;
  readonly upgradeMissingFromOriginalText: (input: RelationshipGraphUpgradeMissingFromOriginalTextInput) => unknown;
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
  ipcMain.handle(
    ipcChannels.relationshipGraph.refreshCacheStatus,
    createValidatedIpcHandler(relationshipGraphStatusInputSchema, (input) => serviceFactory(input.projectId).refreshCacheStatus(input))
  );
  ipcMain.handle(
    ipcChannels.relationshipGraph.getCacheSettingsStatus,
    createValidatedIpcHandler(relationshipGraphStatusInputSchema, (input) => serviceFactory(input.projectId).getCacheSettingsStatus(input))
  );
  ipcMain.handle(
    ipcChannels.relationshipGraph.upgradeMissingFromOriginalText,
    createValidatedIpcHandler(relationshipGraphUpgradeMissingFromOriginalTextInputSchema, (input) =>
      serviceFactory(input.projectId).upgradeMissingFromOriginalText(input)
    )
  );
}
