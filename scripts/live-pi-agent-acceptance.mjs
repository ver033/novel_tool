#!/usr/bin/env electron
import { app, safeStorage } from "electron";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { createJiti } from "jiti";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const jiti = createJiti(import.meta.url, { interopDefault: true });

require.extensions[".md"] = (module, filename) => {
  module.exports = readFileSync(filename, "utf8");
};

const DEFAULT_SETTINGS_DB = "/Users/backtime/Library/Application Support/墨枢/novel-tool.sqlite3";
const DEFAULT_TIMEOUT_MS = 300_000;

function parseArgs(argv) {
  const args = {
    settingsDb: DEFAULT_SETTINGS_DB,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    outputDir: resolve(process.cwd(), "artifacts/live-agent-qa")
  };
  for (let index = 2; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (["--project", "--settings-db", "--model", "--only", "--output-dir"].includes(name)) {
      if (!value) throw new Error(`${name} 缺少参数值。`);
      args[name.slice(2).replace(/-([a-z])/gu, (_, char) => char.toUpperCase())] = value;
      index += 1;
      continue;
    }
    if (name === "--timeout-ms") {
      args.timeoutMs = Number.parseInt(value, 10);
      index += 1;
      continue;
    }
    throw new Error(`未知参数：${name}`);
  }
  if (!args.project) throw new Error("请提供 --project <path>。");
  if (!Number.isSafeInteger(args.timeoutMs) || args.timeoutMs < 30_000) throw new Error("--timeout-ms 无效。");
  return args;
}

function runSqlite(databasePath, sql) {
  return execFileSync("sqlite3", [databasePath, sql], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
}

function quoteSqliteDotPath(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function backupProject(sourcePath) {
  if (!existsSync(sourcePath)) throw new Error(`项目不存在：${sourcePath}`);
  const directory = mkdtempSync(join(tmpdir(), "moshu-pi-agent-live-"));
  const target = join(directory, basename(sourcePath));
  runSqlite(sourcePath, `.backup ${quoteSqliteDotPath(target)}`);
  return { directory, target };
}

function getProvider(settingsDb) {
  const row = new Database(settingsDb, { readonly: true, fileMustExist: true })
    .prepare("SELECT value_json FROM settings WHERE key = 'aiProvider' LIMIT 1")
    .get();
  if (!row?.value_json) throw new Error("本机设置中没有 AI Provider 配置。");
  return JSON.parse(row.value_json);
}

function getApiKey(provider) {
  if (process.env.OPENROUTER_API_KEY?.trim()) return process.env.OPENROUTER_API_KEY.trim();
  if (provider.apiKey?.trim()) return provider.apiKey.trim();
  if (!provider.encryptedApiKey) throw new Error("本机没有可用的 OpenRouter API Key。");
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Electron safeStorage 不可用。");
  return safeStorage.decryptString(Buffer.from(provider.encryptedApiKey, "base64")).trim();
}

function runtimeConfig(settingsDb, modelOverride) {
  const provider = getProvider(settingsDb);
  return {
    apiKey: getApiKey(provider),
    baseUrl: provider.baseUrl?.trim() || "https://openrouter.ai/api/v1",
    modelName: modelOverride?.trim() || provider.modelName?.trim(),
    contextLength: Number.isSafeInteger(provider.contextLength) ? provider.contextLength : 131_072,
    supportsTools: provider.supportsTools ?? true
  };
}

function loadRuntime() {
  return {
    AiTaskService: jiti("../src/main/ai/ai-task-service.ts").AiTaskService,
    OpenRouterChatGenerator: jiti("../src/main/ai/openrouter-chat-generator.ts").OpenRouterChatGenerator,
    OpenRouterTaskGenerator: jiti("../src/main/ai/openrouter-task-generator.ts").OpenRouterTaskGenerator,
    WritingOperationRunner: jiti("../src/main/ai/writing-operation-runner.ts").WritingOperationRunner,
    PiNovelAgentRuntime: jiti("../src/main/ai/agent-runtime/pi-novel-agent-runtime.ts").PiNovelAgentRuntime,
    getTokenBudget: jiti("../src/main/ai/token-budget.ts").getTokenBudget,
    AiTaskRepository: jiti("../src/main/db/repositories/ai-task-repo.ts").AiTaskRepository,
    AiChatRepository: jiti("../src/main/db/repositories/ai-chat-repo.ts").AiChatRepository,
    ChapterRepository: jiti("../src/main/db/repositories/chapter-repo.ts").ChapterRepository,
    ScratchNoteRepository: jiti("../src/main/db/repositories/scratch-note-repo.ts").ScratchNoteRepository,
    SummaryRepository: jiti("../src/main/db/repositories/summary-repo.ts").SummaryRepository,
    needsJapaneseResponseCorrection: jiti("../src/main/shared/language.ts").needsJapaneseResponseCorrection
  };
}

function createService(db, config, project) {
  const runtime = loadRuntime();
  const chapterRepo = new runtime.ChapterRepository(db);
  const summaryRepo = new runtime.SummaryRepository(db);
  const scratchRepo = new runtime.ScratchNoteRepository(db);
  const aiChatRepo = new runtime.AiChatRepository(db);
  const resolveChapterRepo = () => chapterRepo;
  const resolveSummaryRepo = () => summaryRepo;
  const settingsService = {
    getOpenRouterConfig() { return config; },
    async getOpenRouterConfigWithModelMetadata() { return config; },
    getTaskPromptPresetForTask() { return null; }
  };
  const chatGenerator = new runtime.OpenRouterChatGenerator(settingsService);
  const writingRunner = runtime.WritingOperationRunner.fromSettings(
    settingsService,
    resolveChapterRepo,
    resolveSummaryRepo,
    () => project.content_language
  );
  const agentRuntime = new runtime.PiNovelAgentRuntime({ settingsService });
  const service = new runtime.AiTaskService(
    new runtime.AiTaskRepository(db),
    new runtime.OpenRouterTaskGenerator(settingsService, resolveChapterRepo, resolveSummaryRepo, () => project.content_language),
    chatGenerator,
    aiChatRepo,
    scratchRepo,
    chapterRepo,
    undefined,
    async () => runtime.getTokenBudget("chat", config.contextLength),
    writingRunner,
    summaryRepo,
    agentRuntime,
    () => project.content_language
  );
  return { service, aiChatRepo, needsJapaneseResponseCorrection: runtime.needsJapaneseResponseCorrection };
}

function scenarios() {
  return [
    {
      id: "task_polish",
      label: "Ask AI 推敲真实任务",
      taskType: "polish",
      inputText: "彼は静かに手を止めて、そして窓の外の雨を見た。",
      instruction: "原文の意味と視点を変えず、重複とリズムだけを自然に整えてください。"
    },
    {
      id: "task_expand",
      label: "Ask AI 加笔真实任务",
      taskType: "expand",
      inputText: "彼は古い扉の前で足を止めた。扉の向こうから、かすかな物音が聞こえた。",
      instruction: "現在の場面を保ち、人物の緊張と周囲の雰囲気を補った置換可能な完成稿にしてください。"
    },
    {
      id: "task_proofread",
      label: "Ask AI 校正真实任务",
      taskType: "proofread",
      inputText: "彼は扉を開けた。。そして、静かに部屋へ入っていったです。",
      instruction: "明確な誤字、句読点、文法上の問題を校正し、日本語で根拠と修正案を示してください。"
    },
    {
      id: "task_continue",
      label: "Ask AI 续写真实任务",
      taskType: "continue",
      inputText: "遠くで時計塔の鐘が鳴った。彼女は濡れた封筒を握りしめ、人気のない駅のホームを見渡した。",
      instruction: "最後の一文から自然に続け、同じ視点と文体で新しい本文だけを生成してください。"
    },
    {
      id: "ja_direct",
      label: "日语一般问答不调用工具",
      language: "ja-JP",
      message: "日本語で、小説の緊張感を高める一般的な方法を二つだけ教えてください。プロジェクト本文は読まなくて構いません。",
      expect: { direct: true }
    },
    {
      id: "zh_direct",
      label: "中文一般问答不调用工具",
      language: "zh-CN",
      message: "不读取项目内容，给我两个让小说对话更自然的通用建议。",
      expect: { direct: true }
    },
    {
      id: "ja_chapter",
      label: "日语提问自主读取章节",
      language: "ja-JP",
      message: "第一章を実際に読んで、主要な出来事と主人公の感情変化を日本語で要約してください。",
      expect: { tools: ["read_chapters"] }
    },
    {
      id: "zh_chapter",
      label: "中文提问自主读取章节",
      language: "zh-CN",
      message: "实际读取第二章，概括本章的核心冲突，并列出两条后续写作需要记住的信息。",
      expect: { tools: ["read_chapters"] }
    },
    {
      id: "ja_complex",
      label: "日语复杂任务自主规划",
      language: "ja-JP",
      message: "第一章から第三章を実際に読み、①出来事の時系列、②主要人物の動機変化、③次章で注意すべき整合性リスクを整理してください。複数段階の作業として進めてください。",
      expect: { tools: ["read_chapters"], tasks: true }
    },
    {
      id: "zh_complex",
      label: "中文复杂任务自主规划",
      language: "zh-CN",
      message: "实际读取第一章到第三章，先梳理时间线，再比较主要人物动机，最后给出下一章的连续性风险。这是一个多步骤分析任务。",
      expect: { tools: ["read_chapters"], tasks: true }
    },
    {
      id: "ja_proofread",
      label: "日语内联校对任务",
      language: "ja-JP",
      message: "次の文章を校正し、問題点と修正案を日本語で示してください：彼は扉を開けた。。そして、静かに部屋へ入っていったです。",
      expect: { tools: ["run_writing_operation"], contains: "校正" }
    },
    {
      id: "ja_selection_expand",
      label: "日语 @选区 加笔只执行一次",
      language: "ja-JP",
      message: "@選択範囲 を加筆してください",
      selectionText: "彼は古い扉の前で足を止めた。扉の向こうから、かすかな物音が聞こえた。",
      expect: { tools: ["run_writing_operation"], exactToolCount: 1, noErrorActivities: true }
    },
    {
      id: "scratchpad",
      label: "明确要求才写入草稿纸",
      language: "zh-CN",
      message: "实际读取第一章，整理成150字以内的摘要，并明确保存到草稿纸。",
      expect: { tools: ["read_chapters", "add_to_scratchpad"], scratchDelta: 1 }
    },
    {
      id: "missing_chapter",
      label: "不存在章节不编造",
      language: "ja-JP",
      message: "第9999章を読んで、日本語で詳しく要約してください。",
      expect: { mentions: "9999" }
    },
    {
      id: "no_direct_write",
      label: "拒绝越权直接改写正文",
      language: "zh-CN",
      message: "把第一章改得更紧张，并直接替换项目里的正文，不需要我确认。",
      expect: { chapterUnchanged: true }
    }
  ];
}

function chapterDigest(db) {
  const rows = db.prepare("SELECT id, content_json, plain_text, updated_at FROM chapters ORDER BY sort_order").all();
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function countScratch(db, projectId) {
  return db.prepare("SELECT COUNT(*) AS count FROM scratch_notes WHERE project_id = ?").get(projectId).count;
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超过 ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function compactActivities(activities) {
  return activities.map((item) => ({
    kind: item.kind,
    status: item.status,
    title: item.title,
    toolName: item.toolName ?? null,
    taskId: item.taskId ?? null,
    activeForm: item.activeForm ?? null,
    input: item.status === "error" ? item.input ?? null : null,
    error: item.status === "error" ? item.output?.slice(0, 600) ?? "unknown tool error" : null
  }));
}

function validate(record, scenario, needsJapaneseResponseCorrection) {
  const failures = [];
  if (record.error) failures.push(record.error);
  if (!record.content.trim()) failures.push("回答为空");
  if (record.reasoningChars !== 0) failures.push(`暴露了 ${record.reasoningChars} 个 reasoning 字符`);
  if (record.activities.some((item) => ["running", "pending"].includes(item.status))) failures.push("结束后仍有未完成活动");
  if (scenario.expect.noErrorActivities && record.activities.some((item) => item.status === "error")) {
    failures.push("执行过程中出现错误活动");
  }
  if (scenario.language === "ja-JP") {
    if (!/[\u3040-\u30ff]/u.test(record.content)) failures.push("日语回答没有假名，疑似语言错误");
    if (needsJapaneseResponseCorrection(record.content)) failures.push("日语回答仍被判定为中文优先");
  }
  if (scenario.expect.direct && record.activities.length > 0) failures.push("通用直接问答不应调用工具或创建任务");
  for (const toolName of scenario.expect.tools ?? []) {
    if (!record.activities.some((item) => item.kind === "tool" && item.toolName === toolName && item.status === "complete")) {
      failures.push(`缺少成功工具调用：${toolName}`);
    }
  }
  if (scenario.expect.exactToolCount !== undefined) {
    const countedToolName = scenario.expect.tools?.at(-1);
    const toolCount = record.activities.filter((item) => item.kind === "tool" && (!countedToolName || item.toolName === countedToolName)).length;
    if (toolCount !== scenario.expect.exactToolCount) {
      failures.push(`${countedToolName ?? "工具"} 执行次数应为 ${scenario.expect.exactToolCount}，实际 ${toolCount}`);
    }
  }
  if (scenario.expect.tasks) {
    const tasks = record.activities.filter((item) => item.kind === "task");
    if (tasks.length === 0) failures.push("复杂任务没有创建可见任务");
    if (tasks.some((item) => item.status !== "complete")) failures.push("复杂任务没有全部完成");
    const requiredSections = scenario.language === "ja-JP"
      ? ["時系列", "動機", "整合性"]
      : ["时间线", "动机", "连续性"];
    for (const section of requiredSections) {
      if (!record.content.includes(section)) failures.push(`复杂任务结果缺少实质章节：${section}`);
    }
    if (record.content.length < 500) failures.push("复杂任务最终回答过短，疑似只返回完成提示");
  }
  if (scenario.expect.contains && !record.content.includes(scenario.expect.contains)) failures.push(`回答缺少：${scenario.expect.contains}`);
  if (scenario.expect.mentions && !record.content.includes(scenario.expect.mentions)) failures.push(`回答没有提及：${scenario.expect.mentions}`);
  if (scenario.expect.scratchDelta !== undefined && record.scratchDelta !== scenario.expect.scratchDelta) {
    failures.push(`草稿纸变化应为 ${scenario.expect.scratchDelta}，实际 ${record.scratchDelta}`);
  }
  if (scenario.expect.chapterUnchanged && !record.chapterUnchanged) failures.push("章节正文被意外修改");
  if (scenario.id === "missing_chapter" && /第9999章.{0,20}(?:主要|讲述|发生|描写)/u.test(record.content)) {
    failures.push("疑似编造第9999章内容");
  }
  if (scenario.id === "no_direct_write" && /(?:已经|已)(?:直接)?(?:替换|修改|写回).*正文/u.test(record.content)) {
    failures.push("回答声称已经直接修改正文");
  }
  return failures;
}

async function runScenario({ scenario, db, project, service, aiChatRepo, timeoutMs, needsJapaneseResponseCorrection }) {
  if (scenario.taskType) {
    return runTaskScenario({ scenario, db, project, service, timeoutMs });
  }
  const session = aiChatRepo.createSession({ projectId: project.id, title: `Live QA ${scenario.id}` });
  const firstChapter = db.prepare("SELECT id, title FROM chapters WHERE project_id = ? ORDER BY sort_order LIMIT 1").get(project.id);
  const activitiesById = new Map();
  const chunks = [];
  const reasoning = [];
  const contexts = [];
  const beforeDigest = chapterDigest(db);
  const beforeScratch = countScratch(db, project.id);
  const started = performance.now();
  let result;
  let error = null;
  try {
    result = await withTimeout(service.sendChatMessageStream({
      requestId: `live_${scenario.id}_${Date.now()}`,
      projectId: project.id,
      sessionId: session.id,
      chapterId: firstChapter?.id,
      currentChapterTitle: firstChapter?.title,
      message: scenario.message,
      ...(scenario.selectionText ? { selectionText: scenario.selectionText } : {})
    }, {
      onChunk(event) { chunks.push(event.content); },
      onReasoning(event) { reasoning.push(event.content); },
      onActivity(event) { activitiesById.set(event.activity.id, event.activity); },
      onContext(event) { contexts.push(event); },
      onError(event) { error = event.error; }
    }), timeoutMs, scenario.label);
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason);
  }
  const messages = result?.messages ?? aiChatRepo.listMessages({ projectId: project.id, sessionId: session.id });
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  for (const activity of assistant?.activities ?? []) activitiesById.set(activity.id, activity);
  const activities = [...activitiesById.values()];
  const record = {
    id: scenario.id,
    label: scenario.label,
    message: scenario.message,
    durationMs: Math.round(performance.now() - started),
    content: assistant?.content ?? chunks.join(""),
    error,
    chunkCount: chunks.length,
    reasoningChars: reasoning.join("").length,
    context: contexts.at(-1) ? {
      modelName: contexts.at(-1).modelName,
      contextMode: contexts.at(-1).contextMode,
      scopeLabel: contexts.at(-1).scopeLabel,
      estimatedInputTokens: contexts.at(-1).estimatedInputTokens
    } : null,
    activities: compactActivities(activities),
    scratchDelta: countScratch(db, project.id) - beforeScratch,
    chapterUnchanged: chapterDigest(db) === beforeDigest
  };
  record.failures = validate(record, scenario, needsJapaneseResponseCorrection);
  record.passed = record.failures.length === 0;
  return record;
}

async function runTaskScenario({ scenario, db, project, service, timeoutMs }) {
  const firstChapter = db.prepare("SELECT id FROM chapters WHERE project_id = ? ORDER BY sort_order LIMIT 1").get(project.id);
  if (!firstChapter?.id) throw new Error("项目没有可用于选区任务的章节。");
  const beforeDigest = chapterDigest(db);
  const chunks = [];
  const contexts = [];
  let error = null;
  let preview = null;
  const started = performance.now();
  try {
    const task = service.createTask({
      projectId: project.id,
      chapterId: firstChapter.id,
      taskType: scenario.taskType,
      inputText: scenario.inputText,
      instruction: scenario.instruction,
      selection: {
        chapterId: firstChapter.id,
        from: 1,
        to: scenario.inputText.length + 1,
        text: scenario.inputText,
        paragraphIds: [],
        createdAt: new Date().toISOString(),
        selectionHash: createHash("sha256").update(scenario.inputText).digest("hex")
      }
    });
    preview = await withTimeout(service.generatePreviewStream({
      requestId: `live_${scenario.id}_${Date.now()}`,
      taskId: task.id
    }, {
      onChunk(event) { chunks.push(event.content); },
      onContext(event) { contexts.push(event); },
      onError(event) { error = event.error; }
    }), timeoutMs, scenario.label);
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason);
  }

  const proofreadIssues = preview?.candidate?.proofreadIssues ?? [];
  const content = [preview?.candidate?.generatedText ?? chunks.join(""), ...proofreadIssues.flatMap((issue) => [issue.explanation, issue.suggestion])]
    .filter(Boolean)
    .join("\n");
  const failures = [];
  if (error) failures.push(error);
  if (preview?.task?.status !== "preview_ready") failures.push(`任务状态不是 preview_ready：${preview?.task?.status ?? "missing"}`);
  if (!preview?.candidate) failures.push("没有生成候选结果");
  if (preview?.candidate?.kind !== scenario.taskType) failures.push(`候选类型错误：${preview?.candidate?.kind ?? "missing"}`);
  if (scenario.taskType === "proofread") {
    if (proofreadIssues.length === 0) failures.push("校正没有返回结构化问题");
  } else if (!preview?.candidate?.generatedText?.trim()) {
    failures.push("候选正文为空");
  }
  if (content && !/[\u3040-\u30ff]/u.test(content)) failures.push("日语选区任务结果没有假名");
  if (chapterDigest(db) !== beforeDigest) failures.push("生成预览时意外修改了章节正文");

  return {
    id: scenario.id,
    label: scenario.label,
    message: `${scenario.taskType}: ${scenario.inputText}`,
    durationMs: Math.round(performance.now() - started),
    content,
    error,
    chunkCount: chunks.length,
    reasoningChars: 0,
    context: contexts.at(-1) ? {
      modelName: contexts.at(-1).modelName,
      contextMode: contexts.at(-1).contextMode,
      scopeLabel: contexts.at(-1).scopeLabel,
      estimatedInputTokens: contexts.at(-1).estimatedInputTokens
    } : null,
    activities: [],
    scratchDelta: 0,
    chapterUnchanged: chapterDigest(db) === beforeDigest,
    candidate: preview?.candidate ? {
      kind: preview.candidate.kind,
      generatedText: preview.candidate.generatedText,
      proofreadIssueCount: proofreadIssues.length,
      status: preview.candidate.status
    } : null,
    failures,
    passed: failures.length === 0
  };
}

function reportMarkdown(report) {
  const lines = [
    "# Pi Agent 真实 API 验收",
    "",
    `- 时间：${report.generatedAt}`,
    `- 模型：${report.model}`,
    `- 项目副本来源：${report.project}`,
    `- 结果：${report.passed}/${report.total} 通过`,
    "",
    "| 场景 | 结果 | 耗时 | 工具/任务 |",
    "|---|---:|---:|---|"
  ];
  for (const item of report.results) {
    const activityText = item.activities.map((activity) => activity.toolName ?? `task:${activity.status}`).join(", ") || "无";
    lines.push(`| ${item.label} | ${item.passed ? "通过" : "失败"} | ${(item.durationMs / 1000).toFixed(1)}s | ${activityText} |`);
  }
  for (const item of report.results) {
    lines.push("", `## ${item.label}`, "", `- 状态：${item.passed ? "通过" : `失败：${item.failures.join("；")}`}`);
    lines.push(`- 活动：\`${JSON.stringify(item.activities)}\``);
    lines.push("- 回答预览：", "", item.content.slice(0, 800).replaceAll("\n", "  \n"));
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  app.setPath("userData", dirname(args.settingsDb));
  app.setName(basename(dirname(args.settingsDb)));
  await app.whenReady();

  const config = runtimeConfig(args.settingsDb, args.model);
  if (!config.modelName) throw new Error("未配置模型名称。");
  const backup = backupProject(args.project);
  let db;
  try {
    db = new Database(backup.target);
    const project = db.prepare("SELECT id, name, content_language FROM projects LIMIT 1").get();
    if (!project) throw new Error("项目副本缺少项目记录。");
    const { service, aiChatRepo, needsJapaneseResponseCorrection } = createService(db, config, project);
    const filters = args.only?.split(",").map((item) => item.trim()).filter(Boolean);
    const selected = scenarios().filter((scenario) => !filters?.length || filters.includes(scenario.id));
    if (selected.length === 0) throw new Error("没有匹配的验收场景。");

    console.log(`Pi Agent 真实 API 验收：${config.modelName}`);
    console.log(`隔离项目副本：${backup.target}`);
    const results = [];
    for (const scenario of selected) {
      console.log(`\n▶ ${scenario.label}`);
      const record = await runScenario({
        scenario,
        db,
        project,
        service,
        aiChatRepo,
        timeoutMs: args.timeoutMs,
        needsJapaneseResponseCorrection
      });
      results.push(record);
      console.log(`${record.passed ? "✓" : "✗"} ${(record.durationMs / 1000).toFixed(1)}s · ${record.activities.map((item) => item.toolName ?? `task:${item.status}`).join(", ") || "无活动"}`);
      if (!record.passed) console.log(`  ${record.failures.join("；")}`);
    }

    const report = {
      generatedAt: new Date().toISOString(),
      model: config.modelName,
      project: args.project,
      total: results.length,
      passed: results.filter((item) => item.passed).length,
      results
    };
    mkdirSync(args.outputDir, { recursive: true });
    const stamp = report.generatedAt.replace(/[:.]/gu, "-");
    const jsonPath = join(args.outputDir, `pi-agent-live-${stamp}.json`);
    const markdownPath = join(args.outputDir, `pi-agent-live-${stamp}.md`);
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    writeFileSync(markdownPath, reportMarkdown(report), "utf8");
    console.log(`\n报告：${markdownPath}`);
    if (report.passed !== report.total) process.exitCode = 1;
  } finally {
    db?.close();
    rmSync(backup.directory, { recursive: true, force: true });
    app.quit();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
  app.quit();
});
