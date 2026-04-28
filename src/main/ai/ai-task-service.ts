import { ChatActionService } from "./chat-action-service";
import type { AiChatRepository } from "../db/repositories/ai-chat-repo";
import { AiTaskRepository } from "../db/repositories/ai-task-repo";
import type { ScratchNoteRepository } from "../db/repositories/scratch-note-repo";
import type { ProofreadIssue } from "../shared/proofread";
import type {
  AiApplyCandidateInput,
  AiChatAction,
  AiChatMessageRecord,
  AiChatSessionRecord,
  AiClearChatInput,
  AiCreateTaskInput,
  AiGeneratePreviewInput,
  AiGeneratePreviewStreamInput,
  AiGetChatSessionInput,
  AiListChatMessagesInput,
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
};

export type AiTaskGenerator = {
  readonly generate: (task: AiTaskRecord) => Promise<AiTaskGenerationResult>;
  readonly generateStream?: (task: AiTaskRecord, handlers: AiTaskStreamHandlers) => Promise<AiTaskGenerationResult>;
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
  readonly sendMessageStream?: (input: AiChatGenerationInput, handlers: AiChatStreamHandlers) => Promise<AiChatMessageResult>;
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

export class AiTaskService {
  private readonly resolveAiTaskRepo: AiTaskRepositoryResolver;
  private readonly resolveAiChatRepo?: AiChatRepositoryResolver;
  private readonly chatActionService?: ChatActionService;

  constructor(
    aiTaskRepo: AiTaskRepository | AiTaskRepositoryResolver,
    private readonly generator?: AiTaskGenerator,
    private readonly chatGenerator?: AiChatGenerator,
    aiChatRepo?: AiChatRepository | AiChatRepositoryResolver,
    scratchRepo?: ScratchNoteRepository | ScratchNoteRepositoryResolver
  ) {
    this.resolveAiTaskRepo = typeof aiTaskRepo === "function" ? aiTaskRepo : () => aiTaskRepo;
    this.resolveAiChatRepo = aiChatRepo ? (typeof aiChatRepo === "function" ? aiChatRepo : () => aiChatRepo) : undefined;
    this.chatActionService = scratchRepo ? new ChatActionService(typeof scratchRepo === "function" ? scratchRepo : () => scratchRepo) : undefined;
  }

  private getAiChatRepo(projectId: string): AiChatRepository {
    if (!this.resolveAiChatRepo) {
      throw new Error("AI 对话存储未初始化。");
    }

    return this.resolveAiChatRepo(projectId);
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

    try {
      const generated = await this.generator.generateStream(task, {
        onChunk: (event) => {
          if (task.taskType !== "proofread") {
            handlers.onChunk?.({ requestId: input.requestId, content: event.content });
          }
        }
      });
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
    }
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

    return this.chatGenerator.sendMessage(input);
  }

  getChatSession(input: AiGetChatSessionInput): AiChatSessionRecord {
    return this.getAiChatRepo(input.projectId).getOrCreateDefaultSession(input.projectId);
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

    try {
      const generated = await this.chatGenerator.sendMessageStream(
        {
          ...input,
          history
        },
        {
          onChunk: (event) => {
            handlers.onChunk?.({ requestId: input.requestId, content: event.content });
          }
        }
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
      const action = this.chatActionService?.executeSafeActionFromChat(input, generated.content) ?? null;
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
    }
  }

  rejectCandidate(input: AiRejectCandidateInput): AiTaskCandidateRecord {
    return this.resolveAiTaskRepo().updateCandidateStatus(input.candidateId, "rejected");
  }
}
