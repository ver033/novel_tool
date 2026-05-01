import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AiTaskService } from "../../src/main/ai/ai-task-service";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { AiTaskRepository } from "../../src/main/db/repositories/ai-task-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { ScratchNoteRepository } from "../../src/main/db/repositories/scratch-note-repo";
import { ProjectService } from "../../src/main/project/project-service";

const tempDirs: string[] = [];

function createServices() {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-sidebar-flow-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "novel-tool.sqlite3"));
  runMigrations(db);

  const projectRepo = new ProjectRepository(db);
  const projectService = new ProjectService(projectRepo, {
    projectFileDirectory: join(dir, "projects")
  });
  const resolveProjectDb = (projectId?: string) =>
    projectId ? projectService.getProjectDatabaseForProject(projectId) : projectService.getActiveProjectDatabase();

  return {
    aiTaskRepo: (projectId?: string) => new AiTaskRepository(resolveProjectDb(projectId)),
    aiTaskService: new AiTaskService((projectId) => new AiTaskRepository(resolveProjectDb(projectId))),
    db,
    projectService,
    scratchRepo: (projectId?: string) => new ScratchNoteRepository(resolveProjectDb(projectId))
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("sidebar data features", () => {
  it("persists scratch notes by project and optional chapter", () => {
    const { db, projectService, scratchRepo } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "归途" });
    const projectScratchRepo = scratchRepo(project.id);

    const projectNote = projectScratchRepo.create({
      projectId: project.id,
      chapterId: null,
      content: "整部作品的情绪基调要克制。",
      pinned: true,
      sourceTaskId: null
    });
    const chapterNote = projectScratchRepo.create({
      projectId: project.id,
      chapterId: initialChapter.id,
      content: "本章补一段母亲停筷。",
      pinned: false,
      sourceTaskId: null
    });

    projectScratchRepo.update({
      projectId: project.id,
      noteId: chapterNote.id,
      patch: {
        content: "本章补一段母亲停筷，动作要轻。",
        pinned: true
      }
    });

    expect(projectScratchRepo.list({ projectId: project.id }).map((note) => note.id)).toEqual([chapterNote.id, projectNote.id]);
    expect(projectScratchRepo.list({ projectId: project.id, chapterId: initialChapter.id })).toMatchObject([
      {
        id: chapterNote.id,
        chapterId: initialChapter.id,
        content: "本章补一段母亲停筷，动作要轻。",
        pinned: true
      }
    ]);

    projectScratchRepo.delete({ projectId: project.id, noteId: projectNote.id });
    expect(projectScratchRepo.list({ projectId: project.id }).map((note) => note.id)).toEqual([chapterNote.id]);

    db.close();
  });

  it("does not let scratch note updates cross project boundaries", () => {
    const { db, projectService, scratchRepo } = createServices();
    const firstProject = projectService.createProject({ name: "归途" }).project;
    const secondProject = projectService.createProject({ name: "另一部" }).project;
    projectService.openProject({ projectId: firstProject.id });
    const projectScratchRepo = scratchRepo(firstProject.id);
    const note = projectScratchRepo.create({
      projectId: firstProject.id,
      chapterId: null,
      content: "第一部项目草稿。",
      pinned: false,
      sourceTaskId: null
    });

    expect(() =>
      projectScratchRepo.update({
        projectId: secondProject.id,
        noteId: note.id,
        patch: {
          content: "不应跨项目更新。"
        }
      })
    ).toThrow("Scratch note not found");
    expect(() =>
      projectScratchRepo.delete({
        projectId: secondProject.id,
        noteId: note.id
      })
    ).toThrow("Scratch note not found");
    expect(projectScratchRepo.findById(note.id).content).toBe("第一部项目草稿。");

    db.close();
  });

  it("creates configured AI tasks for all task types with selection snapshots", () => {
    const { aiTaskService, db, projectService } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "归途" });
    const taskTypes = ["polish", "expand", "proofread", "continue"] as const;

    const tasks = taskTypes.map((taskType) =>
      aiTaskService.createTask({
        projectId: project.id,
        chapterId: initialChapter.id,
        taskType,
        inputText: "他勒住马缰。",
        instruction: "保持事实不变。",
        selection: {
          chapterId: initialChapter.id,
          from: 1,
          to: 7,
          text: "他勒住马缰",
          paragraphIds: ["p_1"],
          createdAt: "2026-04-28T00:00:00.000Z",
          selectionHash: "selection_hash"
        }
      })
    );

    expect(tasks.map((task) => task.taskType)).toEqual(taskTypes);
    expect(tasks.every((task) => task.status === "configured")).toBe(true);
    expect(tasks[0].selection).toMatchObject({ text: "他勒住马缰", selectionHash: "selection_hash" });

    db.close();
  });

  it("fails visibly instead of generating fallback AI text before OpenRouter is wired", async () => {
    const { aiTaskRepo, aiTaskService, db, projectService } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "归途" });
    const projectAiTaskRepo = aiTaskRepo(project.id);
    const task = aiTaskService.createTask({
      projectId: project.id,
      chapterId: initialChapter.id,
      taskType: "expand",
      inputText: "村口那棵老槐树，仿佛都在向他招手。"
    });

    await expect(aiTaskService.generatePreviewStream({ requestId: "stream_unconfigured", taskId: task.id })).rejects.toThrow("OpenRouter 流式服务未初始化");
    expect(projectAiTaskRepo.findTaskById(task.id)).toMatchObject({
      status: "failed",
      error: "OpenRouter 流式服务未初始化，无法生成预览。"
    });

    const candidate = projectAiTaskRepo.createCandidate({
      taskId: task.id,
      kind: "expand",
      originalText: task.inputText,
      generatedText: "村口那棵老槐树仍在风中轻轻摇晃。",
      changeSummary: "补充环境动作"
    });
    const rejected = aiTaskService.rejectCandidate({ projectId: project.id, candidateId: candidate.id });
    expect(rejected.status).toBe("rejected");

    const secondCandidate = projectAiTaskRepo.createCandidate({
      taskId: task.id,
      kind: "expand",
      originalText: task.inputText,
      generatedText: "村口那棵老槐树仍在风中轻轻摇晃。",
      changeSummary: "补充环境动作"
    });
    const applied = aiTaskService.applyCandidate({
      projectId: project.id,
      candidateId: secondCandidate.id,
      applyMode: "insert_below",
      writebackConfirmed: true
    });
    expect(applied.candidate.status).toBe("inserted");
    expect(projectAiTaskRepo.findCandidateById(secondCandidate.id).status).toBe("inserted");
    expect(projectAiTaskRepo.findTaskById(task.id)).toMatchObject({
      status: "inserted",
      error: null
    });

    const scratchCandidate = projectAiTaskRepo.createCandidate({
      taskId: task.id,
      kind: "expand",
      originalText: task.inputText,
      generatedText: "这一段可先存入草稿纸。",
      changeSummary: "草稿"
    });
    const savedToScratchpad = aiTaskService.saveCandidateToScratchpad({ projectId: project.id, candidateId: scratchCandidate.id });
    expect(savedToScratchpad.candidate.status).toBe("inserted_to_scratchpad");
    expect(projectAiTaskRepo.findTaskById(task.id).status).toBe("saved_to_scratchpad");

    db.close();
  });

  it("does not let candidate state changes cross project boundaries", () => {
    const { aiTaskRepo, aiTaskService, db, projectService } = createServices();
    const firstProject = projectService.createProject({ name: "归途" }).project;
    const secondProject = projectService.createProject({ name: "另一部" }).project;
    projectService.openProject({ projectId: firstProject.id });
    const projectAiTaskRepo = aiTaskRepo(firstProject.id);
    const task = aiTaskService.createTask({
      projectId: firstProject.id,
      taskType: "polish",
      inputText: "他停在门前。"
    });
    const candidate = projectAiTaskRepo.createCandidate({
      taskId: task.id,
      kind: "polish",
      originalText: task.inputText,
      generatedText: "他在门前停住脚步。",
      changeSummary: "增强动作"
    });

    expect(() =>
      aiTaskService.rejectCandidate({
        projectId: secondProject.id,
        candidateId: candidate.id
      })
    ).toThrow("AI task candidate not found");
    expect(() =>
      aiTaskService.applyCandidate({
        projectId: secondProject.id,
        candidateId: candidate.id,
        applyMode: "replace_selection",
        writebackConfirmed: true
      })
    ).toThrow("AI task candidate not found");
    expect(() =>
      aiTaskService.saveCandidateToScratchpad({
        projectId: secondProject.id,
        candidateId: candidate.id
      })
    ).toThrow("AI task candidate not found");
    const refreshedFirstProjectAiTaskRepo = aiTaskRepo(firstProject.id);
    expect(refreshedFirstProjectAiTaskRepo.findCandidateById(candidate.id).status).toBe("preview");
    expect(refreshedFirstProjectAiTaskRepo.findTaskById(task.id).status).toBe("configured");

    db.close();
  });
});
