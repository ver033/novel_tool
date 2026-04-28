import { AiTaskRepository } from "../db/repositories/ai-task-repo";
import type {
  AiApplyCandidateInput,
  AiCreateTaskInput,
  AiGeneratePreviewInput,
  AiRejectCandidateInput,
  AiSaveCandidateToScratchpadInput,
  AiSendChatMessageInput,
  AiTaskCandidateRecord,
  AiTaskRecord,
  AiUpdateTaskInput
} from "../shared/types";

export type AiTaskGenerationResult = {
  readonly generatedText: string;
  readonly changeSummary: string | null;
};

export type AiTaskGenerator = {
  readonly generate: (task: AiTaskRecord) => Promise<AiTaskGenerationResult>;
};

export type AiChatMessageResult = {
  readonly role: "assistant";
  readonly content: string;
  readonly createdAt: string;
};

export type AiChatGenerator = {
  readonly sendMessage: (input: AiSendChatMessageInput) => Promise<AiChatMessageResult>;
};

type GeneratedPreview = {
  readonly task: AiTaskRecord;
  readonly candidate: AiTaskCandidateRecord;
};

type AiTaskRepositoryResolver = (projectId?: string) => AiTaskRepository;

export class AiTaskService {
  private readonly resolveAiTaskRepo: AiTaskRepositoryResolver;

  constructor(
    aiTaskRepo: AiTaskRepository | AiTaskRepositoryResolver,
    private readonly generator?: AiTaskGenerator,
    private readonly chatGenerator?: AiChatGenerator
  ) {
    this.resolveAiTaskRepo = typeof aiTaskRepo === "function" ? aiTaskRepo : () => aiTaskRepo;
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
        changeSummary: generated.changeSummary
      });
      const updatedTask = aiTaskRepo.updateTask(task.id, {
        status: "preview_ready",
        outputText: generated.generatedText,
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

  rejectCandidate(input: AiRejectCandidateInput): AiTaskCandidateRecord {
    return this.resolveAiTaskRepo().updateCandidateStatus(input.candidateId, "rejected");
  }
}
