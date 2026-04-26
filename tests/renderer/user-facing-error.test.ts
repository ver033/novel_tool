import { describe, expect, test } from 'vitest';

import { userFacingErrorMessage } from '../../src/renderer/user-facing-error';

describe('user-facing error messages', () => {
  test('removes Electron remote-method noise from visible UI errors', () => {
    expect(
      userFacingErrorMessage(
        new Error("Error invoking remote method 'project.pickExisting': Error: 请选择 .novelproj 项目文件夹"),
        '打开项目失败'
      )
    ).toBe('请选择 .novelproj 项目文件夹');
  });

  test('replaces raw sqlite constraint errors with an actionable import message', () => {
    expect(
      userFacingErrorMessage(
        new Error("Error invoking remote method 'imports.commitTxt': SqliteError: UNIQUE constraint failed: books.id"),
        '导入失败'
      )
    ).toContain('打开已有项目或换一个项目名');
  });
});
