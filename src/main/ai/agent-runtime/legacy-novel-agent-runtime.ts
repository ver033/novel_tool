import type {
  NovelAgentRunInput,
  NovelAgentRunOptions,
  NovelAgentRunResult,
  NovelAgentRuntime,
  NovelAgentRuntimeHandlers
} from "./novel-agent-runtime";

export type LegacyNovelAgentGenerator = {
  readonly sendAgentMessageStream: (
    input: NovelAgentRunInput,
    handlers: NovelAgentRuntimeHandlers,
    options?: NovelAgentRunOptions
  ) => Promise<NovelAgentRunResult>;
};

/** Keeps the current harness available as a rollback adapter during the Pi migration. */
export class LegacyNovelAgentRuntime implements NovelAgentRuntime {
  constructor(private readonly generator: LegacyNovelAgentGenerator) {}

  run(input: NovelAgentRunInput, handlers: NovelAgentRuntimeHandlers, options: NovelAgentRunOptions = {}): Promise<NovelAgentRunResult> {
    return this.generator.sendAgentMessageStream(input, handlers, options);
  }
}
