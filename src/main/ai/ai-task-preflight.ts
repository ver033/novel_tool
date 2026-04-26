import {
  buildContextPackage,
  createAiTaskWithContext,
  type ContextActionKind,
  type ContextPackage,
} from '../context/context-builder';
import { defaultModelForProvider } from '../llm/provider-adapters';

export type AiTaskType = 'chat' | 'polish' | 'continuity' | 'expand' | 'proofread' | 'memory';
export type ActiveProviderId = 'deepseek' | 'openrouter';

export interface TaskModelSetting {
  modelRole: 'pro' | 'flash';
  modelNameOverride?: string;
  reasoningEffort: 'high' | 'max';
  thinkingMode: 'enabled' | 'disabled';
}

export interface BuildAiTaskPreflightInput {
  task: AiTaskType;
  activeProvider: ActiveProviderId | null;
  taskSetting: TaskModelSetting;
  contextReferenceParagraphIds: string[];
  scope: Record<string, unknown>;
  input: Record<string, unknown>;
}

export interface AiTaskPreflightResponse {
  taskId: string;
  status: 'preflight_ready';
  providerId: ActiveProviderId;
  modelName: string;
  reasoning: {
    reasoningEffort: 'high' | 'max';
    thinkingMode: 'enabled' | 'disabled';
  };
  context: ContextPackage;
}

function taskToActionKind(task: AiTaskType): ContextActionKind {
  return task === 'chat' ? 'ask' : task;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function buildAiTaskPreflight(dbPath: string, input: BuildAiTaskPreflightInput): AiTaskPreflightResponse {
  if (!input.activeProvider) {
    throw new Error('请先在模型设置里选择一个激活供应商');
  }

  const modelName =
    input.activeProvider === 'openrouter' && input.taskSetting.modelNameOverride?.trim()
      ? input.taskSetting.modelNameOverride.trim()
      : defaultModelForProvider(input.activeProvider, input.taskSetting.modelRole);
  const context = buildContextPackage(dbPath, {
    actionKind: taskToActionKind(input.task),
    scopeLabel: stringValue(input.scope.scopeLabel) ?? '当前任务',
    selectedText: stringValue(input.scope.selectedText),
    anchorParagraphId: stringValue(input.scope.anchorParagraphId),
    currentChapterId: stringValue(input.scope.currentChapterId),
    referenceParagraphIds: unique([
      ...input.contextReferenceParagraphIds,
      ...stringArrayValue(input.scope.referenceParagraphIds),
    ]),
    searchMentions: stringArrayValue(input.scope.searchMentions),
    userInstruction: stringValue(input.input.userInstruction),
    maxCharacters: numberValue(input.input.maxCharacters),
  });

  const task = createAiTaskWithContext(dbPath, {
    taskType: input.task,
    context,
    providerId: input.activeProvider,
    modelName,
    reasoningEffort: input.taskSetting.reasoningEffort,
    thinkingMode: input.taskSetting.thinkingMode,
  });

  return {
    taskId: task.taskId,
    status: task.status,
    providerId: input.activeProvider,
    modelName,
    reasoning: {
      reasoningEffort: input.taskSetting.reasoningEffort,
      thinkingMode: input.taskSetting.thinkingMode,
    },
    context,
  };
}
