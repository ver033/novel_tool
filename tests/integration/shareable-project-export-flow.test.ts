import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { AuthorRelationshipRepository } from "../../src/main/db/repositories/author-relationship-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { SummaryRepository } from "../../src/main/db/repositories/summary-repo";
import { WritingGoalRepository } from "../../src/main/db/repositories/writing-goal-repo";
import { SummaryService } from "../../src/main/ai/summary-service";
import { ShareableProjectExporter } from "../../src/main/export/shareable-project-exporter";
import { openExistingProjectDatabase } from "../../src/main/project/project-file";
import { ProjectService } from "../../src/main/project/project-service";
import { countWritingUnits } from "../../src/main/shared/text";
import { WritingGoalService } from "../../src/main/writing-goals/writing-goal-service";
import { chapterIndexPayloadV2 } from "../helpers/summary-index-fixtures";

const tempDirs: string[] = [];
const projectServices: ProjectService[] = [];

function createProjectHarness() {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-share-export-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "app.sqlite3"));
  runMigrations(db);

  const projectRepo = new ProjectRepository(db);
  const projectService = new ProjectService(projectRepo, {
    projectFileDirectory: join(dir, "projects")
  });
  projectServices.push(projectService);

  return { db, dir, projectService };
}

function countRows(db: ReturnType<typeof createDatabase>, tableName: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { readonly count: number };
  return row.count;
}

afterEach(() => {
  for (const projectService of projectServices.splice(0)) {
    projectService.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("shareable project export flow", () => {
  it("exports a privacy-scrubbed project copy while preserving selected derived caches", async () => {
    const { db, dir, projectService } = createProjectHarness();
    const { project, initialChapter } = projectService.createProject({ name: "白鹿原" });
    const projectDb = projectService.getProjectDatabaseForProject(project.id);
    const chapterRepo = new ChapterRepository(projectDb);
    const authorRelationshipRepo = new AuthorRelationshipRepository(projectDb);
    const now = "2026-05-15T00:00:00.000Z";

    chapterRepo.saveContent(
      initialChapter.id,
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "白嘉轩站在原上。" }] }] },
      "白嘉轩站在原上。",
      countWritingUnits("白嘉轩站在原上。"),
      0,
      "2026-05-15",
      now
    );
    chapterRepo.createSnapshot({
      id: "snapshot_private",
      chapterId: initialChapter.id,
      contentJson: { type: "doc" },
      plainText: "这段旧稿不能进入分享副本。",
      reason: "privacy-test",
      createdAt: now
    });

    projectDb.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)").run(
      "project_source",
      JSON.stringify({ type: "txt", path: "/Users/backtime/private/source.txt" }),
      now
    );
    projectDb.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)").run("current_project_id", JSON.stringify(project.id), now);
    projectDb
      .prepare(
        "INSERT INTO import_jobs (id, project_id, source_path, source_type, status, parsed_json, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run("import_private", project.id, "/Users/backtime/private/source.txt", "txt", "completed", JSON.stringify({ raw: "导入预览" }), null, now, now);
    projectDb
      .prepare(
        "INSERT INTO ai_tasks (id, project_id, chapter_id, task_type, status, input_text, output_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run("task_private", project.id, initialChapter.id, "polish", "preview_ready", "私密改写输入", "私密改写输出", now, now);
    projectDb
      .prepare(
        "INSERT INTO ai_task_candidates (id, task_id, kind, original_text, generated_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run("candidate_private", "task_private", "polish", "旧句子", "新句子", "preview", now, now);
    projectDb
      .prepare("INSERT INTO ai_chat_sessions (id, project_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("chat_private", project.id, "私密对话", "active", now, now);
    projectDb
      .prepare("INSERT INTO ai_chat_messages (id, session_id, project_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("message_private", "chat_private", project.id, "user", "不要导出这段聊天", now);
    projectDb
      .prepare("INSERT INTO scratch_notes (id, project_id, chapter_id, content, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("note_private", project.id, initialChapter.id, "临时素材不默认分享", 1, now, now);
    projectDb
      .prepare(
        "INSERT INTO prompt_presets (id, project_id, name, task_type, system_prompt, user_template, is_builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run("preset_private", project.id, "私有提示词", "polish", "私有 system", "私有 template", 0, now, now);
    projectDb
      .prepare(
        "INSERT INTO chapter_ai_summaries (id, project_id, chapter_id, chapter_title, chapter_order, content_hash, summary_short, summary_long, structured_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        "summary_keep",
        project.id,
        initialChapter.id,
        initialChapter.title,
        1,
        "hash_1",
        "短摘要",
        "长摘要",
        JSON.stringify(chapterIndexPayloadV2({ title: initialChapter.title })),
        "ready",
        now,
        now
      );
    authorRelationshipRepo.createRelationship({
      projectId: project.id,
      sourceCharacterName: "白嘉轩",
      targetCharacterName: "鹿三",
      sourceToTargetLabel: "主人",
      targetToSourceLabel: "长工"
    });
    const writingGoalService = new WritingGoalService(new WritingGoalRepository(projectDb));
    writingGoalService.createGoal({
      projectId: project.id,
      name: "私密写作目标",
      goalType: "total_words",
      targetWordCount: 100_000,
      startDate: "2026-05-15",
      deadlineDate: "2026-06-15",
      activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
      restDates: []
    });
    writingGoalService.recordWordDelta({
      projectId: project.id,
      chapterId: initialChapter.id,
      chapterTitle: initialChapter.title,
      chapterSortOrder: initialChapter.sortOrder,
      previousWordCount: 0,
      nextWordCount: countWritingUnits("白嘉轩站在原上。"),
      previousProjectWordCount: 0,
      nextProjectWordCount: countWritingUnits("白嘉轩站在原上。"),
      now
    });
    projectDb
      .prepare(
        "INSERT INTO summary_jobs (id, project_id, job_type, target_id, source_hash, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run("summary_job_private", project.id, "chapter_summary", initialChapter.id, "hash_1", "failed", "模型错误详情", now, now);
    const outputPath = join(dir, "share", "白鹿原-可分享副本.noveltool");
    const exporter = new ShareableProjectExporter((projectId) => projectService.getProjectDatabaseForProject(projectId));
    const result = await exporter.exportShareableProjectCopy({
      projectId: project.id,
      filePath: outputPath,
      includeScratchNotes: false,
      includePromptPresets: false,
      includeSummaryCache: true,
      includeWritingGoalsAndStats: false
    });

    expect(result.filePath).toBe(outputPath);
    expect(result.included).toEqual(expect.arrayContaining(["章节正文", "人物关系设定", "章节索引缓存"]));
    expect(result.removed).toEqual(expect.arrayContaining(["本机路径", "章节快照", "AI 聊天记录", "AI 改写任务记录", "导入记录", "缓存任务记录"]));

    const exportedDb = openExistingProjectDatabase(outputPath);
    try {
      const exportedProject = new ProjectRepository(exportedDb).listRecent(1)[0];
      expect(exportedProject?.id).not.toBe(project.id);
      expect(exportedProject?.name).toBe(project.name);
      expect(exportedProject?.rootPath).toBeNull();
      expect(new ChapterRepository(exportedDb).listByProject(exportedProject.id)).toHaveLength(1);
      expect(new ChapterRepository(exportedDb).getContent(initialChapter.id)?.plainText).toBe("白嘉轩站在原上。");
      expect(countRows(exportedDb, "settings")).toBe(0);
      expect(countRows(exportedDb, "import_jobs")).toBe(0);
      expect(countRows(exportedDb, "chapter_snapshots")).toBe(0);
      expect(countRows(exportedDb, "ai_tasks")).toBe(0);
      expect(countRows(exportedDb, "ai_task_candidates")).toBe(0);
      expect(countRows(exportedDb, "ai_chat_sessions")).toBe(0);
      expect(countRows(exportedDb, "ai_chat_messages")).toBe(0);
      expect(countRows(exportedDb, "scratch_notes")).toBe(0);
      expect(countRows(exportedDb, "prompt_presets")).toBe(0);
      expect(countRows(exportedDb, "summary_jobs")).toBe(0);
      expect(countRows(exportedDb, "writing_goals")).toBe(0);
      expect(countRows(exportedDb, "writing_word_events")).toBe(0);
      expect(countRows(exportedDb, "writing_daily_stats")).toBe(0);
      expect(countRows(exportedDb, "writing_goal_daily_plans")).toBe(0);
      expect(countRows(exportedDb, "chapter_ai_summaries")).toBe(1);
      const authorCharacters = exportedDb.prepare("SELECT name, project_id FROM author_relationship_characters ORDER BY name ASC").all() as {
        readonly name: string;
        readonly project_id: string;
      }[];
      const authorRelationships = exportedDb
        .prepare("SELECT source_to_target_label, target_to_source_label, project_id FROM author_relationships")
        .all() as { readonly source_to_target_label: string; readonly target_to_source_label: string | null; readonly project_id: string }[];
      expect(authorCharacters.map((row) => row.name).sort()).toEqual(["白嘉轩", "鹿三"]);
      expect(authorCharacters.every((row) => row.project_id === exportedProject.id)).toBe(true);
      expect(authorRelationships).toEqual([
        {
          source_to_target_label: "主人",
          target_to_source_label: "长工",
          project_id: exportedProject.id
        }
      ]);
    } finally {
      exportedDb.close();
    }

    const opened = projectService.openProjectFile({ filePath: outputPath });
    expect(opened.project.id).not.toBe(project.id);
    expect(opened.chapters.map((chapter) => chapter.title)).toEqual([initialChapter.title]);
    expect(() =>
      new SummaryService(
        new SummaryRepository(projectService.getProjectDatabaseForProject(opened.project.id)),
        new ChapterRepository(projectService.getProjectDatabaseForProject(opened.project.id))
      ).getIndexStatus(opened.project.id, now)
    ).not.toThrow();

    db.close();
  });

  it("deletes the copy and rejects export when a high-confidence secret survives sanitization", async () => {
    const { db, dir, projectService } = createProjectHarness();
    const { project } = projectService.createProject({ name: "泄漏检查" });
    const projectDb = projectService.getProjectDatabaseForProject(project.id);
    projectDb.exec("CREATE TABLE future_private_metadata (value TEXT NOT NULL);");
    projectDb.prepare("INSERT INTO future_private_metadata (value) VALUES (?)").run("OPENROUTER_API_KEY=sk-or-should-not-leak");

    const outputPath = join(dir, "share", "leak.noveltool");
    const exporter = new ShareableProjectExporter((projectId) => projectService.getProjectDatabaseForProject(projectId));

    await expect(
      exporter.exportShareableProjectCopy({
        projectId: project.id,
        filePath: outputPath,
        includeScratchNotes: false,
        includePromptPresets: false,
        includeSummaryCache: false,
        includeWritingGoalsAndStats: false
      })
    ).rejects.toThrow("可分享副本隐私扫描失败");
    expect(existsSync(outputPath)).toBe(false);

    db.close();
  });
});
