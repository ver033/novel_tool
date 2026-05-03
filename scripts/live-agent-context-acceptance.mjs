#!/usr/bin/env electron
import { app, safeStorage } from "electron";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { createJiti } from "jiti";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const jiti = createJiti(import.meta.url, { interopDefault: true });

require.extensions[".md"] = (module, filename) => {
  module.exports = readFileSync(filename, "utf8");
};

const DEFAULT_MODEL = "deepseek/deepseek-v3.2";
const DEFAULT_RANGE = 50;
const DEFAULT_SETTINGS_DB = "/Users/backtime/Library/Application Support/墨枢/novel-tool.sqlite3";
const DEFAULT_CONTEXT_LENGTH = 163_840;
const RAW_BUDGET_ERROR_PATTERN = /超过模型输入预算|AI 对话上下文太长|AI 对话记忆超过预算|超过输入预算|超过上限|tokens?，超过|token budget/iu;
const API_ERROR_PATTERN = /OpenRouter 请求失败|rate limit|429|Provider|网络|timeout|timed out/iu;

function parseArgs(argv) {
  const args = {
    model: DEFAULT_MODEL,
    range: DEFAULT_RANGE,
    settingsDb: DEFAULT_SETTINGS_DB,
    timeoutMs: 240_000
  };
  for (let index = 2; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === "--project" || name === "--model" || name === "--settings-db") {
      if (!value) throw new Error(`${name} 缺少参数值。`);
      args[name.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
      index += 1;
      continue;
    }
    if (name === "--range" || name === "--timeout-ms") {
      if (!value) throw new Error(`${name} 缺少参数值。`);
      args[name.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = Number.parseInt(value, 10);
      index += 1;
      continue;
    }
    if (name === "--only") {
      if (!value) throw new Error(`${name} 缺少参数值。`);
      args.only = value;
      index += 1;
      continue;
    }
    throw new Error(`未知参数：${name}`);
  }
  if (!args.project) throw new Error("请提供 --project <path>。");
  if (!Number.isSafeInteger(args.range) || args.range <= 0) throw new Error(`--range 无效：${args.range}`);
  if (!Number.isSafeInteger(args.timeoutMs) || args.timeoutMs < 30_000) throw new Error(`--timeout-ms 无效：${args.timeoutMs}`);
  return args;
}

function runSqlite(databasePath, sql) {
  return execFileSync("sqlite3", [databasePath, sql], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024
  });
}

function runSqliteJson(databasePath, sql) {
  const output = execFileSync("sqlite3", ["-json", databasePath, sql], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024
  }).trim();
  return output ? JSON.parse(output) : [];
}

function quoteSqliteDotPath(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function backupSqliteDatabase(sourcePath) {
  if (!existsSync(sourcePath)) throw new Error(`项目文件不存在：${sourcePath}`);
  const dir = mkdtempSync(join(tmpdir(), "moshu-agent-acceptance-"));
  const target = join(dir, basename(sourcePath));
  runSqlite(sourcePath, `.backup ${quoteSqliteDotPath(target)}`);
  return { dir, target };
}

function getStoredProvider(settingsDb) {
  const rows = runSqliteJson(settingsDb, "select value_json from settings where key = 'aiProvider' limit 1;");
  const row = rows[0];
  if (!row?.value_json) throw new Error(`设置库没有 aiProvider：${settingsDb}`);
  return JSON.parse(row.value_json);
}

function getApiKey(settingsDb) {
  if (process.env.OPENROUTER_API_KEY?.trim()) return process.env.OPENROUTER_API_KEY.trim();
  const provider = getStoredProvider(settingsDb);
  if (provider.apiKey?.trim()) return provider.apiKey.trim();
  if (!provider.encryptedApiKey) throw new Error("没有 OPENROUTER_API_KEY，也没有可用的本机已保存 OpenRouter key。");
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Electron safeStorage 不可用，不能读取本机已保存 OpenRouter key。");
  return safeStorage.decryptString(Buffer.from(provider.encryptedApiKey, "base64")).trim();
}

function getRuntimeConfig(settingsDb, cliModel) {
  const provider = getStoredProvider(settingsDb);
  return {
    apiKey: getApiKey(settingsDb),
    baseUrl: provider.baseUrl?.trim() || "https://openrouter.ai/api/v1",
    modelName: cliModel === DEFAULT_MODEL ? provider.modelName?.trim() || cliModel : cliModel,
    contextLength: Number.isSafeInteger(provider.contextLength) && provider.contextLength > 0 ? provider.contextLength : DEFAULT_CONTEXT_LENGTH,
    supportsTools: provider.supportsTools ?? true
  };
}

function loadServices(runtimeConfig) {
  const { AiTaskService } = jiti("../src/main/ai/ai-task-service.ts");
  const { OpenRouterChatGenerator } = jiti("../src/main/ai/openrouter-chat-generator.ts");
  const { OpenRouterTaskGenerator } = jiti("../src/main/ai/openrouter-task-generator.ts");
  const { WritingOperationRunner } = jiti("../src/main/ai/writing-operation-runner.ts");
  const { getTokenBudget } = jiti("../src/main/ai/token-budget.ts");
  const { AiTaskRepository } = jiti("../src/main/db/repositories/ai-task-repo.ts");
  const { AiChatRepository } = jiti("../src/main/db/repositories/ai-chat-repo.ts");
  const { ChapterRepository } = jiti("../src/main/db/repositories/chapter-repo.ts");
  const { ScratchNoteRepository } = jiti("../src/main/db/repositories/scratch-note-repo.ts");
  const { SummaryRepository } = jiti("../src/main/db/repositories/summary-repo.ts");

  const settingsService = {
    getOpenRouterConfig() {
      return runtimeConfig;
    },
    async getOpenRouterConfigWithModelMetadata() {
      return runtimeConfig;
    },
    getTaskPromptPresetForTask() {
      return null;
    }
  };

  return {
    AiTaskService,
    OpenRouterChatGenerator,
    OpenRouterTaskGenerator,
    WritingOperationRunner,
    getTokenBudget,
    AiTaskRepository,
    AiChatRepository,
    ChapterRepository,
    ScratchNoteRepository,
    SummaryRepository,
    settingsService
  };
}

function readProjectSnapshot(db, range) {
  const chapters = db.prepare("select id, project_id, title, sort_order, word_count from chapters order by sort_order asc").all();
  const summaries = db
    .prepare(
      `select chapter_id, chapter_title, chapter_order, status, error,
              json_extract(structured_json, '$.章节信息.缓存版本') as cache_version
       from chapter_ai_summaries
       order by chapter_order asc`
    )
    .all();
  const readyInRange = summaries.filter((summary) => summary.status === "ready" && summary.chapter_order <= range);
  const missingInRange = chapters.slice(0, range).filter((chapter) => !readyInRange.some((summary) => summary.chapter_id === chapter.id));
  return {
    projectId: chapters[0]?.project_id ?? null,
    chapters,
    summaries,
    readyInRange,
    missingInRange,
    firstChapterId: chapters[0]?.id ?? null,
    currentChapterTitle: chapters[0]?.title ?? null
  };
}

function createService(db, runtimeConfig) {
  const services = loadServices(runtimeConfig);
  const aiTaskRepo = new services.AiTaskRepository(db);
  const aiChatRepo = new services.AiChatRepository(db);
  const chapterRepo = new services.ChapterRepository(db);
  const scratchRepo = new services.ScratchNoteRepository(db);
  const summaryRepo = new services.SummaryRepository(db);
  const resolveChapterRepo = () => chapterRepo;
  const resolveSummaryRepo = () => summaryRepo;
  const chatGenerator = new services.OpenRouterChatGenerator(services.settingsService);
  const taskGenerator = new services.OpenRouterTaskGenerator(services.settingsService, resolveChapterRepo, resolveSummaryRepo);
  const writingOperationRunner = services.WritingOperationRunner.fromSettings(services.settingsService, resolveChapterRepo, resolveSummaryRepo);
  const aiTaskService = new services.AiTaskService(
    aiTaskRepo,
    taskGenerator,
    chatGenerator,
    aiChatRepo,
    scratchRepo,
    chapterRepo,
    undefined,
    () => services.getTokenBudget("chat", runtimeConfig.contextLength),
    writingOperationRunner,
    summaryRepo
  );
  return {
    aiTaskService,
    aiChatRepo,
    chapterRepo
  };
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时 ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function classifyFailure(message) {
  if (RAW_BUDGET_ERROR_PATTERN.test(message)) return "budget";
  if (API_ERROR_PATTERN.test(message)) return "api";
  return "product";
}

function buildScenarios(range) {
  return [
    {
      name: "前50章整体总结",
      message: `帮我总结前${range}章的内容`
    },
    {
      name: "前50章时间线",
      message: `前${range}章按时间线梳理一下，按事件先后顺序列出关键节点`
    },
    {
      name: "全书时间线请求",
      message: "所有章节都缓存完了，帮我总结时间线"
    },
    {
      name: "主要人物状态",
      message: `前${range}章出现了哪些主要人物？分别有什么状态变化、动机和关系变化？`
    },
    {
      name: "伏笔线索",
      message: `前${range}章有哪些明确伏笔、疑似伏笔、普通线索和未解决问题？`
    },
    {
      name: "世界规则设定",
      message: `前${range}章里斗气、炼药师、功法、丹药这些世界规则是什么？`
    },
    {
      name: "道具状态",
      message: `前${range}章里聚气散、黑铁片、筑基灵液、功法这些物品或资源的状态变化是什么？`
    },
    {
      name: "章节范围总结",
      message: "总结第20章到第25章的拍卖相关剧情，顺便说明关键道具和人物态度"
    },
    {
      name: "连续性检查",
      message: "检查第5章到第10章有没有人物认知、道具状态、时间线或因果上的矛盾"
    },
    {
      name: "缺失缓存范围",
      message: "总结第51章到第60章的内容，如果索引不完整请明确说明"
    },
    {
      name: "非写作任务不能扭曲成润色",
      message: "把前10章整理成一个可用于写大纲的剧情节点表，不要改写正文"
    },
    {
      name: "自然语言润色 inline",
      message: "床榻之上，少年闭目盘腿而坐，双手在身前摆出奇异的手印，胸膛轻微起伏，一呼一吸间，形成完美的循环。帮我润一下色"
    },
    {
      name: "润色加扩写 inline",
      message: "萧炎沉默地走下石台，身后的人群仍在窃窃私语。把这一段润色一下，并稍微扩写动作和心理。"
    },
    {
      name: "校对 inline 明显错误",
      message: "火候的轻重是重中之中，粉嫩娇舌轻轻的添了添红唇，大厅噶然一静。校对一下这段。"
    },
    {
      name: "续写 inline",
      message: "萧炎望着掌心逐渐凝聚的斗气，终于缓缓吐出一口气。顺着这个场景续写一小段。"
    },
    {
      name: "不存在章节",
      message: "总结第9999章的内容"
    }
  ];
}

function assertScenarioOutput(record) {
  const combined = [record.error ?? "", record.content ?? ""].join("\n");
  if (RAW_BUDGET_ERROR_PATTERN.test(combined)) {
    throw new Error(`出现内部输入预算错误：${combined.slice(0, 500)}`);
  }
  if (record.error) {
    throw new Error(record.error);
  }
  if (!record.content?.trim()) {
    throw new Error("返回内容为空。");
  }
  if (["前50章整体总结", "前50章时间线", "全书时间线请求", "主要人物状态", "伏笔线索"].includes(record.name) && record.chunkCount === 0) {
    throw new Error("没有收到流式正文 chunk。");
  }
  if (record.name === "自然语言润色 inline" && /当前没有选中文本|请先选择正文/u.test(record.content)) {
    throw new Error("自然语言 inline 润色被错误要求选择正文。");
  }
  if (record.name === "校对 inline 明显错误" && !/重中之重|舔了舔|戛然/u.test(record.content)) {
    throw new Error("校对没有抓到注入的明显错误。");
  }
  if (record.name === "缺失缓存范围" && !/(索引不完整|摘要索引.*(?:缺失|未建立|不完整)|缺失章节|覆盖：0\/10|不能声称已经读取)/u.test(record.content)) {
    throw new Error("缺失缓存范围没有明确说明摘要索引不完整。");
  }
  if (record.name === "非写作任务不能扭曲成润色") {
    if (/【(?:校对结果|润色稿|扩写稿|续写稿)】/u.test(record.content)) {
      throw new Error("非写作整理请求被错误扭曲成写作操作。");
    }
    if (!/(剧情节点|大纲|节点表|第1章|第一章)/u.test(record.content)) {
      throw new Error("非写作整理请求没有返回剧情节点/大纲内容。");
    }
  }
  const compactContent = record.content?.replace(/[\s*_`]+/g, "") ?? "";
  if (record.name === "不存在章节" && !/(第9999章.*(?:不存在|找不到)|(?:不存在|找不到|没有)第9999章|可用章节范围)/u.test(compactContent)) {
    throw new Error("不存在章节没有给出明确说明。");
  }
  if (record.name === "不存在章节" && /(?:^|\n)##?\s*第999章|第999章.*内容总结|主要情节|核心事件/u.test(record.content)) {
    throw new Error("不存在章节被错误改读为其他章节。");
  }
  if (record.name === "不存在章节" && record.totalChapters) {
    const totalMatch =
      /(?:总章节数|总章数)\s*[：:]\s*(\d{2,5})\s*章/u.exec(record.content) ??
      /(?:总共只有|实际共有|项目(?:实际)?共有)\s*(\d{2,5})\s*章/u.exec(record.content) ??
      /(?:实际章节范围|可用章节范围)[^\n]*第\s*1\s*章[^\n]*第\s*(\d{2,5})\s*章/u.exec(record.content);
    if (totalMatch && Number.parseInt(totalMatch[1], 10) !== record.totalChapters) {
      throw new Error(`不存在章节回复中的总章数错误：${totalMatch[1]}，实际 ${record.totalChapters}。`);
    }
    if (/第999章[^\n]*(?:标题为|内容|剧情|主要情节|核心事件)/u.test(record.content)) {
      throw new Error("不存在章节回复声称知道未读取的中间章节标题或内容。");
    }
  }
}

async function runScenario({ aiTaskService, projectId, sessionId, chapterId, currentChapterTitle, scenario, timeoutMs, totalChapters }) {
  const chunks = [];
  const reasoningChunks = [];
  const contexts = [];
  const started = performance.now();
  let result;
  let error = null;
  try {
    result = await withTimeout(
      aiTaskService.sendChatMessageStream(
        {
          requestId: `live_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          projectId,
          sessionId,
          chapterId,
          currentChapterTitle,
          message: scenario.message
        },
        {
          onChunk(event) {
            chunks.push(event.content);
          },
          onReasoning(event) {
            reasoningChunks.push(event.content);
          },
          onContext(event) {
            contexts.push(event);
          },
          onError(event) {
            error = event.error;
          }
        }
      ),
      timeoutMs,
      scenario.name
    );
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason);
  }
  const durationMs = Math.round(performance.now() - started);
  const assistant = result?.messages?.find((message) => message.role === "assistant");
  const content = assistant?.content ?? chunks.join("");
  const record = {
    name: scenario.name,
    message: scenario.message,
    durationMs,
    chunkCount: chunks.length,
    reasoningChars: reasoningChunks.join("").length,
    contextEvents: contexts.length,
    lastContext: contexts.at(-1) ?? null,
    totalChapters,
    content,
    error,
    failureKind: error ? classifyFailure(error) : null
  };
  return record;
}

async function main() {
  const args = parseArgs(process.argv);
  app.setPath("userData", dirname(args.settingsDb));
  app.setName(basename(dirname(args.settingsDb)));
  await app.whenReady();

  const runtimeConfig = getRuntimeConfig(args.settingsDb, args.model);
  const backup = backupSqliteDatabase(args.project);
  const db = new Database(backup.target);
  const snapshot = readProjectSnapshot(db, args.range);
  if (!snapshot.projectId || !snapshot.firstChapterId) throw new Error("项目没有可用章节。");
  const { aiTaskService, aiChatRepo } = createService(db, runtimeConfig);
  const session = aiChatRepo.createSession({
    projectId: snapshot.projectId,
    title: "真实模型上下文验收"
  });

  const scenarios = buildScenarios(args.range).filter((scenario) => !args.only || scenario.name.includes(args.only));
  if (scenarios.length === 0) {
    throw new Error(`没有匹配 --only ${args.only} 的验收场景。`);
  }
  const results = [];
  const failures = [];

  console.log("墨枢真实 Agent 上下文验收开始");
  console.log(`项目副本：${backup.target}`);
  console.log(`模型：${runtimeConfig.modelName}`);
  console.log(`模型窗口：${runtimeConfig.contextLength ?? "unknown"}`);
  console.log(`章节总数：${snapshot.chapters.length}`);
  console.log(`前 ${args.range} 章缓存：${snapshot.readyInRange.length}/${args.range}`);
  if (snapshot.missingInRange.length > 0) {
    console.log(`缺失缓存：${snapshot.missingInRange.map((chapter) => chapter.title).join("、")}`);
  }
  console.log(`计划问题数：${scenarios.length}`);

  for (const scenario of scenarios) {
    console.log(`\n▶ ${scenario.name}`);
    const record = await runScenario({
      aiTaskService,
      projectId: snapshot.projectId,
      sessionId: session.id,
      chapterId: snapshot.firstChapterId,
      currentChapterTitle: snapshot.currentChapterTitle,
      scenario,
      timeoutMs: args.timeoutMs,
      totalChapters: snapshot.chapters.length
    });
    try {
      assertScenarioOutput(record);
      console.log(`✓ 通过，耗时 ${record.durationMs}ms，chunks=${record.chunkCount}，reasoning=${record.reasoningChars}`);
      console.log(`${record.content.slice(0, 360)}${record.content.length > 360 ? "..." : ""}`);
    } catch (reason) {
      const failure = {
        name: scenario.name,
        kind: record.failureKind ?? classifyFailure(reason instanceof Error ? reason.message : String(reason)),
        message: reason instanceof Error ? reason.message : String(reason),
        rawError: record.error,
        preview: record.content?.slice(0, 800) ?? ""
      };
      failures.push(failure);
      console.log(`✗ 失败：${failure.message}`);
      if (failure.preview) console.log(`预览：${failure.preview}`);
      if (failure.kind === "budget") {
        break;
      }
    }
    results.push(record);
  }

  const outputDir = join(tmpdir(), "moshu-live-acceptance-results");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, `agent-context-${Date.now()}.json`);
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        project: args.project,
        projectCopy: backup.target,
        model: runtimeConfig.modelName,
        contextLength: runtimeConfig.contextLength,
        range: args.range,
        cacheCoverage: {
          readyInRange: snapshot.readyInRange.length,
          range: args.range,
          totalChapters: snapshot.chapters.length
        },
        results,
        failures
      },
      null,
      2
    )
  );

  console.log(`\n结果文件：${outputPath}`);
  if (failures.length > 0) {
    console.log(`失败数：${failures.length}`);
    for (const failure of failures) {
      console.log(`- [${failure.kind}] ${failure.name}: ${failure.message}`);
    }
    process.exitCode = failures.some((failure) => failure.kind !== "api") ? 1 : 2;
  } else {
    console.log("全部真实模型验收场景通过。");
  }
  db.close();
  app.quit();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
  app.quit();
});
