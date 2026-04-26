import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { createProject } from "../../../src/main/projects/project-service";
import { readProjectConfig, writeProjectConfig } from "../../../src/main/projects/project-config";

async function tempRoot() {
  return mkdtemp(path.join(tmpdir(), "novel-tool-project-"));
}

describe("project service", () => {
  test("creates a portable .novelproj folder with config, folders, and database", async () => {
    const root = await tempRoot();
    const project = await createProject({
      baseDirectory: root,
      projectName: "雾灯纪事"
    });

    expect(project.projectPath).toBe(path.join(root, "雾灯纪事.novelproj"));
    await expect(stat(path.join(project.projectPath, "book.db"))).resolves.toBeTruthy();
    await expect(stat(path.join(project.projectPath, "originals"))).resolves.toBeTruthy();
    await expect(stat(path.join(project.projectPath, "canon"))).resolves.toBeTruthy();
    await expect(stat(path.join(project.projectPath, "outlines"))).resolves.toBeTruthy();
    await expect(stat(path.join(project.projectPath, "exports"))).resolves.toBeTruthy();
    await expect(stat(path.join(project.projectPath, "backups"))).resolves.toBeTruthy();
    await expect(stat(path.join(project.projectPath, "cache"))).resolves.toBeTruthy();
    await expect(stat(path.join(project.projectPath, "logs"))).resolves.toBeTruthy();

    const config = await readProjectConfig(project.projectPath);
    expect(config.projectName).toBe("雾灯纪事");
    expect(config.taskModelProfile.chat.reasoningEffort).toBe("high");
    expect(config.customInstructions.polish).toContain("保守");
    expect(config.contextReferences.paragraphIds).toEqual([]);

    const db = new Database(path.join(project.projectPath, "book.db"));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual')").all() as Array<{ name: string }>;
    db.close();
    expect(tables.map((row) => row.name)).toContain("paragraphs");
    expect(tables.map((row) => row.name)).toContain("paragraphs_fts");
  });

  test("does not silently reuse an existing project folder when creating", async () => {
    const root = await tempRoot();
    await createProject({
      baseDirectory: root,
      projectName: "重复项目"
    });

    await expect(
      createProject({
        baseDirectory: root,
        projectName: "重复项目"
      })
    ).rejects.toThrow("项目已存在");
  });

  test("rejects provider secrets in project config", async () => {
    const root = await tempRoot();
    const project = await createProject({
      baseDirectory: root,
      projectName: "密钥边界"
    });

    await expect(
      writeProjectConfig(project.projectPath, {
        schemaVersion: 1,
        projectName: "密钥边界",
        language: "zh-CN",
        defaultOpenState: {},
        taskModelProfile: {
          chat: { modelRole: "pro", reasoningEffort: "high", thinkingMode: "enabled" },
          polish: { modelRole: "flash", reasoningEffort: "high", thinkingMode: "disabled" },
          continuity: { modelRole: "pro", reasoningEffort: "high", thinkingMode: "enabled" },
          expand: { modelRole: "pro", reasoningEffort: "high", thinkingMode: "enabled" },
          proofread: { modelRole: "flash", reasoningEffort: "high", thinkingMode: "disabled" },
          memory: { modelRole: "flash", reasoningEffort: "high", thinkingMode: "disabled" }
        },
        customInstructions: {
          global: "保持作者风格。",
          polish: "保守润色。",
          expand: "覆盖情节要点。",
          proofread: "检查中文表达。",
          continuity: "证据不足时返回不确定。",
          chat: "回答必须列出来源段落。"
        },
        agentDefaults: {
          chatExecutionMode: "suggest_only",
          requireApprovalForWrites: true,
          showToolTrace: true,
          allowedTools: ["context_builder"]
        },
        providerApiKey: "sk-secret"
      } as never)
    ).rejects.toThrow("Project config must not contain provider secrets");

    const raw = await readFile(path.join(project.projectPath, "project-config.json"), "utf8");
    expect(raw).not.toContain("sk-secret");
  });
});
