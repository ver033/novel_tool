import { ChatActionService } from "./chat-action-service";
import { enrichChatInputWithReferencedChapter } from "./chat-context-resolver";
import type { AiChatRepository } from "../db/repositories/ai-chat-repo";
import { AiTaskRepository } from "../db/repositories/ai-task-repo";
import type { ChapterRepository } from "../db/repositories/chapter-repo";
import type { ScratchNoteRepository } from "../db/repositories/scratch-note-repo";
import type { ProofreadIssue } from "../shared/proofread";
import type {
  AiApplyCandidateInput,
  AiChatAction,
  AiChatMessageRecord,
  AiChatSessionRecord,
  AiClearChatInput,
  AiCreateChatSessionInput,
  AiCreateTaskInput,
  AiDeleteChatSessionInput,
  AiGeneratePreviewInput,
  AiGeneratePreviewStreamInput,
  AiGetChatSessionInput,
  AiListChatSessionsInput,
  AiListChatMessagesInput,
  AiRenameChatSessionInput,
  AiRejectCandidateInput,
  AiSaveCandidateToScratchpadInput,
  AiSendChatMessageInput,
  AiSendChatMessageStreamInput,
  AiTaskCandidateRecord,
  AiTaskRecord,
  AiUpdateTaskInput
} from "../shared/types";

export type AiTaskGenerationResult = {
  readonly generatedText: string;
  readonly changeSummary: string | null;
  readonly proofreadIssues?: readonly ProofreadIssue[] | null;
  readonly truncated?: boolean;
};

export type AiGenerationOptions = {
  readonly signal?: AbortSignal;
};

export type AiTaskGenerator = {
  readonly generate: (task: AiTaskRecord) => Promise<AiTaskGenerationResult>;
  readonly generateStream?: (task: AiTaskRecord, handlers: AiTaskStreamHandlers, options?: AiGenerationOptions) => Promise<AiTaskGenerationResult>;
  readonly continueStream?: (
    task: AiTaskRecord,
    partialText: string,
    handlers: AiTaskStreamHandlers,
    options?: AiGenerationOptions
  ) => Promise<AiTaskGenerationResult>;
};

export type AiChatMessageResult = {
  readonly role: "assistant";
  readonly content: string;
  readonly createdAt: string;
};

export type AiChatGenerationInput = AiSendChatMessageStreamInput & {
  readonly history: readonly AiChatMessageRecord[];
};

export type AiChatGenerator = {
  readonly sendMessage: (input: AiSendChatMessageInput) => Promise<AiChatMessageResult>;
  readonly sendMessageStream?: (input: AiChatGenerationInput, handlers: AiChatStreamHandlers, options?: AiGenerationOptions) => Promise<AiChatMessageResult>;
};

type GeneratedPreview = {
  readonly task: AiTaskRecord;
  readonly candidate: AiTaskCandidateRecord;
};

export type AiTaskStreamHandlers = {
  readonly onChunk?: (event: { readonly requestId: string; readonly content: string }) => void;
  readonly onDone?: (event: { readonly requestId: string; readonly payload: GeneratedPreview }) => void;
  readonly onError?: (event: { readonly requestId: string; readonly error: string }) => void;
};

export type AiChatStreamResult = {
  readonly messages: readonly AiChatMessageRecord[];
  readonly action: AiChatAction | null;
};

export type AiChatStreamHandlers = {
  readonly onChunk?: (event: { readonly requestId: string; readonly content: string }) => void;
  readonly onDone?: (event: { readonly requestId: string; readonly payload: AiChatStreamResult }) => void;
  readonly onError?: (event: { readonly requestId: string; readonly error: string }) => void;
};

type AiTaskRepositoryResolver = (projectId?: string) => AiTaskRepository;
type AiChatRepositoryResolver = (projectId: string) => AiChatRepository;
type ScratchNoteRepositoryResolver = (projectId: string) => ScratchNoteRepository;
type ChapterRepositoryResolver = (projectId: string) => ChapterRepository;

function truncatedTaskError(task: AiTaskRecord): string {
  return task.taskType === "proofread"
    ? "校对结果被截断。请缩短选区，或换用输出额度更高的模型后重试。"
    : "AI 输出被截断。已保留部分结果，请点击继续生成或缩短选区后重试。";
}

export class AiTaskService {
  private readonly resolveAiTaskRepo: AiTaskRepositoryResolver;
  private readonly resolveAiChatRepo?: AiChatRepositoryResolver;
  private readonly resolveChapterRepo?: ChapterRepositoryResolver;
  private readonly chatActionService?: ChatActionService;
  private readonly activeStreams = new Map<string, AbortController>();

  constructor(
    aiTaskRepo: AiTaskRepository | AiTaskRepositoryResolver,
    private readonly generator?: AiTaskGenerator,
    private readonly chatGenerator?: AiChatGenerator,
    aiChatRepo?: AiChatRepository | AiChatRepositoryResolver,
    scratchRepo?: ScratchNoteRepository | ScratchNoteRepositoryResolver,
    chapterRepo?: ChapterRepository | ChapterRepositoryResolver
  ) {
    this.resolveAiTaskRepo = typeof aiTaskRepo === "function" ? aiTaskRepo : () => aiTaskRepo;
    this.resolveAiChatRepo = aiChatRepo ? (typeof aiChatRepo === "function" ? aiChatRepo : () => aiChatRepo) : undefined;
    this.resolveChapterRepo = chapterRepo ? (typeof chapterRepo === "function" ? chapterRepo : () => chapterRepo) : undefined;
    this.chatActionService = scratchRepo ? new ChatActionService(typeof scratchRepo === "function" ? scratchRepo : () => scratchRepo) : undefined;
  }

  private getAiChatRepo(projectId: string): AiChatRepository {
    if (!this.resolveAiChatRepo) {
      throw new Error("AI 对话存储未初始化。");
    }

    return this.resolveAiChatRepo(projectId);
  }

  private resolveReferencedChapterInput<T extends AiSendChatMessageInput | AiSendChatMessageStreamInput>(input: T): T {
    if (!input.projectId || !this.resolveChapterRepo) {
      return input;
    }

    return enrichChatInputWithReferencedChapter(input, this.resolveChapterRepo(input.projectId));
  }

  createTask(input: AiCreateTaskInput): AiTaskRecord {
    return this.resolveAiTaskRepo(input.projectId).createTask({
      projectId: input.projectId,
      chapterId: input.chapterId ?? null,
      taskType: input.taskType,
      status: "configured",
      selection: input.selection ?? null,
      inputText: input.inputText,
      instruction: input.instruction ?? null,
      presetId: input.presetId ?? null,
      outputText: null,
      error: null
    });
  }

  updateTask(input: AiUpdateTaskInput): AiTaskRecord {
    return this.resolveAiTaskRepo().updateTask(input.taskId, {
      status: input.patch.status,
      instruction: input.patch.instruction,
      presetId: input.patch.presetId,
      error: input.patch.error
    });
  }

  async generatePreview(input: AiGeneratePreviewInput): Promise<GeneratedPreview> {
    const aiTaskRepo = this.resolveAiTaskRepo();
    const task = aiTaskRepo.findTaskById(input.taskId);
    if (!this.generator) {
      const error = "OpenRouter 服务未初始化，无法生成预览。";
      aiTaskRepo.updateTask(task.id, {
        status: "failed",
        error
      });
      throw new Error(error);
    }

    aiTaskRepo.updateTask(task.id, {
      status: "generating",
      error: null
    });

    try {
      const generated = await this.generator.generate(task);
      if (generated.truncated) {
        const error = truncatedTaskError(task);
        aiTaskRepo.updateTask(task.id, {
          status: "failed",
          outputText: generated.generatedText,
          error
        });
        throw new Error(error);
      }
      const candidate = aiTaskRepo.createCandidate({
        taskId: task.id,
        kind: task.taskType,
        originalText: task.inputText,
        generatedText: generated.generatedText,
        changeSummary: generated.changeSummary,
        proofreadIssues: generated.proofreadIssues ?? null
      });
      const updatedTask = aiTaskRepo.updateTask(task.id, {
        status: "preview_ready",
        outputText: generated.proofreadIssues ? generated.changeSummary : generated.generatedText,
        error: null
      });
      return {
        task: updatedTask,
        candidate
      };
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason);
      aiTaskRepo.updateTask(task.id, {
        status: "failed",
        error
      });
      throw new Error(error);
    }
  }

  async generatePreviewStream(input: AiGeneratePreviewStreamInput, handlers: AiTaskStreamHandlers = {}): Promise<GeneratedPreview> {
    const aiTaskRepo = this.resolveAiTaskRepo();
    const task = aiTaskRepo.findTaskById(input.taskId);
    if (!this.generator?.generateStream) {
      const error = "OpenRouter 流式服务未初始化，无法生成预览。";
      aiTaskRepo.updateTask(task.id, {
        status: "failed",
        error
      });
      handlers.onError?.({ requestId: input.requestId, error });
      throw new Error(error);
    }

    aiTaskRepo.updateTask(task.id, {
      status: "generating",
      error: null
    });

    const abortController = this.registerStream(input.requestId);

    try {
      const generated = await this.generator.generateStream(task, {
        onChunk: (event) => {
          if (task.taskType !== "proofread") {
            handlers.onChunk?.({ requestId: input.requestId, content: event.content });
          }
        }
      }, { signal: abortController.signal });
      if (generated.truncated) {
        const error = truncatedTaskError(task);
        aiTaskRepo.updateTask(task.id, {
          status: "failed",
          outputText: generated.generatedText,
          error
        });
        throw new Error(error);
      }
      const candidate = aiTaskRepo.createCandidate({
        taskId: task.id,
        kind: task.taskType,
        originalText: task.inputText,
        generatedText: generated.generatedText,
        changeSummary: generated.changeSummary,
        proofreadIssues: generated.proofreadIssues ?? null
      });
      const updatedTask = aiTaskRepo.updateTask(task.id, {
        status: "preview_ready",
        outputText: generated.proofreadIssues ? generated.changeSummary : generated.generatedText,
        error: null
      });
      const result = {
        task: updatedTask,
        candidate
      };
      handlers.onDone?.({ requestId: input.requestId, payload: result });
      return result;
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason);
      aiTaskRepo.updateTask(task.id, {
        status: "failed",
        error
      });
      handlers.onError?.({ requestId: input.requestId, error });
      throw new Error(error);
    } finally {
      this.activeStreams.delete(input.requestId);
    }
  }

  async continuePreviewStream(input: AiGeneratePreviewStreamInput, handlers: AiTaskStreamHandlers = {}): Promise<GeneratedPreview> {
    const aiTaskRepo = this.resolveAiTaskRepo();
    const task = aiTaskRepo.findTaskById(input.taskId);
    const partialText = task.outputText?.trim() ?? "";
    if (!partialText) {
      const error = "没有可继续生成的部分结果。";
      handlers.onError?.({ requestId: input.requestId, error });
      throw new Error(error);
    }
    if (task.taskType === "proofread") {
      const error = "校对结果被截断时请缩短选区后重新校对。";
      handlers.onError?.({ requestId: input.requestId, error });
      throw new Error(error);
    }
    if (!this.generator?.continueStream) {
      const error = "OpenRouter 继续生成服务未初始化。";
      handlers.onError?.({ requestId: input.requestId, error });
      throw new Error(error);
    }

    aiTaskRepo.updateTask(task.id, {
      status: "generating",
      error: null
    });

    const abortController = this.registerStream(input.requestId);

    try {
      const generated = await this.generator.continueStream(
        task,
        partialText,
        {
          onChunk: (event) => {
            handlers.onChunk?.({ requestId: input.requestId, content: event.content });
          }
        },
        { signal: abortController.signal }
      );
      if (generated.truncated) {
        const error = truncatedTaskError(task);
        aiTaskRepo.updateTask(task.id, {
          status: "failed",
          outputText: generated.generatedText,
          error
        });
        throw new Error(error);
      }
      const candidate = aiTaskRepo.createCandidate({
        taskId: task.id,
        kind: task.taskType,
        originalText: task.inputText,
        generatedText: generated.generatedText,
        changeSummary: generated.changeSummary,
        proofreadIssues: generated.proofreadIssues ?? null
      });
      const updatedTask = aiTaskRepo.updateTask(task.id, {
        status: "preview_ready",
        outputText: generated.generatedText,
        error: null
      });
      const result = {
        task: updatedTask,
        candidate
      };
      handlers.onDone?.({ requestId: input.requestId, payload: result });
      return result;
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason);
      aiTaskRepo.updateTask(task.id, {
        status: "failed",
        error
      });
      handlers.onError?.({ requestId: input.requestId, error });
      throw new Error(error);
    } finally {
      this.activeStreams.delete(input.requestId);
    }
  }

  cancelStream(input: { readonly requestId: string }): void {
    const controller = this.activeStreams.get(input.requestId);
    if (!controller) {
      return;
    }
    controller.abort();
    this.activeStreams.delete(input.requestId);
  }

  applyCandidate(input: AiApplyCandidateInput): GeneratedPreview {
    const aiTaskRepo = this.resolveAiTaskRepo();
    const candidate = aiTaskRepo.findCandidateById(input.candidateId);
    const task = aiTaskRepo.findTaskById(candidate.taskId);
    if (task.selection && input.selectionHash !== task.selection.selectionHash) {
      throw new Error("AI 选区校验失败，请重新选择文本后再应用。");
    }

    const inserted = input.applyMode === "insert_below" || input.applyMode === "insert_at_cursor";
    const updatedCandidate = aiTaskRepo.updateCandidateStatus(candidate.id, inserted ? "inserted" : "applied");
    const updatedTask = aiTaskRepo.updateTask(candidate.taskId, {
      status: inserted ? "inserted" : "applied",
      error: null
    });

    return {
      task: updatedTask,
      candidate: updatedCandidate
    };
  }

  saveCandidateToScratchpad(input: AiSaveCandidateToScratchpadInput): GeneratedPreview {
    const aiTaskRepo = this.resolveAiTaskRepo();
    const candidate = aiTaskRepo.updateCandidateStatus(input.candidateId, "inserted_to_scratchpad");
    const task = aiTaskRepo.updateTask(candidate.taskId, {
      status: "saved_to_scratchpad",
      error: null
    });

    return {
      task,
      candidate
    };
  }

  async sendChatMessage(input: AiSendChatMessageInput): Promise<AiChatMessageResult> {
    if (!this.chatGenerator) {
      throw new Error("OpenRouter 对话服务未初始化。");
    }

    if (!input.projectId) {
      return this.chatGenerator.sendMessage(input);
    }

    const chatRepo = this.getAiChatRepo(input.projectId);
    const session = chatRepo.getOrCreateDefaultSession(input.projectId);
    const sessionId = input.sessionId ?? session.id;

    chatRepo.createMessage({
      projectId: input.projectId,
      sessionId,
      role: "user",
      content: input.message,
      action: null
    });
    chatRepo.renameSessionFromFirstMessage({
      projectId: input.projectId,
      sessionId,
      message: input.message
    });

    try {
      const generationInput = this.resolveReferencedChapterInput({
        ...input,
        projectId: input.projectId,
        sessionId
      });
      const streamLikeInput = {
        projectId: input.projectId,
        sessionId,
        requestId: `chat_non_stream_${Date.now()}`,
        message: generationInput.message,
        chapterId: generationInput.chapterId,
        currentChapterTitle: generationInput.currentChapterTitle,
        selectionText: generationInput.selectionText,
        chapterExcerpt: generationInput.chapterExcerpt
      } satisfies AiSendChatMessageStreamInput;
      const generated = await this.chatGenerator.sendMessage(generationInput);
      const assistantMessage = chatRepo.createMessage({
        projectId: input.projectId,
        sessionId,
        role: "assistant",
        content: generated.content,
        action: {
          type: "none"
        }
      });
      const action = this.chatActionService?.executeSafeActionFromChat(streamLikeInput, generated.content) ?? null;
      if (action) {
        chatRepo.createMessage({
          projectId: input.projectId,
          sessionId,
          role: "tool",
          content: "已加入草稿纸。",
          action
        });
      }
      return {
        role: "assistant",
        content: assistantMessage.content,
        createdAt: assistantMessage.createdAt
      };
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason);
      chatRepo.createMessage({
        projectId: input.projectId,
        sessionId,
        role: "error",
        content: error,
        action: null
      });
      throw new Error(error);
    }
  }

  getChatSession(input: AiGetChatSessionInput): AiChatSessionRecord {
    return this.getAiChatRepo(input.projectId).getOrCreateDefaultSession(input.projectId);
  }

  listChatSessions(input: AiListChatSessionsInput): AiChatSessionRecord[] {
    return this.getAiChatRepo(input.projectId).listSessions(input.projectId);
  }

  createChatSession(input: AiCreateChatSessionInput): AiChatSessionRecord {
    return this.getAiChatRepo(input.projectId).createSession(input);
  }

  renameChatSession(input: AiRenameChatSessionInput): AiChatSessionRecord {
    return this.getAiChatRepo(input.projectId).renameSession(input);
  }

  deleteChatSession(input: AiDeleteChatSessionInput): void {
    this.getAiChatRepo(input.projectId).deleteSession(input);
  }

  listChatMessages(input: AiListChatMessagesInput): AiChatMessageRecord[] {
    return this.getAiChatRepo(input.projectId).listMessages(input);
  }

  clearChat(input: AiClearChatInput): void {
    this.getAiChatRepo(input.projectId).clearSession(input);
  }

  async sendChatMessageStream(input: AiSendChatMessageStreamInput, handlers: AiChatStreamHandlers = {}): Promise<AiChatStreamResult> {
    const chatRepo = this.getAiChatRepo(input.projectId);
    const history = chatRepo.listMessages({
      projectId: input.projectId,
      sessionId: input.sessionId
    });
    const userMessage = chatRepo.createMessage({
      projectId: input.projectId,
      sessionId: input.sessionId,
      role: "user",
      content: input.message,
      action: null
    });
    chatRepo.renameSessionFromFirstMessage({
      projectId: input.projectId,
      sessionId: input.sessionId,
      message: input.message
    });

    const fail = (error: string): never => {
      chatRepo.createMessage({
        projectId: input.projectId,
        sessionId: input.sessionId,
        role: "error",
        content: error,
        action: null
      });
      handlers.onError?.({ requestId: input.requestId, error });
      throw new Error(error);
    };

    if (!this.chatGenerator?.sendMessageStream) {
      return fail("OpenRouter 对话流式服务未初始化。");
    }

    const abortController = this.registerStream(input.requestId);

    try {
      const generationInput = this.resolveReferencedChapterInput(input);
      const generated = await this.chatGenerator.sendMessageStream(
        {
          ...generationInput,
          history
        },
        {
          onChunk: (event) => {
            handlers.onChunk?.({ requestId: input.requestId, content: event.content });
          }
        },
        { signal: abortController.signal }
      );
      const assistantMessage = chatRepo.createMessage({
        projectId: input.projectId,
        sessionId: input.sessionId,
        role: "assistant",
        content: generated.content,
        action: {
          type: "none"
        }
      });
      const action = this.chatActionService?.executeSafeActionFromChat(generationInput, generated.content) ?? null;
      const toolMessage = action
        ? chatRepo.createMessage({
            projectId: input.projectId,
            sessionId: input.sessionId,
            role: "tool",
            content: "已加入草稿纸。",
            action
          })
        : null;
      const result = {
        messages: toolMessage ? [userMessage, assistantMessage, toolMessage] : [userMessage, assistantMessage],
        action
      };
      handlers.onDone?.({ requestId: input.requestId, payload: result });
      return result;
    } catch (reason) {
      return fail(reason instanceof Error ? reason.message : String(reason));
    } finally {
      this.activeStreams.delete(input.requestId);
    }
  }

  rejectCandidate(input: AiRejectCandidateInput): AiTaskCandidateRecord {
    return this.resolveAiTaskRepo().updateCandidateStatus(input.candidateId, "rejected");
  }

  private registerStream(requestId: string): AbortController {
    this.cancelStream({ requestId });
    const abortController = new AbortController();
    this.activeStreams.set(requestId, abortController);
    return abortController;
  }
}
