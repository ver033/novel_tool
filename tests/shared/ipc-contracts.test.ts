import { describe, expect, test } from 'vitest';

import {
  ipcRequestSchemas,
  ipcResponseSchemas,
  validateIpcRequest,
  validateIpcResponse,
} from '../../src/shared/ipc-contracts';

const expectedChannels = [
  'project.create',
  'project.open',
  'project.pickExisting',
  'project.getCurrent',
  'chapters.list',
  'chapters.get',
  'paragraphs.update',
  'revisions.list',
  'revisions.restore',
  'revisions.acceptCandidate',
  'revisions.rejectCandidate',
  'imports.previewTxt',
  'imports.commitTxt',
  'imports.pickManuscript',
  'imports.previewEpub',
  'imports.commitEpub',
  'search.query',
  'search.addToContext',
  'providers.status',
  'providers.saveKey',
  'providers.testConnection',
  'providers.setActive',
  'providers.deleteKey',
  'config.get',
  'config.updateProjectInstructions',
  'config.updateTaskModelProfile',
  'ai.runTask',
  'chat.send',
  'agent.applyArtifact',
  'agent.rejectArtifact',
  'proofread.runRules',
  'issues.list',
  'issues.updateStatus',
  'memory.list',
  'memory.updateCard',
  'canon.list',
  'canon.importMarkdown',
  'canon.analyzeProject',
  'timeline.query',
  'timeline.analyze',
  'exports.preview',
  'exports.run',
  'jobs.subscribe',
] as const;

describe('IPC contracts', () => {
  test('declares every approved renderer channel', () => {
    expect(Object.keys(ipcRequestSchemas).sort()).toEqual([...expectedChannels].sort());
    expect(Object.keys(ipcResponseSchemas).sort()).toEqual([...expectedChannels].sort());
  });

  test('validates project creation input', () => {
    const parsed = validateIpcRequest('project.create', {
      baseDirectory: '/tmp',
      projectName: '长夜试稿',
    });

    expect(parsed).toEqual({
      baseDirectory: '/tmp',
      projectName: '长夜试稿',
    });
  });

  test('validates picked existing project response shape', () => {
    const canceled = validateIpcResponse('project.pickExisting', { canceled: true });
    expect(canceled).toEqual({ canceled: true });

    const opened = validateIpcResponse('project.pickExisting', {
      canceled: false,
      projectPath: '/tmp/长夜.novelproj',
      dbPath: '/tmp/长夜.novelproj/book.db',
      name: '长夜',
    });

    expect(opened).toEqual({
      canceled: false,
      projectPath: '/tmp/长夜.novelproj',
      dbPath: '/tmp/长夜.novelproj/book.db',
      name: '长夜',
    });
  });

  test('rejects invalid provider activation', () => {
    expect(() => validateIpcRequest('providers.setActive', { providerId: 'ollama' })).toThrow();
  });

  test('validates provider key deletion shape', () => {
    const request = validateIpcRequest('providers.deleteKey', { providerId: 'deepseek' });
    expect(request).toEqual({ providerId: 'deepseek' });

    const response = validateIpcResponse('providers.deleteKey', {
      providerId: 'deepseek',
      deleted: true,
      activeProvider: null,
    });
    expect(response).toEqual({
      providerId: 'deepseek',
      deleted: true,
      activeProvider: null,
    });
  });

  test('validates agent chat request and response shapes', () => {
    const request = validateIpcRequest('chat.send', {
      message: '@当前段落 查一下铜钥匙有没有矛盾',
      mode: 'investigate',
      currentParagraphId: 'para-1',
      references: ['para-2'],
    });

    expect(request).toMatchObject({
      message: '@当前段落 查一下铜钥匙有没有矛盾',
      mode: 'investigate',
      currentParagraphId: 'para-1',
      references: ['para-2'],
    });

    const response = validateIpcResponse('chat.send', {
      runId: 'agent-run-1',
      status: 'completed',
      finalAnswer: '没有发现矛盾。',
      error: null,
      toolResults: [
        {
          toolName: 'read_paragraphs',
          permission: 'read',
          output: { references: [] },
          sources: [
            {
              kind: 'paragraph',
              paragraphId: 'para-1',
              chapterId: 'chapter-1',
              friendlyLocation: '第一章 / 第 1 段',
            },
          ],
        },
      ],
      artifacts: [
        {
          id: 'agent-artifact-1',
          artifactType: 'polish_revision',
          title: '润色候选：第一章 / 第 1 段',
          payload: { paragraphId: 'para-1' },
          status: 'pending_approval',
        },
      ],
      steps: [
        {
          label: 'model turn 1',
          status: 'completed',
          details: { modelName: 'deepseek-v4-pro' },
        },
      ],
    });

    expect(response.status).toBe('completed');
    expect(response.artifacts[0].artifactType).toBe('polish_revision');
    expect(response.toolResults[0].sources[0].friendlyLocation).toBe('第一章 / 第 1 段');
  });

  test('validates provider status response shape', () => {
    const parsed = validateIpcResponse('providers.status', {
      activeProvider: 'deepseek',
      activeConnection: {
        status: 'connected',
        providerId: 'deepseek',
        model: 'deepseek-v4-flash',
        testedAt: '2026-04-24T00:00:00.000Z',
        error: null,
      },
      providers: {
        deepseek: {
          configured: true,
          connection: {
            status: 'connected',
            model: 'deepseek-v4-flash',
            testedAt: '2026-04-24T00:00:00.000Z',
            error: null,
          },
        },
        openrouter: {
          configured: false,
          connection: {
            status: 'not_configured',
            model: null,
            testedAt: null,
            error: null,
          },
        },
      },
    });

    expect(parsed).toEqual({
      activeProvider: 'deepseek',
      activeConnection: {
        status: 'connected',
        providerId: 'deepseek',
        model: 'deepseek-v4-flash',
        testedAt: '2026-04-24T00:00:00.000Z',
        error: null,
      },
      providers: {
        deepseek: {
          configured: true,
          connection: {
            status: 'connected',
            model: 'deepseek-v4-flash',
            testedAt: '2026-04-24T00:00:00.000Z',
            error: null,
          },
        },
        openrouter: {
          configured: false,
          connection: {
            status: 'not_configured',
            model: null,
            testedAt: null,
            error: null,
          },
        },
      },
    });
  });

  test('validates agent artifact decision shapes', () => {
    const request = validateIpcRequest('agent.applyArtifact', {
      artifactId: 'agent-artifact-1',
    });
    expect(request.artifactId).toBe('agent-artifact-1');

    const response = validateIpcResponse('agent.applyArtifact', {
      artifactId: 'agent-artifact-1',
      status: 'approved',
      decision: 'approved',
      appliedType: 'polish_revision',
      appliedResult: {
        paragraphId: 'para-1',
        version: 2,
      },
    });

    expect(response.status).toBe('approved');
    expect(response.appliedType).toBe('polish_revision');
  });

  test('validates provider connection test response shape', () => {
    const parsed = validateIpcResponse('providers.testConnection', {
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      ok: true,
      contentPreview: 'OK',
    });

    expect(parsed).toEqual({
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      ok: true,
      contentPreview: 'OK',
    });
  });

  test('validates manuscript picker response shape', () => {
    const parsed = validateIpcResponse('imports.pickManuscript', {
      canceled: false,
      filePath: '/tmp/长夜.txt',
      fileType: 'txt',
    });

    expect(parsed).toEqual({
      canceled: false,
      filePath: '/tmp/长夜.txt',
      fileType: 'txt',
    });
  });

  test('validates chapter editor response shapes', () => {
    const chapters = validateIpcResponse('chapters.list', [
      { id: 'chap-1', title: '第一章', index: 0, wordCount: 1200, paragraphCount: 18 },
    ]);
    const chapter = validateIpcResponse('chapters.get', {
      id: 'chap-1',
      title: '第一章',
      index: 0,
      paragraphs: [
        { id: 'para-1', index: 0, friendlyLabel: '第 1 段', text: '她推开门。', version: 1 },
      ],
    });
    const update = validateIpcResponse('paragraphs.update', {
      paragraphId: 'para-1',
      version: 2,
      changed: true,
      updatedAt: '2026-04-24T00:00:00.000Z',
    });
    const restore = validateIpcResponse('revisions.restore', {
      paragraphId: 'para-1',
      version: 3,
      changed: true,
      updatedAt: '2026-04-24T00:00:01.000Z',
    });

    expect(chapters[0].paragraphCount).toBe(18);
    expect(chapter.paragraphs[0].friendlyLabel).toBe('第 1 段');
    expect(update.changed).toBe(true);
    expect(restore.version).toBe(3);
  });

  test('validates search response shapes', () => {
    const search = validateIpcResponse('search.query', {
      query: '斗之力',
      results: [
        {
          paragraphId: 'para-1',
          chapterId: 'chap-1',
          chapterTitle: '第1章',
          friendlyLocation: '第1章 / 第 1 段',
          snippet: '“斗之力，三段！”',
          text: '“斗之力，三段！”',
        },
      ],
    });
    const references = validateIpcResponse('search.addToContext', {
      references: [
        {
          paragraphId: 'para-1',
          chapterId: 'chap-1',
          chapterTitle: '第1章',
          friendlyLocation: '第1章 / 第 1 段',
          text: '“斗之力，三段！”',
        },
      ],
    });
    const replaceRequest = validateIpcRequest('search.addToContext', {
      mode: 'replace',
      paragraphIds: ['para-1'],
    });
    const clearRequest = validateIpcRequest('search.addToContext', {
      mode: 'clear',
      paragraphIds: [],
    });

    expect(search.results[0].snippet).toContain('斗之力');
    expect(references.references[0].friendlyLocation).toContain('第 1 段');
    expect(replaceRequest.mode).toBe('replace');
    expect(clearRequest.paragraphIds).toEqual([]);
  });

  test('validates global project page response shapes', () => {
    const memory = validateIpcResponse('memory.list', {
      cards: [
        {
          id: 'fact:fact-1',
          kind: 'fact',
          title: '状态',
          body: '铜钥匙被丢入泥水',
          sourceParagraphId: 'para-1',
          sourceQuote: '铜钥匙滚进泥水。',
          sourceLocation: '第十章 / 第 12 段',
          confidence: 0.82,
          status: 'ai_extracted',
          impact: '连续性、道具状态',
        },
      ],
    });
    const canon = validateIpcResponse('canon.importMarkdown', {
      sourceId: 'canon-source-1',
      fileName: 'outline.md',
      sourceKind: 'markdown_outline',
      copiedPath: '/tmp/project.novelproj/outlines/outline.md',
      recordCount: 1,
      records: [
        {
          id: 'outline-record-1',
          headingPath: '卷二 > 第十章',
          recordType: 'chapter_roadmap',
          text: '陈砚公开丢弃铜钥匙',
          status: 'ai_extracted',
        },
      ],
    });
    const analyzedCanon = validateIpcResponse('canon.analyzeProject', {
      sourceKind: 'generated_control_doc',
      fileNames: ['00-project-overview.md', '09-style-guide.md'],
      recordCount: 2,
      records: [
        {
          id: 'outline-record-2',
          headingPath: '章节路线图',
          recordType: 'chapter_roadmap',
          text: '第一章：开场',
          status: 'ai_extracted',
        },
      ],
    });
    const canonList = validateIpcResponse('canon.list', {
      sources: [
        {
          id: 'canon-source-1',
          fileName: 'outline.md',
          sourceKind: 'generated_control_doc',
          importedAt: '2026-04-25T00:00:00.000Z',
          recordCount: 1,
        },
      ],
      records: [
        {
          id: 'outline-record-1',
          sourceId: 'canon-source-1',
          sourceFileName: 'outline.md',
          headingPath: '卷二 > 第十章',
          recordType: 'chapter_roadmap',
          text: '陈砚公开丢弃铜钥匙',
          status: 'ai_extracted',
          createdAt: '2026-04-25T00:00:00.000Z',
        },
      ],
    });
    const timeline = validateIpcResponse('timeline.query', {
      nodes: [
        {
          id: 'event-1',
          chapterId: 'chap-1',
          paragraphId: 'para-1',
          chapterTitle: '第十章',
          friendlyLocation: '第十章 / 第 12 段',
          eventOrder: 10,
          timeExpression: '雨夜',
          normalizedTime: 'chapter-10-night',
          summary: '陈砚把铜钥匙丢进泥水',
          participants: ['陈砚', '铜钥匙'],
          confidence: 0.88,
          status: 'ai_extracted',
          sourceQuote: '铜钥匙滚进泥水。',
        },
      ],
    });
    const timelineAnalyze = validateIpcResponse('timeline.analyze', {
      nodes: timeline.nodes,
      createdCount: 1,
      updatedCount: 0,
      skippedCount: 0,
      warnings: [],
    });
    const exportPreview = validateIpcResponse('exports.preview', {
      format: 'txt',
      chapterCount: 5,
      characterCount: 12000,
      unresolvedHighRiskIssueCount: 0,
      defaultOutputPath: '/tmp/project.novelproj/exports/book.txt',
      artifacts: [
        {
          format: 'txt',
          fileName: 'book.txt',
          outputPath: '/tmp/project.novelproj/exports/book.txt',
          description: '保留章节标题和段落换行',
          status: 'ready',
        },
      ],
    });
    const exportRun = validateIpcResponse('exports.run', {
      format: 'txt',
      outputPath: '/tmp/project.novelproj/exports/book.txt',
      artifactPath: '/tmp/project.novelproj/exports/book.txt',
      chapterCount: 5,
      characterCount: 12000,
      unresolvedHighRiskIssueCount: 0,
      bytesWritten: 32000,
      jobId: 'job-1',
    });

    expect(memory.cards[0].sourceLocation).toBe('第十章 / 第 12 段');
    expect(canonList.records[0].sourceFileName).toBe('outline.md');
    expect(canon.records[0].recordType).toBe('chapter_roadmap');
    expect(analyzedCanon.sourceKind).toBe('generated_control_doc');
    expect(timeline.nodes[0].participants).toContain('铜钥匙');
    expect(timelineAnalyze.createdCount).toBe(1);
    expect(exportPreview.artifacts[0].status).toBe('ready');
    expect(exportRun.bytesWritten).toBe(32000);
  });

  test('validates job strip snapshot response shape', () => {
    const jobs = validateIpcResponse('jobs.subscribe', {
      jobs: [
        {
          id: 'job-1',
          type: 'index_fts',
          status: 'done',
          progress: 100,
          cancellable: true,
          inputSummary: { source: 'test.txt' },
          result: { indexedParagraphs: 5 },
          startedAt: null,
          finishedAt: '2026-04-24T00:00:00.000Z',
          error: null,
          createdAt: '2026-04-24T00:00:00.000Z',
          updatedAt: '2026-04-24T00:00:00.000Z',
        },
      ],
    });

    expect(jobs.jobs[0].type).toBe('index_fts');
  });

  test('validates AI task preflight response shape', () => {
    const preflight = validateIpcResponse('ai.runTask', {
      taskId: 'task-1',
      status: 'preflight_ready',
      providerId: 'deepseek',
      modelName: 'deepseek-v4-pro',
      reasoning: {
        reasoningEffort: 'high',
        thinkingMode: 'enabled',
      },
      context: {
        action: {
          kind: 'polish',
          scopeLabel: '第1章 / 第 2 段',
        },
        selectedText: '她推开门。',
        userInstruction: '更克制',
        contextText: '[selected_text]\n她推开门。',
        sourceList: [
          {
            id: 'current_paragraph:para-1',
            kind: 'current_paragraph',
            label: 'current_paragraph',
            friendlyLocation: '第1章 / 第 2 段',
            paragraphId: 'para-1',
            chapterId: 'chap-1',
            textPreview: '她推开门。',
          },
        ],
        tokenEstimate: 20,
        characterCount: 20,
        maxCharacters: 6000,
        preflightSummary: 'polish / 第1章 / 第 2 段 / 1 个来源 / 约 20 tokens / 省略 1 项',
        omittedContextReasons: [
          {
            code: 'full_book_not_loaded',
            detail: '默认不装入整本书。',
          },
        ],
      },
    });

    expect(preflight.status).toBe('preflight_ready');
    expect(preflight.context.sourceList[0].friendlyLocation).toContain('第 2 段');
  });

  test('validates AI polish candidate and candidate decision response shapes', () => {
    const candidate = validateIpcResponse('ai.runTask', {
      taskId: 'task-1',
      status: 'candidate_ready',
      providerId: 'deepseek',
      modelName: 'deepseek-v4-pro',
      reasoning: {
        reasoningEffort: 'high',
        thinkingMode: 'enabled',
      },
      context: {
        action: { kind: 'polish', scopeLabel: '第1章 / 第 2 段' },
        selectedText: '她推开门。',
        userInstruction: '更克制',
        contextText: '[selected_text]\n她推开门。',
        sourceList: [],
        tokenEstimate: 20,
        characterCount: 20,
        maxCharacters: 6000,
        preflightSummary: 'polish / 第1章 / 第 2 段 / 0 个来源 / 约 20 tokens / 省略 1 项',
        omittedContextReasons: [{ code: 'full_book_not_loaded', detail: '默认不装入整本书。' }],
      },
      candidate: {
        kind: 'polish',
        revisionId: 'rev-1',
        paragraphId: 'para-1',
        beforeText: '她推开门。',
        afterText: '她缓缓推开门。',
        diffJson: [{ value: '她', count: 1 }],
        editSummary: '加了动作节奏。',
        changedFacts: [],
        riskFlags: [],
      },
    });
    const accept = validateIpcResponse('revisions.acceptCandidate', {
      paragraphId: 'para-1',
      version: 2,
      changed: true,
      updatedAt: '2026-04-24T00:00:00.000Z',
    });
    const reject = validateIpcResponse('revisions.rejectCandidate', {
      revisionId: 'rev-1',
      status: 'rejected',
    });

    expect(candidate.status).toBe('candidate_ready');
    if ('version' in accept) {
      expect(accept.version).toBe(2);
    } else {
      throw new Error('expected paragraph candidate accept response');
    }
    expect(reject.status).toBe('rejected');
  });

  test('validates AI expansion candidate and insertion accept response shape', () => {
    const candidate = validateIpcResponse('ai.runTask', {
      taskId: 'task-expand-1',
      status: 'candidate_ready',
      providerId: 'deepseek',
      modelName: 'deepseek-v4-pro',
      reasoning: {
        reasoningEffort: 'high',
        thinkingMode: 'enabled',
      },
      context: {
        action: { kind: 'expand', scopeLabel: '第1章 / 第 2 段' },
        selectedText: '她推开门。',
        userInstruction: '扩写下一幕',
        contextText: '[current_paragraph]\n她推开门。',
        sourceList: [],
        tokenEstimate: 20,
        characterCount: 20,
        maxCharacters: 6000,
        preflightSummary: 'expand / 第1章 / 第 2 段 / 0 个来源 / 约 20 tokens / 省略 1 项',
        omittedContextReasons: [{ code: 'full_book_not_loaded', detail: '默认不装入整本书。' }],
      },
      candidate: {
        kind: 'expand',
        revisionId: 'rev-2',
        anchorParagraphId: 'para-1',
        chapterId: 'chap-1',
        draftText: '她停在门边。\n风把灯吹暗。',
        paragraphs: ['她停在门边。', '风把灯吹暗。'],
        coveredBeats: [{ beat: '停在门边', covered: true, note: '已写' }],
        newFacts: [],
        riskFlags: [],
        revisionNotes: '两段插入。',
      },
    });
    const accept = validateIpcResponse('revisions.acceptCandidate', {
      revisionId: 'rev-2',
      status: 'applied',
      anchorParagraphId: 'para-1',
      chapterId: 'chap-1',
      insertedParagraphIds: ['para-ins-0001-0002-test'],
      insertedCount: 1,
      updatedAt: '2026-04-24T00:00:00.000Z',
    });

    expect(candidate.status).toBe('candidate_ready');
    if (candidate.status === 'candidate_ready') {
      expect(candidate.candidate.kind).toBe('expand');
    }
    if ('insertedCount' in accept) {
      expect(accept.insertedCount).toBe(1);
    } else {
      throw new Error('expected insertion accept response');
    }
  });

  test('validates proofreading issue list, status update, and AI issue response shapes', () => {
    const issue = {
      id: 'issue-1',
      type: 'proofread_quote_mismatch',
      severity: 'medium',
      title: '引号可能未闭合',
      explanation: '第一章 / 第 1 段：中文引号数量不成对。',
      suggestion: '补齐引号。',
      status: 'open',
      currentParagraphId: 'para-1',
      sourceTaskId: 'task-proofread-1',
      createdAt: '2026-04-24T00:00:00.000Z',
      updatedAt: '2026-04-24T00:00:00.000Z',
      evidence: [
        {
          paragraphId: 'para-1',
          quote: '他说：“钥匙还在门口。',
          role: 'current',
          note: '引号配对检查',
        },
      ],
    };
    const listRequest = validateIpcRequest('issues.list', {
      currentParagraphId: 'para-1',
      status: 'open',
    });
    const runRulesRequest = validateIpcRequest('proofread.runRules', {
      paragraphIds: ['para-1'],
    });
    const runRules = validateIpcResponse('proofread.runRules', {
      issues: [issue],
      checkedParagraphCount: 1,
    });
    const list = validateIpcResponse('issues.list', { issues: [issue] });
    const update = validateIpcResponse('issues.updateStatus', {
      ...issue,
      status: 'false_positive',
      updatedAt: '2026-04-24T00:00:01.000Z',
    });
    const aiResult = validateIpcResponse('ai.runTask', {
      taskId: 'task-proofread-1',
      status: 'issues_ready',
      providerId: 'deepseek',
      modelName: 'deepseek-v4-flash',
      reasoning: {
        reasoningEffort: 'high',
        thinkingMode: 'disabled',
      },
      context: {
        action: { kind: 'proofread', scopeLabel: '第1章 / 第 1 段' },
        selectedText: '他说：“钥匙还在门口。',
        userInstruction: '校对',
        contextText: '[current_paragraph]\n他说：“钥匙还在门口。',
        sourceList: [],
        tokenEstimate: 20,
        characterCount: 20,
        maxCharacters: 6000,
        preflightSummary: 'proofread / 第1章 / 第 1 段 / 0 个来源 / 约 20 tokens / 省略 1 项',
        omittedContextReasons: [{ code: 'full_book_not_loaded', detail: '默认不装入整本书。' }],
      },
      issues: [issue],
      checkedParagraphCount: 1,
    });

    expect(listRequest.status).toBe('open');
    expect(runRulesRequest.paragraphIds).toEqual(['para-1']);
    expect(runRules.checkedParagraphCount).toBe(1);
    expect(list.issues[0].evidence[0].quote).toContain('钥匙');
    expect(update.status).toBe('false_positive');
    expect(aiResult.status).toBe('issues_ready');
  });

  test('rejects malformed IPC responses', () => {
    expect(() =>
      validateIpcResponse('providers.status', {
        activeProvider: 'deepseek',
        providers: {
          deepseek: { configured: 'yes' },
          openrouter: { configured: false },
        },
      })
    ).toThrow();
  });
});
