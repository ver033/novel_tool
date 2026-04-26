import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const source = readFileSync(path.join(process.cwd(), 'src', 'main', 'ipc', 'register-ipc.ts'), 'utf8');

describe('IPC handler contract', () => {
  test('awaits project opening before spreading the picked-project response', () => {
    expect(source).toContain('...(await openAndSetCurrentProject(projectPath))');
  });

  test('lets macOS users navigate project package folders in the open-project dialog', () => {
    expect(source).toContain("'treatPackageAsDirectory'");
  });
});
