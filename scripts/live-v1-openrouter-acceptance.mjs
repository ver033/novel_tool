#!/usr/bin/env electron
import { app, safeStorage } from "electron";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const ts = require("typescript");

const DEFAULT_MODEL = "deepseek/deepseek-v3.2";
const DEFAULT_RANGE = 50;
const DEFAULT_SETTINGS_DB = "/Users/backtime/Library/Application Support/墨枢/novel-tool.sqlite3";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function parseArgs(argv) {
  const args = {
    model: DEFAULT_MODEL,
    range: DEFAULT_RANGE,
    settingsDb: DEFAULT_SETTINGS_DB,
    buildCaches: true,
    longChapterUnits: 15_000
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
    if (name === "--range") {
      if (!value) throw new Error("--range 缺少参数值。");
      args.range = Number.parseInt(value, 10);
      index += 1;
      continue;
    }
    if (name === "--long-chapter-units") {
      if (!value) throw new Error("--long-chapter-units 缺少参数值。");
      args.longChapterUnits = Number.parseInt(value, 10);
      index += 1;
      continue;
    }
    if (name === "--no-build-caches") {
      args.buildCaches = false;
      continue;
    }
    throw new Error(`未知参数：${name}`);
  }
  if (!args.project) throw new Error("请提供 --project <path>。");
  if (!Number.isSafeInteger(args.range) || args.range <= 0) throw new Error(`--range 无效：${args.range}`);
  if (!Number.isSafeInteger(args.longChapterUnits) || args.longChapterUnits <= 0) {
    throw new Error(`--long-chapter-units 无效：${args.longChapterUnits}`);
  }
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
  const dir = mkdtempSync(join(tmpdir(), "moshu-v1-live-"));
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

function getConfiguredModel(settingsDb, fallback) {
  try {
    return getStoredProvider(settingsDb).modelName?.trim() || fallback;
  } catch {
    return fallback;
  }
}

function loadSummaryPromptBuilders() {
  const source = readFileSync("src/main/ai/summary-prompts.ts", "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(transpiled, {
    exports: module.exports,
    module,
    require,
    console
  });
  return module.exports;
}

function sha256(input) {
  return createHash("sha256").update(input.replace(/\r\n?/g, "\n").trim(), "utf8").digest("hex");
}

function countWritingUnits(text) {
  let count = 0;
  for (const char of text) {
    if (/\s/u.test(char)) continue;
    if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(char)) {
      count += 1;
      continue;
    }
    count += 0.5;
  }
  return Math.ceil(count);
}

function stripJsonCodeFence(content) {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}

function parseJsonContent(label, content) {
  const text = stripJsonCodeFence(content);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}\n${text.slice(0, 500)}`);
  }
}

function assertChapterCacheShape(cache) {
  const requiredKeys = [
    "章节信息",
    "缓存质量",
    "一句话摘要",
    "短摘要",
    "详细梗概",
    "关键事件",
    "人物状态",
    "人物认知边界",
    "伏笔与线索",
    "可核对事实",
    "连续性风险",
    "不可丢失信息"
  ];
  for (const key of requiredKeys) {
    if (!(key in cache)) throw new Error(`章节缓存缺少字段：${key}`);
  }
  const version = cache.章节信息?.缓存版本;
  if (version !== "三-Lite" && version !== "二") throw new Error(`章节缓存版本不是“三-Lite”或旧版“二”：${version ?? "missing"}`);
  if (version === "三-Lite" && !Array.isArray(cache.关系变化)) throw new Error("章节缓存 V3 Lite 缺少关系变化。");
  if (version === "二" && !Array.isArray(cache.关系动态)) throw new Error("旧版章节缓存 V2 缺少关系动态。");
  if (!Array.isArray(cache.关键事件) || cache.关键事件.length === 0) throw new Error("章节缓存缺少关键事件。");
  if (!Array.isArray(cache.可核对事实) || cache.可核对事实.length === 0) throw new Error("章节缓存缺少可核对事实。");
}

function readSkill(name) {
  return readFileSync(`src/main/ai/writing-skills/${name}/SKILL.md`, "utf8").trim();
}

function buildWritingMessages({ operation, skill, targetText, supportingContext = "（无）", instruction = "无" }) {
  return [
    {
      role: "system",
      content: [
        "你是墨枢的中文小说写作操作 agent。",
        "你会收到一个固定写作操作、目标文本和参考上下文。",
        "硬性规则：参考上下文不能作为改写目标，不能把参考上下文混入输出，不能自动保存草稿纸，不能声称已经写回正文。",
        skill
      ].join("\n\n")
    },
    {
      role: "user",
      content: [
        `写作操作：${operation}`,
        "任务预设：无",
        `本次要求：${instruction}`,
        "",
        "【目标文本】",
        targetText,
        "",
        "【参考上下文】",
        supportingContext,
        "",
        "【输出要求】",
        operation === "校对"
          ? '只输出符合 JSON Schema 的校对结果；没有明确问题时输出 {"issues":[]}。不要输出 no_issue 项。逻辑/连续性问题必须 canAutoApply=false；证据不足时 needsAuthorJudgment=true；不要自动改正文。'
          : "只输出可直接使用的候选正文，不要解释，不要建议清单。"
      ].join("\n")
    }
  ];
}

function proofreadResponseFormat() {
  const codes = [
    "typo",
    "punctuation",
    "grammar",
    "awkward_expression",
    "repetition",
    "unclear_reference",
    "dialogue_voice",
    "pov_leak",
    "timeline_conflict",
    "spatial_logic",
    "character_state_conflict",
    "character_knowledge_conflict",
    "relationship_conflict",
    "prop_state_conflict",
    "world_rule_conflict",
    "causality_gap",
    "motivation_gap",
    "continuity_risk",
    "style_drift",
    "ai_tone"
  ];
  return {
    type: "json_schema",
    json_schema: {
      name: "proofread_result",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["issues"],
        properties: {
          issues: {
            type: "array",
            maxItems: 20,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "code",
                "severity",
                "quote",
                "locationHint",
                "explanation",
                "suggestion",
                "evidence",
                "canAutoApply",
                "needsAuthorJudgment"
              ],
              properties: {
                code: { type: "string", enum: codes },
                severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
                quote: { type: "string", minLength: 1, maxLength: 600 },
                locationHint: { type: "string", minLength: 1, maxLength: 300 },
                explanation: { type: "string", minLength: 1, maxLength: 1200 },
                suggestion: { type: "string", minLength: 1, maxLength: 1200 },
                suggestedReplacement: { type: "string", maxLength: 1200 },
                evidence: {
                  type: "array",
                  maxItems: 8,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["source", "quote", "note"],
                    properties: {
                      source: { type: "string", enum: ["target", "before_context", "after_context", "memory", "chapter_summary"] },
                      quote: { type: "string", minLength: 1, maxLength: 600 },
                      note: { type: "string", minLength: 1, maxLength: 600 }
                    }
                  }
                },
                canAutoApply: { type: "boolean" },
                needsAuthorJudgment: { type: "boolean" }
              }
            }
          }
        }
      }
    }
  };
}

function trimBounds(text, start, end) {
  let trimmedStart = start;
  let trimmedEnd = end;
  while (trimmedStart < trimmedEnd && /\s/u.test(text[trimmedStart] ?? "")) trimmedStart += 1;
  while (trimmedEnd > trimmedStart && /\s/u.test(text[trimmedEnd - 1] ?? "")) trimmedEnd -= 1;
  return trimmedStart < trimmedEnd ? { start: trimmedStart, end: trimmedEnd } : null;
}

function findForwardWritingUnitOffset(text, start, end, targetUnits) {
  let offset = start;
  let units = 0;
  for (const char of text.slice(start, end)) {
    const nextOffset = offset + char.length;
    const nextUnits = units + countWritingUnits(char);
    if (nextUnits > targetUnits && offset > start) break;
    units = nextUnits;
    offset = nextOffset;
  }
  return offset > start ? offset : end;
}

function findBackwardWritingUnitOffset(text, start, end, targetUnits) {
  let offset = end;
  let units = 0;
  while (offset > start && units < targetUnits) {
    const previous = offset - 1;
    units += countWritingUnits(text.slice(previous, offset));
    offset = previous;
  }
  return offset;
}

function splitLongChapterText(plainText, targetUnits = 3500, overlapUnits = 120) {
  const pieces = [];
  const paragraphBreakPattern = /\n{2,}/g;
  let start = 0;
  const addSegment = (rawStart, rawEnd) => {
    const bounds = trimBounds(plainText, rawStart, rawEnd);
    if (!bounds) return;
    const units = countWritingUnits(plainText.slice(bounds.start, bounds.end));
    if (units <= targetUnits) {
      pieces.push({ ...bounds, units });
      return;
    }
    let splitStart = bounds.start;
    while (splitStart < bounds.end) {
      const splitEnd = findForwardWritingUnitOffset(plainText, splitStart, bounds.end, targetUnits);
      const splitBounds = trimBounds(plainText, splitStart, splitEnd);
      if (splitBounds) {
        pieces.push({
          ...splitBounds,
          units: countWritingUnits(plainText.slice(splitBounds.start, splitBounds.end))
        });
      }
      if (splitEnd <= splitStart) break;
      splitStart = splitEnd;
    }
  };
  let match;
  while ((match = paragraphBreakPattern.exec(plainText))) {
    addSegment(start, match.index);
    start = match.index + match[0].length;
  }
  addSegment(start, plainText.length);
  const ranges = [];
  let currentStart = pieces[0]?.start ?? 0;
  let currentEnd = pieces[0]?.end ?? 0;
  let currentUnits = 0;
  for (const piece of pieces) {
    if (currentUnits > 0 && currentUnits + piece.units > targetUnits) {
      ranges.push({ start: currentStart, end: currentEnd, units: currentUnits });
      currentStart = piece.start;
      currentEnd = piece.end;
      currentUnits = piece.units;
      continue;
    }
    currentEnd = piece.end;
    currentUnits += piece.units;
  }
  if (currentEnd > currentStart) ranges.push({ start: currentStart, end: currentEnd, units: currentUnits });
  return ranges.map((range, index) => {
    const textStart = index === 0 ? range.start : findBackwardWritingUnitOffset(plainText, ranges[index - 1]?.start ?? 0, range.start, overlapUnits);
    const bounds = trimBounds(plainText, textStart, range.end) ?? { start: textStart, end: range.end };
    return {
      chunkIndex: index,
      chunkCount: ranges.length,
      text: plainText.slice(bounds.start, bounds.end),
      textStart: bounds.start,
      textEnd: bounds.end
    };
  });
}

function buildSyntheticLongChapterText(db, targetUnits) {
  const rows = db.prepare("SELECT title, plain_text FROM chapters ORDER BY sort_order ASC LIMIT 12").all();
  let text = "";
  let index = 0;
  while (countWritingUnits(text) < targetUnits) {
    const row = rows[index % rows.length];
    text += `\n\n【长章节测试片段 ${index + 1}：${row.title}】\n${row.plain_text}`;
    index += 1;
  }
  return text;
}

function uniqueStrings(values, limit) {
  const seen = new Set();
  const result = [];
  for (const rawValue of values) {
    const value = String(rawValue ?? "").trim();
    if (!value || value === "未明确" || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function uniqueRecords(items, keyForItem, limit) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyForItem(item).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function firstDefined(values, fallback) {
  return values.find((value) => String(value ?? "").trim() && String(value ?? "").trim() !== "未明确") ?? fallback;
}

function limitText(text, maxLength) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function mergeChunkResultsForLongChapter({ title, ordinal, chunkResults }) {
  const orderedChunks = [...chunkResults].sort((left, right) => left.chunkIndex - right.chunkIndex);
  const chunkSummaries = orderedChunks.map((chunk) => `片段${chunk.chunkIndex + 1}：${chunk.structured.片段摘要}`).filter(Boolean);
  const detailText = chunkSummaries.join("\n");
  const stringifyValue = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map((item) => stringifyValue(item)).filter(Boolean).join("、");
    if (typeof value === "object") {
      return Object.entries(value)
        .map(([key, item]) => {
          const text = stringifyValue(item);
          return text ? `${key}：${text}` : "";
        })
        .filter(Boolean)
        .join("；");
    }
    return String(value);
  };
  const keyEvents = uniqueRecords(
    orderedChunks.flatMap((chunk) =>
      (chunk.structured.关键事件 ?? []).map((item) => ({
        事件: String(item.事件 ?? "片段关键事件"),
        涉及人物: Array.isArray(item.涉及人物) ? item.涉及人物 : [],
        时间地点: String(item.时间地点 ?? "未明确"),
        结果: String(item.结果 ?? item.事件结果 ?? "未明确"),
        后续影响: String(item.后续影响 ?? "未明确"),
        证据短句: Array.isArray(item.证据短句) ? item.证据短句.slice(0, 1) : []
      }))
    ),
    (item) => `${item.事件}|${item.时间地点}|${item.结果}`,
    10
  );
  const characterStates = uniqueRecords(
    orderedChunks.flatMap((chunk) =>
      (chunk.structured.人物状态 ?? []).map((item) => ({
        人物: String(item.人物 ?? "未明确"),
        本章变化: String(item.本章变化 ?? item.本章结束状态 ?? item.情绪状态 ?? "未明确"),
        行动: Array.isArray(item.行动) ? item.行动 : [],
        目标或动机: String(item.目标或动机 ?? item.动机 ?? item.目标 ?? "未明确"),
        新获得信息: Array.isArray(item.新获得信息) ? item.新获得信息 : [],
        仍不知道的信息: Array.isArray(item.仍不知道的信息) ? item.仍不知道的信息 : [],
        关系变化: Array.isArray(item.关系变化) ? item.关系变化 : Array.isArray(item.与他人关系变化) ? item.与他人关系变化 : [],
        证据短句: Array.isArray(item.证据短句) ? item.证据短句.slice(0, 1) : []
      }))
    ),
    (item) => `${item.人物}|${item.本章变化}`,
    10
  );
  const characterKnowledge = uniqueRecords(
    orderedChunks.flatMap((chunk) =>
      (chunk.structured.人物认知边界 ?? []).map((item) => ({
        人物: String(item.人物 ?? "未明确"),
        认知变化: String(item.认知变化 ?? item.新得知 ?? item.已经知道 ?? "未明确"),
        仍不知道: Array.isArray(item.仍不知道) ? item.仍不知道 : Array.isArray(item.尚不知道) ? item.尚不知道 : [],
        误解或风险: Array.isArray(item.误解或风险) ? item.误解或风险 : Array.isArray(item.误以为) ? item.误以为 : [],
        证据短句: Array.isArray(item.证据短句) ? item.证据短句.slice(0, 1) : []
      }))
    ),
    (item) => `${item.人物}|${item.认知变化}`,
    10
  );
  const checkableFacts = uniqueStrings(
    orderedChunks.flatMap((chunk) => (chunk.structured.可核对事实 ?? []).map((item) => stringifyValue(item))),
    12
  );
  const timePlaces = orderedChunks.map((chunk) => chunk.structured.时间地点 ?? chunk.structured.时间与地点 ?? {});
  const propsAndRules = uniqueStrings(
    orderedChunks.flatMap((chunk) => [
      ...(chunk.structured.道具设定变化 ?? []),
      ...(chunk.structured.道具状态 ?? []),
      ...(chunk.structured.设定与规则 ?? []),
      ...(chunk.structured.限制与否定事实 ?? []),
      ...(chunk.structured.空间与行动逻辑 ?? [])
    ]).map((item) => stringifyValue(item)),
    10
  );
  const foreshadowing = uniqueRecords(
    orderedChunks.flatMap((chunk) =>
      (chunk.structured.伏笔与线索 ?? []).map((item) => ({
        线索: String(item.线索 ?? "线索"),
        类型: String(item.类型 ?? "普通线索"),
        状态: String(item.状态 ?? item.本章状态 ?? "待判断"),
        指向或意义: String(item.指向或意义 ?? item.可能指向 ?? "未明确"),
        证据短句: Array.isArray(item.证据短句) ? item.证据短句.slice(0, 1) : []
      }))
    ),
    (item) => `${item.线索}|${item.状态}|${item.指向或意义}`,
    8
  );

  return {
    章节信息: {
      章节序号: ordinal,
      章节标题: title,
      正文覆盖: "完整章节",
      缓存类型: "章节缓存",
      缓存版本: "三-Lite",
      语言: "简体中文"
    },
    缓存质量: {
      覆盖完整度: "完整",
      信息密度: "中",
      需要回读原文: "否",
      缺失说明: []
    },
    一句话摘要: limitText(chunkSummaries.join("；"), 120) || `${title}已完成长章节缓存。`,
    短摘要: limitText(chunkSummaries.join("；"), 360) || `${title}已完成片段事实索引聚合。`,
    详细梗概:
      detailText.length >= 60
        ? detailText
        : `${detailText || title}。本章已完成长章节片段缓存聚合，当前缓存保留片段摘要、关键事件、人物状态、伏笔线索、可核对事实和不可丢失信息。`,
    章节作用: {
      剧情作用: "由多个片段缓存聚合，保留本章连续剧情推进。",
      人物作用: "合并片段内主要人物状态和认知变化。",
      后文作用: "为后续全文总结、人物查询、伏笔查询和连续性检查提供章节级索引。"
    },
    场景推进: uniqueStrings(chunkSummaries, 6),
    关键事件:
      keyEvents.length > 0
        ? keyEvents
        : [
            {
              事件: "长章节片段缓存已建立",
              涉及人物: [],
              时间地点: "未明确",
              结果: "系统按片段保留章节事实",
              后续影响: "后续查询可使用片段事实索引",
              证据短句: []
            }
          ],
    人物状态:
      characterStates.length > 0
        ? characterStates
        : [
            {
              人物: "未明确",
              本章变化: "未明确",
              行动: [],
              目标或动机: "未明确",
              新获得信息: [],
              仍不知道的信息: [],
              关系变化: [],
              证据短句: []
            }
          ],
    人物认知边界: characterKnowledge,
    关系变化: uniqueStrings(characterStates.flatMap((item) => item.关系变化 ?? []), 10),
    时间地点: {
      本章时间: firstDefined(timePlaces.map((item) => item.本章时间), "未明确"),
      主要地点: uniqueStrings(timePlaces.flatMap((item) => item.主要地点 ?? []), 8),
      时间线索: uniqueStrings(timePlaces.flatMap((item) => [...(item.时间线索 ?? []), ...(item.明确时间锚点 ?? []), ...(item.相对时间锚点 ?? [])]), 8),
      地点移动: uniqueStrings(timePlaces.flatMap((item) => item.地点移动 ?? []), 8),
      可能风险: uniqueStrings(timePlaces.flatMap((item) => [...(item.可能风险 ?? []), ...(item.可能的时间线风险 ?? [])]), 8)
    },
    道具设定变化: propsAndRules,
    伏笔与线索: foreshadowing,
    可核对事实:
      checkableFacts.length > 0
        ? checkableFacts
        : ["长章节由片段缓存聚合而成，后续查询应参考片段缓存事实条目"],
    连续性风险: uniqueStrings(orderedChunks.flatMap((chunk) => (chunk.structured.连续性风险 ?? []).map((item) => stringifyValue(item))), 8),
    未解决问题: uniqueStrings(orderedChunks.flatMap((chunk) => (chunk.structured.未解决问题 ?? []).map((item) => stringifyValue(item))), 8),
    文风要点: ["长章节由多个连续片段构成", "续写时需承接已建立的人物状态和片段关键事件"],
    不可丢失信息: uniqueStrings(orderedChunks.flatMap((chunk) => chunk.structured.不可丢失信息 ?? []), 10),
    不确定项: []
  };
}

async function testLongChapterCache({ apiKey, model, db, projectId, targetUnits, promptBuilders }) {
  const plainText = buildSyntheticLongChapterText(db, targetUnits);
  const chunks = splitLongChapterText(plainText);
  if (countWritingUnits(plainText) < targetUnits) throw new Error("长章节测试文本长度不足。");
  if (chunks.length < 2) throw new Error(`长章节没有被拆成多个片段：${chunks.length}`);
  console.log(`\n## 15,000 字长章节缓存验收`);
  console.log(`构造文本：${countWritingUnits(plainText)} 写作单位，${plainText.length} 字符，拆分 ${chunks.length} 片段`);
  const chunkResults = [];
  for (const chunk of chunks) {
    const result = await callOpenRouter({
      apiKey,
      model,
      maxTokens: 24000,
      temperature: 0.2,
      responseFormat: { type: "json_object" },
      messages: promptBuilders.buildChapterChunkIndexSummaryMessages({
        projectId,
        chapterId: "synthetic_long_chapter",
        title: `长章节缓存验收 ${targetUnits} 字`,
        ordinal: 9999,
        chunkIndex: chunk.chunkIndex,
        chunkCount: chunk.chunkCount,
        textStart: chunk.textStart,
        textEnd: chunk.textEnd,
        plainText: chunk.text
      })
    });
    const content = result.json?.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error(`长章节片段 ${chunk.chunkIndex + 1} 返回空内容。`);
    const structured = parseJsonContent(`长章节片段 ${chunk.chunkIndex + 1}`, content);
    if (!structured.片段信息 || !Array.isArray(structured.关键事件) || !Array.isArray(structured.可核对事实)) {
      throw new Error(`长章节片段 ${chunk.chunkIndex + 1} 缓存字段不完整。`);
    }
    chunkResults.push({
      chunkIndex: chunk.chunkIndex,
      textStart: chunk.textStart,
      textEnd: chunk.textEnd,
      summaryShort: structured.片段摘要,
      structured
    });
    console.log(`片段 ${chunk.chunkIndex + 1}/${chunk.chunkCount} 完成，耗时 ${result.durationMs}ms`);
  }
  const structured = mergeChunkResultsForLongChapter({
    title: `长章节缓存验收 ${targetUnits} 字`,
    ordinal: 9999,
    chunkResults
  });
  assertChapterCacheShape(structured);
  console.log("长章节本地聚合完成，未触发模型合并。");
  console.log(`长章节缓存摘要预览：${structured.一句话摘要}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callOpenRouter({ apiKey, model, messages, maxTokens, temperature = 0.2, responseFormat, tools, toolChoice }) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const started = performance.now();
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/YuanShiJiLoong/novel_tool",
        "X-Title": "Moshu V1 Live Acceptance"
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
        ...(responseFormat ? { response_format: responseFormat } : {}),
        ...(tools ? { tools, tool_choice: toolChoice ?? "auto", parallel_tool_calls: false } : {})
      })
    });
    const text = await response.text();
    const durationMs = Math.round(performance.now() - started);
    if (!response.ok) {
      lastError = new Error(`OpenRouter 请求失败 (${response.status})：${text.slice(0, 900)}`);
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
        await sleep(attempt * 5000);
        continue;
      }
      throw lastError;
    }
    const json = JSON.parse(text);
    const finishReason = json?.choices?.[0]?.finish_reason;
    if (finishReason === "length") {
      throw new Error(`OpenRouter 返回被截断（finish_reason=length）：${text.slice(0, 900)}`);
    }
    return { json, durationMs };
  }
  throw lastError ?? new Error("OpenRouter 请求失败。");
}

function insertChapterCache(db, { projectId, chapter, sourceHash, structured }) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO chapter_ai_summaries
     (id, project_id, chapter_id, chapter_title, chapter_order, content_hash, summary_short, summary_long,
      structured_json, token_count, status, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', NULL, ?, ?)
     ON CONFLICT(project_id, chapter_id) DO UPDATE SET
       chapter_title = excluded.chapter_title,
       chapter_order = excluded.chapter_order,
       content_hash = excluded.content_hash,
       summary_short = excluded.summary_short,
       summary_long = excluded.summary_long,
       structured_json = excluded.structured_json,
       token_count = excluded.token_count,
       status = 'ready',
       error = NULL,
       updated_at = excluded.updated_at`
  ).run(
    `live_summary_${chapter.id}`,
    projectId,
    chapter.id,
    chapter.title,
    chapter.sort_order + 1,
    sourceHash,
    structured.一句话摘要,
    structured.详细梗概,
    JSON.stringify(structured),
    Math.ceil(JSON.stringify(structured).length / 2),
    now,
    now
  );
}

async function ensureChapterCaches({ apiKey, model, db, projectId, range, promptBuilders }) {
  const chapters = db.prepare("SELECT id, title, sort_order, plain_text, word_count FROM chapters ORDER BY sort_order ASC LIMIT ?").all(range);
  for (const chapter of chapters) {
    const sourceHash = sha256(chapter.plain_text ?? "");
    const existing = db
      .prepare(
        "SELECT content_hash, status, json_extract(structured_json, '$.章节信息.缓存版本') AS version FROM chapter_ai_summaries WHERE project_id = ? AND chapter_id = ?"
      )
      .get(projectId, chapter.id);
    if (existing?.status === "ready" && existing.content_hash === sourceHash && existing.version === "二") {
      console.log(`缓存已存在：第${chapter.sort_order + 1}章 ${chapter.title}`);
      continue;
    }

    console.log(`生成章节缓存：第${chapter.sort_order + 1}章 ${chapter.title}（${chapter.word_count} 字）`);
    const messages = promptBuilders.buildChapterIndexSummaryMessages({
      projectId,
      chapterId: chapter.id,
      title: chapter.title,
      ordinal: chapter.sort_order + 1,
      plainText: chapter.plain_text
    });
    const result = await callOpenRouter({
      apiKey,
      model,
      messages,
      maxTokens: 24000,
      temperature: 0.2,
      responseFormat: { type: "json_object" }
    });
    const content = result.json?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error(`第${chapter.sort_order + 1}章缓存返回空内容。`);
    const structured = parseJsonContent(`第${chapter.sort_order + 1}章缓存`, content);
    assertChapterCacheShape(structured);
    insertChapterCache(db, { projectId, chapter, sourceHash, structured });
    console.log(`完成章节缓存：第${chapter.sort_order + 1}章，耗时 ${result.durationMs}ms`);
  }
}

function readReadyCaches(db, projectId, range) {
  const chapters = db.prepare("SELECT id, title, sort_order, word_count FROM chapters ORDER BY sort_order ASC LIMIT ?").all(range);
  const summaries = db
    .prepare(
      `SELECT chapter_id, chapter_title, chapter_order, summary_short, summary_long, structured_json
       FROM chapter_ai_summaries
       WHERE project_id = ? AND status = 'ready' AND chapter_order <= ?
       ORDER BY chapter_order ASC`
    )
    .all(projectId, range);
  return { chapters, summaries };
}

function buildSummaryContexts(snapshot) {
  const overview = [
    `[长篇摘要索引验收]`,
    `覆盖：${snapshot.summaries.length}/${snapshot.chapters.length} 章`,
    "以下只包含章节索引缓存，不包含原文。请基于缓存综合回答。",
    ...snapshot.summaries.map((summary) => `- 第${summary.chapter_order}章 ${summary.chapter_title}：${summary.summary_short}\n${summary.summary_long}`)
  ].join("\n");
  const structuredRows = snapshot.summaries.map((summary) => {
    const structured = JSON.parse(summary.structured_json);
    return {
      章节: `第${summary.chapter_order}章 ${summary.chapter_title}`,
      短摘要: summary.summary_short,
      人物状态: structured.人物状态,
      人物认知边界: structured.人物认知边界,
      关系动态: structured.关系变化 ?? structured.关系动态,
      伏笔与线索: structured.伏笔与线索,
      未解决问题: structured.未解决问题,
      可核对事实: structured.可核对事实,
      连续性风险: structured.连续性风险,
      不可丢失信息: structured.不可丢失信息
    };
  });
  return { overview, structured: JSON.stringify(structuredRows, null, 2) };
}

async function askScenario({ apiKey, model, name, question, context, history = [] }) {
  const result = await callOpenRouter({
    apiKey,
    model,
    maxTokens: 5000,
    temperature: 0.2,
    messages: [
      { role: "system", content: "你是墨枢发布前真实模型验收助手。必须使用简体中文，只根据给定章节索引缓存回答；不要声称读取了原文。" },
      ...history,
      { role: "user", content: `${context}\n\n用户问题：${question}` }
    ]
  });
  const content = result.json?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error(`${name} 返回空内容。`);
  console.log(`\n## ${name}`);
  console.log(`耗时：${result.durationMs}ms`);
  console.log(content.slice(0, 1200) + (content.length > 1200 ? "\n..." : ""));
  return content;
}

async function testWritingOperation({ apiKey, model, name, operation, skillName, targetText, instruction, supportingContext, responseFormat }) {
  const result = await callOpenRouter({
    apiKey,
    model,
    maxTokens: operation === "校对" ? 5000 : 3500,
    temperature: operation === "校对" ? 0.2 : 0.45,
    responseFormat,
    messages: buildWritingMessages({
      operation,
      skill: readSkill(skillName),
      targetText,
      instruction,
      supportingContext
    })
  });
  const content = result.json?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error(`${name} 返回空内容。`);
  if (operation !== "校对" && /^(以下是|这里是|建议|润色建议|修改建议|核心润色)/u.test(content)) {
    throw new Error(`${name} 返回了建议说明，不是候选正文：${content.slice(0, 120)}`);
  }
  if (operation === "校对") {
    const parsed = parseJsonContent(name, content);
    if (!Array.isArray(parsed.issues)) throw new Error(`${name} 缺少 issues 数组。`);
    if (parsed.issues.some((issue) => !issue.code || !issue.severity || !issue.quote || !issue.suggestion)) {
      throw new Error(`${name} issue 字段不完整。`);
    }
  }
  console.log(`\n## ${name}`);
  console.log(`耗时：${result.durationMs}ms`);
  console.log(content.slice(0, 1000) + (content.length > 1000 ? "\n..." : ""));
  return content;
}

async function testAgentIntent({ apiKey, model }) {
  const tools = [
    {
      type: "function",
      function: {
        name: "run_writing_operation",
        description: "对用户提供的正文执行润色、扩写、校对或续写。自然语言请求也应调用。",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["operation", "target"],
          properties: {
            operation: { type: "string", enum: ["polish", "expand", "proofread", "continue"] },
            target: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "text"],
              properties: {
                kind: { type: "string", enum: ["inline_text"] },
                text: { type: "string" }
              }
            }
          }
        }
      }
    }
  ];
  const result = await callOpenRouter({
    apiKey,
    model,
    maxTokens: 1200,
    temperature: 0.1,
    tools,
    toolChoice: {
      type: "function",
      function: {
        name: "run_writing_operation"
      }
    },
    messages: [
      {
        role: "system",
        content: [
          "你是墨枢的中文小说写作 agent。",
          "slash 不是唯一触发方式。作者自然语言提出润色、扩写、校对或续写，也应调用 run_writing_operation。",
          "用户在当前消息里直接粘贴正文并要求润色时，必须把粘贴正文原样放进 target.kind=inline_text 的 text 字段。"
        ].join("\n")
      },
      {
        role: "user",
        content: "床榻之上，少年闭目盘腿而坐，双手在身前摆出奇异的手印，胸膛轻微起伏。帮我润一下色。"
      }
    ]
  });
  const toolCall = result.json?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.function?.name !== "run_writing_operation") {
    throw new Error(`自然语言润色没有触发 run_writing_operation：${JSON.stringify(result.json).slice(0, 700)}`);
  }
  const args = JSON.parse(toolCall.function.arguments);
  if (args.operation !== "polish" || args.target?.kind !== "inline_text" || !String(args.target?.text ?? "").includes("床榻之上")) {
    throw new Error(`run_writing_operation 参数错误：${toolCall.function.arguments}`);
  }
  console.log("\n## 自然语言 skill 路由");
  console.log(`耗时：${result.durationMs}ms`);
  console.log(toolCall.function.arguments);
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
    const db = new Database(backup.target);
    const projectId = db.prepare("SELECT project_id FROM chapters ORDER BY sort_order ASC LIMIT 1").get()?.project_id;
    if (!projectId) throw new Error("项目没有章节。");
    const promptBuilders = loadSummaryPromptBuilders();

    console.log("墨枢 V1 OpenRouter 真实模型验收开始");
    console.log(`项目副本：${backup.target}`);
    console.log(`模型：${model}`);
    console.log(`范围：前 ${args.range} 章`);

    if (args.buildCaches) {
      await ensureChapterCaches({ apiKey, model, db, projectId, range: args.range, promptBuilders });
    }
    const snapshot = readReadyCaches(db, projectId, args.range);
    if (snapshot.summaries.length < args.range) {
      failures.push(`前 ${args.range} 章缓存覆盖不足：${snapshot.summaries.length}/${args.range}`);
    }
    const contexts = buildSummaryContexts(snapshot);
    const summary = await askScenario({
      apiKey,
      model,
      name: `前 ${args.range} 章总结`,
      question: `帮我总结前${args.range}章的内容`,
      context: contexts.overview
    });
    const characters = await askScenario({
      apiKey,
      model,
      name: "人物查询",
      question: "这些章节里出现了哪些主要人物？分别有什么状态变化和关系变化？",
      context: contexts.structured
    });
    const foreshadowing = await askScenario({
      apiKey,
      model,
      name: "伏笔查询",
      question: "这些章节里有哪些明确伏笔、疑似伏笔、普通线索和未解决问题？",
      context: contexts.structured
    });
    await askScenario({
      apiKey,
      model,
      name: "多轮追问",
      question: "结合刚才三轮结果，萧炎当前最核心的冲突是什么？后续最需要承接哪些信息？",
      context: "这是多轮追问，请基于最近对话回答，不要引入未提供的新原文。",
      history: [
        { role: "user", content: `帮我总结前${args.range}章的内容` },
        { role: "assistant", content: summary.slice(0, 5000) },
        { role: "user", content: "这些章节里出现了哪些主要人物？" },
        { role: "assistant", content: characters.slice(0, 5000) },
        { role: "user", content: "这些章节里有哪些伏笔？" },
        { role: "assistant", content: foreshadowing.slice(0, 5000) }
      ]
    });

    const polishTarget = "周围传来的不屑嘲笑以及惋惜轻叹，落在那如木桩待在原地的少年耳中，恍如一根根利刺狠狠的扎在心脏一般，让得少年呼吸微微急促。";
    await testWritingOperation({
      apiKey,
      model,
      name: "润色 prompt 验收",
      operation: "润色",
      skillName: "polish",
      targetText: polishTarget,
      instruction: "基础顺滑，保留玄幻小说语气。",
      supportingContext: "上一段：萧炎刚在家族测试中被宣布斗之力三段，广场上响起嘲讽。"
    });
    await testWritingOperation({
      apiKey,
      model,
      name: "扩写 prompt 验收",
      operation: "扩写",
      skillName: "expand",
      targetText: "萧炎沉默地走下石台，身后的人群仍在窃窃私语。",
      instruction: "补动作和心理，长度扩到原文两倍左右。",
      supportingContext: "场景：家族测试广场。萧炎刚遭到嘲讽，但不能改变测试结果。"
    });
    await testWritingOperation({
      apiKey,
      model,
      name: "续写 prompt 验收",
      operation: "续写",
      skillName: "continue",
      targetText: "床榻之上，少年闭目盘腿而坐，双手在身前摆出奇异的手印，胸膛轻微起伏。",
      instruction: "自然衔接，继续写修炼过程，不提前揭示戒指秘密。",
      supportingContext: "前文：萧炎斗气总会莫名消失，他尚不知道原因。"
    });
    await testWritingOperation({
      apiKey,
      model,
      name: "校对 V2 prompt 验收",
      operation: "校对",
      skillName: "proofread",
      targetText: "萧炎昨日才第一次见到药老，却熟练地喊出了药老三年前告诉他的名字。他走进屋内，又站在屋外望着床榻上的自己。",
      instruction: "重点检查人物认知、时间线、空间逻辑。",
      supportingContext: "参考上下文：此前只说明萧炎今天第一次听见戒指中的老者开口，尚不知道老者姓名，也没有分身能力。",
      responseFormat: proofreadResponseFormat()
    });
    await testAgentIntent({ apiKey, model });
    await testLongChapterCache({
      apiKey,
      model,
      db,
      projectId,
      targetUnits: args.longChapterUnits,
      promptBuilders
    });

    db.close();
    if (failures.length > 0) {
      console.log("\n验收结论：不通过");
      for (const failure of failures) console.log(`- ${failure}`);
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
