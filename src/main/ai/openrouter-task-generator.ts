import type { AiTaskRecord } from "../shared/types";
import type { AiGenerationOptions, AiTaskGenerationResult, AiTaskGenerator, AiTaskStreamHandlers } from "./ai-task-service";
import type { ChapterRepository } from "../db/repositories/chapter-repo";
import { SettingsService } from "../settings/settings-service";
import { WritingOperationRunner } from "./writing-operation-runner";

export class OpenRouterTaskGenerator implements AiTaskGenerator {
  private readonly runner: WritingOperationRunner;

  constructor(
    settingsService: SettingsService,
    resolveChapterRepo: (projectId: string) => ChapterRepository
  ) {
    this.runner = WritingOperationRunner.fromSettings(settingsService, resolveChapterRepo);
  }

  async generateStream(task: AiTaskRecord, handlers: AiTaskStreamHandlers, options: AiGenerationOptions = {}): Promise<AiTaskGenerationResult> {
    return this.runner.generateStream(task, handlers, options);
  }

  async continueStream(
    task: AiTaskRecord,
    partialText: string,
    handlers: AiTaskStreamHandlers,
    options: AiGenerationOptions = {}
  ): Promise<AiTaskGenerationResult> {
    return this.runner.continueStream(task, partialText, handlers, options);
  }
}
