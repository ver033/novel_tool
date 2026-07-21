import { ChapterRepository } from "../db/repositories/chapter-repo";
import { OutlineRepository, type OutlineEventCreateData } from "../db/repositories/outline-repo";
import { ProjectRepository } from "../db/repositories/project-repo";
import { assertSelectedOutlineImportFilePathAllowed } from "../security/file-access";
import { createId } from "../shared/ids";
import type {
  ChapterSummary,
  OutlineBulkImportPreview,
  OutlineBulkImportPreviewRow,
  OutlineChapterNoteRecord,
  OutlineClearImportedEventsInput,
  OutlineConfirmBulkImportInput,
  OutlineCreateEventInput,
  OutlineCreateThreadInput,
  OutlineDeleteEventInput,
  OutlineDeleteThreadInput,
  OutlineEventRecord,
  OutlineGetChapterNoteInput,
  OutlineGetOverviewInput,
  OutlineImportLegacyChapterNoteInput,
  OutlineListEventsInput,
  OutlinePreviewBulkImportInput,
  OutlinePreviewImportFileInput,
  OutlineReorderEventsInput,
  OutlineSaveChapterNoteInput,
  OutlineThreadRecord,
  OutlineUndoImportBatchInput,
  OutlineUpdateEventInput,
  OutlineUpdateThreadInput,
  OutlineOverview
} from "../shared/types";
import { parseOutlineFile, parseOutlineText, type ParsedOutlineImportRow } from "./outline-import-parser";

function nowIso(): string {
  return new Date().toISOString();
}

function defaultTitle(summary: string): string {
  const trimmed = summary.trim();
  return trimmed.slice(0, 40) || "未命名场景";
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

const previewLimits = {
  chapterTitle: 160,
  text80: 80,
  text120: 120,
  summary: 1000,
  warning: 300,
  maxWarnings: 20,
  maxThreads: 50,
  maxCharacters: 30,
  maxImportRows: 5000
} as const;

function addWarning(warnings: string[], message: string): void {
  if (warnings.length < previewLimits.maxWarnings) {
    warnings.push(message.slice(0, previewLimits.warning));
  }
}

function clampText(value: string, maxLength: number, fieldName: string, warnings: string[]): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  addWarning(warnings, `${fieldName}过长，已截断到 ${maxLength} 字。`);
  return trimmed.slice(0, maxLength);
}

function sanitizeWarnings(values: readonly string[]): string[] {
  return uniqueStrings(values).slice(0, previewLimits.maxWarnings).map((value) => value.slice(0, previewLimits.warning));
}

function sanitizeStringList(values: readonly string[], maxItems: number, maxLength: number, fieldName: string, warnings: string[]): string[] {
  const sanitized: string[] = [];
  for (const value of values) {
    const next = clampText(value, maxLength, fieldName, warnings);
    if (next && !sanitized.includes(next)) {
      sanitized.push(next);
    }
    if (sanitized.length >= maxItems) {
      break;
    }
  }
  if (uniqueStrings(values).length > maxItems) {
    addWarning(warnings, `${fieldName}数量过多，仅保留前 ${maxItems} 个。`);
  }
  return sanitized;
}

function normalizeRow(row: ParsedOutlineImportRow, chapters: readonly ChapterSummary[]): OutlineBulkImportPreviewRow {
  const chapterByTitle = new Map(chapters.map((chapter) => [normalizeName(chapter.title), chapter]));
  const chapter = row.chapterTitle ? chapterByTitle.get(normalizeName(row.chapterTitle)) : undefined;
  const warnings = sanitizeWarnings(row.warnings);
  if (row.chapterTitle && !chapter) {
    addWarning(warnings, `未找到章节：${row.chapterTitle}`);
  }
  return {
    ...row,
    chapterTitle: clampText(row.chapterTitle, previewLimits.chapterTitle, "章节名", warnings),
    chapterId: chapter?.id ?? null,
    storyTimeLabel: clampText(row.storyTimeLabel, previewLimits.text80, "故事时间", warnings),
    weekdayLabel: clampText(row.weekdayLabel, previewLimits.text80, "星期/备注", warnings),
    customDaySegment: row.customDaySegment ? clampText(row.customDaySegment, previewLimits.text80, "自定义时间段", warnings) : null,
    threadNames: sanitizeStringList(row.threadNames, previewLimits.maxThreads, previewLimits.text80, "情节线", warnings),
    summary: clampText(row.summary, previewLimits.summary, "场景摘要", warnings),
    characters: sanitizeStringList(row.characters, previewLimits.maxCharacters, previewLimits.text80, "角色", warnings),
    location: clampText(row.location, previewLimits.text120, "地点", warnings),
    warnings
  };
}

export class OutlineService {
  constructor(
    private readonly repo: OutlineRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly chapterRepo: ChapterRepository
  ) {}

  getOverview(input: OutlineGetOverviewInput): OutlineOverview {
    this.ensureProject(input.projectId);
    return {
      projectId: input.projectId,
      chapters: this.chapterRepo.listByProject(input.projectId),
      threads: this.repo.listThreads(input.projectId),
      events: this.repo.listEvents({ projectId: input.projectId }),
      chapterNotes: this.repo.listChapterNotes(input.projectId)
    };
  }

  listEvents(input: OutlineListEventsInput): OutlineEventRecord[] {
    this.ensureProject(input.projectId);
    return this.repo.listEvents(input);
  }

  createEvent(input: OutlineCreateEventInput): OutlineEventRecord {
    this.ensureProject(input.projectId);
    this.ensureChapterBelongsToProject(input.projectId, input.chapterId ?? null);
    const now = nowIso();
    const eventOrder = this.repo.listEvents({ projectId: input.projectId }).length + 1;
    return this.repo.createEvent({
      id: createId("outline_event"),
      projectId: input.projectId,
      chapterId: input.chapterId ?? null,
      title: input.title.trim() || defaultTitle(input.summary),
      summary: input.summary.trim(),
      storyDate: input.storyDate ?? null,
      storyTimeLabel: input.storyTimeLabel?.trim() ?? "",
      weekdayLabel: input.weekdayLabel?.trim() ?? "",
      storyTimeOrder: input.storyTimeOrder ?? null,
      daySegment: input.daySegment,
      customDaySegment: input.customDaySegment?.trim() || null,
      location: input.location?.trim() ?? "",
      povCharacter: input.povCharacter?.trim() ?? "",
      characters: uniqueStrings(input.characters ?? []),
      goal: input.goal ?? "",
      conflict: input.conflict ?? "",
      outcome: input.outcome ?? "",
      foreshadowing: input.foreshadowing ?? "",
      notes: input.notes ?? "",
      status: input.status,
      eventOrder,
      importBatchId: null,
      threadIds: input.threadIds ?? [],
      createdAt: now,
      updatedAt: now
    });
  }

  updateEvent(input: OutlineUpdateEventInput): OutlineEventRecord {
    this.ensureProject(input.projectId);
    const current = this.repo.getEvent(input.projectId, input.eventId);
    if (!current) {
      throw new Error("大纲事件不存在。");
    }
    if (input.patch.chapterId !== undefined) {
      this.ensureChapterBelongsToProject(input.projectId, input.patch.chapterId ?? null);
    }
    return this.repo.updateEvent({
      projectId: input.projectId,
      eventId: input.eventId,
      patch: {
        ...input.patch,
        updatedAt: nowIso()
      }
    });
  }

  deleteEvent(input: OutlineDeleteEventInput): { deleted: true } {
    this.ensureProject(input.projectId);
    this.repo.deleteEvent(input.projectId, input.eventId);
    return { deleted: true };
  }

  reorderEvents(input: OutlineReorderEventsInput): { reordered: true } {
    this.ensureProject(input.projectId);
    this.repo.reorderEvents(input.projectId, input.orderedEventIds);
    return { reordered: true };
  }

  listThreads(input: { readonly projectId: string }): OutlineThreadRecord[] {
    this.ensureProject(input.projectId);
    return this.repo.listThreads(input.projectId);
  }

  createThread(input: OutlineCreateThreadInput): OutlineThreadRecord {
    this.ensureProject(input.projectId);
    return this.ensureThread(input.projectId, input.name, input.color);
  }

  updateThread(input: OutlineUpdateThreadInput): OutlineThreadRecord {
    this.ensureProject(input.projectId);
    return this.repo.updateThread({
      projectId: input.projectId,
      threadId: input.threadId,
      name: input.patch.name,
      color: input.patch.color,
      sortOrder: input.patch.sortOrder,
      updatedAt: nowIso()
    });
  }

  deleteThread(input: OutlineDeleteThreadInput): { deleted: true } {
    this.ensureProject(input.projectId);
    this.repo.deleteThread(input.projectId, input.threadId);
    return { deleted: true };
  }

  getChapterNote(input: OutlineGetChapterNoteInput): OutlineChapterNoteRecord | null {
    this.ensureProject(input.projectId);
    this.ensureChapterBelongsToProject(input.projectId, input.chapterId);
    return this.repo.getChapterNote(input.projectId, input.chapterId);
  }

  saveChapterNote(input: OutlineSaveChapterNoteInput): OutlineChapterNoteRecord {
    this.ensureProject(input.projectId);
    this.ensureChapterBelongsToProject(input.projectId, input.chapterId);
    const now = nowIso();
    const existing = this.repo.getChapterNote(input.projectId, input.chapterId);
    return this.repo.saveChapterNote({
      projectId: input.projectId,
      chapterId: input.chapterId,
      content: input.content,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
  }

  importLegacyChapterNote(input: OutlineImportLegacyChapterNoteInput): OutlineChapterNoteRecord {
    const existing = this.getChapterNote(input);
    if (existing && existing.content.trim() && !input.overwrite) {
      throw new Error("已有章节细纲，请确认覆盖后再导入。");
    }
    return this.saveChapterNote(input);
  }

  previewBulkImport(input: OutlinePreviewBulkImportInput): OutlineBulkImportPreview {
    this.ensureProject(input.projectId);
    return this.buildPreview(input.projectId, parseOutlineText(input.rawText));
  }

  previewImportFile(input: OutlinePreviewImportFileInput): OutlineBulkImportPreview {
    this.ensureProject(input.projectId);
    const filePath = assertSelectedOutlineImportFilePathAllowed(input.filePath);
    return this.buildPreview(input.projectId, parseOutlineFile(filePath));
  }

  confirmBulkImport(input: OutlineConfirmBulkImportInput): { importedCount: number; createdThreadCount: number } {
    this.ensureProject(input.projectId);
    return this.repo.runInTransaction(() => {
      const existingThreads = new Map(this.repo.listThreads(input.projectId).map((thread) => [normalizeName(thread.name), thread]));
      const existingEventCount = this.repo.listEvents({ projectId: input.projectId }).length;
      let createdThreadCount = 0;
      const events: OutlineEventCreateData[] = input.rows.map((row, index) => {
        this.ensureChapterBelongsToProject(input.projectId, row.chapterId);
        const threadIds = row.threadNames.map((threadName) => {
          const normalized = normalizeName(threadName);
          const existing = existingThreads.get(normalized);
          if (existing) {
            return existing.id;
          }
          const created = this.ensureThread(input.projectId, threadName);
          existingThreads.set(normalized, created);
          createdThreadCount += 1;
          return created.id;
        });
        const now = nowIso();
        return {
          id: createId("outline_event"),
          projectId: input.projectId,
          chapterId: row.chapterId,
          title: defaultTitle(row.summary),
          summary: row.summary,
          storyDate: row.storyDate ?? null,
          storyTimeLabel: row.storyTimeLabel,
          weekdayLabel: row.weekdayLabel,
          storyTimeOrder: row.storyTimeOrder ?? index + 1,
          daySegment: row.daySegment,
          customDaySegment: row.customDaySegment ?? null,
          location: row.location,
          povCharacter: "",
          characters: row.characters,
          goal: "",
          conflict: "",
          outcome: "",
          foreshadowing: "",
          notes: "",
          status: row.status,
          eventOrder: existingEventCount + index + 1,
          importBatchId: input.importBatchId,
          threadIds,
          createdAt: now,
          updatedAt: now
        };
      });
      this.repo.createEventsBulk(events);
      return { importedCount: events.length, createdThreadCount };
    });
  }

  undoImportBatch(input: OutlineUndoImportBatchInput): { deletedCount: number } {
    this.ensureProject(input.projectId);
    return { deletedCount: this.repo.deleteImportBatch(input.projectId, input.importBatchId) };
  }

  clearImportedEvents(input: OutlineClearImportedEventsInput): { deletedCount: number } {
    this.ensureProject(input.projectId);
    return { deletedCount: this.repo.deleteImportedEvents(input.projectId) };
  }

  private buildPreview(projectId: string, rows: readonly ParsedOutlineImportRow[]): OutlineBulkImportPreview {
    const chapters = this.chapterRepo.listByProject(projectId);
    const importableRows = rows.slice(0, previewLimits.maxImportRows);
    const normalizedRows = importableRows.map((row) => normalizeRow(row, chapters));
    const existingThreadNames = new Set(this.repo.listThreads(projectId).map((thread) => normalizeName(thread.name)));
    const newThreadNames = uniqueStrings(normalizedRows.flatMap((row) => row.threadNames)).filter((threadName) => !existingThreadNames.has(normalizeName(threadName)));
    return {
      importBatchId: createId("outline_import"),
      rows: normalizedRows,
      newThreadNames,
      skippedRows: rows.slice(previewLimits.maxImportRows).map((row) => ({
        rowNumber: row.rowNumber,
        reason: `超过单次导入上限 ${previewLimits.maxImportRows} 条，请拆分文件后再导入。`
      }))
    };
  }

  private ensureThread(projectId: string, name: string, color = "#2f80ed"): OutlineThreadRecord {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("情节线名称不能为空。");
    }
    const existing = this.repo.listThreads(projectId).find((thread) => normalizeName(thread.name) === normalizeName(trimmedName));
    if (existing) {
      return existing;
    }
    const now = nowIso();
    return this.repo.createThread({
      id: createId("outline_thread"),
      projectId,
      name: trimmedName,
      color,
      sortOrder: this.repo.listThreads(projectId).length + 1,
      createdAt: now,
      updatedAt: now
    });
  }

  private ensureProject(projectId: string): void {
    if (!this.projectRepo.findById(projectId)) {
      throw new Error("项目不存在。");
    }
  }

  private ensureChapterBelongsToProject(projectId: string, chapterId: string | null | undefined): void {
    if (!chapterId) {
      return;
    }
    const chapter = this.chapterRepo.getContent(chapterId);
    if (!chapter || chapter.projectId !== projectId) {
      throw new Error("章节不属于当前项目。");
    }
  }
}
