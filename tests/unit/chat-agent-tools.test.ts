import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyChapterContent } from "../../src/main/chapter/default-content";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { ScratchNoteRepository } from "../../src/main/db/repositories/scratch-note-repo";
import { createId } from "../../src/main/shared/ids";
import type { ChapterSummary } from "../../src/main/shared/types";
import { executeChatAgentTool, MOSHU_CHAT_AGENT_TOOLS } from "../../src/main/ai/chat-agent-tools";
import { getTokenBudget } from "../../src/main/ai/token-budget";

const tempDirs: string[] = [];

function createRepos() {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-agent-tools-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "novel-tool.sqlite3"));
  runMigrations(db);
  return {
    db,
    chapterRepo: new ChapterRepository(db),
    scratchRepo: new ScratchNoteRepository(db)
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
  const createdAt = new Date().toISOString();
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

describe("chat agent tools", () => {
  it("describes read_chapters with flat model-friendly scope parameters", () => {
    const readTool = MOSHU_CHAT_AGENT_TOOLS.find((tool) => tool.function.name === "read_chapters");
    const parameters = JSON.stringify(readTool?.function.parameters);

    expect(parameters).toContain('"scope"');
    expect(parameters).toContain('"all_chapters"');
    expect(parameters).toContain('"chapter_range"');
    expect(parameters).toContain('"ordinal"');
    expect(parameters).not.toContain('"oneOf"');
  });

  it("exposes run_writing_operation as a read-only writing tool", () => {
    const tool = MOSHU_CHAT_AGENT_TOOLS.find((item) => item.function.name === "run_writing_operation");
    const parameters = JSON.stringify(tool?.function.parameters);

    expect(tool?.function.description).toContain("润色");
    expect(parameters).toContain('"operation"');
    expect(parameters).toContain('"polish"');
    expect(parameters).toContain('"target"');
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
