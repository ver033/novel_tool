import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChapterRepository } from "../db/repositories/chapter-repo";
import type { ProjectRepository } from "../db/repositories/project-repo";
import { detectTxtChapters } from "../import/chapter-detector";
import { readTextFile } from "../import/txt-reader";
import { createId } from "../shared/ids";
import type { ImportPreviewChapter } from "../shared/types";
import { compareExternalBookChapters, type ExternalBookComparisonResult, type ExternalBookMissingChapter } from "./book-chapter-compare";
import { buildExternalBookSyncChatMessages } from "./book-prompt-builder";
import { ExternalBookSourceStore, type ExternalBookSyncSource } from "./book-source-store";
import { isBookFilePath, isPathInsideProjectBookFolder } from "./book-project-folder";
import { scanBookFiles, type BookFileScanProgress, type BookFileScanResult } from "./filesystem-book-scanner";
import { searchWindowsIndexForBookFiles } from "./windows-index-search";

const DEFAULT_SCAN_BUDGET_MS = 180_000;
const WINDOWS_INDEX_TIMEOUT_MS = 15_000;
const MAX_BOOK_BYTES = 20 * 1024 * 1024;

export type ExternalBookSyncMode = "quick" | "global" | "directory";
export type ExternalBookSyncCandidateConfidence = "high" | "medium" | "low";

export type ExternalBookSyncCandidate = {
  readonly id: string;
  readonly projectId: string;
  readonly filePath: string;
  readonly fileName: string;
  readonly size: number;
  readonly modifiedAt: string | null;
  readonly contentHash: string;
  readonly encoding: string;
  readonly confidence: ExternalBookSyncCandidateConfidence;
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
  readonly detectedChapterCount: number;
  readonly comparison: ExternalBookComparisonResult;
};

export type ExternalBookSyncStatus = {
  readonly projectId: string;
  readonly sources: readonly ExternalBookSyncSource[];
};

export type ExternalBookSyncScanInput = {
  readonly projectId: string;
  readonly mode: ExternalBookSyncMode;
  readonly directoryPath?: string;
  readonly roots?: readonly string[];
  readonly timeBudgetMs?: number;
};

export type ExternalBookSyncScanResult = {
  readonly projectId: string;
  readonly candidates: readonly ExternalBookSyncCandidate[];
  readonly scan: BookFileScanResult | null;
  readonly warnings: readonly string[];
  readonly searchedRoots: readonly string[];
  readonly completedAt: string;
};

export type ExternalBookSyncSendResult = {
  readonly sessionId: string;
  readonly sessionTitle: string;
  readonly sentMessageCount: number;
  readonly sentChapterCount: number;
};

export type ExternalBookAiSender = {
  readonly createChatSession: (input: { readonly projectId: string; readonly title: string }) => Promise<{ readonly id: string; readonly title: string }> | { readonly id: string; readonly title: string };
  readonly sendChatMessage: (input: { readonly requestId: string; readonly projectId: string; readonly sessionId: string; readonly message: string }) => Promise<void>;
};

export type ExternalBookSyncServiceDeps = {
  readonly sourceStore: ExternalBookSourceStore;
  readonly resolveChapterRepo: (projectId: string) => ChapterRepository;
  readonly projectRepo: ProjectRepository;
  readonly aiSender: ExternalBookAiSender;
};

export type ExternalBookSyncHandlers = {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: BookFileScanProgress) => void;
};

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function confidenceForCandidate(comparison: ExternalBookComparisonResult, warnings: readonly string[]): ExternalBookSyncCandidateConfidence {
  if (comparison.missingChapters.length === 0 || warnings.length > 0 || comparison.externalLatestOrdinal === null) {
    return "low";
  }
  if (comparison.currentLatestOrdinal !== null && comparison.externalLatestOrdinal > comparison.currentLatestOrdinal) {
    return "high";
  }
  return "medium";
}

function candidateReasons(comparison: ExternalBookComparisonResult): string[] {
  const reasons: string[] = [];
  if (comparison.externalLatestOrdinal !== null) {
    reasons.push(`外部最新章节序号：${comparison.externalLatestOrdinal}`);
  }
  if (comparison.currentLatestOrdinal !== null) {
    reasons.push(`当前项目最新章节序号：${comparison.currentLatestOrdinal}`);
  } else {
    reasons.push(`当前项目章节数：${comparison.currentChapterCount}`);
  }
  reasons.push(`检测到 ${comparison.missingChapters.length} 个缺失章节`);
  return reasons;
}

function candidateIdForPath(projectId: string, filePath: string): string {
  const hash = createHash("sha1").update(`${projectId}:${filePath}`).digest("hex").slice(0, 24);
  return `external_book_candidate_${hash}`;
}

function defaultRoots(projectRootPath: string | null): string[] {
  const roots = new Set<string>();
  if (projectRootPath) {
    roots.add(path.dirname(projectRootPath));
    roots.add(path.parse(projectRootPath).root);
  }
  const home = os.homedir();
  if (home) {
    roots.add(path.join(home, "Documents"));
    roots.add(path.join(home, "Desktop"));
    roots.add(path.join(home, "Downloads"));
    roots.add(home);
  }
  return [...roots].filter((root) => root && existsSync(root));
}

function selectedChapters(candidate: ExternalBookSyncCandidate, chapterKeys: readonly string[]): ExternalBookMissingChapter[] {
  const keySet = new Set(chapterKeys);
  return candidate.comparison.missingChapters.filter((chapter) => keySet.has(chapter.key));
}

export class ExternalBookSyncService {
  private readonly candidatesById = new Map<string, ExternalBookSyncCandidate>();

  constructor(private readonly deps: ExternalBookSyncServiceDeps) {}

  getStatus(projectId: string): ExternalBookSyncStatus {
    return {
      projectId,
      sources: this.deps.sourceStore.listSources(projectId)
    };
  }

  previewCandidate(projectId: string, candidateId: string): ExternalBookSyncCandidate {
    const candidate = this.candidatesById.get(candidateId);
    if (!candidate || candidate.projectId !== projectId) {
      throw new Error("外部 .Book 候选不存在，请重新扫描。");
    }
    return candidate;
  }

  forgetSource(projectId: string, sourceId: string): { readonly ok: true } {
    this.deps.sourceStore.forgetSource(projectId, sourceId);
    return { ok: true };
  }

  async scanProject(input: ExternalBookSyncScanInput, handlers: ExternalBookSyncHandlers = {}): Promise<ExternalBookSyncScanResult> {
    const project = this.deps.projectRepo.findById(input.projectId);
    if (!project) {
      throw new Error("项目不存在，无法检查外部 .Book。");
    }

    const warnings: string[] = [];
    const candidatePaths = new Set<string>();
    for (const source of this.deps.sourceStore.listSources(input.projectId)) {
      candidatePaths.add(source.bookFilePath);
    }

    const indexResult = input.mode !== "directory" ? await searchWindowsIndexForBookFiles({ projectName: project.name, timeoutMs: WINDOWS_INDEX_TIMEOUT_MS }) : null;
    if (indexResult?.status === "failed") {
      warnings.push(`Windows Search 查询失败：${indexResult.error}`);
    }
    for (const filePath of indexResult?.files ?? []) {
      candidatePaths.add(filePath);
    }

    const roots = input.roots ?? (input.directoryPath ? [input.directoryPath] : defaultRoots(project.rootPath));
    const shouldScanFileSystem = input.mode === "global" || input.mode === "directory" || candidatePaths.size === 0;
    const scan = shouldScanFileSystem
      ? await scanBookFiles({
          projectName: project.name,
          roots,
          timeBudgetMs: input.timeBudgetMs ?? DEFAULT_SCAN_BUDGET_MS,
          signal: handlers.signal ?? new AbortController().signal,
          onProgress: handlers.onProgress
        })
      : null;
    for (const file of scan?.files ?? []) {
      candidatePaths.add(file.path);
    }

    const candidates: ExternalBookSyncCandidate[] = [];
    for (const filePath of candidatePaths) {
      const candidate = this.validateCandidate({
        projectId: input.projectId,
        projectName: project.name,
        filePath
      });
      if (candidate) {
        candidates.push(candidate);
        this.candidatesById.set(candidate.id, candidate);
      }
    }

    candidates.sort((a, b) => {
      const confidenceWeight: Record<ExternalBookSyncCandidateConfidence, number> = { high: 3, medium: 2, low: 1 };
      return confidenceWeight[b.confidence] - confidenceWeight[a.confidence] || b.comparison.missingChapters.length - a.comparison.missingChapters.length;
    });

    if (candidates.length === 0) {
      warnings.push("没有在项目同名文件夹下找到可用的 .Book 文件。");
    }

    return {
      projectId: input.projectId,
      candidates,
      scan,
      warnings,
      searchedRoots: roots,
      completedAt: new Date().toISOString()
    };
  }

  async sendMissingChaptersToAi(input: {
    readonly projectId: string;
    readonly candidateId: string;
    readonly chapterKeys: readonly string[];
  }): Promise<ExternalBookSyncSendResult> {
    const project = this.deps.projectRepo.findById(input.projectId);
    if (!project) {
      throw new Error("项目不存在，无法发送外部章节。");
    }
    const candidate = this.previewCandidate(input.projectId, input.candidateId);
    const chapters = selectedChapters(candidate, input.chapterKeys);
    if (chapters.length === 0) {
      throw new Error("没有选择可发送的缺失章节。");
    }
    const session = await this.deps.aiSender.createChatSession({
      projectId: input.projectId,
      title: "外部同步检查"
    });
    const messages = buildExternalBookSyncChatMessages({
      projectName: project.name,
      bookFilePath: candidate.filePath,
      currentLatestLabel: candidate.comparison.currentLatestOrdinal ? `第${candidate.comparison.currentLatestOrdinal}章` : `${candidate.comparison.currentChapterCount} 章`,
      missingChapters: chapters
    });
    for (const message of messages) {
      await this.deps.aiSender.sendChatMessage({
        requestId: createId("external_book_sync_chat"),
        projectId: input.projectId,
        sessionId: session.id,
        message
      });
    }
    this.deps.sourceStore.upsertSource({
      projectId: input.projectId,
      bookFilePath: candidate.filePath,
      displayName: candidate.fileName,
      lastKnownSize: candidate.size,
      lastModifiedAt: candidate.modifiedAt,
      lastContentHash: candidate.contentHash,
      lastScanAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString()
    });
    return {
      sessionId: session.id,
      sessionTitle: session.title,
      sentMessageCount: messages.length,
      sentChapterCount: chapters.length
    };
  }

  private validateCandidate(input: { readonly projectId: string; readonly projectName: string; readonly filePath: string }): ExternalBookSyncCandidate | null {
    if (!isBookFilePath(input.filePath) || !isPathInsideProjectBookFolder(input.filePath, input.projectName)) {
      return null;
    }
    if (!existsSync(input.filePath)) {
      return null;
    }
    const info = statSync(input.filePath);
    if (!info.isFile() || info.size > MAX_BOOK_BYTES) {
      return null;
    }
    const read = readTextFile(input.filePath, { label: ".Book 文件", maxBytes: MAX_BOOK_BYTES });
    const chapters = detectTxtChapters(read.text).filter((chapter: ImportPreviewChapter) => chapter.title.trim() || chapter.text.trim());
    if (chapters.length === 0) {
      return null;
    }
    const comparison = compareExternalBookChapters({
      projectChapters: this.deps.resolveChapterRepo(input.projectId).listByProject(input.projectId),
      externalChapters: chapters
    });
    const warnings = comparison.warnings;
    const candidate: ExternalBookSyncCandidate = {
      id: candidateIdForPath(input.projectId, input.filePath),
      projectId: input.projectId,
      filePath: input.filePath,
      fileName: path.basename(input.filePath),
      size: info.size,
      modifiedAt: info.mtime ? info.mtime.toISOString() : null,
      contentHash: contentHash(read.text),
      encoding: read.encoding,
      confidence: confidenceForCandidate(comparison, warnings),
      reasons: candidateReasons(comparison),
      warnings,
      detectedChapterCount: chapters.length,
      comparison
    };
    return candidate;
  }
}
