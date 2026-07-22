import type { ChatAgentContext } from "../chat-agent-types";
import type { AiAgentActivityRecord, AiChatAction, AiChatMessageRecord, AiContextIndexMode, AiSendChatMessageStreamInput } from "../../shared/types";
import type { ContentLanguage } from "../../shared/language";

export type NovelAgentDirectoryItem = {
  readonly ordinal: number;
  readonly id: string;
  readonly title: string;
  readonly wordCount: number;
  readonly current: boolean;
};

export type NovelAgentToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly parameters: object;
};

export type NovelAgentToolCall = {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
};

export type NovelAgentToolResult = {
  readonly content: string;
  readonly action: AiChatAction | null;
};

export type NovelAgentRunInput = AiSendChatMessageStreamInput & {
  readonly contentLanguage?: ContentLanguage;
  readonly responseLanguage?: ContentLanguage;
  readonly history: readonly AiChatMessageRecord[];
  readonly agentContext?: ChatAgentContext;
  readonly compactedMemorySummary?: string | null;
  readonly compactedMemoryThroughMessageId?: string | null;
  readonly chapterDirectory: readonly NovelAgentDirectoryItem[];
  readonly tools: readonly NovelAgentToolDefinition[];
  readonly executeTool: (call: NovelAgentToolCall) => Promise<NovelAgentToolResult>;
};

export type NovelAgentRunOptions = {
  readonly signal?: AbortSignal;
};

export type NovelAgentRunResult = {
  readonly role: "assistant";
  readonly content: string;
  readonly createdAt: string;
  readonly actions?: readonly AiChatAction[];
  readonly activities?: readonly AiAgentActivityRecord[];
};

export type NovelAgentRuntimeHandlers = {
  readonly onChunk?: (event: { readonly requestId: string; readonly content: string }) => void;
  readonly onReasoning?: (event: { readonly requestId: string; readonly content: string }) => void;
  readonly onActivity?: (event: { readonly requestId: string; readonly activity: AiAgentActivityRecord }) => void;
  readonly onContext?: (event: {
    readonly requestId: string;
    readonly estimatedInputTokens: number;
    readonly maxInputTokens: number;
    readonly maxOutputTokens: number;
    readonly modelContextTokens: number | null;
    readonly modelName: string;
    readonly contextMode: "direct" | "summarized" | "mixed";
    readonly scopeLabel: string;
    readonly indexMode?: AiContextIndexMode;
    readonly indexedChapterCount?: number;
    readonly totalChapterCount?: number;
    readonly staleChapterCount?: number;
    readonly skippedTooShortChapterCount?: number;
  }) => void;
};

/**
 * Deep seam between novel workflow policy and an agent-loop implementation.
 * Provider/Pi-specific message and tool types must be converted inside an adapter.
 */
export interface NovelAgentRuntime {
  run(input: NovelAgentRunInput, handlers: NovelAgentRuntimeHandlers, options?: NovelAgentRunOptions): Promise<NovelAgentRunResult>;
}
