import path from "node:path";

export type ProjectFolderPlatform = "win32" | "darwin" | "linux" | NodeJS.Platform;

const forbiddenWindowsFileNameChars = /[<>:"/\\|?*\u0000-\u001f]/g;

export function normalizeProjectFolderName(projectName: string): string {
  return projectName.replace(forbiddenWindowsFileNameChars, "").trim();
}

function splitPathSegments(filePath: string): string[] {
  return filePath.split(/[\\/]+/u).filter(Boolean);
}

function normalizeSegmentForPlatform(segment: string, platform: ProjectFolderPlatform): string {
  return platform === "win32" ? segment.toLocaleLowerCase("zh-CN") : segment;
}

function normalizePathForPlatform(filePath: string, platform: ProjectFolderPlatform): string {
  return platform === "win32" ? path.win32.normalize(filePath) : path.normalize(filePath);
}

export function isPathInsideProjectBookFolder(filePath: string, projectName: string, platform: ProjectFolderPlatform = process.platform): boolean {
  const expected = normalizeProjectFolderName(projectName);
  if (!expected) {
    return false;
  }

  const normalizedPath = normalizePathForPlatform(filePath, platform);
  const parsed = platform === "win32" ? path.win32.parse(normalizedPath) : path.parse(normalizedPath);
  const directorySegments = splitPathSegments(parsed.dir);
  const expectedSegment = normalizeSegmentForPlatform(expected, platform);
  return directorySegments.some((segment) => normalizeSegmentForPlatform(segment, platform) === expectedSegment);
}

export function isProjectBookFolderPath(directoryPath: string, projectName: string, platform: ProjectFolderPlatform = process.platform): boolean {
  const expected = normalizeProjectFolderName(projectName);
  if (!expected) {
    return false;
  }
  const normalizedPath = normalizePathForPlatform(directoryPath, platform);
  const baseName = platform === "win32" ? path.win32.basename(normalizedPath) : path.basename(normalizedPath);
  return normalizeSegmentForPlatform(baseName, platform) === normalizeSegmentForPlatform(expected, platform);
}

export function isBookFilePath(filePath: string): boolean {
  return path.basename(filePath).toLocaleLowerCase("en-US").endsWith(".book");
}
