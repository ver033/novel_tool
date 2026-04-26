import { z } from 'zod';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { buildContextPackage, type ContextActionKind } from '../context/context-builder';
import { listIssues } from '../proofread/proofread-service';
import { getParagraphReferences, getParagraphReferencesWithMissing, searchParagraphs } from '../search/search-service';

export type AgentToolPermission = 'read' | 'proposal';

export interface AgentToolSource {
  paragraphId?: string;
  chapterId?: string;
  friendlyLocation: string;
  kind: string;
}

export interface AgentToolResult {
  toolName: string;
  permission: AgentToolPermission;
  output: unknown;
  sources: AgentToolSource[];
  artifact?: AgentArtifactSummary;
}

export interface AgentArtifactSummary {
  id: string;
  artifactType: 'polish_revision' | 'expansion_draft' | 'issue_action' | 'memory_update';
  title: string;
  payload: unknown;
  status: 'pending_approval';
}

type AgentToolHandler = (input: unknown) => AgentToolResult | Promise<AgentToolResult>;

interface AgentToolDefinition {
  name: string;
  description: string;
  permission: AgentToolPermission;
  inputSchema: z.ZodType;
  handler: AgentToolHandler;
}

export interface AgentToolRegistry {
  listDefinitions(options?: { permissions?: AgentToolPermission[] }): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  permissionFor(toolName: string): AgentToolPermission | null;
  execute(toolName: string, input: unknown): Promise<AgentToolResult>;
}

const readParagraphsInputSchema = z.object({
  paragraphIds: z.array(z.string().min(1)).min(1).max(40),
});

const searchManuscriptInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(12).default(8),
});

const listIssuesInputSchema = z.object({
  currentParagraphId: z.string().min(1).optional(),
  status: z.enum([
    'open',
    'fixed',
    'ignored',
    'false_positive',
    'marked_as_foreshadowing',
    'marked_as_lie',
    'marked_as_unreliable_narration',
    'author_confirmed_exception',
  ]).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

const buildContextPackageInputSchema = z.object({
  actionKind: z.enum(['ask', 'polish', 'expand', 'proofread', 'continuity', 'memory']),
  scopeLabel: z.string().min(1),
  selectedText: z.string().optional(),
  anchorParagraphId: z.string().min(1).optional(),
  currentChapterId: z.string().min(1).optional(),
  referenceParagraphIds: z.array(z.string().min(1)).default([]),
  searchMentions: z.array(z.string().min(1)).default([]),
  userInstruction: z.string().optional(),
  maxCharacters: z.number().int().min(800).max(12_000).default(4_000),
});
const riskFlagSchema = z.object({
  type: z.string().min(1).default('other'),
  description: z.string().min(1).default(''),
});
const coveredBeatSchema = z.object({
  beat: z.string().min(1),
  covered: z.boolean(),
  note: z.string().default(''),
});
const newFactSchema = z.object({
  fact: z.string().min(1),
  importance: z.enum(['low', 'medium', 'high']).default('medium'),
});
const proposePolishInputSchema = z.object({
  paragraphId: z.string().min(1),
  revisedText: z.string().min(1),
  editSummary: z.string().min(1),
  changedFacts: z.array(z.unknown()).default([]),
  riskFlags: z.array(riskFlagSchema).default([]),
});
const proposeExpansionInputSchema = z.object({
  anchorParagraphId: z.string().min(1),
  draftText: z.string().min(1),
  summary: z.string().min(1).default('扩写候选'),
  coveredBeats: z.array(coveredBeatSchema).default([]),
  newFacts: z.array(newFactSchema).default([]),
  riskFlags: z.array(riskFlagSchema).default([]),
});
const proposeIssueActionInputSchema = z.object({
  issueId: z.string().min(1),
  action: z.enum([
    'mark_fixed',
    'ignore',
    'false_positive',
    'mark_foreshadowing',
    'mark_lie',
    'mark_unreliable_narration',
    'author_confirmed_exception',
  ]),
  note: z.string().default(''),
});
const proposeMemoryUpdateInputSchema = z.object({
  cardType: z.enum(['character', 'location', 'prop', 'world_rule', 'timeline', 'foreshadowing', 'style']),
  title: z.string().min(1),
  content: z.string().min(1),
  sourceParagraphIds: z.array(z.string().min(1)).max(20).default([]),
});

type SqliteDb = InstanceType<typeof Database>;

function openDb(dbPath: string): SqliteDb {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  return db;
}

function schemaToToolParameters(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>;
}

function formatToolOutput(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function optionsToPermissionSet(options?: { permissions?: AgentToolPermission[] }): Set<AgentToolPermission> | null {
  return options?.permissions && options.permissions.length > 0 ? new Set(options.permissions) : null;
}

function readIssueSummary(dbPath: string, issueId: string): { id: string; title: string; status: string; currentParagraphId?: string } {
  const db = openDb(dbPath);
  try {
    const row = db
      .prepare('SELECT id, title, status, current_paragraph_id FROM issues WHERE id = ?')
      .get(issueId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error(`问题卡不存在：${issueId}`);
    }
    return {
      id: String(row.id),
      title: String(row.title),
      status: String(row.status),
      ...(row.current_paragraph_id ? { currentParagraphId: String(row.current_paragraph_id) } : {}),
    };
  } finally {
    db.close();
  }
}

export function createAgentToolRegistry(dbPath: string, options: { runId?: string } = {}): AgentToolRegistry {
  const tools = new Map<string, AgentToolDefinition>();

  function register(definition: AgentToolDefinition): void {
    tools.set(definition.name, definition);
  }

  function insertArtifact(input: Omit<AgentArtifactSummary, 'id' | 'status'>): AgentArtifactSummary {
    if (!options.runId) {
      throw new Error('Agent proposal tools require an active run ID');
    }
    const artifact: AgentArtifactSummary = {
      id: `agent-artifact-${crypto.randomUUID()}`,
      artifactType: input.artifactType,
      title: input.title,
      payload: input.payload,
      status: 'pending_approval',
    };
    const db = openDb(dbPath);
    try {
      db.prepare(
        `INSERT INTO agent_artifacts (id, run_id, artifact_type, title, payload_json, status)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        artifact.id,
        options.runId,
        artifact.artifactType,
        artifact.title,
        JSON.stringify(artifact.payload),
        artifact.status
      );
      return artifact;
    } finally {
      db.close();
    }
  }

  register({
    name: 'read_paragraphs',
    description: 'Read manuscript paragraphs by stable paragraph IDs for evidence.',
    permission: 'read',
    inputSchema: readParagraphsInputSchema,
    handler: (input) => {
      const parsed = readParagraphsInputSchema.parse(input);
      const result = getParagraphReferencesWithMissing(dbPath, parsed.paragraphIds);
      return {
        toolName: 'read_paragraphs',
        permission: 'read',
        output: result,
        sources: result.references.map((reference) => ({
          kind: 'paragraph',
          paragraphId: reference.paragraphId,
          chapterId: reference.chapterId,
          friendlyLocation: reference.friendlyLocation,
        })),
      };
    },
  });

  register({
    name: 'propose_polish',
    description: 'Create a reviewable polish artifact for one paragraph. It does not modify manuscript text.',
    permission: 'proposal',
    inputSchema: proposePolishInputSchema,
    handler: (input) => {
      const parsed = proposePolishInputSchema.parse(input);
      const [reference] = getParagraphReferences(dbPath, [parsed.paragraphId]).references;
      const artifact = insertArtifact({
        artifactType: 'polish_revision',
        title: `润色候选：${reference.friendlyLocation}`,
        payload: {
          paragraphId: parsed.paragraphId,
          friendlyLocation: reference.friendlyLocation,
          beforeText: reference.text,
          afterText: parsed.revisedText,
          editSummary: parsed.editSummary,
          changedFacts: parsed.changedFacts,
          riskFlags: parsed.riskFlags,
        },
      });
      return {
        toolName: 'propose_polish',
        permission: 'proposal',
        output: { artifact },
        sources: [
          {
            kind: 'paragraph',
            paragraphId: reference.paragraphId,
            chapterId: reference.chapterId,
            friendlyLocation: reference.friendlyLocation,
          },
        ],
        artifact,
      };
    },
  });

  register({
    name: 'propose_expansion',
    description: 'Create a reviewable expansion draft after an anchor paragraph. It does not insert manuscript text.',
    permission: 'proposal',
    inputSchema: proposeExpansionInputSchema,
    handler: (input) => {
      const parsed = proposeExpansionInputSchema.parse(input);
      const [reference] = getParagraphReferences(dbPath, [parsed.anchorParagraphId]).references;
      const artifact = insertArtifact({
        artifactType: 'expansion_draft',
        title: `扩写候选：${reference.friendlyLocation} 后`,
        payload: {
          anchorParagraphId: parsed.anchorParagraphId,
          friendlyLocation: reference.friendlyLocation,
          draftText: parsed.draftText,
          summary: parsed.summary,
          coveredBeats: parsed.coveredBeats,
          newFacts: parsed.newFacts,
          riskFlags: parsed.riskFlags,
        },
      });
      return {
        toolName: 'propose_expansion',
        permission: 'proposal',
        output: { artifact },
        sources: [
          {
            kind: 'paragraph',
            paragraphId: reference.paragraphId,
            chapterId: reference.chapterId,
            friendlyLocation: reference.friendlyLocation,
          },
        ],
        artifact,
      };
    },
  });

  register({
    name: 'propose_issue_action',
    description: 'Create a reviewable issue action artifact. It does not update issue status.',
    permission: 'proposal',
    inputSchema: proposeIssueActionInputSchema,
    handler: (input) => {
      const parsed = proposeIssueActionInputSchema.parse(input);
      const issue = readIssueSummary(dbPath, parsed.issueId);
      const artifact = insertArtifact({
        artifactType: 'issue_action',
        title: `问题处理候选：${issue.title}`,
        payload: {
          ...parsed,
          issueTitle: issue.title,
          currentStatus: issue.status,
          currentParagraphId: issue.currentParagraphId ?? null,
        },
      });
      return {
        toolName: 'propose_issue_action',
        permission: 'proposal',
        output: { artifact },
        sources: [{ kind: 'issue', friendlyLocation: issue.title, paragraphId: issue.currentParagraphId }],
        artifact,
      };
    },
  });

  register({
    name: 'propose_memory_update',
    description: 'Create a reviewable memory or canon update artifact. It does not update memory.',
    permission: 'proposal',
    inputSchema: proposeMemoryUpdateInputSchema,
    handler: (input) => {
      const parsed = proposeMemoryUpdateInputSchema.parse(input);
      const sourceReferences = getParagraphReferences(dbPath, parsed.sourceParagraphIds).references;
      const artifact = insertArtifact({
        artifactType: 'memory_update',
        title: `记忆候选：${parsed.title}`,
        payload: {
          ...parsed,
          sources: sourceReferences.map((reference) => ({
            paragraphId: reference.paragraphId,
            chapterId: reference.chapterId,
            friendlyLocation: reference.friendlyLocation,
            textPreview: reference.text.slice(0, 120),
          })),
        },
      });
      return {
        toolName: 'propose_memory_update',
        permission: 'proposal',
        output: { artifact },
        sources: sourceReferences.map((reference) => ({
          kind: 'paragraph',
          paragraphId: reference.paragraphId,
          chapterId: reference.chapterId,
          friendlyLocation: reference.friendlyLocation,
        })),
        artifact,
      };
    },
  });

  register({
    name: 'search_manuscript',
    description: 'Search manuscript paragraphs using the local full-text index.',
    permission: 'read',
    inputSchema: searchManuscriptInputSchema,
    handler: (input) => {
      const parsed = searchManuscriptInputSchema.parse(input);
      const result = searchParagraphs(dbPath, parsed);
      return {
        toolName: 'search_manuscript',
        permission: 'read',
        output: result,
        sources: result.results.map((item) => ({
          kind: 'search_result',
          paragraphId: item.paragraphId,
          chapterId: item.chapterId,
          friendlyLocation: item.friendlyLocation,
        })),
      };
    },
  });

  register({
    name: 'list_issues',
    description: 'List proofreading or continuity issue cards in the current project.',
    permission: 'read',
    inputSchema: listIssuesInputSchema,
    handler: (input) => {
      const parsed = listIssuesInputSchema.parse(input);
      const issues = listIssues(dbPath, parsed);
      return {
        toolName: 'list_issues',
        permission: 'read',
        output: { issues },
        sources: issues.map((issue) => ({
          kind: 'issue',
          ...(issue.currentParagraphId ? { paragraphId: issue.currentParagraphId } : {}),
          friendlyLocation: issue.title,
        })),
      };
    },
  });

  register({
    name: 'build_context_package',
    description: 'Build a bounded context package using current scope, references, and search mentions.',
    permission: 'read',
    inputSchema: buildContextPackageInputSchema,
    handler: (input) => {
      const parsed = buildContextPackageInputSchema.parse(input);
      const context = buildContextPackage(dbPath, {
        ...parsed,
        actionKind: parsed.actionKind as ContextActionKind,
      });
      return {
        toolName: 'build_context_package',
        permission: 'read',
        output: {
          action: context.action,
          contextText: context.contextText,
          sourceList: context.sourceList,
          omittedContextReasons: context.omittedContextReasons,
          tokenEstimate: context.tokenEstimate,
          preflightSummary: context.preflightSummary,
        },
        sources: context.sourceList.map((source) => ({
          kind: source.kind,
          paragraphId: source.paragraphId,
          chapterId: source.chapterId,
          friendlyLocation: source.friendlyLocation ?? source.label,
        })),
      };
    },
  });

  return {
    listDefinitions(options) {
      const allowedPermissions = optionsToPermissionSet(options);
      return Array.from(tools.values())
        .filter((tool) => !allowedPermissions || allowedPermissions.has(tool.permission))
        .map((tool) => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: schemaToToolParameters(tool.inputSchema),
          },
        }));
    },
    permissionFor(toolName) {
      return tools.get(toolName)?.permission ?? null;
    },
    async execute(toolName, input) {
      const tool = tools.get(toolName);
      if (!tool) {
        throw new Error(`Agent tool is not registered: ${toolName}`);
      }
      const output = await tool.handler(input);
      return {
        ...output,
        output: output.output,
      };
    },
  };
}

export function serializeAgentToolResult(result: AgentToolResult): string {
  return formatToolOutput({
    toolName: result.toolName,
    permission: result.permission,
    output: result.output,
    sources: result.sources,
    artifact: result.artifact,
  });
}
