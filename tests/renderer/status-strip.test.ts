import { describe, expect, test } from 'vitest';

import { buildStatusStripModel } from '../../src/renderer/status-strip';

describe('status strip model', () => {
  test('maps current app status into the prototype three-cell footer', () => {
    expect(
      buildStatusStripModel({
        hasDesktopApi: false,
        cursorStatus: '-',
        latestJob: null,
        status: '未打开项目',
      }),
    ).toEqual({
      saveStatus: '未打开项目',
      cursorStatus: '-',
      queueStatus: '队列空闲',
      errorStatus: '无错误',
      queueTone: 'warn',
    });
  });

  test('surfaces failed job errors in the right status cell', () => {
    expect(
      buildStatusStripModel({
        hasDesktopApi: true,
        cursorStatus: '第十二章·44段',
        latestJob: { error: '导入失败', progress: 48, status: 'failed', type: 'import_txt' },
        status: '正在导入',
      }),
    ).toMatchObject({
      queueStatus: '任务：import_txt / failed / 48%',
      errorStatus: '导入失败',
    });
  });
});
