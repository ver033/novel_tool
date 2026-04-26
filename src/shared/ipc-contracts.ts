import { z } from 'zod';

import {
  projectConfigSchema,
  reasoningEffortSchema,
  taskModelProfileSchema,
  taskModelSettingSchema,
  thinkingModeSchema,
} from './project-config-schema';

const emptySchema = z.object({}).strict().default({});
const providerIdSchema = z.enum(['deepseek', 'openrouter']);
const taskTypeSchema = z.enum(['chat', 'polish', 'continuity', 'expand', 'proofread', 'memory']);
const issueStatusSchema = z.enum([
  'open',
  'fixed',
  'ignored',
  'false_positive',
  'marked_as_foreshadowing',
  'marked_as_lie',
  'marked_as_unreliable_narration',
  'author_confirmed_exception',
]);
const currentProjectSchema = z.object({
  projectPath: z.string().min(1),
  dbPath: z.string().min(1),
  name: z.string().min(1),
});
const providerStatusSchema = z.object({
  activeProvider: providerIdSchema.nullable(),
  activeConnection: z
    .object({
      providerId: providerIdSchema,
      status: z.enum(['not_configured', 'configured_untested', 'connected', 'failed']),
      model: z.string().min(1).nullable(),
      testedAt: z.string().min(1).nullable(),
      error: z.string().nullable(),
    })
    .nullable(),
  providers: z.object({
    deepseek: z.object({
      configured: z.boolean(),
      connection: z.object({
        status: z.enum(['not_configured', 'configured_untested', 'connected', 'failed']),
        model: z.string().min(1).nullable(),
        testedAt: z.string().min(1).nullable(),
        error: z.string().nullable(),
      }),
    }),
    openrouter: z.object({
      configured: z.boolean(),
      connection: z.object({
        status: z.enum(['not_configured', 'configured_untested', 'connected', 'failed']),
        model: z.string().min(1).nullable(),
        testedAt: z.string().min(1).nullable(),
        error: z.string().nullable(),
      }),
    }),
  }),
});
const txtImportPreviewChapterSchema = z.object({
  title: z.string(),
  index: z.number().int().min(0),
  paragraphCount: z.number().int().min(0),
  suspiciousHeadingMarkers: z.array(z.string()),
  previewSnippets: z.array(z.string()),
  paragraphs: z.array(z.string()),
});
const txtImportPreviewSchema = z.object({
  sourceFilePath: z.string().min(1),
  fileName: z.string().min(1),
  suggestedProjectName: z.string().min(1),
  detectedEncoding: z.string().min(1),
  chapters: z.array(txtImportPreviewChapterSchema),
  warnings: z.array(z.string()),
});
const manuscriptPickerResponseSchema = z.discriminatedUnion('canceled', [
  z.object({ canceled: z.literal(true) }),
  z.object({
    canceled: z.literal(false),
    filePath: z.string().min(1),
    fileType: z.enum(['txt', 'epub']),
  }),
]);
const projectPickerResponseSchema = z.discriminatedUnion('canceled', [
  z.object({ canceled: z.literal(true) }),
  currentProjectSchema.extend({
    canceled: z.literal(false),
  }),
]);
const chapterListItemSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  index: z.number().int().min(0),
  wordCount: z.number().int().min(0),
  paragraphCount: z.number().int().min(0),
});
const editableParagraphSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().min(0),
  friendlyLabel: z.string().min(1),
  text: z.string(),
  version: z.number().int().min(1),
});
const editableChapterSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  index: z.number().int().min(0),
  paragraphs: z.array(editableParagraphSchema),
});
const paragraphUpdateResponseSchema = z.object({
  paragraphId: z.string().min(1),
  version: z.number().int().min(1),
  changed: z.boolean(),
  updatedAt: z.string().min(1),
});
const revisionListItemSchema = z.object({
  id: z.string().min(1),
  scopeType: z.string().min(1),
  scopeId: z.string().min(1),
  beforeText: z.string(),
  afterText: z.string(),
  diffJson: z.unknown(),
  status: z.string().min(1),
  createdAt: z.string().min(1),
});
const issueEvidenceCardSchema = z.object({
  paragraphId: z.string().min(1).nullable(),
  quote: z.string(),
  role: z.enum(['current', 'conflicting', 'supporting']),
  note: z.string(),
});
const issueCardSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']),
  title: z.string().min(1),
  explanation: z.string().min(1),
  suggestion: z.string(),
  status: issueStatusSchema,
  currentParagraphId: z.string().min(1).nullable(),
  sourceTaskId: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  evidence: z.array(issueEvidenceCardSchema),
});
const polishCandidateSchema = z.object({
  kind: z.literal('polish'),
  revisionId: z.string().min(1),
  paragraphId: z.string().min(1),
  beforeText: z.string(),
  afterText: z.string(),
  diffJson: z.unknown(),
  editSummary: z.string(),
  changedFacts: z.array(z.unknown()),
  riskFlags: z.array(
    z.object({
      type: z.string(),
      description: z.string(),
    })
  ),
});
const expansionCandidateSchema = z.object({
  kind: z.literal('expand'),
  revisionId: z.string().min(1),
  anchorParagraphId: z.string().min(1),
  chapterId: z.string().min(1),
  draftText: z.string().min(1),
  paragraphs: z.array(z.string().min(1)),
  coveredBeats: z.array(
    z.object({
      beat: z.string(),
      covered: z.boolean(),
      note: z.string(),
    })
  ),
  newFacts: z.array(
    z.object({
      fact: z.string(),
      importance: z.enum(['low', 'medium', 'high']),
    })
  ),
  riskFlags: z.array(
    z.object({
      type: z.string(),
      description: z.string(),
    })
  ),
  revisionNotes: z.string(),
});
const candidateAcceptResponseSchema = z.union([
  paragraphUpdateResponseSchema,
  z.object({
    revisionId: z.string().min(1),
    status: z.literal('applied'),
    anchorParagraphId: z.string().min(1),
    chapterId: z.string().min(1),
    insertedParagraphIds: z.array(z.string().min(1)),
    insertedCount: z.number().int().min(1),
    updatedAt: z.string().min(1),
  }),
]);
const searchResultItemSchema = z.object({
  paragraphId: z.string().min(1),
  chapterId: z.string().min(1),
  chapterTitle: z.string(),
  friendlyLocation: z.string().min(1),
  snippet: z.string(),
  text: z.string(),
});
const searchReferenceItemSchema = searchResultItemSchema.omit({ snippet: true });
const jobRecordSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['import_txt', 'index_fts', 'autosave', 'provider_call', 'export_txt', 'import_epub', 'export_epub']),
  status: z.enum(['queued', 'running', 'done', 'error', 'cancelled']),
  progress: z.number().int().min(0).max(100),
  cancellable: z.boolean(),
  inputSummary: z.unknown(),
  result: z.unknown(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
const memoryCardSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['entity', 'fact', 'event', 'world_rule', 'foreshadowing']),
  title: z.string(),
  body: z.string(),
  sourceParagraphId: z.string().min(1).nullable(),
  sourceQuote: z.string(),
  sourceLocation: z.string().min(1).nullable(),
  confidence: z.number(),
  status: z.string().min(1),
  impact: z.string(),
});
const canonImportRecordSchema = z.object({
  id: z.string().min(1),
  headingPath: z.string().min(1),
  recordType: z.string().min(1),
  text: z.string(),
  status: z.string().min(1),
});
const canonListRecordSchema = canonImportRecordSchema.extend({
  sourceId: z.string().min(1),
  sourceFileName: z.string().min(1),
  createdAt: z.string().min(1),
});
const canonListSourceSchema = z.object({
  id: z.string().min(1),
  fileName: z.string().min(1),
  sourceKind: z.enum(['markdown_outline', 'generated_control_doc']),
  importedAt: z.string().min(1),
  recordCount: z.number().int().min(0),
});
const timelineNodeSchema = z.object({
  id: z.string().min(1),
  chapterId: z.string().min(1).nullable(),
  paragraphId: z.string().min(1).nullable(),
  chapterTitle: z.string().min(1).nullable(),
  friendlyLocation: z.string().min(1).nullable(),
  eventOrder: z.number().int().nullable(),
  timeExpression: z.string().min(1).nullable(),
  normalizedTime: z.string().min(1).nullable(),
  summary: z.string().min(1),
  participants: z.array(z.string()),
  confidence: z.number(),
  status: z.string().min(1),
  sourceQuote: z.string(),
});
const exportFormatSchema = z.enum(['txt', 'epub']);
const exportArtifactPreviewSchema = z.object({
  format: exportFormatSchema,
  fileName: z.string().min(1),
  outputPath: z.string().min(1),
  description: z.string().min(1),
  status: z.literal('ready'),
});
const exportPreviewResponseSchema = z.object({
  format: exportFormatSchema,
  chapterCount: z.number().int().min(0),
  characterCount: z.number().int().min(0),
  unresolvedHighRiskIssueCount: z.number().int().min(0),
  defaultOutputPath: z.string().min(1),
  artifacts: z.array(exportArtifactPreviewSchema),
});
const exportRunResponseSchema = z.object({
  format: exportFormatSchema,
  outputPath: z.string().min(1),
  artifactPath: z.string().min(1),
  chapterCount: z.number().int().min(0),
  characterCount: z.number().int().min(0),
  unresolvedHighRiskIssueCount: z.number().int().min(0),
  bytesWritten: z.number().int().min(0),
  jobId: z.string().min(1),
});
const contextActionKindSchema = z.enum(['ask', 'polish', 'expand', 'proofread', 'continuity', 'memory']);
const contextSourceKindSchema = z.enum([
  'selected_text',
  'current_paragraph',
  'previous_paragraph',
  'next_paragraph',
  'reference',
  'search_result',
  'fact',
  'issue',
  'outline',
  'style_guide',
]);
const omittedContextCodeSchema = z.enum([
  'full_book_not_loaded',
  'facts_not_available',
  'style_guide_not_available',
  'issues_not_available',
  'outline_not_available',
  'context_budget_exceeded',
  'missing_anchor_paragraph',
  'missing_current_chapter',
]);
const contextPackageSchema = z.object({
  action: z.object({
    kind: contextActionKindSchema,
    scopeLabel: z.string().min(1),
  }),
  selectedText: z.string().nullable(),
  userInstruction: z.string(),
  contextText: z.string(),
  sourceList: z.array(
    z.object({
      id: z.string().min(1),
      kind: contextSourceKindSchema,
      label: z.string(),
      friendlyLocation: z.string().optional(),
      paragraphId: z.string().optional(),
      chapterId: z.string().optional(),
      textPreview: z.string(),
    })
  ),
  tokenEstimate: z.number().int().min(1),
  characterCount: z.number().int().min(0),
  maxCharacters: z.number().int().min(1),
  preflightSummary: z.string().min(1),
  omittedContextReasons: z.array(
    z.object({
      code: omittedContextCodeSchema,
      detail: z.string().min(1),
    })
  ),
});
const agentTaskModeSchema = z.enum(['ask', 'investigate', 'draft', 'check', 'organize']);
const agentRunStatusSchema = z.enum([
  'completed',
  'blocked_needs_provider',
  'blocked_needs_user_input',
  'blocked_needs_approval',
  'failed_provider',
  'failed_tool_validation',
  'failed_tool_execution',
  'failed_missing_evidence',
  'cancelled',
]);
const agentToolSourceSchema = z.object({
  kind: z.string().min(1),
  paragraphId: z.string().min(1).optional(),
  chapterId: z.string().min(1).optional(),
  friendlyLocation: z.string().min(1),
});
const agentToolResultSchema = z.object({
  toolName: z.string().min(1),
  permission: z.enum(['read', 'proposal']),
  output: z.unknown(),
  sources: z.array(agentToolSourceSchema),
});
const agentArtifactSchema = z.object({
  id: z.string().min(1),
  artifactType: z.enum(['polish_revision', 'expansion_draft', 'issue_action', 'memory_update']),
  title: z.string().min(1),
  payload: z.unknown(),
  status: z.literal('pending_approval'),
});
const agentArtifactDecisionResponseSchema = z.object({
  artifactId: z.string().min(1),
  status: z.enum(['approved', 'rejected']),
  decision: z.enum(['approved', 'rejected']),
  appliedType: z.enum(['polish_revision', 'expansion_draft', 'issue_action', 'memory_update']).nullable(),
  appliedResult: z.unknown(),
});
const agentStepSchema = z.object({
  label: z.string().min(1),
  status: z.string().min(1),
  details: z.record(z.string(), z.unknown()).default({}),
});
const agentChatResponseSchema = z.object({
  runId: z.string().min(1),
  status: agentRunStatusSchema,
  finalAnswer: z.string(),
  error: z.string().nullable(),
  toolResults: z.array(agentToolResultSchema),
  artifacts: z.array(agentArtifactSchema),
  steps: z.array(agentStepSchema),
});
const pendingResponseSchema = z.never();

export const ipcRequestSchemas = {
  'project.create': z.object({
    baseDirectory: z.string().min(1),
    projectName: z.string().min(1),
  }),
  'project.open': z.object({
    projectPath: z.string().min(1),
  }),
  'project.pickExisting': emptySchema,
  'project.getCurrent': emptySchema,
  'chapters.list': emptySchema,
  'chapters.get': z.object({
    chapterId: z.string().min(1),
  }),
  'paragraphs.update': z.object({
    paragraphId: z.string().min(1),
    text: z.string(),
    changeReason: z.string().min(1).optional(),
  }),
  'revisions.list': z.object({
    scopeType: z.string().min(1).optional(),
    scopeId: z.string().min(1).optional(),
  }),
  'revisions.restore': z.object({
    revisionId: z.string().min(1),
  }),
  'revisions.acceptCandidate': z.object({
    revisionId: z.string().min(1),
  }),
  'revisions.rejectCandidate': z.object({
    revisionId: z.string().min(1),
  }),
  'imports.previewTxt': z.object({
    filePath: z.string().min(1),
  }),
  'imports.commitTxt': z.object({
    previewId: z.string().min(1),
    projectName: z.string().min(1),
    baseDirectory: z.string().min(1),
  }),
  'imports.pickManuscript': emptySchema,
  'imports.previewEpub': z.object({
    filePath: z.string().min(1),
  }),
  'imports.commitEpub': z.object({
    previewId: z.string().min(1),
    projectName: z.string().min(1),
    baseDirectory: z.string().min(1),
  }),
  'search.query': z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  'search.addToContext': z.object({
    mode: z.enum(['add', 'replace', 'clear']).default('add'),
    paragraphIds: z.array(z.string().min(1)).default([]),
  }),
  'providers.status': emptySchema,
  'providers.saveKey': z.object({
    providerId: providerIdSchema,
    apiKey: z.string().min(1),
  }),
  'providers.testConnection': z.object({
    providerId: providerIdSchema,
    model: z.string().min(1).optional(),
  }),
  'providers.setActive': z.object({
    providerId: providerIdSchema,
  }),
  'providers.deleteKey': z.object({
    providerId: providerIdSchema,
  }),
  'config.get': emptySchema,
  'config.updateProjectInstructions': z.object({
    customInstructions: z.string(),
  }),
  'config.updateTaskModelProfile': z.object({
    task: taskTypeSchema,
    setting: taskModelSettingSchema,
  }),
  'ai.runTask': z.object({
    task: taskTypeSchema,
    scope: z.record(z.string(), z.unknown()).default({}),
    input: z.record(z.string(), z.unknown()).default({}),
  }),
  'chat.send': z.object({
    sessionId: z.string().min(1).optional(),
    message: z.string().min(1),
    mode: agentTaskModeSchema.default('ask'),
    currentParagraphId: z.string().min(1).optional(),
    selectedParagraphIds: z.array(z.string().min(1)).default([]),
    selectedText: z.string().optional(),
    references: z.array(z.string().min(1)).default([]),
  }),
  'agent.applyArtifact': z.object({
    artifactId: z.string().min(1),
  }),
  'agent.rejectArtifact': z.object({
    artifactId: z.string().min(1),
  }),
  'proofread.runRules': z.object({
    paragraphIds: z.array(z.string().min(1)).min(1),
  }),
  'issues.list': z.object({
    currentParagraphId: z.string().min(1).optional(),
    status: issueStatusSchema.optional(),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  'issues.updateStatus': z.object({
    issueId: z.string().min(1),
    status: issueStatusSchema,
  }),
  'memory.list': emptySchema,
  'memory.updateCard': z.object({
    cardId: z.string().min(1),
    changes: z.record(z.string(), z.unknown()),
  }),
  'canon.list': emptySchema,
  'canon.importMarkdown': z.object({
    filePath: z.string().min(1),
  }),
  'canon.analyzeProject': emptySchema,
  'timeline.query': z.object({
    entityId: z.string().min(1).optional(),
    chapterId: z.string().min(1).optional(),
  }),
  'timeline.analyze': emptySchema,
  'exports.preview': z.object({
    format: z.enum(['txt', 'epub']),
    chapterIds: z.array(z.string().min(1)).optional(),
  }),
  'exports.run': z.object({
    format: z.enum(['txt', 'epub']),
    outputPath: z.string().min(1),
    chapterIds: z.array(z.string().min(1)).optional(),
  }),
  'jobs.subscribe': emptySchema,
} as const;

export const ipcResponseSchemas = {
  'project.create': currentProjectSchema,
  'project.open': currentProjectSchema,
  'project.pickExisting': projectPickerResponseSchema,
  'project.getCurrent': currentProjectSchema.nullable(),
  'chapters.list': z.array(chapterListItemSchema),
  'chapters.get': editableChapterSchema,
  'paragraphs.update': paragraphUpdateResponseSchema,
  'revisions.list': z.array(revisionListItemSchema),
  'revisions.restore': paragraphUpdateResponseSchema,
  'revisions.acceptCandidate': candidateAcceptResponseSchema,
  'revisions.rejectCandidate': z.object({
    revisionId: z.string().min(1),
    status: z.literal('rejected'),
  }),
  'imports.previewTxt': z.object({
    previewId: z.string().min(1),
    preview: txtImportPreviewSchema,
  }),
  'imports.commitTxt': z.object({
    projectPath: z.string().min(1),
    dbPath: z.string().min(1),
    bookId: z.string().min(1),
    chapterCount: z.number().int().min(0),
    paragraphCount: z.number().int().min(0),
    originalCopyPath: z.string().min(1),
  }),
  'imports.pickManuscript': manuscriptPickerResponseSchema,
  'imports.previewEpub': z.object({
    previewId: z.string().min(1),
    preview: txtImportPreviewSchema,
  }),
  'imports.commitEpub': z.object({
    projectPath: z.string().min(1),
    dbPath: z.string().min(1),
    bookId: z.string().min(1),
    chapterCount: z.number().int().min(0),
    paragraphCount: z.number().int().min(0),
    originalCopyPath: z.string().min(1),
  }),
  'search.query': z.object({
    query: z.string().min(1),
    results: z.array(searchResultItemSchema),
  }),
  'search.addToContext': z.object({
    references: z.array(searchReferenceItemSchema),
  }),
  'providers.status': providerStatusSchema,
  'providers.saveKey': z.object({
    providerId: providerIdSchema,
    configured: z.literal(true),
    activeProvider: providerIdSchema,
  }),
  'providers.testConnection': z.object({
    providerId: providerIdSchema,
    model: z.string().min(1),
    ok: z.literal(true),
    contentPreview: z.string(),
  }),
  'providers.setActive': z.object({
    activeProvider: providerIdSchema,
  }),
  'providers.deleteKey': z.object({
    providerId: providerIdSchema,
    deleted: z.literal(true),
    activeProvider: providerIdSchema.nullable(),
  }),
  'config.get': projectConfigSchema,
  'config.updateProjectInstructions': projectConfigSchema,
  'config.updateTaskModelProfile': taskModelProfileSchema,
	  'ai.runTask': z.discriminatedUnion('status', [
    z.object({
      taskId: z.string().min(1),
      status: z.literal('preflight_ready'),
      providerId: providerIdSchema,
      modelName: z.string().min(1),
      reasoning: z.object({
        reasoningEffort: reasoningEffortSchema,
        thinkingMode: thinkingModeSchema,
      }),
      context: contextPackageSchema,
    }),
	    z.object({
	      taskId: z.string().min(1),
	      status: z.literal('candidate_ready'),
      providerId: providerIdSchema,
      modelName: z.string().min(1),
      reasoning: z.object({
        reasoningEffort: reasoningEffortSchema,
        thinkingMode: thinkingModeSchema,
      }),
      context: contextPackageSchema,
	      candidate: z.discriminatedUnion('kind', [polishCandidateSchema, expansionCandidateSchema]),
	    }),
	    z.object({
	      taskId: z.string().min(1),
	      status: z.literal('issues_ready'),
	      providerId: providerIdSchema,
	      modelName: z.string().min(1),
	      reasoning: z.object({
	        reasoningEffort: reasoningEffortSchema,
	        thinkingMode: thinkingModeSchema,
	      }),
	      context: contextPackageSchema,
	      issues: z.array(issueCardSchema),
	      checkedParagraphCount: z.number().int().min(0),
	    }),
	  ]),
	  'chat.send': agentChatResponseSchema,
  'agent.applyArtifact': agentArtifactDecisionResponseSchema,
  'agent.rejectArtifact': agentArtifactDecisionResponseSchema,
	  'proofread.runRules': z.object({
	    issues: z.array(issueCardSchema),
	    checkedParagraphCount: z.number().int().min(0),
	  }),
	  'issues.list': z.object({
	    issues: z.array(issueCardSchema),
	  }),
  'issues.updateStatus': issueCardSchema,
  'memory.list': z.object({
    cards: z.array(memoryCardSchema),
  }),
  'memory.updateCard': memoryCardSchema,
  'canon.list': z.object({
    sources: z.array(canonListSourceSchema),
    records: z.array(canonListRecordSchema),
  }),
  'canon.importMarkdown': z.object({
    sourceId: z.string().min(1),
    fileName: z.string().min(1),
    sourceKind: z.literal('markdown_outline'),
    copiedPath: z.string().min(1),
    recordCount: z.number().int().min(0),
    records: z.array(canonImportRecordSchema),
  }),
  'canon.analyzeProject': z.object({
    sourceKind: z.literal('generated_control_doc'),
    fileNames: z.array(z.string().min(1)),
    recordCount: z.number().int().min(0),
    records: z.array(canonImportRecordSchema),
  }),
  'timeline.query': z.object({
    nodes: z.array(timelineNodeSchema),
  }),
  'timeline.analyze': z.object({
    nodes: z.array(timelineNodeSchema),
    createdCount: z.number().int().min(0),
    updatedCount: z.number().int().min(0),
    skippedCount: z.number().int().min(0),
    warnings: z.array(z.string()),
  }),
  'exports.preview': exportPreviewResponseSchema,
  'exports.run': exportRunResponseSchema,
  'jobs.subscribe': z.object({
    jobs: z.array(jobRecordSchema),
  }),
} as const;

export type IpcChannel = keyof typeof ipcRequestSchemas;
export type IpcRequest<C extends IpcChannel> = z.input<(typeof ipcRequestSchemas)[C]>;
export type IpcParsedRequest<C extends IpcChannel> = z.output<(typeof ipcRequestSchemas)[C]>;
export type IpcResponse<C extends IpcChannel> = z.output<(typeof ipcResponseSchemas)[C]>;

export function validateIpcRequest<C extends IpcChannel>(channel: C, payload: unknown): IpcParsedRequest<C> {
  return ipcRequestSchemas[channel].parse(payload) as IpcParsedRequest<C>;
}

export function validateIpcResponse<C extends IpcChannel>(channel: C, payload: unknown): IpcResponse<C> {
  return ipcResponseSchemas[channel].parse(payload) as IpcResponse<C>;
}
