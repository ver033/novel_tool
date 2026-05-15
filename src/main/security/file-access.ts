import path from "node:path";

const selectedTxtFilePaths = new Set<string>();
const selectedTxtExportFilePaths = new Set<string>();
const selectedProjectFilePaths = new Set<string>();
const selectedProjectExportFilePaths = new Set<string>();

function normalizeFilePath(filePath: string): string {
  return path.resolve(filePath);
}

function assertSelectedPathAllowed(filePath: string, allowedPaths: ReadonlySet<string>, message: string): string {
  const resolvedPath = normalizeFilePath(filePath);
  if (!allowedPaths.has(resolvedPath)) {
    throw new Error(message);
  }
  return resolvedPath;
}

export function allowSelectedTxtFilePath(filePath: string): string {
  const resolvedPath = normalizeFilePath(filePath);
  selectedTxtFilePaths.add(resolvedPath);
  return resolvedPath;
}

export function assertSelectedTxtFilePathAllowed(filePath: string): string {
  return assertSelectedPathAllowed(filePath, selectedTxtFilePaths, "TXT 文件必须通过选择文件按钮打开。");
}

export function allowSelectedTxtExportFilePath(filePath: string): string {
  const resolvedPath = normalizeFilePath(filePath);
  selectedTxtExportFilePaths.add(resolvedPath);
  return resolvedPath;
}

export function assertSelectedTxtExportFilePathAllowed(filePath: string): string {
  const resolvedPath = assertSelectedPathAllowed(filePath, selectedTxtExportFilePaths, "TXT 导出路径必须通过保存文件按钮选择。");
  if (path.extname(resolvedPath).toLowerCase() !== ".txt") {
    throw new Error("TXT 导出文件必须使用 .txt 扩展名。");
  }
  return resolvedPath;
}

export function allowSelectedProjectFilePath(filePath: string): string {
  const resolvedPath = normalizeFilePath(filePath);
  selectedProjectFilePaths.add(resolvedPath);
  return resolvedPath;
}

export function assertSelectedProjectFilePathAllowed(filePath: string): string {
  return assertSelectedPathAllowed(filePath, selectedProjectFilePaths, "项目文件必须通过选择文件按钮打开。");
}

export function allowSelectedProjectExportFilePath(filePath: string): string {
  const resolvedPath = normalizeFilePath(filePath);
  selectedProjectExportFilePaths.add(resolvedPath);
  return resolvedPath;
}

export function assertSelectedProjectExportFilePathAllowed(filePath: string): string {
  const resolvedPath = assertSelectedPathAllowed(filePath, selectedProjectExportFilePaths, "可分享副本导出路径必须通过保存文件按钮选择。");
  if (path.extname(resolvedPath).toLowerCase() !== ".noveltool") {
    throw new Error("可分享副本必须使用 .noveltool 扩展名。");
  }
  return resolvedPath;
}
