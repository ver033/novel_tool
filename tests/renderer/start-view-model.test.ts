import { describe, expect, test } from 'vitest';

import { emptyRecentProjectCopy, openReturnCards, recentProjectRows, startHeroCopy } from '../../src/renderer/start-view-model';

describe('approved start page model', () => {
  test('keeps the start page copy aligned with full-prototype.html', () => {
    expect(startHeroCopy).toEqual({
      title: '选择开始方式',
      description: '新建项目会先选择 TXT 或 EPUB；打开项目会回到上次位置。',
      createTitle: '新建本地项目',
      createDescription: '选择 TXT 或 EPUB 后预览章节，确认后进入编辑。',
      openTitle: '打开已有项目',
      openDescription: '回到上次章节、功能页和待处理问题。',
    });
  });

  test('does not show fake recent projects before a real recent-project store exists', () => {
    expect(recentProjectRows).toEqual([]);
    expect(emptyRecentProjectCopy).toContain('还没有最近项目');
    expect(openReturnCards).toEqual([]);
  });
});
