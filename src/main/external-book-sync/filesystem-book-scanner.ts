import { opendir, stat } from "node:fs/promises";
import path from "node:path";
import { isBookFilePath, isProjectBookFolderPath } from "./book-project-folder";

const EXCLUDED_DIRECTORY_NAMES = new Set([
  "windows",
  "program files",
  "program files (x86)",
  "$recycle.bin",
  "system volume information",
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".cache",
  ".gradle",
  "temp",
  "tmp"
]);

export type BookFileScanCandidate = {
  readonly path: string;
  readonly size: number;
  readonly modifiedAt: string | null;
};

export type BookFileScanProgress = {
  readonly phase: "scanning";
  readonly currentRoot: string | null;
  readonly checkedDirectories: number;
  readonly checkedFiles: number;
  readonly candidatesFound: number;
  readonly skippedErrors: number;
  readonly elapsedMs: number;
};

export type BookFileScanResult = {
  readonly files: readonly BookFileScanCandidate[];
  readonly checkedDirectories: number;
  readonly checkedFiles: number;
  readonly skippedErrors: number;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly elapsedMs: number;
};

export type ScanBookFilesInput = {
  readonly projectName: string;
  readonly roots: readonly string[];
  readonly timeBudgetMs: number;
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: BookFileScanProgress) => void;
};

type QueueEntry = {
  readonly directoryPath: string;
  readonly currentRoot: string;
  readonly insideProjectFolder: boolean;
};

function isExcludedDirectory(name: string): boolean {
  return EXCLUDED_DIRECTORY_NAMES.has(name.toLocaleLowerCase("en-US"));
}

function shouldEmitProgress(checkedDirectories: number, checkedFiles: number): boolean {
  return (checkedDirectories + checkedFiles) % 100 === 0;
}

export async function scanBookFiles(input: ScanBookFilesInput): Promise<BookFileScanResult> {
  const startedAt = Date.now();
  const queue: QueueEntry[] = input.roots.map((root) => ({
    directoryPath: root,
    currentRoot: root,
    insideProjectFolder: isProjectBookFolderPath(root, input.projectName)
  }));
  const files: BookFileScanCandidate[] = [];
  let checkedDirectories = 0;
  let checkedFiles = 0;
  let skippedErrors = 0;
  let timedOut = false;

  const emitProgress = (currentRoot: string | null) => {
    input.onProgress?.({
      phase: "scanning",
      currentRoot,
      checkedDirectories,
      checkedFiles,
      candidatesFound: files.length,
      skippedErrors,
      elapsedMs: Date.now() - startedAt
    });
  };

  while (queue.length > 0) {
    if (input.signal.aborted) {
      break;
    }
    if (Date.now() - startedAt >= input.timeBudgetMs) {
      timedOut = true;
      break;
    }

    const entry = queue.shift();
    if (!entry) {
      break;
    }
    checkedDirectories += 1;
    if (shouldEmitProgress(checkedDirectories, checkedFiles)) {
      emitProgress(entry.currentRoot);
    }

    let directory;
    try {
      directory = await opendir(entry.directoryPath);
    } catch {
      skippedErrors += 1;
      continue;
    }

    try {
      for await (const child of directory) {
        if (input.signal.aborted) {
          break;
        }
        const childPath = path.join(entry.directoryPath, child.name);
        if (child.isDirectory()) {
          if (isExcludedDirectory(child.name)) {
            continue;
          }
          queue.push({
            directoryPath: childPath,
            currentRoot: entry.currentRoot,
            insideProjectFolder: entry.insideProjectFolder || isProjectBookFolderPath(childPath, input.projectName)
          });
          continue;
        }
        if (!child.isFile() || !entry.insideProjectFolder || !isBookFilePath(child.name)) {
          checkedFiles += child.isFile() ? 1 : 0;
          continue;
        }

        checkedFiles += 1;
        try {
          const info = await stat(childPath);
          files.push({
            path: childPath,
            size: info.size,
            modifiedAt: info.mtime ? info.mtime.toISOString() : null
          });
        } catch {
          skippedErrors += 1;
        }
        if (shouldEmitProgress(checkedDirectories, checkedFiles)) {
          emitProgress(entry.currentRoot);
        }
      }
    } catch {
      skippedErrors += 1;
    }
  }

  emitProgress(null);
  return {
    files,
    checkedDirectories,
    checkedFiles,
    skippedErrors,
    timedOut,
    cancelled: input.signal.aborted,
    elapsedMs: Date.now() - startedAt
  };
}
