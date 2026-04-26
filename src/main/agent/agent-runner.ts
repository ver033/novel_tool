import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import {
  createAgentToolRegistry,
  serializeAgentToolResult,
  type AgentArtifactSummary,
  type AgentToolPermission,
  type AgentToolResult,
} from './agent-tool-registry';
import type {
  LlmMessage,
  LlmTaskRequest,
  ParsedProviderResponse,
  ProviderId,
  ReasoningEffort,
  ThinkingMode,
} from '../llm/provider-adapters';
import { buildContextPackage, type ContextActionKind } from '../context/context-builder';

type SqliteDb = InstanceType<typeof Database>;

export type AgentTaskMode = 'ask' | 'investigate' | 'draft' | 'check' | 'organize';
export type AgentRunStatus =
  | 'completed'
  | 'blocked_needs_provider'
  | 'blocked_needs_user_input'
  | 'blocked_needs_approval'
  | 'failed_provider'
  | 'failed_tool_validation'
  | 'failed_tool_execution'
  | 'failed_missing_evidence'
  | 'cancelled';

export interface RunAgentInput {
  dbPath: string;
  message: string;
  mode: AgentTaskMode;
  providerId: ProviderId;
  modelName: string;
  reasoningEffort: ReasoningEffort;
  thinkingMode: ThinkingMode;
  sessionId?: string;
  currentParagraphId?: string;
  selectedParagraphIds?: string[];
  selectedText?: string;
  references?: string[];
  sendModelRequest: (request: LlmTaskRequest) => Promise<ParsedProviderResponse>;
}

export interface RunAgentResult {
  runId: string;
  status: AgentRunStatus;
  finalAnswer: string;
  error?: string;
  toolResults: AgentToolResult[];
  artifacts: AgentArtifactSummary[];
}

export interface AgentRunStepSummary {
  label: string;
  status: string;
  details: Record<string, unknown>;
}

const maxModelTurns = 6;
const maxToolCalls = 12;
const maxProposalArtifacts = 3;
const maxDurationMs = 120_000;

function openDb(dbPath: string): SqliteDb {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  return db;
}

function nowIso(): string {
  return new Date().toISOString();
}

function insertRun(db: SqliteDb, input: RunAgentInput): string {
  const runId = `agent-run-${crypto.randomUUID()}`;
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO agent_runs (id, chat_session_id, mode, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(runId, input.sessionId ?? null, input.mode, 'created', timestamp, timestamp);
  return runId;
}

function updateRunStatus(db: SqliteDb, runId: string, status: string): void {
  db.prepare('UPDATE agent_runs SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), runId);
}

function insertStep(
  db: SqliteDb,
  runId: string,
  stepIndex: number,
  label: string,
  status: string,
  details: Record<string, unknown> = {}
): void {
  db.prepare(
    `INSERT INTO agent_steps (id, run_id, step_index, label, status, details_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(`agent-step-${crypto.randomUUID()}`, runId, stepIndex, label, status, JSON.stringify(details));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function parseToolArguments(value: unknown): unknown {
  if (typeof value !== 'string') {
    throw new Error('Tool arguments must be a JSON string');
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('Tool arguments are not valid JSON');
  }
}

function parseToolCall(toolCall: unknown): { id: string; name: string; arguments: unknown } {
  const root = asRecord(toolCall);
  const fn = asRecord(root.function);
  const id = typeof root.id === 'string' ? root.id : '';
  const name = typeof fn.name === 'string' ? fn.name : '';
  if (!id || !name) {
    throw new Error('Tool call is missing id or function name');
  }
  return {
    id,
    name,
    arguments: parseToolArguments(fn.arguments),
  };
}

function buildSystemMessage(): LlmMessage {
  return {
    role: 'system',
    content: [
      '你是中文长篇小说工作站的项目 Agent。',
      '你只能使用已注册工具读取证据或生成可审阅候选。',
      '不要声称检查过未提供的正文。',
      '不要直接修改正文、记忆、问题状态、项目配置或模型设置。',
      '事实性回答必须依据工具返回的来源。',
    ].join('\n'),
  };
}

function allowedToolPermissionsForMode(mode: AgentTaskMode): AgentToolPermission[] {
  if (mode === 'ask' || mode === 'investigate') {
    return ['read'];
  }
  return ['read', 'proposal'];
}

function buildUserMessage(input: RunAgentInput): LlmMessage {
  const scope = {
    mode: input.mode,
    currentParagraphId: input.currentParagraphId,
    selectedParagraphIds: input.selectedParagraphIds ?? [],
    selectedText: input.selectedText ?? '',
    references: input.references ?? [],
  };
  return {
    role: 'user',
    content: `用户请求：${input.message}\n\n当前范围：${JSON.stringify(scope)}`,
  };
}

function contextActionForMode(mode: AgentTaskMode): ContextActionKind {
  if (mode === 'draft') {
    return 'polish';
  }
  if (mode === 'check') {
    return 'continuity';
  }
  if (mode === 'organize') {
    return 'memory';
  }
  return 'ask';
}

function extractSearchMentions(message: string): string[] {
  return Array.from(message.matchAll(/@search:([^\s]+)/g), (match) => `@search:${match[1]}`);
}

function buildFinalSynthesisMessage(): LlmMessage {
  return {
    role: 'user',
    content: [
      '已经达到本次 Agent 的工具调用轮数上限。',
      '不要再调用工具；请只基于上面已有的项目上下文和工具结果回答。',
      '如果证据不足，请直接说明缺少什么证据，不要继续搜索。',
    ].join('\n'),
  };
}

export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const db = openDb(input.dbPath);
  const runId = insertRun(db, input);
  const registry = createAgentToolRegistry(input.dbPath, { runId });
  const started = Date.now();
  let stepIndex = 0;
  let toolCallCount = 0;
  const toolResults: AgentToolResult[] = [];
  const artifacts: AgentArtifactSummary[] = [];
  const messages: LlmMessage[] = [buildSystemMessage(), buildUserMessage(input)];
  const allowedPermissions = allowedToolPermissionsForMode(input.mode);

  try {
    insertStep(db, runId, stepIndex++, 'resolve context', 'completed', {
      mode: input.mode,
      currentParagraphId: input.currentParagraphId ?? null,
      selectedParagraphCount: input.selectedParagraphIds?.length ?? 0,
      referenceCount: input.references?.length ?? 0,
    });
    const context = buildContextPackage(input.dbPath, {
      actionKind: contextActionForMode(input.mode),
      scopeLabel: input.currentParagraphId ? '当前段落' : input.references && input.references.length > 0 ? '当前引用' : '当前对话',
      selectedText: input.selectedText,
      anchorParagraphId: input.currentParagraphId,
      referenceParagraphIds: input.references ?? [],
      searchMentions: extractSearchMentions(input.message),
      userInstruction: input.message,
      maxCharacters: 4_000,
    });
    insertStep(db, runId, stepIndex++, 'context builder', 'completed', {
      sourceCount: context.sourceList.length,
      tokenEstimate: context.tokenEstimate,
      omittedContextReasons: context.omittedContextReasons,
    });
    messages.push({
      role: 'user',
      content: `已解析的项目上下文如下。只能把这些来源当作证据：\n\n${context.contextText}`,
    });

    for (let turn = 1; turn <= maxModelTurns; turn += 1) {
      if (Date.now() - started > maxDurationMs) {
        throw new Error('Agent run exceeded the 120s time limit');
      }

      updateRunStatus(db, runId, 'calling_model');
      insertStep(db, runId, stepIndex++, `model turn ${turn}`, 'completed', {
        providerId: input.providerId,
        modelName: input.modelName,
        reasoningEffort: input.reasoningEffort,
        thinkingMode: input.thinkingMode,
      });

      const response = await input.sendModelRequest({
        model: input.modelName,
        messages,
        reasoningEffort: input.reasoningEffort,
        thinkingMode: input.thinkingMode,
        stream: false,
        tools: registry.listDefinitions({ permissions: allowedPermissions }),
      });

      if (response.toolCalls.length === 0) {
        updateRunStatus(db, runId, 'completed');
        return {
          runId,
          status: 'completed',
          finalAnswer: response.content,
          toolResults,
          artifacts,
        };
      }

      messages.push({
        role: 'assistant',
        content: response.content,
        reasoningContent: response.reasoningContent ?? undefined,
        toolCalls: response.toolCalls,
      });

      for (const rawToolCall of response.toolCalls) {
        if (toolCallCount >= maxToolCalls) {
          throw new Error('Agent run exceeded the tool-call limit');
        }
        toolCallCount += 1;
        let parsed: { id: string; name: string; arguments: unknown };
        try {
          parsed = parseToolCall(rawToolCall);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Tool call validation failed';
          insertStep(db, runId, stepIndex++, 'tool unknown', 'failed', { error: message });
          updateRunStatus(db, runId, 'failed_tool_validation');
          return {
            runId,
            status: 'failed_tool_validation',
            finalAnswer: '',
            error: message,
            toolResults,
            artifacts,
          };
        }
        const toolPermission = registry.permissionFor(parsed.name);
        if (toolPermission && !allowedPermissions.includes(toolPermission)) {
          const message = `Agent tool ${parsed.name} is not allowed in ${input.mode} mode`;
          insertStep(db, runId, stepIndex++, `tool ${parsed.name}`, 'failed', { error: message });
          updateRunStatus(db, runId, 'failed_tool_validation');
          return {
            runId,
            status: 'failed_tool_validation',
            finalAnswer: '',
            error: message,
            toolResults,
            artifacts,
          };
        }

        try {
          if (parsed.name.startsWith('propose_') && artifacts.length >= maxProposalArtifacts) {
            throw new Error('Agent run exceeded the proposal artifact limit');
          }
          updateRunStatus(db, runId, 'executing_tool');
          const result = await registry.execute(parsed.name, parsed.arguments);
          toolResults.push(result);
          if (result.artifact) {
            artifacts.push(result.artifact);
            if (artifacts.length > maxProposalArtifacts) {
              throw new Error('Agent run exceeded the proposal artifact limit');
            }
          }
          const serialized = serializeAgentToolResult(result);
          insertStep(db, runId, stepIndex++, `tool ${parsed.name}`, 'completed', {
            permission: result.permission,
            sourceCount: result.sources.length,
            sources: result.sources,
          });
          messages.push({
            role: 'tool',
            toolCallId: parsed.id,
            content: serialized,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Tool execution failed';
          insertStep(db, runId, stepIndex++, `tool ${parsed.name}`, 'failed', { error: message });
          updateRunStatus(db, runId, 'failed_tool_validation');
          return {
            runId,
            status: 'failed_tool_validation',
            finalAnswer: '',
            error: message,
            toolResults,
            artifacts,
          };
        }
      }

      if (artifacts.length > 0) {
        updateRunStatus(db, runId, 'blocked_needs_approval');
        return {
          runId,
          status: 'blocked_needs_approval',
          finalAnswer: '已生成待确认候选，等待作者审批。',
          toolResults,
          artifacts,
        };
      }
    }

    messages.push(buildFinalSynthesisMessage());
    updateRunStatus(db, runId, 'calling_model');
    insertStep(db, runId, stepIndex++, 'final synthesis', 'completed', {
      providerId: input.providerId,
      modelName: input.modelName,
      toolResultCount: toolResults.length,
    });
    const finalResponse = await input.sendModelRequest({
      model: input.modelName,
      messages,
      reasoningEffort: input.reasoningEffort,
      thinkingMode: input.thinkingMode,
      stream: false,
    });
    if (finalResponse.toolCalls.length > 0) {
      throw new Error('Agent final synthesis returned tool calls after tools were disabled');
    }
    updateRunStatus(db, runId, 'completed');
    return {
      runId,
      status: 'completed',
      finalAnswer: finalResponse.content,
      toolResults,
      artifacts,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Agent run failed';
    updateRunStatus(db, runId, 'failed_provider');
    return {
      runId,
      status: 'failed_provider',
      finalAnswer: '',
      error: message,
      toolResults,
      artifacts,
    };
  } finally {
    db.close();
  }
}

export function listAgentRunSteps(dbPath: string, runId: string): AgentRunStepSummary[] {
  const db = openDb(dbPath);
  try {
    const rows = db
      .prepare('SELECT label, status, details_json FROM agent_steps WHERE run_id = ? ORDER BY step_index ASC')
      .all(runId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      label: String(row.label),
      status: String(row.status),
      details: row.details_json ? JSON.parse(String(row.details_json)) : {},
    }));
  } finally {
    db.close();
  }
}
