export function userFacingErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;
  const remoteMatch = raw.match(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?(.+)$/s);
  const withoutRemotePrefix = remoteMatch?.[1] ?? raw;
  if (/SQLITE_CONSTRAINT|UNIQUE constraint failed|SqliteError/i.test(withoutRemotePrefix)) {
    return '项目写入失败：当前项目目录里已有数据，请打开已有项目或换一个项目名后再导入。';
  }
  return withoutRemotePrefix.trim() || fallback;
}
