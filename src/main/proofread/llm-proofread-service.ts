import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { z } from 'zod';

import type { LlmMessage } from '../llm/provider-adapters';
import { listIssues, type IssueCard } from './proofread-service';

type SqliteDb = InstanceType<typeof Database>;

const llmProofreadIssueSchema = z.object({
  paragraph_id: z.string().min(1),
  type: z.enum([
    'typo',
    'punctuation',
    'name_consistency',
    'term_consistency',
    'awkward_expression',
    'context_gap',
    'possible_contradiction',
    'other',
  ]),
  severity: z.enum(['low', 'medium', 'high']),
  title: z.string().min(1),
  quote: z.string().min(1),
  explanation: z.string().min(1),
  suggestion: z.string().default(''),
  needs_user_judgment: z.boolean().default(true),
});

const llmProofreadStructuredOutputSchema = z.object({
  issues: z.array(llmProofreadIssueSchema).default([]),
});

export interface LlmProofreadIssue {
  paragraphId: string;
  type: z.infer<typeof llmProofreadIssueSchema>['type'];
  severity: IssueCard['severity'];
  title: string;
  quote: string;
  explanation: string;
  suggestion: string;
  needsUserJudgment: boolean;
}

export interface LlmProofreadStructuredOutput {
  issues: LlmProofreadIssue[];
}

export interface PersistLlmProofreadIssuesInput {
  sourceTaskId: string;
  structuredOutput: LlmProofreadStructuredOutput;
}

function openDb(dbPath: string): SqliteDb {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  return db;
}

function shortHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 14);
}

function parseJsonObject(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('LLM 校对输出结构无效：不是合法 JSON');
  }
}

function issueIdFor(issue: LlmProofreadIssue): string {
  return `issue-llm-${shortHash(`${issue.paragraphId}:${issue.type}:${issue.title}:${issue.quote}`)}`;
}

function evidenceIdFor(issueId: string, paragraphId: string, quote: string): string {
  return `iev-${shortHash(`${issueId}:${paragraphId}:${quote}`)}`;
}

function readParagraphTextMap(db: SqliteDb, paragraphIds: string[]): Map<string, string> {
  const uniqueIds = [...new Set(paragraphIds)];
  const map = new Map<string, string>();
  if (uniqueIds.length === 0) {
    return map;
  }
  const rows = db
    .prepare(`SELECT id, text FROM paragraphs WHERE id IN (${uniqueIds.map(() => '?').join(',')})`)
    .all(...uniqueIds) as Array<Record<string, unknown>>;
  for (const row of rows) {
    map.set(String(row.id), String(row.text));
  }
  return map;
}

export function parseLlmProofreadStructuredOutput(raw: string | unknown): LlmProofreadStructuredOutput {
  const parsed = llmProofreadStructuredOutputSchema.safeParse(typeof raw === 'string' ? parseJsonObject(raw) : raw);
  if (!parsed.success) {
    throw new Error(`LLM 校对输出结构无效：${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }
  return {
    issues: parsed.data.issues.map((issue) => ({
      paragraphId: issue.paragraph_id,
      type: issue.type,
      severity: issue.severity,
      title: issue.title,
      quote: issue.quote,
      explanation: issue.explanation,
      suggestion: issue.suggestion,
      needsUserJudgment: issue.needs_user_judgment,
    })),
  };
}

export function buildLlmProofreadPromptMessages(context: {
  selectedText: string | null;
  userInstruction: string;
  contextText: string;
  sourceList?: Array<{
    paragraphId?: string;
    friendlyLocation?: string;
    label: string;
    kind: string;
    textPreview: string;
  }>;
}): LlmMessage[] {
  const sourceListText =
    context.sourceList && context.sourceList.length > 0
      ? context.sourceList
          .filter((source) => source.paragraphId)
          .map(
            (source) =>
              `- paragraph_id=${source.paragraphId}; location=${source.friendlyLocation ?? source.label}; kind=${source.kind}; preview=${source.textPreview}`
          )
          .join('\n')
      : '无可用 paragraph_id。';
  return [
    {
      role: 'system',
      content:
        '你是中文长篇小说校对助手。你必须基于提供的上下文指出错字、标点、称谓、术语、局部表达和前后不搭风险。必须给出原文证据和 paragraph_id。只返回 JSON，不要输出解释文本。',
    },
    {
      role: 'user',
      content: [
        '任务：校对中文小说文本。',
        '不要直接改写正文；只给问题卡建议。',
        '只使用提供的上下文，不要补造人物、设定或未给出的事实。',
        'quote 必须是对应 paragraph_id 中连续出现的原文证据。',
        `用户要求：${context.userInstruction || '优先检查错字、标点、称谓、表达别扭和前后不搭。'}`,
        '',
        '可用段落 ID 列表：',
        sourceListText,
        '',
        '上下文：',
        context.contextText,
        '',
        '选中文本：',
        context.selectedText ?? '',
        '',
        '只返回符合以下字段的 JSON：',
        JSON.stringify(
          {
            issues: [
              {
                paragraph_id: 'string',
                type:
                  'typo|punctuation|name_consistency|term_consistency|awkward_expression|context_gap|possible_contradiction|other',
                severity: 'low|medium|high',
                title: 'string',
                quote: 'string',
                explanation: 'string',
                suggestion: 'string',
                needs_user_judgment: true,
              },
            ],
          },
          null,
          2
        ),
      ].join('\n'),
    },
  ];
}

export function persistLlmProofreadIssues(
  dbPath: string,
  input: PersistLlmProofreadIssuesInput
): { issues: IssueCard[]; checkedParagraphCount: number } {
  const db = openDb(dbPath);
  try {
    const paragraphIds = [...new Set(input.structuredOutput.issues.map((issue) => issue.paragraphId))];
    const paragraphs = readParagraphTextMap(db, paragraphIds);
    const timestamp = new Date().toISOString();
    const issueIds: string[] = [];

    const write = db.transaction(() => {
      for (const issue of input.structuredOutput.issues) {
        const paragraphText = paragraphs.get(issue.paragraphId);
        if (paragraphText === undefined) {
          throw new Error(`LLM 校对引用了不存在的段落：${issue.paragraphId}`);
        }
        if (!paragraphText.includes(issue.quote)) {
          throw new Error(`LLM 校对引用不在对应段落中：${issue.paragraphId}`);
        }

        const issueId = issueIdFor(issue);
        issueIds.push(issueId);
        db.prepare(
          `INSERT INTO issues
           (id, type, severity, title, explanation, suggestion, status, current_paragraph_id, source_task_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             severity = excluded.severity,
             title = excluded.title,
             explanation = excluded.explanation,
             suggestion = excluded.suggestion,
             source_task_id = excluded.source_task_id,
             updated_at = excluded.updated_at`
        ).run(
          issueId,
          `proofread_llm_${issue.type}`,
          issue.severity,
          issue.title,
          issue.explanation,
          issue.suggestion,
          issue.paragraphId,
          input.sourceTaskId,
          timestamp,
          timestamp
        );
        db.prepare(
          `INSERT OR IGNORE INTO issue_evidence
           (id, issue_id, paragraph_id, quote, role, note)
           VALUES (?, ?, ?, ?, 'current', ?)`
        ).run(
          evidenceIdFor(issueId, issue.paragraphId, issue.quote),
          issueId,
          issue.paragraphId,
          issue.quote,
          issue.needsUserJudgment ? 'LLM 校对，需要作者判断' : 'LLM 校对'
        );
      }
    });
    write();

    const storedIssues = listIssues(dbPath, {
      status: 'open',
      limit: Math.max(issueIds.length, 1),
    }).filter((issue) => issueIds.includes(issue.id));
    return {
      issues: storedIssues,
      checkedParagraphCount: paragraphIds.length,
    };
  } finally {
    db.close();
  }
}
