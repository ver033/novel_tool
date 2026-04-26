import type { IpcRequest } from './ipc-contracts';

export interface NovelToolApi {
  project: {
    create(input: IpcRequest<'project.create'>): Promise<unknown>;
    open(input: IpcRequest<'project.open'>): Promise<unknown>;
    pickExisting(): Promise<unknown>;
    getCurrent(): Promise<unknown>;
  };
  chapters: {
    list(): Promise<unknown>;
    get(input: IpcRequest<'chapters.get'>): Promise<unknown>;
  };
  paragraphs: {
    update(input: IpcRequest<'paragraphs.update'>): Promise<unknown>;
  };
  revisions: {
    list(input: IpcRequest<'revisions.list'>): Promise<unknown>;
    restore(input: IpcRequest<'revisions.restore'>): Promise<unknown>;
    acceptCandidate(input: IpcRequest<'revisions.acceptCandidate'>): Promise<unknown>;
    rejectCandidate(input: IpcRequest<'revisions.rejectCandidate'>): Promise<unknown>;
  };
  imports: {
    pickManuscript(): Promise<unknown>;
    previewTxt(input: IpcRequest<'imports.previewTxt'>): Promise<unknown>;
    commitTxt(input: IpcRequest<'imports.commitTxt'>): Promise<unknown>;
    previewEpub(input: IpcRequest<'imports.previewEpub'>): Promise<unknown>;
    commitEpub(input: IpcRequest<'imports.commitEpub'>): Promise<unknown>;
  };
  search: {
    query(input: IpcRequest<'search.query'>): Promise<unknown>;
    addToContext(input: IpcRequest<'search.addToContext'>): Promise<unknown>;
  };
  providers: {
    status(): Promise<unknown>;
    saveKey(input: IpcRequest<'providers.saveKey'>): Promise<unknown>;
    testConnection(input: IpcRequest<'providers.testConnection'>): Promise<unknown>;
    setActive(input: IpcRequest<'providers.setActive'>): Promise<unknown>;
    deleteKey(input: IpcRequest<'providers.deleteKey'>): Promise<unknown>;
  };
  config: {
    get(): Promise<unknown>;
    updateProjectInstructions(input: IpcRequest<'config.updateProjectInstructions'>): Promise<unknown>;
    updateTaskModelProfile(input: IpcRequest<'config.updateTaskModelProfile'>): Promise<unknown>;
  };
  ai: {
    runTask(input: IpcRequest<'ai.runTask'>): Promise<unknown>;
  };
  chat: {
    send(input: IpcRequest<'chat.send'>): Promise<unknown>;
  };
  agent: {
    applyArtifact(input: IpcRequest<'agent.applyArtifact'>): Promise<unknown>;
    rejectArtifact(input: IpcRequest<'agent.rejectArtifact'>): Promise<unknown>;
  };
  proofread: {
    runRules(input: IpcRequest<'proofread.runRules'>): Promise<unknown>;
  };
  issues: {
    list(input: IpcRequest<'issues.list'>): Promise<unknown>;
    updateStatus(input: IpcRequest<'issues.updateStatus'>): Promise<unknown>;
  };
  memory: {
    list(): Promise<unknown>;
    updateCard(input: IpcRequest<'memory.updateCard'>): Promise<unknown>;
  };
  canon: {
    list(): Promise<unknown>;
    importMarkdown(input: IpcRequest<'canon.importMarkdown'>): Promise<unknown>;
    analyzeProject(): Promise<unknown>;
  };
  timeline: {
    query(input: IpcRequest<'timeline.query'>): Promise<unknown>;
    analyze(input: IpcRequest<'timeline.analyze'>): Promise<unknown>;
  };
  exports: {
    preview(input: IpcRequest<'exports.preview'>): Promise<unknown>;
    run(input: IpcRequest<'exports.run'>): Promise<unknown>;
  };
  jobs: {
    subscribe(): Promise<unknown>;
  };
}
