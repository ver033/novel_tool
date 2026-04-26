import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'src/renderer/App.tsx'), 'utf8');

describe('global project pages contract', () => {
  test('does not render prototype canon data as if it belonged to the active project', () => {
    expect(appSource).not.toContain('林照 · 主角');
    expect(appSource).not.toContain('陈砚公开丢弃铜钥匙');
    expect(appSource).not.toContain('旧港 · 世界规则');
    expect(appSource).toContain('当前项目还没有生成全局设定文档');
  });

  test('loads canon records from the project instead of only keeping the last import result in memory', () => {
    expect(appSource).toContain("type CanonListResult = IpcResponse<'canon.list'>");
    expect(appSource).toContain('const [canonRecords, setCanonRecords]');
    expect(appSource).toContain('await window.novelTool.canon.list()');
  });

  test('runs project analysis for global canon instead of exposing a manual outline import button', () => {
    expect(appSource).toContain("type CanonAnalyzeResult = IpcResponse<'canon.analyzeProject'>");
    expect(appSource).toContain('await window.novelTool.canon.analyzeProject()');
    expect(appSource).toContain('分析项目');
    expect(appSource).not.toContain('读取 Markdown 大纲');
    expect(appSource).not.toContain('Markdown 文件路径');
    expect(appSource).not.toContain('canonMarkdownPath');
    expect(appSource).not.toContain('生成 00-09 项目文档');
    expect(appSource).not.toContain('生成 00-09 控制文档');
    expect(appSource).not.toContain('项目 canon/ 目录生成 00-09');
  });

  test('renders generated control documents as separate author-facing pages', () => {
    expect(appSource).toContain('const canonDocumentPages');
    expect(appSource).toContain('activeCanonDocumentId');
    expect(appSource).toContain('setActiveCanonDocumentId');
    expect(appSource).toContain("displayTitle: '项目概览'");
    expect(appSource).toContain("displayTitle: '角色人设'");
    expect(appSource).toContain("displayTitle: '章节路线'");
    expect(appSource).toContain("displayTitle: '风格指南'");
    expect(appSource).toContain('selectedCanonDocument');
    expect(appSource).toContain('selectedCanonRecords');
  });

  test('separates global canon from evidence memory in author-facing copy', () => {
    expect(appSource).toContain('作品设定与写作控制');
    expect(appSource).toContain('正文证据，不是设定大纲');
    expect(appSource).toContain('证据位置');
    expect(appSource).toContain('用途');
  });

  test('treats plotlines as first-class global canon instead of a miscellaneous markdown note', () => {
    expect(appSource).toContain("plotline: '主线'");
    expect(appSource).toContain("overview: '概览'");
    expect(appSource).toContain("theme: '主题'");
    expect(appSource).toContain("dynamic_state: '状态'");
    expect(appSource).toContain("sourceFileName: '05-main-plotlines.md'");
    expect(appSource).not.toContain('Markdown 其他标题');
  });

  test('exposes an explicit timeline analysis action separate from refresh', () => {
    expect(appSource).toContain("type TimelineAnalyzeResult = IpcResponse<'timeline.analyze'>");
    expect(appSource).toContain('await window.novelTool.timeline.analyze({})');
    expect(appSource).toContain('分析时间线');
    expect(appSource).toContain('刷新时间线');
    expect(appSource).toContain('timeline-event-list');
    expect(appSource).toContain('timeline-event-card');
    expect(appSource).not.toContain('timeline-node');
    expect(appSource).not.toContain('Math.min(86, 6 + index * 16)');
  });

  test('global side panels use real project counts instead of static sample counts', () => {
    expect(appSource).toContain('buildCanonDocumentRows(canonSources, canonRecords)');
    expect(appSource).toContain('buildMemoryCategoryRows(memoryCards)');
    expect(appSource).toContain('const timelineRows = buildTimelineCategoryRows(timelineNodes)');
    expect(appSource).toContain("const [activeTimelineView, setActiveTimelineView] = useState<TimelineViewId>('events')");
    expect(appSource).toContain('onClick={() => setActiveTimelineView(id)}');
    expect(appSource).not.toContain("['人物', '28'");
    expect(appSource).not.toContain("['卷二：潮汐线', '高热'");
    expect(appSource).not.toContain("['道具线', '铜钥匙'");
  });

  test('disables memory confirmation when there is no pending memory card', () => {
    expect(appSource).toContain('const pendingMemoryCount = memoryCards.filter((card) => card.status !==');
    expect(appSource).toContain('disabled={pendingMemoryCount === 0}');
    expect(appSource).toContain("{pendingMemoryCount > 0 ? '确认待确认记忆' : '暂无待确认记忆'}");
  });

  test('global project errors use writer-facing messages instead of raw remote prefixes', () => {
    expect(appSource).toContain("setCanonStatus(userFacingErrorMessage(error, '全局设定读取失败'))");
    expect(appSource).toContain("setTimelineStatus(userFacingErrorMessage(error, '时间线读取失败'))");
  });

  test('timeline analysis warnings remain visible after a partial successful run', () => {
    expect(appSource).toContain('result.warnings[0]');
    expect(appSource).toContain('跳过 ${result.skippedCount} 条无法定位引用');
  });
});
