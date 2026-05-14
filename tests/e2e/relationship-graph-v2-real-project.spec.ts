import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const rootDir = path.resolve(__dirname, "../..");
const now = "2026-05-13T02:00:00.000Z";
const projectId = "project_relationship_graph_v2";

function resolveElectronExecutablePath(): string {
  const platform = process.platform;
  const candidates =
    platform === "darwin"
      ? [path.join(rootDir, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")]
      : platform === "win32"
        ? [path.join(rootDir, "node_modules/electron/dist/electron.exe")]
        : [path.join(rootDir, "node_modules/electron/dist/electron")];

  const executablePath = candidates.find((candidate) => existsSync(candidate));
  if (!executablePath) {
    throw new Error(`Electron executable not found. Run \`npm install\` before e2e tests. Checked:\n${candidates.join("\n")}`);
  }
  return executablePath;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function jsonSql(value: unknown): string {
  return sqlString(JSON.stringify(value));
}

function runSql(databasePath: string, sql: string): string {
  return execFileSync("sqlite3", [databasePath, sql], { encoding: "utf8" });
}

function migrationRowsSql(): string {
  return Array.from({ length: 13 }, (_, index) => `(${index + 1}, 'seeded_for_e2e', ${sqlString(now)})`).join(",");
}

function createAppDatabase(databasePath: string, projectPath: string): void {
  runSql(
    databasePath,
    `
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations (version, name, applied_at) VALUES ${migrationRowsSql()};
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO projects (id, name, root_path, created_at, updated_at)
    VALUES (${sqlString(projectId)}, '关系图种子项目', ${sqlString(projectPath)}, ${sqlString(now)}, ${sqlString(now)});
    INSERT INTO settings (key, value_json, updated_at)
    VALUES ('current_project_id', ${jsonSql(projectId)}, ${sqlString(now)});
    `
  );
}

function createProjectDatabase(databasePath: string, projectPath: string): void {
  runSql(
    databasePath,
    `
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations (version, name, applied_at) VALUES ${migrationRowsSql()};
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE chapters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      volume_title TEXT,
      sort_order INTEGER NOT NULL,
      content_json TEXT NOT NULL,
      plain_text TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      daily_word_count INTEGER NOT NULL DEFAULT 0,
      daily_word_count_date TEXT,
      target_word_count INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      content_updated_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_chapters_project_sort ON chapters(project_id, sort_order);
    CREATE TABLE relationship_index_chapters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      chapter_title TEXT NOT NULL,
      chapter_order INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      eligible_at TEXT,
      indexed_at TEXT,
      stable_after_ms INTEGER NOT NULL,
      extractor_version TEXT NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, chapter_id)
    );
    CREATE TABLE relationship_index_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      eligible_at TEXT,
      next_run_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );
    CREATE TABLE relationship_entities (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      aliases_json TEXT NOT NULL,
      entity_kind TEXT NOT NULL,
      importance TEXT NOT NULL,
      role_summary TEXT,
      faction TEXT,
      first_chapter_order INTEGER,
      latest_chapter_order INTEGER,
      source_chapter_ids_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, canonical_name)
    );
    CREATE TABLE relationship_mentions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      chapter_title TEXT NOT NULL,
      chapter_order INTEGER NOT NULL,
      source_hash TEXT NOT NULL,
      source_name TEXT NOT NULL,
      target_name TEXT NOT NULL,
      source_entity_id TEXT,
      target_entity_id TEXT,
      base_relation_label TEXT NOT NULL,
      base_relation_summary TEXT,
      plot_relation_label TEXT NOT NULL,
      plot_relation_summary TEXT NOT NULL,
      primary_dimension_name TEXT NOT NULL,
      relationship_dimensions_json TEXT NOT NULL,
      semantic_markers_json TEXT NOT NULL,
      direction TEXT NOT NULL,
      polarity TEXT NOT NULL,
      intensity REAL NOT NULL,
      change_summary TEXT NOT NULL,
      start_state TEXT,
      end_state TEXT,
      reason TEXT,
      evidence_quote TEXT NOT NULL,
      confidence REAL NOT NULL,
      uncertainty TEXT,
      created_at TEXT NOT NULL
    );

    INSERT INTO projects (id, name, root_path, created_at, updated_at)
    VALUES (${sqlString(projectId)}, '关系图种子项目', ${sqlString(projectPath)}, ${sqlString(now)}, ${sqlString(now)});
    INSERT INTO settings (key, value_json, updated_at)
    VALUES ('current_project_id', ${jsonSql(projectId)}, ${sqlString(now)});
    ${chapterSql(1, "林砚在迷雾中遇见雾灵，两人因旧契约互相试探。")}
    ${chapterSql(2, "危机逼近，林砚与雾灵临时结盟。")}
    ${chapterSql(3, "沈照现身，雾灵的旧识身份带来新的不确定。")}
    ${entitySql("entity_lin", "林砚", "main", "person", [1, 2])}
    ${entitySql("entity_wu", "雾灵", "supporting", "nonhuman", [1, 2, 3])}
    ${entitySql("entity_shen", "沈照", "supporting", "person", [3])}
    ${indexChapterSql(1)}
    ${indexChapterSql(2)}
    ${indexChapterSql(3)}
    ${mentionSql({
      id: "mention_1",
      chapterOrder: 1,
      sourceName: "林砚",
      targetName: "雾灵",
      sourceEntityId: "entity_lin",
      targetEntityId: "entity_wu",
      baseLabel: "旧契约牵连者",
      plotLabel: "互相试探",
      dimensions: ["契约张力", "信息差"],
      primaryDimension: "契约张力"
    })}
    ${mentionSql({
      id: "mention_2",
      chapterOrder: 2,
      sourceName: "林砚",
      targetName: "雾灵",
      sourceEntityId: "entity_lin",
      targetEntityId: "entity_wu",
      baseLabel: "旧契约牵连者",
      plotLabel: "临时结盟",
      dimensions: ["契约张力", "共同风险"],
      primaryDimension: "共同风险"
    })}
    ${mentionSql({
      id: "mention_3",
      chapterOrder: 3,
      sourceName: "雾灵",
      targetName: "沈照",
      sourceEntityId: "entity_wu",
      targetEntityId: "entity_shen",
      baseLabel: "旧识",
      plotLabel: "疑似背离",
      dimensions: ["不确定动机"],
      primaryDimension: "不确定动机",
      uncertainty: "正文只暗示，没有确认"
    })}
    `
  );
}

function chapterSql(order: number, text: string): string {
  return `
    INSERT INTO chapters
      (id, project_id, title, volume_title, sort_order, content_json, plain_text, word_count, daily_word_count,
       daily_word_count_date, target_word_count, status, created_at, updated_at, content_updated_at)
    VALUES
      ('chapter_${order}', ${sqlString(projectId)}, '第${order}章', NULL, ${order - 1},
       ${jsonSql({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })},
       ${sqlString(text)}, ${text.length}, 0, NULL, NULL, 'draft', ${sqlString(now)}, ${sqlString(now)}, ${sqlString(now)});
  `;
}

function entitySql(id: string, name: string, importance: string, entityKind: string, chapterOrders: readonly number[]): string {
  return `
    INSERT INTO relationship_entities
      (id, project_id, canonical_name, aliases_json, entity_kind, importance, role_summary, faction,
       first_chapter_order, latest_chapter_order, source_chapter_ids_json, confidence, created_at, updated_at)
    VALUES
      (${sqlString(id)}, ${sqlString(projectId)}, ${sqlString(name)}, '[]', ${sqlString(entityKind)}, ${sqlString(importance)},
       ${sqlString(`${name}在测试图谱中的身份`)}, NULL, ${Math.min(...chapterOrders)}, ${Math.max(...chapterOrders)},
       ${jsonSql(chapterOrders.map((order) => `chapter_${order}`))}, 0.9, ${sqlString(now)}, ${sqlString(now)});
  `;
}

function indexChapterSql(order: number): string {
  return `
    INSERT INTO relationship_index_chapters
      (id, project_id, chapter_id, chapter_title, chapter_order, content_hash, status, eligible_at, indexed_at,
       stable_after_ms, extractor_version, token_count, error, created_at, updated_at)
    VALUES
      ('relationship_index_chapter_${order}', ${sqlString(projectId)}, 'chapter_${order}', '第${order}章', ${order},
       'relationship-e2e-${order}', 'ready', NULL, ${sqlString(now)}, 3600000, 'relationship-index-v1', 120, NULL,
       ${sqlString(now)}, ${sqlString(now)});
  `;
}

function mentionSql(input: {
  readonly id: string;
  readonly chapterOrder: number;
  readonly sourceName: string;
  readonly targetName: string;
  readonly sourceEntityId: string;
  readonly targetEntityId: string;
  readonly baseLabel: string;
  readonly plotLabel: string;
  readonly dimensions: readonly string[];
  readonly primaryDimension: string;
  readonly uncertainty?: string;
}): string {
  const dimensions = input.dimensions.map((name) => ({ name, description: `${name}说明`, confidence: 0.9 }));
  return `
    INSERT INTO relationship_mentions
      (id, project_id, chapter_id, chapter_title, chapter_order, source_hash, source_name, target_name,
       source_entity_id, target_entity_id, base_relation_label, base_relation_summary, plot_relation_label,
       plot_relation_summary, primary_dimension_name, relationship_dimensions_json, semantic_markers_json,
       direction, polarity, intensity, change_summary, start_state, end_state, reason, evidence_quote,
       confidence, uncertainty, created_at)
    VALUES
      (${sqlString(input.id)}, ${sqlString(projectId)}, 'chapter_${input.chapterOrder}', '第${input.chapterOrder}章',
       ${input.chapterOrder}, 'relationship-e2e-${input.chapterOrder}', ${sqlString(input.sourceName)}, ${sqlString(input.targetName)},
       ${sqlString(input.sourceEntityId)}, ${sqlString(input.targetEntityId)}, ${sqlString(input.baseLabel)}, ${sqlString(`${input.baseLabel}稳定层`)},
       ${sqlString(input.plotLabel)}, ${sqlString(`${input.plotLabel}阶段层`)}, ${sqlString(input.primaryDimension)},
       ${jsonSql(dimensions)}, ${jsonSql(["e2e-seed"])}, 'source_to_target', 'mixed', 0.8,
       ${sqlString(`${input.sourceName}与${input.targetName}出现关系变化`)}, '未明确', ${sqlString(input.plotLabel)}, '测试章节推进',
       ${sqlString(`${input.sourceName}看向${input.targetName}`)}, ${input.uncertainty ? 0.55 : 0.92},
       ${input.uncertainty ? sqlString(input.uncertainty) : "NULL"}, ${sqlString(now)});
  `;
}

function seedProject(homeDir: string): { readonly projectPath: string } {
  const userDataPath = path.join(homeDir, "user-data");
  const projectDir = path.join(homeDir, "projects");
  const projectPath = path.join(projectDir, "关系图种子项目.noveltool");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(userDataPath, { recursive: true });
  createAppDatabase(path.join(userDataPath, "novel-tool.sqlite3"), projectPath);
  createProjectDatabase(projectPath, projectPath);
  return { projectPath };
}

function relationshipJobCount(projectPath: string): number {
  return Number(runSql(projectPath, "SELECT COUNT(*) FROM relationship_index_jobs;").trim());
}

async function launchNovelTool(homeDir: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: resolveElectronExecutablePath(),
    args: [rootDir, `--user-data-dir=${path.join(homeDir, "user-data")}`],
    env: {
      ...process.env,
      HOME: homeDir,
      NODE_ENV: "test",
      NOVEL_TOOL_E2E_AI: "1",
      NOVEL_TOOL_E2E_USER_DATA_DIR: path.join(homeDir, "user-data")
    }
  });
}

async function firstPage(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return page;
}

test.describe("relationship graph v2 cached project flow", () => {
  test.setTimeout(90_000);

  test("renders cached V2 graph, chapter slider, focus mode, and evidence navigation without live rebuild", async () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), "novel-tool-relationship-v2-e2e-"));
    let app: ElectronApplication | null = null;
    try {
      const { projectPath } = seedProject(homeDir);
      const jobsBefore = relationshipJobCount(projectPath);
      app = await launchNovelTool(homeDir);
      const page = await firstPage(app);
      await page.setViewportSize({ width: 1440, height: 920 });

      await page.locator(".project-main-button", { hasText: "《关系图种子项目》" }).click();
      await expect(page.locator(".chapter-heading-button")).toContainText("第1章");

      await page.getByRole("button", { name: "人物关系图" }).click();
      await expect(page.locator(".relationship-graph-workspace")).toBeVisible();
      await expect(page.getByText("正在读取关系图")).toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByText("基础关系默认显示", { exact: true })).toBeVisible();
      await expect(page.getByText("点击关系线查看剧情关系")).toBeVisible();
      await expect(page.getByRole("button", { name: "展开显示设置" })).toBeVisible();
      await page.getByRole("button", { name: "展开显示设置" }).click();
      await expect(page.getByLabel("图例")).toContainText("基础关系默认显示");

      await page.getByRole("button", { name: "全部" }).click();
      await page.getByLabel("按章节查看关系图").evaluate((element) => {
        const slider = element as HTMLInputElement;
        const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        valueSetter?.call(slider, "0");
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        slider.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await expect(page.locator(".relationship-chapter-slider strong")).toContainText("第1章");

      await page.getByRole("button", { name: "选择人物 林砚", includeHidden: true }).evaluate((button) => (button as HTMLButtonElement).click());
      await expect(page.getByRole("heading", { name: "林砚" })).toBeVisible();
      const linYanKeyRelation = page.locator(".relationship-key-relation-row", {
        hasText: "雾灵"
      });
      await expect(linYanKeyRelation).toContainText("旧契约牵连者");
      await expect(linYanKeyRelation).toContainText("互相试探");
      await page.getByRole("button", { name: "以此为中心" }).click();
      await expect(page.getByRole("button", { name: "返回全局图" })).toBeVisible();
      await page.getByRole("button", { name: "二跳" }).click();

      expect(relationshipJobCount(projectPath)).toBe(jobsBefore);
    } finally {
      await app?.close();
      rmSync(homeDir, { force: true, recursive: true });
    }
  });
});
