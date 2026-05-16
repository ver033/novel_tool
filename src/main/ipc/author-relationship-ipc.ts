import { ipcMain } from "electron";
import {
  authorRelationshipCreateCharacterInputSchema,
  authorRelationshipCreateRelationshipInputSchema,
  authorRelationshipDeleteCharacterInputSchema,
  authorRelationshipDeleteRelationshipInputSchema,
  authorRelationshipGetGraphInputSchema,
  authorRelationshipUpdateCharacterInputSchema
} from "../shared/schemas";
import type {
  AuthorRelationshipCreateCharacterInput,
  AuthorRelationshipCreateRelationshipInput,
  AuthorRelationshipDeleteCharacterInput,
  AuthorRelationshipDeleteRelationshipInput,
  AuthorRelationshipGetGraphInput,
  AuthorRelationshipUpdateCharacterInput
} from "../shared/types";
import { ipcChannels } from "../shared/types";
import { createValidatedIpcHandler } from "./register-ipc";

export type AuthorRelationshipIpcService = {
  readonly getGraph: (input: AuthorRelationshipGetGraphInput) => unknown;
  readonly createCharacter: (input: AuthorRelationshipCreateCharacterInput) => unknown;
  readonly updateCharacter: (input: AuthorRelationshipUpdateCharacterInput) => unknown;
  readonly createRelationship: (input: AuthorRelationshipCreateRelationshipInput) => unknown;
  readonly deleteCharacter: (input: AuthorRelationshipDeleteCharacterInput) => unknown;
  readonly deleteRelationship: (input: AuthorRelationshipDeleteRelationshipInput) => unknown;
};

export function registerAuthorRelationshipIpc(serviceFactory: (projectId: string) => AuthorRelationshipIpcService): void {
  ipcMain.handle(
    ipcChannels.authorRelationship.getGraph,
    createValidatedIpcHandler(authorRelationshipGetGraphInputSchema, (input) => serviceFactory(input.projectId).getGraph(input))
  );
  ipcMain.handle(
    ipcChannels.authorRelationship.createCharacter,
    createValidatedIpcHandler(authorRelationshipCreateCharacterInputSchema, (input) => serviceFactory(input.projectId).createCharacter(input))
  );
  ipcMain.handle(
    ipcChannels.authorRelationship.updateCharacter,
    createValidatedIpcHandler(authorRelationshipUpdateCharacterInputSchema, (input) => serviceFactory(input.projectId).updateCharacter(input))
  );
  ipcMain.handle(
    ipcChannels.authorRelationship.createRelationship,
    createValidatedIpcHandler(authorRelationshipCreateRelationshipInputSchema, (input) => serviceFactory(input.projectId).createRelationship(input))
  );
  ipcMain.handle(
    ipcChannels.authorRelationship.deleteCharacter,
    createValidatedIpcHandler(authorRelationshipDeleteCharacterInputSchema, (input) => serviceFactory(input.projectId).deleteCharacter(input))
  );
  ipcMain.handle(
    ipcChannels.authorRelationship.deleteRelationship,
    createValidatedIpcHandler(authorRelationshipDeleteRelationshipInputSchema, (input) => serviceFactory(input.projectId).deleteRelationship(input))
  );
}
