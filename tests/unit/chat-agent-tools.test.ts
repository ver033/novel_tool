import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyChapterContent } from "../../src/main/chapter/default-content";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { ScratchNoteRepository } from "../../src/main/db/repositories/scratch-note-repo";
import { SummaryRepository } from "../../src/main/db/repositories/summary-repo";
import { createId } from "../../src/main/shared/ids";
import { computeChapterContentHash, type ChapterAiSummaryPayload, type ChapterAiSummaryPayloadV2 } from "../../src/main/shared/summary-index";
import type { ChapterSummary } from "../../src/main/shared/types";
import { executeChatAgentTool, MOSHU_CHAT_AGENT_TOOLS } from "../../src/main/ai/chat-agent-tools";
import { estimateTextTokens } from "../../src/main/ai/token-estimator";
import { getTokenBudget } from "../../src/main/ai/token-budget";
import { chapterIndexPayloadV2 } from "../helpers/summary-index-fixtures";

const tempDirs: string[] = [];

function createRepos() {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-agent-tools-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "novel-tool.sqlite3"));
  runMigrations(db);
  return {
    db,
    chapterRepo: new ChapterRepository(db),
    scratchRepo: new ScratchNoteRepository(db),
    summaryRepo: new SummaryRepository(db)
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createChapter(
  repo: ChapterRepository,
  input: {
    readonly projectId: string;
    readonly title: string;
    readonly sortOrder: number;
    readonly plainText: string;
  }
): ChapterSummary {
  const createdAt = "2026-05-01T00:00:00.000Z";
  return repo.create({
    id: createId("chapter"),
    projectId: input.projectId,
    title: input.title,
    volumeTitle: null,
    sortOrder: input.sortOrder,
    contentJson: emptyChapterContent,
    plainText: input.plainText,
    wordCount: input.plainText.length,
    dailyWordCount: 0,
    dailyWordCountDate: null,
    targetWordCount: null,
    status: "draft",
    createdAt,
    updatedAt: createdAt
  });
}

function createProject(repo: ProjectRepository, projectId: string): void {
  const createdAt = new Date().toISOString();
  repo.create({
    id: projectId,
    name: projectId,
    rootPath: null,
    createdAt,
    updatedAt: createdAt
  });
}

function parseToolJson(result: string): Record<string, unknown> {
  return JSON.parse(result) as Record<string, unknown>;
}

function createSummaryPayload(input: { readonly oneLine: string; readonly synopsis: string }): ChapterAiSummaryPayload {
  return chapterIndexPayloadV2({
    oneLine: input.oneLine,
    synopsis: input.synopsis,
    detail: `${input.synopsis} 这个章节缓存用于工具测试，保留章节事实索引字段，确保 read_chapters 的 summary 模式读取的是中文 V2 结构。`
  });
}

describe("chat agent tools", () => {
  it("describes read_chapters with flat model-friendly scope parameters", () => {
    const readTool = MOSHU_CHAT_AGENT_TOOLS.find((tool) => tool.function.name === "read_chapters");
    const parameters = JSON.stringify(readTool?.function.parameters);

    expect(parameters).toContain('"scope"');
    expect(parameters).toContain('"all_chapters"');
    expect(parameters).toContain('"chapter_range"');
    expect(parameters).toContain('"ordinal"');
    expect(parameters).toContain('"mode"');
    expect(parameters).toContain('"focus"');
    expect(parameters).toContain('"characters"');
    expect(parameters).toContain('"foreshadowing"');
    expect(parameters).toContain('"timeline"');
    expect(parameters).toContain('"summary"');
    expect(parameters).not.toContain('"oneOf"');
  });

  it("exposes run_writing_operation as a read-only writing tool", () => {
    const tool = MOSHU_CHAT_AGENT_TOOLS.find((item) => item.function.name === "run_writing_operation");
    const parameters = JSON.stringify(tool?.function.parameters);

    expect(tool?.function.description).toContain("润色");
    expect(tool?.function.description).toContain("自然语言明确提出这四类任务时也可以调用");
    expect(tool?.function.description).toContain("没有明确目标时不要调用本工具");
    expect(parameters).toContain('"operation"');
    expect(parameters).toContain('"polish"');
    expect(parameters).toContain('"target"');
    expect(parameters).toContain('"kind"');
    expect(parameters).toContain('"required":["operation"]');
    expect(parameters).toContain("用户当前消息里直接粘贴的正文必须原样放入 text");
    expect(parameters).not.toContain("add_to_scratchpad");
  });

  it("lists project chapters with stable ordinals and current chapter marker", async () => {
    const { chapterRepo, db, scratchRepo } = createRepos();
    const projectId = "project_tools";
    createProject(new ProjectRepository(db), projectId);
    const first = createChapter(chapterRepo, {
      projectId,
      title: "第1章 雨夜",
      sortOrder: 0,
      plainText: "第一章正文"
    });
    createChapter(chapterRepo, {
      projectId,
      title: "第2章 山门",
      sortOrder: 1,
      plainText: "第二章正文"
    });

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "list_chapters",
        argumentsJson: "{}",
        runtime: {
          projectId,
          currentChapterId: first.id,
          userMessage: "列出章节",
          chapterRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat")
        }
      })
    );

    expect(result).toMatchObject({
      chapters: [
        {
          ordinal: 1,
          id: first.id,
          title: "第1章 雨夜",
          wordCount: 5,
          current: true
        },
        {
          ordinal: 2,
          title: "第2章 山门",
          current: false
        }
      ]
    });

    db.close();
  });

  it("runs writing operation without creating scratchpad action", async () => {
    const { chapterRepo, db, scratchRepo } = createRepos();
    const projectId = "project_writing_tool";
    createProject(new ProjectRepository(db), projectId);

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "run_writing_operation",
        argumentsJson: JSON.stringify({
          operation: "polish",
          target: {
            kind: "inline_text",
            text: "萧炎垂下眼，指节慢慢攥紧。"
          },
          instruction: "更有压迫感"
        }),
        runtime: {
          projectId,
          userMessage: "润色这段",
          chapterRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat"),
          executeWritingOperation: async (input) => ({
            operation: input.operation,
            outputKind: "candidate_text",
            generatedText: "萧炎缓缓垂下眼，指节在袖中攥得发白。",
            changeSummary: "OpenRouter polish candidate",
            proofreadIssues: null,
            contextPlan: {
              targetText: "萧炎垂下眼，指节慢慢攥紧。",
              supportingContext: [],
              mode: "direct",
              estimatedInputTokens: 120,
              maxInputTokens: 8000,
              reason: "对话内粘贴文本"
            }
          })
        }
      })
    );

    expect(result).toMatchObject({
      operation: "polish",
      outputKind: "candidate_text",
      generatedText: "萧炎缓缓垂下眼，指节在袖中攥得发白。"
    });
    expect(result.action).toBeUndefined();

    db.close();
  });

  it("accepts the flattened selection arguments emitted by OpenRouter models", async () => {
    const { chapterRepo, db, scratchRepo } = createRepos();
    const projectId = "project_flat_selection_writing_tool";
    createProject(new ProjectRepository(db), projectId);
    const chapter = createChapter(chapterRepo, {
      projectId,
      title: "第1章 起点",
      sortOrder: 0,
      plainText: "彼は古い扉の前で足を止めた。"
    });
    const executeWritingOperation = vi.fn(async (input) => ({
      operation: input.operation,
      outputKind: "candidate_text" as const,
      generatedText: "彼は古びた扉の前で、息を殺すように足を止めた。",
      changeSummary: "OpenRouter expand candidate",
      proofreadIssues: null,
      contextPlan: {
        targetText: "彼は古い扉の前で足を止めた。",
        supportingContext: [],
        mode: "direct" as const,
        estimatedInputTokens: 120,
        maxInputTokens: 8000,
        reason: "当前选区"
      }
    }));

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "run_writing_operation",
        argumentsJson: JSON.stringify({
          operation: "expand",
          kind: "selection",
          instruction: "情景描写を補ってください。"
        }),
        runtime: {
          projectId,
          currentChapterId: chapter.id,
          selectionText: "彼は古い扉の前で足を止めた。",
          userMessage: "@選択範囲 を加筆してください",
          chapterRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat"),
          executeWritingOperation
        }
      })
    );

    expect(result).toMatchObject({
      operation: "expand",
      generatedText: "彼は古びた扉の前で、息を殺すように足を止めた。"
    });
    expect(executeWritingOperation).toHaveBeenCalledWith({
      operation: "expand",
      target: expect.objectContaining({ kind: "selection", chapterId: chapter.id }),
      instruction: "情景描写を補ってください。"
    });

    for (const argumentsJson of [
      JSON.stringify({
        operation: "expand",
        target: { kind: "selection", text: "彼は古い扉の前で足を止めた。" },
        instruction: "情景描写を補ってください。"
      }),
      JSON.stringify({
        operation: "expand",
        target: "selection",
        instruction: "情景描写を補ってください。"
      })
    ]) {
      await executeChatAgentTool({
        name: "run_writing_operation",
        argumentsJson,
        runtime: {
          projectId,
          currentChapterId: chapter.id,
          selectionText: "彼は古い扉の前で足を止めた。",
          userMessage: "@選択範囲 を加筆してください",
          chapterRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat"),
          executeWritingOperation
        }
      });
    }
    expect(executeWritingOperation).toHaveBeenCalledTimes(3);
    db.close();
  });

  it("reads all chapters through the context combiner instead of returning only the current chapter", async () => {
    const { chapterRepo, db, scratchRepo } = createRepos();
    const projectId = "project_read_all";
    createProject(new ProjectRepository(db), projectId);
    const first = createChapter(chapterRepo, {
      projectId,
      title: "第1章 起点",
      sortOrder: 0,
      plainText: "第一章真实正文。"
    });
    createChapter(chapterRepo, {
      projectId,
      title: "第2章 暗潮",
      sortOrder: 1,
      plainText: "第二章真实正文。"
    });
    createChapter(chapterRepo, {
      projectId,
      title: "第3章 转折",
      sortOrder: 2,
      plainText: "第三章真实正文。"
    });

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "read_chapters",
        argumentsJson: JSON.stringify({
          scope: {
            type: "all_chapters"
          }
        }),
        runtime: {
          projectId,
          currentChapterId: first.id,
          userMessage: "总结全部章节",
          chapterRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat")
        }
      })
    );

    expect(result.scopeLabel).toBe("全部章节");
    expect(result.mode).toBe("direct");
    expect(result.contextText).toContain("第一章真实正文。");
    expect(result.contextText).toContain("第二章真实正文。");
    expect(result.contextText).toContain("第三章真实正文。");

    db.close();
  });

  it("accepts unambiguous string scope aliases from model tool calls", async () => {
    const { chapterRepo, db, scratchRepo } = createRepos();
    const projectId = "project_read_string_scope";
    createProject(new ProjectRepository(db), projectId);
    const first = createChapter(chapterRepo, {
      projectId,
      title: "第1章 起点",
      sortOrder: 0,
      plainText: "第一章真实正文。"
    });
    createChapter(chapterRepo, {
      projectId,
      title: "第2章 暗潮",
      sortOrder: 1,
      plainText: "第二章真实正文。"
    });

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "read_chapters",
        argumentsJson: JSON.stringify({
          scope: "all_chapters"
        }),
        runtime: {
          projectId,
          currentChapterId: first.id,
          userMessage: "总结全部章节",
          chapterRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat")
        }
      })
    );

    expect(result.scopeLabel).toBe("全部章节");
    expect(result.contextText).toContain("第一章真实正文。");
    expect(result.contextText).toContain("第二章真实正文。");

    db.close();
  });

  it("accepts explicit Chinese chapter string scopes from model tool calls", async () => {
    const { chapterRepo, db, scratchRepo } = createRepos();
    const projectId = "project_read_chinese_scope";
    createProject(new ProjectRepository(db), projectId);
    const first = createChapter(chapterRepo, {
      projectId,
      title: "第1章 起点",
      sortOrder: 0,
      plainText: "第一章真实正文。"
    });
    createChapter(chapterRepo, {
      projectId,
      title: "第2章 暗潮",
      sortOrder: 1,
      plainText: "第二章真实正文。"
    });

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "read_chapters",
        argumentsJson: JSON.stringify({
          scope: "第2章"
        }),
        runtime: {
          projectId,
          currentChapterId: first.id,
          userMessage: "总结第2章",
          chapterRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat")
        }
      })
    );

    expect(result.scopeLabel).toBe("第2章");
    expect(result.contextText).toContain("第二章真实正文。");
    expect(result.contextText).not.toContain("第一章真实正文。");

    db.close();
  });

  it("accepts flat chapter arguments advertised to the model", async () => {
    const { chapterRepo, db, scratchRepo } = createRepos();
    const projectId = "project_read_flat_chapter";
    createProject(new ProjectRepository(db), projectId);
    const first = createChapter(chapterRepo, {
      projectId,
      title: "第1章 起点",
      sortOrder: 0,
      plainText: "第一章真实正文。"
    });
    createChapter(chapterRepo, {
      projectId,
      title: "第2章 暗潮",
      sortOrder: 1,
      plainText: "第二章真实正文。"
    });

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "read_chapters",
        argumentsJson: JSON.stringify({
          scope: "chapter",
          ordinal: 2
        }),
        runtime: {
          projectId,
          currentChapterId: first.id,
          userMessage: "总结第2章",
          chapterRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat")
        }
      })
    );

    expect(result.scopeLabel).toBe("第2章");
    expect(result.contextText).toContain("第二章真实正文。");
    expect(result.contextText).not.toContain("第一章真实正文。");

    db.close();
  });

  it("accepts flat chapter range arguments advertised to the model", async () => {
    const { chapterRepo, db, scratchRepo } = createRepos();
    const projectId = "project_read_flat_range";
    createProject(new ProjectRepository(db), projectId);
    createChapter(chapterRepo, {
      projectId,
      title: "第1章 起点",
      sortOrder: 0,
      plainText: "第一章真实正文。"
    });
    const second = createChapter(chapterRepo, {
      projectId,
      title: "第2章 暗潮",
      sortOrder: 1,
      plainText: "第二章真实正文。"
    });
    createChapter(chapterRepo, {
      projectId,
      title: "第3章 转折",
      sortOrder: 2,
      plainText: "第三章真实正文。"
    });

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "read_chapters",
        argumentsJson: JSON.stringify({
          scope: "chapter_range",
          from: 2,
          to: 3
        }),
        runtime: {
          projectId,
          currentChapterId: second.id,
          userMessage: "总结第2到第3章",
          chapterRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat")
        }
      })
    );

    expect(result.scopeLabel).toBe("第2-3章");
    expect(result.contextText).not.toContain("第一章真实正文。");
    expect(result.contextText).toContain("第二章真实正文。");
    expect(result.contextText).toContain("第三章真实正文。");

    db.close();
  });

  it("uses ready summary cache for a short chapter range when the model does not request raw mode", async () => {
    const { chapterRepo, db, scratchRepo, summaryRepo } = createRepos();
    const projectId = "project_read_short_range_summary";
    createProject(new ProjectRepository(db), projectId);
    const first = createChapter(chapterRepo, {
      projectId,
      title: "第1章 起点",
      sortOrder: 0,
      plainText: "第一章不应读取原文。".repeat(1200)
    });
    const second = createChapter(chapterRepo, {
      projectId,
      title: "第2章 暗潮",
      sortOrder: 1,
      plainText: "第二章不应读取原文。".repeat(1200)
    });
    [first, second].forEach((chapter, index) => {
      const ordinal = index + 1;
      summaryRepo.upsertChapterSummary({
        id: `summary_short_range_${ordinal}`,
        projectId,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterOrder: ordinal,
        contentHash: computeChapterContentHash(`chapter-${ordinal}`),
        summaryShort: `第${ordinal}章短摘要。`,
        summaryLong: `第${ordinal}章长摘要。`,
        structured: createSummaryPayload({
          oneLine: `第${ordinal}章短摘要。`,
          synopsis: `第${ordinal}章长摘要。`
        }),
        tokenCount: 30,
        status: "ready",
        error: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z"
      });
    });
    const guardedRepo = Object.create(chapterRepo) as ChapterRepository;
    guardedRepo.getContent = () => {
      throw new Error("short chapter range with ready summaries must not read raw chapter content");
    };

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "read_chapters",
        argumentsJson: JSON.stringify({
          scope: "chapter_range",
          from: 1,
          to: 2
        }),
        runtime: {
          projectId,
          currentChapterId: first.id,
          userMessage: "帮我总结前两章的内容",
          chapterRepo: guardedRepo,
          summaryRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat")
        }
      })
    );

    expect(result.scopeLabel).toBe("第1-2章摘要索引");
    expect(result.indexMode).toBe("summary_cache");
    expect(result.indexedChapterCount).toBe(2);
    expect(result.totalChapterCount).toBe(2);
    expect(result.contextText).toContain("第1章短摘要。");
    expect(result.contextText).toContain("第2章长摘要。");
    expect(result.contextText).not.toContain("不应读取原文");

    db.close();
  });

  it("treats ready summary caches as stale when chapter content changed after indexing", async () => {
    const { chapterRepo, db, scratchRepo, summaryRepo } = createRepos();
    const projectId = "project_read_stale_ready_summary";
    createProject(new ProjectRepository(db), projectId);
    const first = createChapter(chapterRepo, {
      projectId,
      title: "第1章 起点",
      sortOrder: 0,
      plainText: "第一章旧正文。"
    });
    const second = createChapter(chapterRepo, {
      projectId,
      title: "第2章 暗潮",
      sortOrder: 1,
      plainText: "第二章旧正文。"
    });
    [first, second].forEach((chapter, index) => {
      const ordinal = index + 1;
      summaryRepo.upsertChapterSummary({
        id: `summary_stale_ready_${ordinal}`,
        projectId,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterOrder: ordinal,
        contentHash: computeChapterContentHash(chapter.id),
        summaryShort: `第${ordinal}章旧短摘要。`,
        summaryLong: `第${ordinal}章旧长摘要。`,
        structured: createSummaryPayload({
          oneLine: `第${ordinal}章旧短摘要。`,
          synopsis: `第${ordinal}章旧长摘要。`
        }),
        tokenCount: 30,
        status: "ready",
        error: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z"
      });
    });
    chapterRepo.saveContent(
      first.id,
      emptyChapterContent,
      "第一章最新正文。",
      "第一章最新正文。".length,
      0,
      "2026-05-01",
      "2026-05-01T00:10:00.000Z",
      first.contentUpdatedAt
    );
    chapterRepo.saveContent(
      second.id,
      emptyChapterContent,
      "第二章最新正文。",
      "第二章最新正文。".length,
      0,
      "2026-05-01",
      "2026-05-01T00:10:00.000Z",
      second.contentUpdatedAt
    );

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "read_chapters",
        argumentsJson: JSON.stringify({
          scope: "chapter_range",
          from: 1,
          to: 2
        }),
        runtime: {
          projectId,
          currentChapterId: first.id,
          userMessage: "帮我总结前两章的内容",
          chapterRepo,
          summaryRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat")
        }
      })
    );

    expect(result.scopeLabel).toBe("第1-2章");
    expect(result.mode).toBe("direct");
    expect(result.contextText).toContain("第一章最新正文。");
    expect(result.contextText).toContain("第二章最新正文。");
    expect(result.contextText).not.toContain("旧短摘要");

    db.close();
  });

  it("uses hybrid summaries for partially cached long chapter ranges without requiring an explicit mode", async () => {
    const { chapterRepo, db, scratchRepo, summaryRepo } = createRepos();
    const projectId = "project_read_partial_long_summary";
    createProject(new ProjectRepository(db), projectId);
    const chapters = Array.from({ length: 10 }, (_, index) => {
      const ordinal = index + 1;
      return createChapter(chapterRepo, {
        projectId,
        title: `第${ordinal}章 长范围${ordinal}`,
        sortOrder: index,
        plainText: `第${ordinal}章默认工具参数不应回退读取原文。`
      });
    });
    chapters.forEach((chapter, index) => {
      const ordinal = index + 1;
      if (ordinal === 5) {
        return;
      }
      summaryRepo.upsertChapterSummary({
        id: `summary_read_partial_long_${ordinal}`,
        projectId,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterOrder: ordinal,
        contentHash: computeChapterContentHash(`partial-long-${ordinal}`),
        summaryShort: `第${ordinal}章工具短摘要。`,
        summaryLong: `第${ordinal}章工具长摘要。`,
        structured: createSummaryPayload({
          oneLine: `第${ordinal}章工具短摘要。`,
          synopsis: `第${ordinal}章工具长摘要。`
        }),
        tokenCount: 30,
        status: "ready",
        error: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z"
      });
    });
    const guardedRepo = Object.create(chapterRepo) as ChapterRepository;
    guardedRepo.getContent = () => {
      throw new Error("partially cached long read_chapters calls must not read raw chapter content");
    };

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "read_chapters",
        argumentsJson: JSON.stringify({
          scope: "chapter_range",
          from: 1,
          to: 10
        }),
        runtime: {
          projectId,
          currentChapterId: chapters[0].id,
          userMessage: "帮我总结前十章的内容",
          chapterRepo: guardedRepo,
          summaryRepo,
          scratchRepo,
          tokenBudget: {
            maxInputTokens: 120_000,
            maxOutputTokens: 4096
          }
        }
      })
    );

    expect(result.scopeLabel).toBe("第1-10章摘要索引");
    expect(result.indexMode).toBe("hybrid");
    expect(result.indexedChapterCount).toBe(9);
    expect(result.totalChapterCount).toBe(10);
    expect(result.staleChapterCount).toBe(1);
    expect(result.contextText).toContain("摘要缺失或过期 1 章");
    expect(result.contextText).toContain("缺失章节：第5章 长范围5");
    expect(result.contextText).toContain("第1章工具短摘要。");
    expect(result.contextText).toContain("第10章工具长摘要。");
    expect(result.contextText).not.toContain("回退读取原文");

    db.close();
  });

  it("reads character-focused fields from chapter summary caches without raw text", async () => {
    const { chapterRepo, db, scratchRepo, summaryRepo } = createRepos();
    const projectId = "project_read_character_focus";
    createProject(new ProjectRepository(db), projectId);
    const first = createChapter(chapterRepo, {
      projectId,
      title: "第1章 起点",
      sortOrder: 0,
      plainText: "第一章人物原文不应被读取。"
    });
    const second = createChapter(chapterRepo, {
      projectId,
      title: "第2章 暗潮",
      sortOrder: 1,
      plainText: "第二章人物原文不应被读取。"
    });
    [first, second].forEach((chapter, index) => {
      const ordinal = index + 1;
      const structured = createSummaryPayload({
        oneLine: `第${ordinal}章人物短摘要。`,
        synopsis: `第${ordinal}章人物长摘要。`
      }) as ChapterAiSummaryPayloadV2;
      structured.人物状态[0] = {
        ...structured.人物状态[0],
        人物: ordinal === 1 ? "林远" : "沈青",
        情绪状态: ordinal === 1 ? "谨慎" : "犹疑",
        新获得信息: ordinal === 1 ? ["旧信出现"] : ["祠堂线索浮出"],
        仍不知道的信息: ordinal === 1 ? ["旧信来源"] : ["林远是否可信"]
      };
      structured.人物认知边界[0] = {
        ...structured.人物认知边界[0],
        人物: ordinal === 1 ? "林远" : "沈青",
        已经知道: ordinal === 1 ? ["旧信存在"] : ["祠堂有异常"],
        尚不知道: ordinal === 1 ? ["旧信来源"] : ["旧信真正持有者"]
      };
      structured.关系动态[0] = {
        ...structured.关系动态[0],
        关系双方: ["林远", "沈青"],
        关系类型: "试探关系",
        本章结束状态: ordinal === 1 ? "尚未接触" : "开始互相试探"
      };
      summaryRepo.upsertChapterSummary({
        id: `summary_character_focus_${ordinal}`,
        projectId,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterOrder: ordinal,
        contentHash: computeChapterContentHash(`character-focus-${ordinal}`),
        summaryShort: `第${ordinal}章人物短摘要。`,
        summaryLong: `第${ordinal}章人物长摘要。`,
        structured,
        tokenCount: 60,
        status: "ready",
        error: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z"
      });
    });
    const guardedRepo = Object.create(chapterRepo) as ChapterRepository;
    guardedRepo.getContent = () => {
      throw new Error("character-focused reads must use summary caches");
    };

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "read_chapters",
        argumentsJson: JSON.stringify({
          scope: "chapter_range",
          from: 1,
          to: 2,
          focus: "characters"
        }),
        runtime: {
          projectId,
          currentChapterId: first.id,
          userMessage: "这些章节里出现了哪些角色，有什么特征",
          chapterRepo: guardedRepo,
          summaryRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat")
        }
      })
    );

    expect(result.scopeLabel).toBe("第1-2章人物索引");
    expect(result.indexMode).toBe("summary_cache");
    expect(result.contextText).toContain("人物状态");
    expect(result.contextText).toContain("人物认知边界");
    expect(result.contextText).toContain("关系动态");
    expect(result.contextText).toContain("林远");
    expect(result.contextText).toContain("沈青");
    expect(result.contextText).not.toContain("人物原文不应被读取");

    db.close();
  });

  it("keeps focused all-chapter summary tool output within a conservative tool budget", async () => {
    const { chapterRepo, db, scratchRepo, summaryRepo } = createRepos();
    const projectId = "project_read_huge_facts_focus";
    createProject(new ProjectRepository(db), projectId);
    const chapterCount = 24;
    for (let index = 0; index < chapterCount; index += 1) {
      const ordinal = index + 1;
      const chapter = createChapter(chapterRepo, {
        projectId,
        title: `第${ordinal}章 时间线${ordinal}`,
        sortOrder: index,
        plainText: `第${ordinal}章原文不应被读取。`
      });
      const structured = createSummaryPayload({
        oneLine: `第${ordinal}章时间线短摘要。`,
        synopsis: `第${ordinal}章时间线长摘要。`
      }) as ChapterAiSummaryPayloadV2;
      structured.可核对事实 = Array.from({ length: 12 }, (_, factIndex) => ({
        事实编号: `事实-${ordinal}-${factIndex + 1}`,
        事实类型: factIndex % 2 === 0 ? "时间" : "人物状态",
        主体: `人物${ordinal}`,
        属性: "时间线推进",
        取值: `第${ordinal}章第${factIndex + 1}个很长的事实线索，包含大量用于模拟长篇索引的文字。${"剧情状态变化".repeat(12)}`,
        时间范围: `第${ordinal}章期间`,
        地点: `地点${ordinal}`,
        确定性: "确定",
        后文核对意义: `用于判断第${ordinal}章之后的时间线是否冲突。${"后续承接".repeat(8)}`,
        证据短句: [`第${ordinal}章证据${factIndex + 1}`]
      }));
      summaryRepo.upsertChapterSummary({
        id: `summary_huge_facts_${ordinal}`,
        projectId,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterOrder: ordinal,
        contentHash: computeChapterContentHash(`huge-facts-${ordinal}`),
        summaryShort: `第${ordinal}章时间线短摘要。`,
        summaryLong: `第${ordinal}章时间线长摘要。`,
        structured,
        tokenCount: 900,
        status: "ready",
        error: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z"
      });
    }
    const guardedRepo = Object.create(chapterRepo) as ChapterRepository;
    guardedRepo.getContent = () => {
      throw new Error("huge all-chapter summary reads must not fall back to raw text");
    };
    const maxInputTokens = 900;

    const output = await executeChatAgentTool({
      name: "read_chapters",
      argumentsJson: JSON.stringify({
        scope: "all_chapters",
        mode: "summary",
        focus: "facts"
      }),
      runtime: {
        projectId,
        currentChapterId: chapterRepo.listByProject(projectId)[0].id,
        userMessage: "所有章节都缓存完了，帮我总结时间线",
        chapterRepo: guardedRepo,
        summaryRepo,
        scratchRepo,
        tokenBudget: {
          maxInputTokens,
          maxOutputTokens: 4096
        }
      }
    });
    const result = parseToolJson(output);

    expect(estimateTextTokens(output)).toBeLessThanOrEqual(Math.floor(maxInputTokens * 0.65));
    expect(result.contextTruncated).toBe(true);
    expect(String(result.contextText)).toContain("工具结果已按当前模型窗口压缩");
    expect(String(result.contextText)).not.toContain("原文不应被读取");
    db.close();
  });

  it("reads timeline-focused summary fields for all chapters without raw text", async () => {
    const { chapterRepo, db, scratchRepo, summaryRepo } = createRepos();
    const projectId = "project_read_timeline_focus";
    createProject(new ProjectRepository(db), projectId);
    const first = createChapter(chapterRepo, {
      projectId,
      title: "第1章 清晨",
      sortOrder: 0,
      plainText: "第一章时间线原文不应被读取。"
    });
    const second = createChapter(chapterRepo, {
      projectId,
      title: "第2章 入夜",
      sortOrder: 1,
      plainText: "第二章时间线原文不应被读取。"
    });
    [first, second].forEach((chapter, index) => {
      const ordinal = index + 1;
      const structured = createSummaryPayload({
        oneLine: `第${ordinal}章时间短摘要。`,
        synopsis: `第${ordinal}章时间长摘要。`
      }) as ChapterAiSummaryPayloadV2;
      structured.时间与地点 = {
        ...structured.时间与地点,
        本章时间: ordinal === 1 ? "清晨" : "入夜",
        主要地点: ordinal === 1 ? ["坊市入口"] : ["萧家大厅"],
        相对时间锚点: ordinal === 1 ? ["纳兰来访前"] : ["当天夜里"]
      };
      structured.可核对事实 = [
        {
          事实编号: `时间事实-${ordinal}`,
          事实类型: "时间",
          主体: `第${ordinal}章`,
          属性: "时间锚点",
          取值: ordinal === 1 ? "清晨" : "入夜",
          时间范围: ordinal === 1 ? "清晨" : "夜间",
          地点: ordinal === 1 ? "坊市入口" : "萧家大厅",
          确定性: "确定",
          后文核对意义: "用于整理全书时间线",
          证据短句: []
        }
      ];
      summaryRepo.upsertChapterSummary({
        id: `summary_timeline_focus_${ordinal}`,
        projectId,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterOrder: ordinal,
        contentHash: computeChapterContentHash(`timeline-focus-${ordinal}`),
        summaryShort: `第${ordinal}章时间短摘要。`,
        summaryLong: `第${ordinal}章时间长摘要。`,
        structured,
        tokenCount: 60,
        status: "ready",
        error: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z"
      });
    });
    const guardedRepo = Object.create(chapterRepo) as ChapterRepository;
    guardedRepo.getContent = () => {
      throw new Error("timeline-focused reads must use summary caches");
    };

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "read_chapters",
        argumentsJson: JSON.stringify({
          scope: "all_chapters",
          focus: "timeline"
        }),
        runtime: {
          projectId,
          currentChapterId: first.id,
          userMessage: "所有章节都缓存完了，帮我总结时间线",
          chapterRepo: guardedRepo,
          summaryRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat")
        }
      })
    );

    expect(result.scopeLabel).toBe("全部章节时间线索引");
    expect(result.indexMode).toBe("summary_cache");
    expect(result.contextText).toContain("时间与地点");
    expect(result.contextText).toContain("清晨");
    expect(result.contextText).toContain("入夜");
    expect(result.contextText).not.toContain("伏笔与线索");
    expect(result.contextText).not.toContain("时间线原文不应被读取");

    db.close();
  });

  it("reports missing foreshadowing indexes instead of reading raw text or hallucinating", async () => {
    const { chapterRepo, db, scratchRepo, summaryRepo } = createRepos();
    const projectId = "project_read_missing_foreshadowing_focus";
    createProject(new ProjectRepository(db), projectId);
    const first = createChapter(chapterRepo, {
      projectId,
      title: "第1章 旧信",
      sortOrder: 0,
      plainText: "第一章伏笔原文不应被读取。"
    });
    createChapter(chapterRepo, {
      projectId,
      title: "第2章 祠堂",
      sortOrder: 1,
      plainText: "第二章伏笔原文不应被读取。"
    });
    const guardedRepo = Object.create(chapterRepo) as ChapterRepository;
    guardedRepo.getContent = () => {
      throw new Error("missing foreshadowing indexes must not fall back to raw text");
    };

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "read_chapters",
        argumentsJson: JSON.stringify({
          scope: "chapter_range",
          from: 1,
          to: 2,
          focus: "foreshadowing"
        }),
        runtime: {
          projectId,
          currentChapterId: first.id,
          userMessage: "本章有哪些伏笔",
          chapterRepo: guardedRepo,
          summaryRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat")
        }
      })
    );

    expect(result.scopeLabel).toBe("第1-2章伏笔索引");
    expect(result.indexMode).toBe("missing");
    expect(result.indexedChapterCount).toBe(0);
    expect(result.contextText).toContain("摘要索引缺失或过期");
    expect(result.contextText).toContain("缺失章节：第1章 旧信、第2章 祠堂");
    expect(result.contextText).toContain("不能声称已经读取正文");
    expect(result.contextText).not.toContain("伏笔原文不应被读取");

    db.close();
  });

  it("checks continuity from V2 chapter caches without reading raw chapter bodies", async () => {
    const { chapterRepo, db, scratchRepo, summaryRepo } = createRepos();
    const projectId = "project_continuity_cache";
    createProject(new ProjectRepository(db), projectId);
    const first = createChapter(chapterRepo, {
      projectId,
      title: "第1章 旧信",
      sortOrder: 0,
      plainText: "第1章原文不应被连续性工具读取。"
    });
    const second = createChapter(chapterRepo, {
      projectId,
      title: "第2章 祠堂",
      sortOrder: 1,
      plainText: "第2章原文不应被连续性工具读取。"
    });
    [first, second].forEach((chapter, index) => {
      const ordinal = index + 1;
      summaryRepo.upsertChapterSummary({
        id: `summary_continuity_${ordinal}`,
        projectId,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterOrder: ordinal,
        contentHash: computeChapterContentHash(`continuity-${ordinal}`),
        summaryShort: `第${ordinal}章连续性短摘要。`,
        summaryLong: `第${ordinal}章连续性长摘要。`,
        structured: createSummaryPayload({
          oneLine: `第${ordinal}章连续性短摘要。`,
          synopsis: `第${ordinal}章连续性长摘要。`
        }),
        tokenCount: 30,
        status: "ready",
        error: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z"
      });
    });
    const guardedRepo = Object.create(chapterRepo) as ChapterRepository;
    guardedRepo.getContent = () => {
      throw new Error("continuity check must use chapter summary caches before raw text");
    };

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "check_continuity",
        argumentsJson: JSON.stringify({
          scope: "chapter_range",
          from: 1,
          to: 2,
          question: "检查旧信来源是否前后矛盾"
        }),
        runtime: {
          projectId,
          currentChapterId: first.id,
          userMessage: "检查旧信来源是否前后矛盾",
          chapterRepo: guardedRepo,
          summaryRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat"),
          executeContinuityCheck: async (input) => {
            expect(input.question).toBe("检查旧信来源是否前后矛盾");
            expect(input.chapters.map((chapter) => chapter.ordinal)).toEqual([1, 2]);
            expect(input.chapters[0].structured.可核对事实.length).toBeGreaterThan(0);
            return {
              结论: "疑似冲突",
              问题列表: [
                {
                  问题类型: "人物认知",
                  严重程度: "中",
                  涉及章节: ["第1章", "第2章"],
                  冲突说明: "旧信来源在缓存中需要核对。",
                  证据一: { 章节: "第1章", 字段: "人物认知边界", 证据短句: "尚不知道旧信来源" },
                  证据二: { 章节: "第2章", 字段: "可核对事实", 证据短句: "说出旧信来自祠堂" },
                  为什么可能冲突: "前章未建立信息来源，后章直接使用信息。",
                  是否可能是伏笔或误导: "是",
                  是否需要回读原文: "是",
                  建议处理: "回读两章确认是否有中间线索。"
                }
              ],
              需要回读的章节: ["第1章", "第2章"],
              给作者的简短说明: "这属于疑似信息差，不应直接判定为错误。"
            };
          }
        }
      })
    );

    expect(result.scopeLabel).toBe("第1-2章连续性检查");
    expect(result.source).toBe("chapter_summary_cache");
    expect(result.result).toMatchObject({
      结论: "疑似冲突",
      问题列表: [
        {
          是否可能是伏笔或误导: "是"
        }
      ]
    });

    db.close();
  });

  it("accepts a clean continuity result without forcing a fake issue", async () => {
    const { chapterRepo, db, scratchRepo, summaryRepo } = createRepos();
    const projectId = "project_continuity_clean";
    createProject(new ProjectRepository(db), projectId);
    const chapter = createChapter(chapterRepo, {
      projectId,
      title: "第1章 起点",
      sortOrder: 0,
      plainText: "第一章正文"
    });
    summaryRepo.upsertChapterSummary({
      id: "summary_continuity_clean",
      projectId,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      chapterOrder: 1,
      contentHash: computeChapterContentHash("continuity-clean"),
      summaryShort: "第1章短摘要。",
      summaryLong: "第1章长摘要。",
      structured: createSummaryPayload({
        oneLine: "第1章短摘要。",
        synopsis: "第1章长摘要。"
      }),
      tokenCount: 30,
      status: "ready",
      error: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "check_continuity",
        argumentsJson: JSON.stringify({
          scope: "chapter",
          ordinal: 1
        }),
        runtime: {
          projectId,
          currentChapterId: chapter.id,
          userMessage: "检查本章有没有明显冲突",
          chapterRepo,
          summaryRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat"),
          executeContinuityCheck: async () => ({
            结论: "无明显冲突",
            问题列表: [],
            需要回读的章节: [],
            给作者的简短说明: "根据当前章节缓存，未发现明显连续性冲突。"
          })
        }
      })
    );

    expect(result.result).toMatchObject({
      结论: "无明显冲突",
      问题列表: []
    });

    db.close();
  });

  it("honors explicit raw mode for a small chapter range even when summaries exist", async () => {
    const { chapterRepo, db, scratchRepo, summaryRepo } = createRepos();
    const projectId = "project_read_raw_mode";
    createProject(new ProjectRepository(db), projectId);
    const first = createChapter(chapterRepo, {
      projectId,
      title: "第1章 起点",
      sortOrder: 0,
      plainText: "第一章应读取原文。"
    });
    const second = createChapter(chapterRepo, {
      projectId,
      title: "第2章 暗潮",
      sortOrder: 1,
      plainText: "第二章应读取原文。"
    });
    [first, second].forEach((chapter, index) => {
      const ordinal = index + 1;
      summaryRepo.upsertChapterSummary({
        id: `summary_raw_mode_${ordinal}`,
        projectId,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterOrder: ordinal,
        contentHash: computeChapterContentHash(`raw-mode-${ordinal}`),
        summaryShort: `第${ordinal}章不应使用摘要。`,
        summaryLong: `第${ordinal}章不应使用长摘要。`,
        structured: createSummaryPayload({
          oneLine: `第${ordinal}章不应使用摘要。`,
          synopsis: `第${ordinal}章不应使用长摘要。`
        }),
        tokenCount: 30,
        status: "ready",
        error: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z"
      });
    });

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "read_chapters",
        argumentsJson: JSON.stringify({
          scope: "chapter_range",
          from: 1,
          to: 2,
          mode: "raw"
        }),
        runtime: {
          projectId,
          currentChapterId: first.id,
          userMessage: "请逐字查看前两章",
          chapterRepo,
          summaryRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat")
        }
      })
    );

    expect(result.scopeLabel).toBe("第1-2章");
    expect(result.mode).toBe("direct");
    expect(result.indexMode).toBeUndefined();
    expect(result.contextText).toContain("第一章应读取原文。");
    expect(result.contextText).toContain("第二章应读取原文。");
    expect(result.contextText).not.toContain("不应使用摘要");

    db.close();
  });

  it("rejects inverted chapter ranges instead of returning empty context", async () => {
    const { chapterRepo, db, scratchRepo } = createRepos();
    const projectId = "project_read_invalid_range";
    createProject(new ProjectRepository(db), projectId);
    createChapter(chapterRepo, {
      projectId,
      title: "第1章 起点",
      sortOrder: 0,
      plainText: "第一章真实正文。"
    });
    createChapter(chapterRepo, {
      projectId,
      title: "第2章 暗潮",
      sortOrder: 1,
      plainText: "第二章真实正文。"
    });

    await expect(
      executeChatAgentTool({
        name: "read_chapters",
        argumentsJson: JSON.stringify({
          scope: "chapter_range",
          from: 2,
          to: 1
        }),
        runtime: {
          projectId,
          userMessage: "总结第2到第1章",
          chapterRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat")
        }
      })
    ).rejects.toThrow("章节范围无效");

    db.close();
  });

  it("reads model-provided inline text as the current selection when no editor selection exists", async () => {
    const { chapterRepo, db, scratchRepo } = createRepos();
    const projectId = "project_inline_selection";
    createProject(new ProjectRepository(db), projectId);
    const chapter = createChapter(chapterRepo, {
      projectId,
      title: "第1章 起点",
      sortOrder: 0,
      plainText: "第一章正文"
    });
    const pastedText = [
      "望着测验魔石碑上面闪亮得甚至有些刺眼的五个大字，少年面无表情。",
      "“萧炎，斗之力，三段！级别：低级！”"
    ].join("\n");

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "read_selection",
        argumentsJson: JSON.stringify({
          inlineText: pastedText
        }),
        runtime: {
          projectId,
          currentChapterId: chapter.id,
          userMessage: `${pastedText}\n这一段文字润色一下`,
          chapterRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat")
        }
      })
    );

    expect(result.scopeLabel).toBe("对话内粘贴文本");
    expect(result.sourceChapterIds).toEqual([]);
    expect(result.contextText).toContain("测验魔石碑");
    expect(result.contextText).toContain("斗之力，三段");
    expect(result.contextText).toBe(pastedText);

    db.close();
  });

  it("accepts kana-rich Japanese inline text as an explicit selection source", async () => {
    const { chapterRepo, db, scratchRepo } = createRepos();
    const projectId = "project_japanese_inline_selection";
    createProject(new ProjectRepository(db), projectId);
    const pastedText = "雨は静かに降り続いていた。彼女は傘も差さず、遠ざかる背中を見送った。";

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "read_selection",
        argumentsJson: JSON.stringify({ inlineText: pastedText }),
        runtime: {
          projectId,
          userMessage: `${pastedText}\nこの文章を推敲してください`,
          chapterRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat")
        }
      })
    );

    expect(result.scopeLabel).toBe("对话内粘贴文本");
    expect(result.contextText).toBe(pastedText);
    db.close();
  });

  it("runs natural-language polish through explicit inline_text tool arguments without slash", async () => {
    const { chapterRepo, db, scratchRepo } = createRepos();
    const projectId = "project_inline_colloquial_polish";
    createProject(new ProjectRepository(db), projectId);
    const chapter = createChapter(chapterRepo, {
      projectId,
      title: "第1章 起点",
      sortOrder: 0,
      plainText: "第一章正文"
    });
    const pastedText = "床榻之上，少年闭目盘腿而坐，双手在身前摆出奇异的手印，胸膛轻微起伏，一呼一吸间，形成完美的循环，而在气息循环间，有着淡淡的白色气流顺着口鼻，钻入了体内，温养着骨骼与肉体。";

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "run_writing_operation",
        argumentsJson: JSON.stringify({
          operation: "polish",
          target: {
            kind: "inline_text",
            text: pastedText
          },
          instruction: "帮我润一下色"
        }),
        runtime: {
          projectId,
          currentChapterId: chapter.id,
          userMessage: `${pastedText}\n帮我润一下色`,
          chapterRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat"),
          executeWritingOperation: async (input) => ({
            operation: input.operation,
            outputKind: "candidate_text",
            generatedText: "床榻上，少年闭目盘坐，双手于身前结出奇异手印。胸膛随呼吸轻轻起伏，气息流转之间，淡淡白气自口鼻没入体内，悄然温养着骨骼与血肉。",
            changeSummary: "OpenRouter polish candidate",
            proofreadIssues: null,
            contextPlan: {
              targetText: pastedText,
              supportingContext: [],
              mode: "direct",
              estimatedInputTokens: 160,
              maxInputTokens: 8000,
              reason: "对话内粘贴文本由模型显式传入 inline_text"
            }
          })
        }
      })
    );

    expect(result.operation).toBe("polish");
    expect(result.generatedText).toContain("少年闭目盘坐");

    db.close();
  });

  it("does not require slash when the model passes single-line pasted text to writing operation", async () => {
    const { chapterRepo, db, scratchRepo } = createRepos();
    const projectId = "project_inline_same_line_polish";
    createProject(new ProjectRepository(db), projectId);
    const chapter = createChapter(chapterRepo, {
      projectId,
      title: "第1章 起点",
      sortOrder: 0,
      plainText: "第一章正文"
    });
    const pastedText = "床榻之上，少年闭目盘腿而坐，胸膛轻微起伏，淡淡的白色气流顺着口鼻钻入体内，温养着骨骼与肉体。";

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "run_writing_operation",
        argumentsJson: JSON.stringify({
          operation: "polish",
          target: {
            kind: "inline_text",
            text: pastedText
          },
          instruction: "帮我润一下色"
        }),
        runtime: {
          projectId,
          currentChapterId: chapter.id,
          userMessage: `${pastedText}帮我润一下色`,
          chapterRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat"),
          executeWritingOperation: async (input) => ({
            operation: input.operation,
            outputKind: "candidate_text",
            generatedText: "床榻上，少年闭目盘坐，胸膛随着呼吸微微起伏，淡淡白气顺着口鼻没入体内，温养着骨骼与血肉。",
            changeSummary: "OpenRouter polish candidate",
            proofreadIssues: null,
            contextPlan: {
              targetText: pastedText,
              supportingContext: [],
              mode: "direct",
              estimatedInputTokens: 150,
              maxInputTokens: 8000,
              reason: "对话内粘贴文本由模型显式传入 inline_text"
            }
          })
        }
      })
    );

    expect(result.operation).toBe("polish");
    expect(result.generatedText).toContain("床榻上");

    db.close();
  });

  it("uses model-provided inline text when a model reads selection scope through read_chapters", async () => {
    const { chapterRepo, db, scratchRepo } = createRepos();
    const projectId = "project_inline_selection_scope";
    createProject(new ProjectRepository(db), projectId);
    const chapter = createChapter(chapterRepo, {
      projectId,
      title: "第1章 起点",
      sortOrder: 0,
      plainText: "第一章正文"
    });

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "read_chapters",
        argumentsJson: JSON.stringify({
          scope: "selection",
          inlineText: "少年面无表情，唇角有一抹自嘲。"
        }),
        runtime: {
          projectId,
          currentChapterId: chapter.id,
          userMessage: "请润色下面这段：\n少年面无表情，唇角有一抹自嘲。",
          chapterRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat")
        }
      })
    );

    expect(result.scopeLabel).toBe("对话内粘贴文本");
    expect(result.mode).toBe("direct");
    expect(result.sourceChapterIds).toEqual([]);
    expect(result.contextText).toContain("少年面无表情");

    db.close();
  });

  it("adds generated content to scratchpad only through the explicit tool call", async () => {
    const { chapterRepo, db, scratchRepo } = createRepos();
    const projectId = "project_scratch";
    createProject(new ProjectRepository(db), projectId);
    const chapter = createChapter(chapterRepo, {
      projectId,
      title: "第1章 起点",
      sortOrder: 0,
      plainText: "第一章正文"
    });

    const result = parseToolJson(
      await executeChatAgentTool({
        name: "add_to_scratchpad",
        argumentsJson: JSON.stringify({
          content: "全书摘要：主角在雨夜抵达山门。",
          chapterId: chapter.id
        }),
        runtime: {
          projectId,
          currentChapterId: chapter.id,
          userMessage: "加入草稿纸",
          chapterRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat"),
          allowedActions: ["add_to_scratchpad"]
        }
      })
    );

    expect(result).toMatchObject({
      ok: true,
      action: {
        type: "add_to_scratchpad",
        chapterId: chapter.id,
        content: "全书摘要：主角在雨夜抵达山门。"
      }
    });
    expect(scratchRepo.list({ projectId, chapterId: chapter.id })).toMatchObject([
      {
        content: "全书摘要：主角在雨夜抵达山门。"
      }
    ]);

    db.close();
  });

  it("rejects scratchpad writes when the author did not explicitly allow saving", async () => {
    const { chapterRepo, db, scratchRepo } = createRepos();
    const projectId = "project_scratch_guard";
    createProject(new ProjectRepository(db), projectId);
    const chapter = createChapter(chapterRepo, {
      projectId,
      title: "第1章 起点",
      sortOrder: 0,
      plainText: "第一章正文"
    });

    await expect(
      executeChatAgentTool({
        name: "add_to_scratchpad",
        argumentsJson: JSON.stringify({
          content: "不应自动保存的润色建议。",
          chapterId: chapter.id
        }),
        runtime: {
          projectId,
          currentChapterId: chapter.id,
          userMessage: "帮我润色这一段",
          chapterRepo,
          scratchRepo,
          tokenBudget: getTokenBudget("chat")
        }
      })
    ).rejects.toThrow("作者没有要求加入草稿纸");
    expect(scratchRepo.list({ projectId, chapterId: chapter.id })).toEqual([]);

    db.close();
  });
});
