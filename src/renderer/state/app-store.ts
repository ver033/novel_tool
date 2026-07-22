import { useCallback, useEffect, useMemo, useState } from "react";
import type { NovelToolApi } from "../../preload/api";
import type {
  ChapterContent,
  ChapterSummary,
  ImportConfirmResult,
  ProjectCreateInput,
  ProjectRecord,
  RecentProjectEntry
} from "../../main/shared/types";
import { initialVolumeTitle } from "../../main/shared/language";
import { suggestNewChapterTitle } from "./chapter-title";
import { resolveInitialActiveChapterId, saveLastWritingPosition } from "./writing-position-store";

type CreateChapterOptions = {
  readonly afterChapterId?: string;
};

type CreatedProjectResult = {
  readonly project: ProjectRecord;
  readonly initialChapter: ChapterSummary;
};

type OpenedProjectResult = {
  readonly project: ProjectRecord;
  readonly chapters: readonly ChapterSummary[];
};

type SelectedProjectFile = {
  readonly filePath: string;
};

function chapterSummaryFromContent(content: ChapterContent): ChapterSummary {
  const { contentJson: _contentJson, plainText: _plainText, ...summary } = content;
  return summary;
}

export function mergeSavedChapterContentIntoChapters(chapters: readonly ChapterSummary[], content: ChapterContent): ChapterSummary[] {
  return chapters.map((chapter) =>
    chapter.id === content.id && chapter.projectId === content.projectId ? chapterSummaryFromContent(content) : chapter
  );
}

export function getNovelToolApi(): NovelToolApi {
  const api = window.api ?? window.novelTool;
  if (!api) {
    throw new Error("Electron preload API 未加载：window.api/window.novelTool 不存在。请在 Electron 中运行应用，并检查 preload/contextBridge 配置。");
  }
  return api;
}

export function useAppStore() {
  const api = useMemo(getNovelToolApi, []);
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>([]);
  const [currentProject, setCurrentProject] = useState<ProjectRecord | null>(null);
  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);

  const activeChapter = chapters.find((chapter) => chapter.id === activeChapterId) ?? chapters[0] ?? null;

  const loadRecentProjects = useCallback(async () => {
    setRecentProjects((await api.project.listRecentProjects()) as RecentProjectEntry[]);
  }, [api]);

  const openProject = useCallback(
    async (projectId: string) => {
      const opened = (await api.project.openProject({ projectId })) as OpenedProjectResult;
      setCurrentProject(opened.project);
      setChapters([...opened.chapters]);
      setActiveChapterId(resolveInitialActiveChapterId(opened.project.id, opened.chapters));
      await loadRecentProjects();
    },
    [api, loadRecentProjects]
  );

  const openProjectFile = useCallback(async () => {
    const selected = (await api.project.selectProjectFile()) as SelectedProjectFile | null;
    if (!selected) {
      return null;
    }

    const opened = (await api.project.openProjectFile({ filePath: selected.filePath })) as OpenedProjectResult;
    setCurrentProject(opened.project);
    setChapters([...opened.chapters]);
    setActiveChapterId(resolveInitialActiveChapterId(opened.project.id, opened.chapters));
    await loadRecentProjects();
    return opened;
  }, [api, loadRecentProjects]);

  const selectProjectSavePath = useCallback(
    async (suggestedName: string) => {
      const selected = (await api.project.selectProjectSavePath({ suggestedName })) as SelectedProjectFile | null;
      return selected?.filePath ?? null;
    },
    [api]
  );

  const suggestProjectPath = useCallback(
    async (suggestedName: string) => {
      const suggested = (await api.project.suggestProjectPath({ suggestedName })) as SelectedProjectFile;
      return suggested.filePath;
    },
    [api]
  );

  const createProject = useCallback(async (input: ProjectCreateInput) => {
    const created = (await api.project.createProject(input)) as CreatedProjectResult;
    setCurrentProject(created.project);
    setChapters([created.initialChapter]);
    setActiveChapterId(created.initialChapter.id);
    await loadRecentProjects();
  }, [api, loadRecentProjects]);

  const continueWriting = useCallback(async () => {
    const recent = (await api.project.listRecentProjects()) as RecentProjectEntry[];
    setRecentProjects(recent);
    return recent;
  }, [api]);

  const renameProject = useCallback(
    async (projectId: string, name: string) => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        return;
      }

      const renamed = (await api.project.renameProject({ projectId, name: trimmedName })) as ProjectRecord;
      setRecentProjects((current) => current.map((entry) => (entry.project.id === renamed.id ? { ...entry, project: renamed } : entry)));
      setCurrentProject((current) => (current?.id === renamed.id ? renamed : current));
      await loadRecentProjects();
    },
    [api, loadRecentProjects]
  );

  const deleteProject = useCallback(
    async (projectId: string, currentName: string) => {
      if (!window.confirm(`删除项目《${currentName}》？此操作会删除 .noveltool 项目文件及其中的章节、草稿纸和 AI 记录。`)) {
        return;
      }

      const wasCurrentProject = currentProject?.id === projectId;
      await api.project.deleteProject({ projectId });
      setRecentProjects((current) => current.filter((entry) => entry.project.id !== projectId));
      setCurrentProject((current) => (current?.id === projectId ? null : current));
      setChapters((current) => (wasCurrentProject ? [] : current));
      setActiveChapterId((current) => (wasCurrentProject ? null : current));
    },
    [api, currentProject?.id]
  );

  const createChapter = useCallback(async (options: CreateChapterOptions = {}) => {
    if (!currentProject) {
      return;
    }

    const sortedChapters = [...chapters].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
    const lastChapter = sortedChapters[sortedChapters.length - 1] ?? null;
    const requestedAfterChapter = options.afterChapterId ? sortedChapters.find((chapter) => chapter.id === options.afterChapterId) ?? null : null;
    const afterChapter = requestedAfterChapter?.id === lastChapter?.id ? requestedAfterChapter : null;
    const title = suggestNewChapterTitle(sortedChapters, afterChapter ? { afterChapterId: afterChapter.id } : {});
    const inheritedTargetWordCount = (afterChapter ?? sortedChapters[sortedChapters.length - 1])?.targetWordCount ?? null;
    const volumeTitle = (afterChapter ?? sortedChapters[sortedChapters.length - 1])?.volumeTitle ?? initialVolumeTitle(currentProject.contentLanguage);
    const chapter = (await api.chapter.create({
      projectId: currentProject.id,
      title,
      volumeTitle,
      sortOrder: afterChapter ? afterChapter.sortOrder + 1 : undefined,
      targetWordCount: inheritedTargetWordCount
    })) as ChapterSummary;
    const refreshedChapters = (await api.chapter.list({ projectId: currentProject.id })) as ChapterSummary[];
    setChapters([...refreshedChapters]);
    setActiveChapterId(chapter.id);
  }, [api, chapters, currentProject]);

  const renameChapter = useCallback(
    async (chapterId: string, title: string) => {
      const trimmedTitle = title.trim();
      if (!trimmedTitle) {
        return;
      }

      const renamed = (await api.chapter.rename({ projectId: currentProject?.id, chapterId, title: trimmedTitle })) as ChapterSummary;
      setChapters((current) => current.map((chapter) => (chapter.id === renamed.id ? renamed : chapter)));
    },
    [api, currentProject?.id]
  );

  const updateChapterTargetWordCount = useCallback(
    async (chapterId: string, targetWordCount: number | null) => {
      const updated = (await api.chapter.updateTargetWordCount({
        projectId: currentProject?.id,
        chapterId,
        targetWordCount
      })) as ChapterSummary;
      setChapters((current) => current.map((chapter) => (chapter.id === updated.id ? updated : chapter)));
    },
    [api, currentProject?.id]
  );

  const updateChapterFromSavedContent = useCallback((content: ChapterContent) => {
    setChapters((current) => mergeSavedChapterContentIntoChapters(current, content));
  }, []);

  const deleteChapter = useCallback(
    async (chapterId: string) => {
      const chapterIndex = chapters.findIndex((chapter) => chapter.id === chapterId);
      const chapter = chapters[chapterIndex];
      if (!chapter || !window.confirm(`删除“${chapter.title}”？`)) {
        return;
      }

      const remainingChapters = chapters.filter((item) => item.id !== chapterId);
      const nextActiveId =
        activeChapterId === chapterId
          ? remainingChapters[Math.min(chapterIndex, remainingChapters.length - 1)]?.id ?? null
          : activeChapterId;

      await api.chapter.delete({ projectId: currentProject?.id, chapterId });
      setChapters(remainingChapters);
      setActiveChapterId(nextActiveId);
    },
    [activeChapterId, api, chapters, currentProject?.id]
  );

  useEffect(() => {
    void loadRecentProjects();
  }, [loadRecentProjects]);

  useEffect(() => {
    if (currentProject && activeChapter) {
      saveLastWritingPosition({
        projectId: currentProject.id,
        chapterId: activeChapter.id
      });
    }
  }, [activeChapter?.id, currentProject?.id]);

  const selectChapter = useCallback((chapterId: string) => {
    setActiveChapterId(chapterId);
  }, []);

  const acceptImportedProject = useCallback(async (result: ImportConfirmResult) => {
    const refreshedChapters = (await api.chapter.list({ projectId: result.project.id })) as ChapterSummary[];
    setCurrentProject(result.project);
    setChapters(refreshedChapters);
    setActiveChapterId(
      result.firstChapterId && refreshedChapters.some((chapter) => chapter.id === result.firstChapterId)
        ? result.firstChapterId
        : refreshedChapters[0]?.id ?? null
    );
    void loadRecentProjects();
  }, [api, loadRecentProjects]);

  return useMemo(() => ({
    acceptImportedProject,
    activeChapter,
    activeChapterId,
    chapters,
    continueWriting,
    createChapter,
    createProject,
    currentProject,
    deleteChapter,
    deleteProject,
    openProject,
    openProjectFile,
    recentProjects,
    renameProject,
    renameChapter,
    updateChapterTargetWordCount,
    updateChapterFromSavedContent,
    refreshRecentProjects: loadRecentProjects,
    selectChapter,
    selectProjectSavePath,
    suggestProjectPath
  }), [
    acceptImportedProject,
    activeChapter,
    activeChapterId,
    chapters,
    continueWriting,
    createChapter,
    createProject,
    currentProject,
    deleteChapter,
    deleteProject,
    openProject,
    openProjectFile,
    recentProjects,
    renameProject,
    renameChapter,
    updateChapterTargetWordCount,
    updateChapterFromSavedContent,
    loadRecentProjects,
    selectChapter,
    selectProjectSavePath,
    suggestProjectPath
  ]);
}
