import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { WritingOperationRunner } from "../../src/main/ai/writing-operation-runner";
import { emptyChapterContent } from "../../src/main/chapter/default-content";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import type { OpenRouterChatCompletionInput, OpenRouterStreamHandlers } from "../../src/main/ai/openrouter-client";
import type { AiTaskRecord } from "../../src/main/shared/types";
import { describe, expect, it, vi } from "vitest";
import { parseAiCandidateMetadata, stringifyAiCandidateMetadata } from "../../src/main/shared/ai-candidate-metadata";

const runnerTempDirs: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const dir of runnerTempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createProject(db: SqliteDatabase, projectId: string): void {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(projectId, projectId, now, now);
}

function createRunnerRepo(projectId: string) {
  const dir = mkdtempSync(join(tmpdir(), "moshu-operation-runner-"));
  runnerTempDirs.push(dir);
  const db = createDatabase(join(dir, "project.sqlite3"));
  runMigrations(db);
  createProject(db, projectId);
  return { db, chapterRepo: new ChapterRepository(db) };
}

function createTask(patch: Partial<AiTaskRecord>): AiTaskRecord {
  return {
    id: "task_polish",
    projectId: "project_runner",
    chapterId: "chapter_runner",
    taskType: "polish",
    status: "configured",
    selection: null,
    inputText: "萧炎垂下眼，指节慢慢攥紧。",
    instruction: "更有压迫感。",
    presetId: null,
    outputText: null,
    error: null,
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    ...patch
  };
}

describe("AI candidate metadata", () => {
  it("round-trips proofread issues and writing context plan", () => {
    const metadata = {
      proofreadIssues: [
        {
          code: "awkward_expression" as const,
          severity: "medium" as const,
          quote: "雨声里停下脚步",
          locationHint: "选区第 1 句",
          explanation: "语序不自然，主语和动作关系不够清楚。",
          suggestion: "林远听着雨声停下脚步。",
          suggestedReplacement: "林远听着雨声停下脚步。",
          evidence: [
            {
              source: "target" as const,
              quote: "雨声里停下脚步",
              note: "目标文本中的原句"
            }
          ],
          canAutoApply: true,
          needsAuthorJudgment: false
        }
      ],
      writingContextPlan: {
        targetText: "雨声里停下脚步",
        supportingContext: [],
        mode: "direct" as const,
        estimatedInputTokens: 120,
        maxInputTokens: 8000,
        reason: "选区是唯一修改目标"
      }
    };

    expect(parseAiCandidateMetadata(stringifyAiCandidateMetadata(metadata))).toEqual(metadata);
  });

  it("rejects obsolete proofread issue metadata instead of silently converting it", () => {
    expect(() =>
      parseAiCandidateMetadata(
        JSON.stringify({
          proofreadIssues: [
            {
              type: "表达不顺",
              quote: "雨声里停下脚步",
              suggestion: "林远听着雨声停下脚步。",
              reason: "语序更自然"
            }
          ]
        })
      )
    ).toThrow();
  });
});

describe("WritingOperationRunner", () => {
  it("uses Japanese prompts for Japanese inline text inside a Chinese project", async () => {
    const projectId = "project_inline_ja";
    const { db, chapterRepo } = createRunnerRepo(projectId);
    const capturedMessages: string[] = [];
    const runner = new WritingOperationRunner({
      resolveChapterRepo: () => chapterRepo,
      resolveContentLanguage: () => "zh-CN",
      resolveTaskPreset: () => null,
      resolveModelConfig: async () => ({
        apiKey: "sk-or-v1-test",
        modelName: "test/model",
        contextLength: null
      }),
      createClient: () => ({
        async createChatCompletion(input: OpenRouterChatCompletionInput) {
          capturedMessages.push(input.messages.map((message) => message.content).join("\n"));
          expect(input.responseFormat).toEqual({ type: "json_object" });
          return { content: '{"issues":[]}', truncated: false };
        },
        async streamChatCompletion() {
          throw new Error("structured proofread should use bounded non-streaming completion");
        }
      })
    });

    await runner.runRequest({
      projectId,
      source: "chat_tool",
      operation: "proofread",
      target: { kind: "inline_text", text: "彼は扉を開けた。。そして静かに入ったです。" },
      userInstruction: "日本語で校正してください。"
    });

    expect(capturedMessages.join("\n")).toContain("日本語小説執筆オペレーションエージェント");
    expect(capturedMessages.join("\n")).not.toContain("中文小说写作操作 agent");
    db.close();
  });

  it("retries a Chinese Japanese-candidate response and only exposes the corrected text", async () => {
    const projectId = "project_inline_ja_correction";
    const { db, chapterRepo } = createRunnerRepo(projectId);
    const requests: OpenRouterChatCompletionInput[] = [];
    const runner = new WritingOperationRunner({
      resolveChapterRepo: () => chapterRepo,
      resolveContentLanguage: () => "zh-CN",
      resolveTaskPreset: () => null,
      resolveModelConfig: async () => ({
        apiKey: "sk-or-v1-test",
        modelName: "test/model",
        contextLength: null
      }),
      createClient: () => ({
        async createChatCompletion(input: OpenRouterChatCompletionInput) {
          requests.push(input);
          return requests.length === 1
            ? { content: "他在这扇斑驳的木门前停下脚步，从门缝里传来的声音让他更加紧张。", truncated: false }
            : { content: "彼は斑の浮いた木の扉の前で足を止めた。扉の向こうから、かすかな物音が聞こえた。", truncated: false };
        },
        async streamChatCompletion() {
          throw new Error("Japanese candidates must be validated before they are exposed");
        }
      })
    });
    const chunks: string[] = [];

    const result = await runner.runRequest(
      {
        projectId,
        source: "chat_tool",
        operation: "expand",
        target: { kind: "inline_text", text: "彼は古い扉の前で足を止めた。" },
        userInstruction: "情景描写を補ってください。"
      },
      {},
      { onChunk(event) { chunks.push(event.content); } }
    );

    expect(requests).toHaveLength(2);
    expect(requests[1].messages.at(-1)?.content).toContain("直前の候補本文は中国語");
    expect(chunks).toEqual(["彼は斑の浮いた木の扉の前で足を止めた。扉の向こうから、かすかな物音が聞こえた。"]);
    expect(result.generatedText).toContain("扉の向こうから");
    db.close();
  });

  it("stops a structured proofread request after the writing-operation deadline", async () => {
    vi.useFakeTimers();
    const projectId = "project_proofread_deadline";
    const { db, chapterRepo } = createRunnerRepo(projectId);
    const runner = new WritingOperationRunner({
      resolveChapterRepo: () => chapterRepo,
      resolveContentLanguage: () => "zh-CN",
      resolveTaskPreset: () => null,
      resolveModelConfig: async () => ({
        apiKey: "sk-or-v1-test",
        modelName: "test/model",
        contextLength: null
      }),
      createClient: () => ({
        async createChatCompletion() {
          return await new Promise(() => undefined);
        },
        async streamChatCompletion() {
          throw new Error("proofread should not use an unbounded stream");
        }
      })
    });

    const pending = runner.runRequest({
      projectId,
      source: "selection_toolbar",
      operation: "proofread",
      target: { kind: "inline_text", text: "他打开门。。然后走进去。" },
      userInstruction: "检查明显问题。"
    });
    const rejection = expect(pending).rejects.toThrow("60 秒内完成");
    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;
    db.close();
  });

  it("runs selected-text polish with operation skill and context plan", async () => {
    const projectId = "project_runner";
    const chapterId = "chapter_runner";
    const { db, chapterRepo } = createRunnerRepo(projectId);
    chapterRepo.create({
      id: chapterId,
      projectId,
      title: "第3章 客人",
      volumeTitle: null,
      sortOrder: 3,
      contentJson: emptyChapterContent,
      plainText: "众人的目光落在少年身上。\n萧炎垂下眼，指节慢慢攥紧。\n大厅安静下来。",
      wordCount: 38,
      dailyWordCount: 0,
      dailyWordCountDate: null,
      targetWordCount: null,
      status: "draft",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z"
    });

    const capturedMessages: string[] = [];
    const runner = new WritingOperationRunner({
      resolveChapterRepo: () => chapterRepo,
      resolveTaskPreset: () => null,
      resolveModelConfig: async () => ({
        apiKey: "sk-or-v1-test",
        modelName: "test/model",
        contextLength: null
      }),
      createClient: () => ({
        async createChatCompletion(input: OpenRouterChatCompletionInput) {
          capturedMessages.push(input.messages.map((message) => message.content).join("\n"));
          return {
            content: "萧炎缓缓垂下眼，紧攥的指节在袖中一点点泛白。",
            truncated: false
          };
        },
        async streamChatCompletion(input: OpenRouterChatCompletionInput, handlers?: OpenRouterStreamHandlers) {
          capturedMessages.push(input.messages.map((message) => message.content).join("\n"));
          handlers?.onToken?.("萧炎缓缓垂下眼，紧攥的指节在袖中一点点泛白。");
          return {
            content: "萧炎缓缓垂下眼，紧攥的指节在袖中一点点泛白。",
            truncated: false
          };
        }
      })
    });

    const result = await runner.generateStream(
      createTask({
        projectId,
        chapterId,
        selection: {
          chapterId,
          from: 1,
          to: 2,
          text: "萧炎垂下眼，指节慢慢攥紧。",
          paragraphIds: ["p1"],
          createdAt: "2026-04-30T00:00:00.000Z",
          selectionHash: "hash_selected"
        }
      }),
      {}
    );

    expect(result.generatedText).toBe("萧炎缓缓垂下眼，紧攥的指节在袖中一点点泛白。");
    expect(result.contextPlan.targetText).toBe("萧炎垂下眼，指节慢慢攥紧。");
    expect(result.contextPlan.supportingContext.map((item) => item.content).join("\n")).toContain("众人的目光落在少年身上");
    expect(capturedMessages.join("\n")).toContain("中文小说润色");
    expect(capturedMessages.join("\n")).toContain("参考上下文不能作为改写目标");

    db.close();
  });

  it("streams chat-tool writing operations instead of using a blocking completion", async () => {
    const projectId = "project_runner_stream_request";
    const { db, chapterRepo } = createRunnerRepo(projectId);
    let usedCreateCompletion = false;
    let usedStreamCompletion = false;
    const runner = new WritingOperationRunner({
      resolveChapterRepo: () => chapterRepo,
      resolveTaskPreset: () => null,
      resolveModelConfig: async () => ({
        apiKey: "sk-or-v1-test",
        modelName: "test/model",
        contextLength: null
      }),
      createClient: () => ({
        async createChatCompletion() {
          usedCreateCompletion = true;
          throw new Error("chat-tool writing operations should use streamChatCompletion");
        },
        async streamChatCompletion(input: OpenRouterChatCompletionInput, handlers?: OpenRouterStreamHandlers) {
          usedStreamCompletion = true;
          handlers?.onToken?.("萧炎缓缓垂下眼，紧攥的指节在袖中一点点泛白。");
          expect(input.messages.map((message) => message.content).join("\n")).toContain("中文小说润色");
          return {
            content: "萧炎缓缓垂下眼，紧攥的指节在袖中一点点泛白。",
            truncated: false
          };
        }
      })
    });

    const streamedTokens: string[] = [];
    const result = await runner.runRequest(
      {
        projectId,
        source: "chat_tool",
        operation: "polish",
        target: {
          kind: "inline_text",
          text: "萧炎垂下眼，指节慢慢攥紧。"
        },
        userInstruction: "更有压迫感。"
      },
      {},
      {
        onChunk(event) {
          streamedTokens.push(event.content);
        }
      }
    );

    expect(usedCreateCompletion).toBe(false);
    expect(usedStreamCompletion).toBe(true);
    expect(streamedTokens.join("")).toBe("萧炎缓缓垂下眼，紧攥的指节在袖中一点点泛白。");
    expect(result.generatedText).toContain("萧炎缓缓垂下眼");

    db.close();
  });

  it("forwards reasoning chunks for chat-tool writing operations", async () => {
    const projectId = "project_runner_stream_reasoning";
    const { db, chapterRepo } = createRunnerRepo(projectId);
    let capturedReasoning: OpenRouterChatCompletionInput["reasoning"] | undefined;
    const runner = new WritingOperationRunner({
      resolveChapterRepo: () => chapterRepo,
      resolveTaskPreset: () => null,
      resolveModelConfig: async () => ({
        apiKey: "sk-or-v1-test",
        modelName: "test/model",
        contextLength: null
      }),
      createClient: () => ({
        async createChatCompletion() {
          throw new Error("chat-tool writing operations should use streamChatCompletion");
        },
        async streamChatCompletion(input: OpenRouterChatCompletionInput, handlers?: OpenRouterStreamHandlers) {
          capturedReasoning = input.reasoning;
          handlers?.onReasoning?.("先判断润色目标和边界。");
          handlers?.onToken?.("萧炎缓缓垂下眼，紧攥的指节在袖中一点点泛白。");
          return {
            content: "萧炎缓缓垂下眼，紧攥的指节在袖中一点点泛白。",
            truncated: false
          };
        }
      })
    });

    const streamedReasoning: string[] = [];
    const result = await runner.runRequest(
      {
        projectId,
        source: "chat_tool",
        operation: "polish",
        target: {
          kind: "inline_text",
          text: "萧炎垂下眼，指节慢慢攥紧。"
        },
        userInstruction: "更有压迫感。"
      },
      {},
      {
        onReasoning(event) {
          streamedReasoning.push(event.content);
        }
      }
    );

    expect(capturedReasoning).not.toMatchObject({ exclude: true });
    expect(streamedReasoning).toEqual(["先判断润色目标和边界。"]);
    expect(result.generatedText).toContain("萧炎缓缓垂下眼");

    db.close();
  });

  it("continues a truncated candidate through the same writing operation context", async () => {
    const projectId = "project_runner_continue";
    const chapterId = "chapter_runner_continue";
    const { db, chapterRepo } = createRunnerRepo(projectId);
    chapterRepo.create({
      id: chapterId,
      projectId,
      title: "第3章 客人",
      volumeTitle: null,
      sortOrder: 3,
      contentJson: emptyChapterContent,
      plainText: "众人的目光落在少年身上。\n萧炎垂下眼，指节慢慢攥紧。\n大厅安静下来。",
      wordCount: 38,
      dailyWordCount: 0,
      dailyWordCountDate: null,
      targetWordCount: null,
      status: "draft",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z"
    });
    const capturedMessages: string[] = [];
    const streamedTokens: string[] = [];
    const runner = new WritingOperationRunner({
      resolveChapterRepo: () => chapterRepo,
      resolveTaskPreset: () => null,
      resolveModelConfig: async () => ({
        apiKey: "sk-or-v1-test",
        modelName: "test/model",
        contextLength: null
      }),
      createClient: () => ({
        async createChatCompletion() {
          throw new Error("continuation should use the writing operation stream path");
        },
        async streamChatCompletion(input: OpenRouterChatCompletionInput, handlers?: OpenRouterStreamHandlers) {
          capturedMessages.push(input.messages.map((message) => message.content).join("\n"));
          handlers?.onToken?.("紧攥的指节在袖中一点点泛白。");
          return {
            content: "紧攥的指节在袖中一点点泛白。",
            truncated: false
          };
        }
      })
    });

    const result = await runner.continueStream(
      createTask({
        projectId,
        chapterId,
        selection: {
          chapterId,
          from: 1,
          to: 2,
          text: "萧炎垂下眼，指节慢慢攥紧。",
          paragraphIds: ["p1"],
          createdAt: "2026-04-30T00:00:00.000Z",
          selectionHash: "hash_selected"
        }
      }),
      "萧炎缓缓垂下眼，",
      {
        onChunk(event) {
          streamedTokens.push(event.content);
        }
      }
    );

    expect(result.generatedText).toBe("萧炎缓缓垂下眼，紧攥的指节在袖中一点点泛白。");
    expect(capturedMessages.join("\n")).toContain("中文小说润色");
    expect(capturedMessages.join("\n")).toContain("上一次输出已被截断");
    expect(streamedTokens.join("")).toBe("紧攥的指节在袖中一点点泛白。");

    db.close();
  });
});
