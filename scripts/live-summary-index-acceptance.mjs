#!/usr/bin/env electron
import { app, safeStorage } from "electron";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

const DEFAULT_MODEL = "deepseek/deepseek-v3.2";
const DEFAULT_RANGE = 50;
const DEFAULT_SETTINGS_DB = "/Users/backtime/Library/Application Support/墨枢/novel-tool.sqlite3";

function parseArgs(argv) {
  const args = {
    model: DEFAULT_MODEL,
    range: DEFAULT_RANGE,
    settingsDb: DEFAULT_SETTINGS_DB
  };
  for (let index = 2; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === "--project" || name === "--model" || name === "--settings-db") {
      if (!value) {
        throw new Error(`${name} 缺少参数值。`);
      }
      args[name.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
      index += 1;
      continue;
    }
    if (name === "--range") {
      if (!value) {
        throw new Error("--range 缺少参数值。");
      }
      const range = Number.parseInt(value, 10);
      if (!Number.isSafeInteger(range) || range <= 0) {
        throw new Error(`--range 无效：${value}`);
      }
      args.range = range;
      index += 1;
      continue;
    }
    throw new Error(`未知参数：${name}`);
  }
  if (!args.project) {
    throw new Error("请提供 --project <path>。");
  }
  return args;
}

function runSqliteJson(databasePath, sql) {
  const output = execFileSync("sqlite3", ["-json", databasePath, sql], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  const trimmed = output.trim();
  return trimmed ? JSON.parse(trimmed) : [];
}

function runSqlite(databasePath, sql) {
  return execFileSync("sqlite3", [databasePath, sql], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
}

function quoteSqliteDotPath(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function backupSqliteDatabase(sourcePath) {
  if (!existsSync(sourcePath)) {
    throw new Error(`项目文件不存在：${sourcePath}`);
  }
  const dir = mkdtempSync(join(tmpdir(), "moshu-acceptance-"));
  const target = join(dir, basename(sourcePath));
  runSqlite(sourcePath, `.backup ${quoteSqliteDotPath(target)}`);
  return { dir, target };
}

function getStoredProvider(settingsDb) {
  const rows = runSqliteJson(settingsDb, "select value_json from settings where key = 'aiProvider' limit 1;");
  const row = rows[0];
  if (!row?.value_json) {
    throw new Error(`设置库没有 aiProvider：${settingsDb}`);
  }
  return JSON.parse(row.value_json);
}

function getApiKey(settingsDb) {
  if (process.env.OPENROUTER_API_KEY?.trim()) {
    return process.env.OPENROUTER_API_KEY.trim();
  }
  const provider = getStoredProvider(settingsDb);
  if (provider.apiKey?.trim()) {
    return provider.apiKey.trim();
  }
  if (!provider.encryptedApiKey) {
    throw new Error("没有 OPENROUTER_API_KEY，也没有可用的本机已保存 OpenRouter key。");
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Electron safeStorage 不可用，不能读取本机已保存 OpenRouter key。");
  }
  return safeStorage.decryptString(Buffer.from(provider.encryptedApiKey, "base64")).trim();
}

function getConfiguredModel(settingsDb, fallback) {
  try {
    const provider = getStoredProvider(settingsDb);
    return provider.modelName?.trim() || fallback;
  } catch {
    return fallback;
  }
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function readProjectSnapshot(databasePath, range) {
  const chapters = runSqliteJson(
    databasePath,
    `select id, title, sort_order, word_count from chapters order by sort_order asc limit ${range};`
  );
  const summaries = runSqliteJson(
    databasePath,
    `select chapter_id, chapter_title, chapter_order, summary_short, summary_long, structured_json, status,
            json_extract(structured_json, '$.章节信息.缓存版本') as cache_version,
            json_type(structured_json, '$.oneLine') as legacy_one_line
     from chapter_ai_summaries
     where chapter_order <= ${range}
     order by chapter_order asc;`
  );
  const jobs = runSqliteJson(
    databasePath,
    `select status, count(*) as count
     from summary_jobs
     group by status
     order by status asc;`
  );
  const legacyOrInvalidSummaries = summaries.filter((summary) => summary.cache_version !== "二");
  const ready = summaries.filter((summary) => summary.status === "ready" && summary.cache_version === "二");
  const readyByChapterId = new Map(ready.map((summary) => [summary.chapter_id, summary]));
  const missing = chapters.filter((chapter) => !readyByChapterId.has(chapter.id));
  return { chapters, summaries, ready, missing, jobs, legacyOrInvalidSummaries };
}

function stringifyCompact(value) {
  return JSON.stringify(value, null, 2);
}

function takeItems(items, limit) {
  return Array.isArray(items) ? items.slice(0, limit) : [];
}

function buildOverviewContext(snapshot, range) {
  const lines = [
    "[墨枢前置摘要索引验收：前置章节总结]",
    `范围：前 ${range} 章`,
    `覆盖：${snapshot.ready.length}/${snapshot.chapters.length} 章`,
    snapshot.missing.length > 0
      ? `缺失章节：${snapshot.missing.map((chapter) => `第${chapter.sort_order + 1}章 ${chapter.title}`).join("、")}`
      : "缺失章节：无",
    "要求：只根据以下章节摘要索引回答；缺失章节必须说明，不能声称已经读取完整前 50 章原文。",
    "章节摘要："
  ];
  for (const summary of snapshot.ready) {
    lines.push(`- 第${summary.chapter_order}章 ${summary.chapter_title}：${summary.summary_short}\n${summary.summary_long}`);
  }
  return lines.join("\n");
}

function buildCharacterContext(snapshot, range) {
  const entries = [];
  for (const summary of snapshot.ready) {
    const structured = parseJson(summary.structured_json, {});
    entries.push({
      章节: `第${summary.chapter_order}章 ${summary.chapter_title}`,
      短摘要: summary.summary_short,
      人物状态: takeItems(structured.人物状态, 12),
      人物认知边界: takeItems(structured.人物认知边界, 12),
      关系动态: takeItems(structured.关系动态, 12),
      可核对事实: takeItems(structured.可核对事实, 20).filter((fact) =>
        ["人物状态", "人物认知", "关系"].includes(String(fact?.事实类型 ?? ""))
      )
    });
  }
  return [
    "[墨枢前置摘要索引验收：人物查询]",
    `范围：前 ${range} 章`,
    `覆盖：${snapshot.ready.length}/${snapshot.chapters.length} 章`,
    snapshot.missing.length > 0
      ? `缺失章节：${snapshot.missing.map((chapter) => `第${chapter.sort_order + 1}章 ${chapter.title}`).join("、")}`
      : "缺失章节：无",
    "要求：只根据人物摘要索引回答；不要编造缺失章节内容。",
    stringifyCompact(entries)
  ].join("\n");
}

function buildForeshadowingContext(snapshot, range) {
  const entries = [];
  for (const summary of snapshot.ready) {
    const structured = parseJson(summary.structured_json, {});
    entries.push({
      章节: `第${summary.chapter_order}章 ${summary.chapter_title}`,
      短摘要: summary.summary_short,
      伏笔与线索: takeItems(structured.伏笔与线索, 16),
      未解决问题: takeItems(structured.未解决问题, 12),
      连续性风险: takeItems(structured.连续性风险, 8),
      可核对事实: takeItems(structured.可核对事实, 20).filter((fact) => String(fact?.事实类型 ?? "") === "伏笔")
    });
  }
  return [
    "[墨枢前置摘要索引验收：伏笔查询]",
    `范围：前 ${range} 章`,
    `覆盖：${snapshot.ready.length}/${snapshot.chapters.length} 章`,
    snapshot.missing.length > 0
      ? `缺失章节：${snapshot.missing.map((chapter) => `第${chapter.sort_order + 1}章 ${chapter.title}`).join("、")}`
      : "缺失章节：无",
    "要求：明确伏笔、疑似伏笔、线索和未解决问题要分开；不要编造缺失章节内容。",
    stringifyCompact(entries)
  ].join("\n");
}

function truncateContext(context, maxChars = 90_000) {
  if (context.length <= maxChars) {
    return context;
  }
  return `${context.slice(0, maxChars)}\n（上下文因烟测脚本字符预算被截断。）`;
}

async function callOpenRouter({ apiKey, model, messages, maxTokens = 2400 }) {
  const started = performance.now();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/YuanShiJiLoong/novel_tool",
      "X-Title": "Moshu Summary Index Acceptance"
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2
    })
  });
  const text = await response.text();
  const durationMs = Math.round(performance.now() - started);
  if (!response.ok) {
    throw new Error(`OpenRouter 请求失败 (${response.status})：${text.slice(0, 900)}`);
  }
  const json = JSON.parse(text);
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`OpenRouter 返回空内容：${text.slice(0, 900)}`);
  }
  return {
    durationMs,
    content: content.trim()
  };
}

async function runScenario({ apiKey, model, name, question, context, history = [] }) {
  const messages = [
    {
      role: "system",
      content:
        "你是墨枢真实模型验收助手。必须使用简体中文。只根据提供的摘要索引回答；如果索引覆盖不足，必须明确说明覆盖范围与缺失范围。"
    },
    ...history,
    {
      role: "user",
      content: `${truncateContext(context)}\n\n用户问题：${question}`
    }
  ];
  const result = await callOpenRouter({ apiKey, model, messages });
  return {
    name,
    question,
    ...result
  };
}

function printScenario(result) {
  console.log(`\n## ${result.name}`);
  console.log(`问题：${result.question}`);
  console.log(`耗时：${result.durationMs}ms`);
  console.log("回答预览：");
  console.log(`${result.content.slice(0, 900)}${result.content.length > 900 ? "\n..." : ""}`);
}

function verifyStopIndexPersistence(databasePath) {
  const before = runSqliteJson(databasePath, "select id from summary_jobs where status = 'queued' limit 1;");
  if (before.length === 0) {
    return {
      ok: false,
      reason: "项目副本没有 queued 摘要任务，无法验证停止后台索引的持久化路径。"
    };
  }
  const jobId = before[0].id;
  runSqlite(databasePath, `update summary_jobs set status = 'running', started_at = datetime('now'), updated_at = datetime('now') where id = '${jobId.replaceAll("'", "''")}';`);
  runSqlite(databasePath, "update summary_jobs set status = 'cancelled', error = '验收脚本停止当前索引任务。', finished_at = datetime('now'), updated_at = datetime('now') where status = 'running';");
  const after = runSqliteJson(databasePath, `select status, error from summary_jobs where id = '${jobId.replaceAll("'", "''")}' limit 1;`);
  return {
    ok: after[0]?.status === "cancelled",
    reason: after[0]?.status === "cancelled" ? "项目副本 running job 已标记 cancelled。" : `任务状态不是 cancelled：${after[0]?.status ?? "missing"}`
  };
}

async function main() {
  const args = parseArgs(process.argv);
  app.setPath("userData", dirname(args.settingsDb));
  app.setName(basename(dirname(args.settingsDb)));
  await app.whenReady();
  const apiKey = getApiKey(args.settingsDb);
  const model = args.model === DEFAULT_MODEL ? getConfiguredModel(args.settingsDb, args.model) : args.model;
  const backup = backupSqliteDatabase(args.project);
  const failures = [];
  try {
    const snapshot = readProjectSnapshot(backup.target, args.range);
    console.log("墨枢真实模型验收开始");
    console.log(`项目副本：${backup.target}`);
    console.log(`模型：${model}`);
    console.log(`范围：前 ${args.range} 章`);
    console.log(`摘要缓存覆盖：${snapshot.ready.length}/${snapshot.chapters.length} 章`);
    console.log(`旧版或无效缓存：${snapshot.legacyOrInvalidSummaries.length} 章`);
    console.log(`摘要任务：${snapshot.jobs.map((job) => `${job.status}=${job.count}`).join(", ") || "无"}`);
    if (snapshot.legacyOrInvalidSummaries.length > 0) {
      failures.push(`前 ${args.range} 章存在 ${snapshot.legacyOrInvalidSummaries.length} 条旧版或无效摘要缓存，已拒绝用于验收。`);
    }
    if (snapshot.missing.length > 0) {
      failures.push(`前 ${args.range} 章摘要缓存缺失 ${snapshot.missing.length} 章。`);
    }

    if (snapshot.ready.length === 0) {
      const stopIndex = verifyStopIndexPersistence(backup.target);
      console.log("\n## 停止后台索引");
      console.log(stopIndex.reason);
      if (!stopIndex.ok) {
        failures.push(`停止后台索引持久化验收失败：${stopIndex.reason}`);
      }
      console.log("\n验收结论：不通过");
      for (const failure of failures) {
        console.log(`- ${failure}`);
      }
      process.exitCode = 2;
      return;
    }

    const summary = await runScenario({
      apiKey,
      model,
      name: "前置章节总结",
      question: `帮我总结前${args.range}章的内容`,
      context: buildOverviewContext(snapshot, args.range)
    });
    printScenario(summary);

    const characters = await runScenario({
      apiKey,
      model,
      name: "人物查询",
      question: `前${args.range}章出现了哪些主要人物？分别有什么特征、状态变化和关系变化？`,
      context: buildCharacterContext(snapshot, args.range)
    });
    printScenario(characters);

    const foreshadowing = await runScenario({
      apiKey,
      model,
      name: "伏笔查询",
      question: `前${args.range}章有哪些伏笔、线索和未解决问题？请按明确伏笔、疑似伏笔、普通线索区分。`,
      context: buildForeshadowingContext(snapshot, args.range)
    });
    printScenario(foreshadowing);

    const followUp = await runScenario({
      apiKey,
      model,
      name: "多轮追问",
      question: "结合刚才的总结、人物和伏笔结果，萧炎当前的核心冲突是什么？后续最需要承接哪些信息？",
      context: "这是多轮追问，请综合上一轮回答，不要引入未提供的新正文。",
      history: [
        { role: "user", content: `帮我总结前${args.range}章的内容` },
        { role: "assistant", content: summary.content.slice(0, 4000) },
        { role: "user", content: `前${args.range}章出现了哪些主要人物？` },
        { role: "assistant", content: characters.content.slice(0, 4000) },
        { role: "user", content: `前${args.range}章有哪些伏笔？` },
        { role: "assistant", content: foreshadowing.content.slice(0, 4000) }
      ]
    });
    printScenario(followUp);

    const stopIndex = verifyStopIndexPersistence(backup.target);
    console.log("\n## 停止后台索引");
    console.log(stopIndex.reason);
    if (!stopIndex.ok) {
      failures.push(`停止后台索引持久化验收失败：${stopIndex.reason}`);
    }

    if (failures.length > 0) {
      console.log("\n验收结论：不通过");
      for (const failure of failures) {
        console.log(`- ${failure}`);
      }
      process.exitCode = 2;
    } else {
      console.log("\n验收结论：通过");
    }
  } finally {
    rmSync(backup.dir, { recursive: true, force: true });
    app.exit(process.exitCode ?? 0);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
  app.exit(process.exitCode);
});
