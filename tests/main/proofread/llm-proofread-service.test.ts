import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { createTxtImportService } from '../../../src/main/importers/txt/txt-import-service';
import { getChapterForEditing, listChaptersForProject, updateParagraphText } from '../../../src/main/manuscript/manuscript-service';
import { listIssues } from '../../../src/main/proofread/proofread-service';
import {
  buildLlmProofreadPromptMessages,
  parseLlmProofreadStructuredOutput,
  persistLlmProofreadIssues,
} from '../../../src/main/proofread/llm-proofread-service';

async function importTestNovel() {
  const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-llm-proofread-'));
  const service = createTxtImportService();
  const preview = await service.previewTxt(path.join(process.cwd(), 'test_novel', 'test.txt'));
  return service.commitTxt({
    previewId: preview.previewId,
    baseDirectory: root,
    projectName: preview.preview.suggestedProjectName,
  });
}

describe('LLM proofreading service', () => {
  test('builds a proofreading prompt that requires paragraph evidence and JSON only', () => {
    const messages = buildLlmProofreadPromptMessages({
      selectedText: '她她抬起头，钥匙还在门口。',
      userInstruction: '重点看表达和前后不搭。',
      contextText: '[current_paragraph:para-1]\n她她抬起头，钥匙还在门口。',
      sourceList: [
        {
          kind: 'current_paragraph',
          label: '当前段落',
          friendlyLocation: '第一章 / 第 1 段',
          paragraphId: 'para-1',
          textPreview: '她她抬起头，钥匙还在门口。',
        },
      ],
    });

    expect(messages[0].content).toContain('只返回 JSON');
    expect(messages[1].content).toContain('paragraph_id');
    expect(messages[1].content).toContain('paragraph_id=para-1');
    expect(messages[1].content).toContain('原文证据');
    expect(messages[1].content).toContain('重点看表达和前后不搭');
  });

  test('parses structured LLM proofreading issues with explicit paragraph ids', () => {
    const parsed = parseLlmProofreadStructuredOutput(
      JSON.stringify({
        issues: [
          {
            paragraph_id: 'para-1',
            type: 'awkward_expression',
            severity: 'medium',
            title: '动作承接略生硬',
            quote: '她她抬起头',
            explanation: '连续两个“她”影响阅读，可能是输入重复。',
            suggestion: '删掉一个“她”。',
            needs_user_judgment: false,
          },
        ],
      })
    );

    expect(parsed.issues[0]).toMatchObject({
      paragraphId: 'para-1',
      type: 'awkward_expression',
      severity: 'medium',
      quote: '她她抬起头',
      needsUserJudgment: false,
    });
  });

  test('stores LLM proofreading issue cards without changing manuscript text', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const editable = getChapterForEditing(project.dbPath, chapter.id);
    const paragraph = editable.paragraphs[0];
    updateParagraphText(project.dbPath, {
      paragraphId: paragraph.id,
      text: '她她抬起头，钥匙还在门口。',
      changeReason: 'llm_proofread_fixture',
    });

    const structuredOutput = parseLlmProofreadStructuredOutput(
      JSON.stringify({
        issues: [
          {
            paragraph_id: paragraph.id,
            type: 'awkward_expression',
            severity: 'medium',
            title: '疑似重复主语',
            quote: '她她抬起头',
            explanation: '重复主语让句子显得像输入误触。',
            suggestion: '改为“她抬起头”。',
            needs_user_judgment: false,
          },
        ],
      })
    );

    const result = persistLlmProofreadIssues(project.dbPath, {
      sourceTaskId: 'task-llm-proofread-1',
      structuredOutput,
    });
    const listed = listIssues(project.dbPath, { currentParagraphId: paragraph.id, status: 'open' });
    const reopened = getChapterForEditing(project.dbPath, chapter.id).paragraphs.find((item) => item.id === paragraph.id);

    expect(result.checkedParagraphCount).toBe(1);
    expect(result.issues).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      type: 'proofread_llm_awkward_expression',
      sourceTaskId: 'task-llm-proofread-1',
      currentParagraphId: paragraph.id,
      suggestion: '改为“她抬起头”。',
    });
    expect(listed[0].evidence[0]).toMatchObject({
      paragraphId: paragraph.id,
      quote: '她她抬起头',
      role: 'current',
    });
    expect(reopened?.text).toBe('她她抬起头，钥匙还在门口。');
  });
});
