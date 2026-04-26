import { contextBridge, ipcRenderer } from 'electron';

import { validateIpcRequest, type IpcChannel, type IpcRequest } from '../shared/ipc-contracts';
import type { NovelToolApi } from '../shared/preload-api';

function invoke<C extends IpcChannel>(channel: C, payload: IpcRequest<C>): Promise<unknown> {
  const parsed = validateIpcRequest(channel, payload);
  return ipcRenderer.invoke(channel, parsed);
}

const api: NovelToolApi = {
  project: {
    create: (input) => invoke('project.create', input),
    open: (input) => invoke('project.open', input),
    pickExisting: () => invoke('project.pickExisting', {}),
    getCurrent: () => invoke('project.getCurrent', {}),
  },
  chapters: {
    list: () => invoke('chapters.list', {}),
    get: (input) => invoke('chapters.get', input),
  },
  paragraphs: {
    update: (input) => invoke('paragraphs.update', input),
  },
  revisions: {
    list: (input) => invoke('revisions.list', input),
    restore: (input) => invoke('revisions.restore', input),
    acceptCandidate: (input) => invoke('revisions.acceptCandidate', input),
    rejectCandidate: (input) => invoke('revisions.rejectCandidate', input),
  },
  imports: {
    pickManuscript: () => invoke('imports.pickManuscript', {}),
    previewTxt: (input) => invoke('imports.previewTxt', input),
    commitTxt: (input) => invoke('imports.commitTxt', input),
    previewEpub: (input) => invoke('imports.previewEpub', input),
    commitEpub: (input) => invoke('imports.commitEpub', input),
  },
  search: {
    query: (input) => invoke('search.query', input),
    addToContext: (input) => invoke('search.addToContext', input),
  },
  providers: {
    status: () => invoke('providers.status', {}),
    saveKey: (input) => invoke('providers.saveKey', input),
    testConnection: (input) => invoke('providers.testConnection', input),
    setActive: (input) => invoke('providers.setActive', input),
    deleteKey: (input) => invoke('providers.deleteKey', input),
  },
  config: {
    get: () => invoke('config.get', {}),
    updateProjectInstructions: (input) => invoke('config.updateProjectInstructions', input),
    updateTaskModelProfile: (input) => invoke('config.updateTaskModelProfile', input),
  },
  ai: {
    runTask: (input) => invoke('ai.runTask', input),
  },
  chat: {
    send: (input) => invoke('chat.send', input),
  },
  agent: {
    applyArtifact: (input) => invoke('agent.applyArtifact', input),
    rejectArtifact: (input) => invoke('agent.rejectArtifact', input),
  },
  proofread: {
    runRules: (input) => invoke('proofread.runRules', input),
  },
  issues: {
    list: (input) => invoke('issues.list', input),
    updateStatus: (input) => invoke('issues.updateStatus', input),
  },
  memory: {
    list: () => invoke('memory.list', {}),
    updateCard: (input) => invoke('memory.updateCard', input),
  },
  canon: {
    list: () => invoke('canon.list', {}),
    importMarkdown: (input) => invoke('canon.importMarkdown', input),
    analyzeProject: () => invoke('canon.analyzeProject', {}),
  },
  timeline: {
    query: (input) => invoke('timeline.query', input),
    analyze: (input) => invoke('timeline.analyze', input),
  },
  exports: {
    preview: (input) => invoke('exports.preview', input),
    run: (input) => invoke('exports.run', input),
  },
  jobs: {
    subscribe: () => invoke('jobs.subscribe', {}),
  },
};

contextBridge.exposeInMainWorld('novelTool', api);
