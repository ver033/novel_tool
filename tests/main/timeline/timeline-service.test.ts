import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { analyzeTimeline, queryTimeline } from '../../../src/main/timeline/timeline-service';
import { createTxtImportService } from '../../../src/main/importers/txt/txt-import-service';
import { getChapterForEditing, listChaptersForProject } from '../../../src/main/manuscript/manuscript-service';

async function importTestNovel() {
  const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-timeline-'));
  const service = createTxtImportService();
  const preview = await service.previewTxt(path.join(process.cwd(), 'test_novel', 'test.txt'));
  return service.commitTxt({
    previewId: preview.previewId,
    baseDirectory: root,
    projectName: preview.preview.suggestedProjectName,
  });
}

describe('timeline service', () => {
  test('returns source-backed event nodes with friendly paragraph locations', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const editable = getChapterForEditing(project.dbPath, chapter.id);
    const paragraph = editable.paragraphs[2];
    const db = new Database(project.dbPath);
    try {
      db.prepare(
        `INSERT INTO events
         (id, chapter_id, paragraph_id, event_order, time_expression, normalized_time, summary, participants_json, confidence, status)
         VALUES ('event-key-thrown', ?, ?, 10, '第十章雨夜', 'chapter-10-night', '陈砚把铜钥匙丢进泥水', ?, 0.88, 'ai_extracted')`
      ).run(chapter.id, paragraph.id, JSON.stringify(['陈砚', '铜钥匙']));
    } finally {
      db.close();
    }

    const timeline = queryTimeline(project.dbPath, {});

    expect(timeline.nodes).toEqual([
      expect.objectContaining({
        id: 'event-key-thrown',
        chapterId: chapter.id,
        paragraphId: paragraph.id,
        friendlyLocation: `${editable.title} / ${paragraph.friendlyLabel}`,
        summary: '陈砚把铜钥匙丢进泥水',
        participants: ['陈砚', '铜钥匙'],
        sourceQuote: paragraph.text,
      }),
    ]);
  });

  test('analyzes imported chapters into paragraph-backed story events, not one node per chapter', async () => {
    const project = await importTestNovel();
    const chapters = listChaptersForProject(project.dbPath);
    const firstChapter = getChapterForEditing(project.dbPath, chapters[0].id);
    const secondChapter = getChapterForEditing(project.dbPath, chapters[1].id);
    const testResultParagraph = firstChapter.paragraphs.find((paragraph) =>
      paragraph.text.includes('萧炎，斗之力，三段')
    );
    const secretParagraph = secondChapter.paragraphs.find((paragraph) => paragraph.text.includes('他穿越了'));
    expect(testResultParagraph).toBeDefined();
    expect(secretParagraph).toBeDefined();

    const modelRequest = {
      model: 'deepseek-v4-pro',
      reasoningEffort: 'high' as const,
      thinkingMode: 'enabled' as const,
      sendModelRequest: async () => ({
        content: JSON.stringify({
          events: [
            {
              paragraph_id: testResultParagraph!.id,
              event_type: '实力状态变化',
              summary: '萧炎在家族测验中被公布为斗之力三段，落入低级评价并引发族人嘲讽。',
              quote: '“萧炎，斗之力，三段！级别：低级！”',
              participants: ['萧炎', '萧家'],
              time_expression: '家族测验当天',
              confidence: 0.92,
            },
            {
              paragraph_id: secretParagraph!.id,
              event_type: '隐藏身份揭示',
              summary: '萧炎确认自己来自地球，穿越到斗气大陆，这是只有他自己知道的秘密。',
              quote: '他穿越了！',
              participants: ['萧炎'],
              time_expression: '十五年后回想',
              confidence: 0.9,
            },
          ],
        }),
        reasoningContent: null,
        toolCalls: [],
      }),
    };

    const firstRun = await analyzeTimeline(project.dbPath, { modelRequest });
    const secondRun = await analyzeTimeline(project.dbPath, { modelRequest });
    const timeline = queryTimeline(project.dbPath, {});

    expect(firstRun.createdCount).toBe(2);
    expect(firstRun.skippedCount).toBe(0);
    expect(firstRun.warnings).toEqual([]);
    expect(secondRun.createdCount).toBe(0);
    expect(secondRun.updatedCount).toBe(2);
    expect(secondRun.skippedCount).toBe(0);
    expect(timeline.nodes).toHaveLength(2);
    expect(timeline.nodes).not.toHaveLength(chapters.length);
    expect(timeline.nodes[0].summary).not.toContain('章节节点');
    expect(timeline.nodes[0]).toEqual(
      expect.objectContaining({
        chapterId: chapters[0].id,
        paragraphId: testResultParagraph!.id,
        chapterTitle: chapters[0].title,
        timeExpression: '实力状态变化',
        normalizedTime: `${chapters[0].title} / ${testResultParagraph!.friendlyLabel}`,
        participants: ['萧炎', '萧家'],
        status: 'ai_extracted',
      })
    );
    expect(timeline.nodes[0].sourceQuote).toContain('萧炎，斗之力，三段');
  });

  test('skips timeline events whose evidence quote cannot be anchored instead of failing the whole analysis', async () => {
    const project = await importTestNovel();
    const chapter = listChaptersForProject(project.dbPath)[0];
    const editable = getChapterForEditing(project.dbPath, chapter.id);
    const validParagraph = editable.paragraphs.find((paragraph) => paragraph.text.includes('萧炎，斗之力，三段'));
    const invalidParagraph = editable.paragraphs.find((paragraph) => paragraph.id !== validParagraph?.id);
    expect(validParagraph).toBeDefined();
    expect(invalidParagraph).toBeDefined();

    const result = await analyzeTimeline(project.dbPath, {
      modelRequest: {
        model: 'deepseek-v4-pro',
        reasoningEffort: 'high',
        thinkingMode: 'enabled',
        sendModelRequest: async () => ({
          content: JSON.stringify({
            events: [
              {
                paragraph_id: invalidParagraph!.id,
                event_type: '错误引用',
                summary: '这一条引用无法在对应段落中定位，应该被跳过。',
                quote: '这句话并没有出现在原文段落里',
                participants: ['萧炎'],
                time_expression: '',
                confidence: 0.5,
              },
              {
                paragraph_id: validParagraph!.id,
                event_type: '实力状态变化',
                summary: '萧炎在测验中被公布为斗之力三段。',
                quote: '“萧炎，斗之力，三段！级别：低级！”',
                participants: ['萧炎'],
                time_expression: '家族测验当天',
                confidence: 0.92,
              },
            ],
          }),
          reasoningContent: null,
          toolCalls: [],
        }),
      },
    });

    expect(result.createdCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.warnings).toEqual([
      expect.stringContaining(`引用无法定位，已跳过：${editable.title} / ${invalidParagraph!.friendlyLabel}`),
    ]);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].summary).toContain('萧炎在测验中被公布');
  });

  test('timeline analysis requires an explicit model request instead of silent chapter fallback', async () => {
    const project = await importTestNovel();

    await expect(analyzeTimeline(project.dbPath)).rejects.toThrow('时间线分析需要可用模型');
  });
});
