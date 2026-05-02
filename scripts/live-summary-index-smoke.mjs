#!/usr/bin/env node
import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

function parseArgs(argv) {
  const args = {
    model: "deepseek/deepseek-v3.2",
    question: "总结前十章"
  };
  for (let index = 2; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === "--project" || name === "--question" || name === "--model") {
      if (!value) {
        throw new Error(`${name} 缺少参数值。`);
      }
      args[name.slice(2)] = value;
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

function parseFrontChapterCount(question) {
  const digit = question.match(/前\s*(\d+)\s*章/);
  if (digit) {
    return Number(digit[1]);
  }
  const chineseDigits = new Map([
    ["一", 1],
    ["二", 2],
    ["两", 2],
    ["三", 3],
    ["四", 4],
    ["五", 5],
    ["六", 6],
    ["七", 7],
    ["八", 8],
    ["九", 9],
    ["十", 10]
  ]);
  const chinese = question.match(/前\s*([一二两三四五六七八九十])\s*章/);
  return chinese ? (chineseDigits.get(chinese[1]) ?? null) : null;
}

function copyProjectToTemp(projectPath) {
  if (!existsSync(projectPath)) {
    throw new Error(`项目文件不存在：${projectPath}`);
  }
  const dir = mkdtempSync(join(tmpdir(), "moshu-summary-smoke-"));
  const target = join(dir, basename(projectPath));
  copyFileSync(projectPath, target);
  return target;
}

function readJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function formatCoverage(bookStructured, chapters, chapterSummaries) {
  const bookInfo = bookStructured?.["全书信息"];
  if (bookInfo && typeof bookInfo === "object") {
    return {
      total: Number(bookInfo["总章节数"] ?? chapters.length),
      indexed: Number(bookInfo["已索引章节数"] ?? chapterSummaries.length),
      stale: Array.isArray(bookInfo["过期章节"]) ? bookInfo["过期章节"].length : 0,
      missing: Array.isArray(bookInfo["缺失章节"]) ? bookInfo["缺失章节"].length : Math.max(0, chapters.length - chapterSummaries.length)
    };
  }
  return {
    total: chapters.length,
    indexed: chapterSummaries.length,
    stale: 0,
    missing: Math.max(0, chapters.length - chapterSummaries.length)
  };
}

function buildContext(db, question) {
  const chapters = db.prepare("SELECT id, title, sort_order, word_count FROM chapters ORDER BY sort_order ASC").all();
  const chapterSummaries = db
    .prepare(
      `SELECT chapter_id, chapter_title, chapter_order, summary_short, summary_long, status,
              json_extract(structured_json, '$.章节信息.缓存版本') as cache_version
       FROM chapter_ai_summaries
       ORDER BY chapter_order ASC`
    )
    .all();
  const arcSummaries = db
    .prepare("SELECT chapter_from, chapter_to, summary, status FROM arc_ai_summaries ORDER BY chapter_from ASC")
    .all()
    .filter((row) => row.status === "ready");
  const bookSummary = db
    .prepare("SELECT summary_short, summary_long, structured_json, status FROM book_ai_summaries WHERE status = 'ready' ORDER BY updated_at DESC LIMIT 1")
    .get();
  const legacyOrInvalidSummaries = chapterSummaries.filter((row) => row.cache_version !== "二");
  const readyChapterSummaries = chapterSummaries.filter((row) => row.status === "ready" && row.cache_version === "二");
  const bookStructured = bookSummary ? readJson(bookSummary.structured_json, null) : null;
  const coverage = formatCoverage(bookStructured, chapters, readyChapterSummaries);
  const frontCount = parseFrontChapterCount(question);
  const scopedSummaries = frontCount ? readyChapterSummaries.filter((row) => row.chapter_order <= frontCount) : readyChapterSummaries;
  const scopedChapters = frontCount ? chapters.slice(0, frontCount) : chapters;
  const missingInScope = scopedChapters.filter((chapter) => !scopedSummaries.some((summary) => summary.chapter_id === chapter.id));

  const contextLines = [];
  contextLines.push("[墨枢摘要索引烟测上下文]");
  contextLines.push(`问题：${question}`);
  contextLines.push(`覆盖：${coverage.indexed}/${coverage.total} 章，缺失 ${coverage.missing} 章，过期 ${coverage.stale} 章。`);
  if (missingInScope.length > 0) {
    contextLines.push(`当前问题范围缺失章节：${missingInScope.map((chapter) => `第${chapter.sort_order + 1}章 ${chapter.title}`).join("、")}`);
  }
  if (legacyOrInvalidSummaries.length > 0) {
    contextLines.push(`已拒绝旧版或无效章节摘要：${legacyOrInvalidSummaries.length} 章。`);
  }
  if (!frontCount && bookSummary) {
    contextLines.push(`全书短摘要：${bookSummary.summary_short}`);
    contextLines.push(`全书长摘要：${bookSummary.summary_long}`);
  }
  if (arcSummaries.length > 0) {
    contextLines.push("阶段摘要：");
    for (const arc of arcSummaries.slice(0, 8)) {
      contextLines.push(`- 第${arc.chapter_from}-${arc.chapter_to}章：${arc.summary}`);
    }
  }
  contextLines.push("章节摘要：");
  for (const summary of scopedSummaries.slice(0, frontCount ?? 30)) {
    contextLines.push(`- 第${summary.chapter_order}章 ${summary.chapter_title}：${summary.summary_short} ${summary.summary_long}`);
  }

  return {
    contextText: contextLines.join("\n"),
    report: {
      totalChapters: chapters.length,
      readyChapterSummaries: readyChapterSummaries.length,
      readyArcSummaries: arcSummaries.length,
      hasBookSummary: Boolean(bookSummary),
      scopedMissingChapters: missingInScope.length,
      legacyOrInvalidSummaries: legacyOrInvalidSummaries.length
    }
  };
}

async function callOpenRouter({ apiKey, model, question, contextText }) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/YuanShiJiLoong/novel_tool",
      "X-Title": "Moshu Summary Index Smoke"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "你是墨枢的摘要索引烟测助手。只根据提供的摘要索引回答，必须使用简体中文，不要声称读取了原文。"
        },
        {
          role: "user",
          content: `${contextText}\n\n请回答用户问题：${question}`
        }
      ],
      max_tokens: 1600,
      temperature: 0.2
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter 请求失败 (${response.status})：${text.slice(0, 600)}`);
  }
  const json = JSON.parse(text);
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`OpenRouter 返回空内容：${text.slice(0, 600)}`);
  }
  return content.trim();
}

async function main() {
  const args = parseArgs(process.argv);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 OPENROUTER_API_KEY 环境变量。");
  }

  const copiedProject = copyProjectToTemp(args.project);
  const db = new Database(copiedProject, { readonly: true, fileMustExist: true });
  try {
    const { contextText, report } = buildContext(db, args.question);
    const started = performance.now();
    const answer = await callOpenRouter({
      apiKey,
      model: args.model,
      question: args.question,
      contextText
    });
    const durationMs = Math.round(performance.now() - started);

    console.log("墨枢摘要索引烟测完成");
    console.log(`项目副本：${copiedProject}`);
    console.log(`模型：${args.model}`);
    console.log(`索引：章节 ${report.readyChapterSummaries}/${report.totalChapters}，阶段 ${report.readyArcSummaries}，全书 ${report.hasBookSummary ? "ready" : "missing"}`);
    console.log(`当前问题范围缺失：${report.scopedMissingChapters} 章`);
    console.log(`旧版或无效章节摘要：${report.legacyOrInvalidSummaries} 章`);
    console.log(`耗时：${durationMs}ms`);
    console.log(`回答预览：${answer.slice(0, 360)}${answer.length > 360 ? "..." : ""}`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
