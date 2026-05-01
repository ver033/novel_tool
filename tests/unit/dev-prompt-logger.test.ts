import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { logDevLlmPrompt, shouldLogDevLlmPrompt } from "../../src/main/ai/dev-prompt-logger";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("dev LLM prompt logging", () => {
  it("logs full OpenRouter messages only in development or explicit prompt-log mode", () => {
    expect(shouldLogDevLlmPrompt({ NODE_ENV: "production" })).toBe(false);
    expect(shouldLogDevLlmPrompt({ NODE_ENV: "test" })).toBe(false);
    expect(shouldLogDevLlmPrompt({ NODE_ENV: "development" })).toBe(true);
    expect(shouldLogDevLlmPrompt({ NODE_ENV: "production", NOVEL_TOOL_LOG_LLM_PROMPTS: "1" })).toBe(true);
    expect(shouldLogDevLlmPrompt({ NODE_ENV: "development", NOVEL_TOOL_LOG_LLM_PROMPTS: "0" })).toBe(false);

    const info = vi.fn();
    logDevLlmPrompt(
      {
        kind: "chat",
        messages: [
          { role: "system", content: "你是中文小说写作助手。" },
          { role: "user", content: "当前章节：第三章\n当前章节节选：\n第三章完整正文" }
        ],
        meta: {
          chapterId: "chapter_3",
          projectId: "project_1",
          sessionId: "chat_1"
        },
        modelName: "openai/gpt-5.2",
        params: {
          maxCompletionTokens: 4096,
          temperature: 0.55
        }
      },
      { info },
      { NODE_ENV: "development" }
    );

    expect(info).toHaveBeenCalledTimes(1);
    const output = String(info.mock.calls[0][0]);
    expect(output).toContain("[MoShu Dev LLM Prompt] chat");
    expect(output).toContain("model: openai/gpt-5.2");
    expect(output).toContain("chapter_3");
    expect(output).toContain("1. system:");
    expect(output).toContain("2. user:");
    expect(output).toContain("当前章节：第三章");
    expect(output).toContain("第三章完整正文");
    expect(output).not.toContain("sk-or-v1-secret");
  });

  it("wires dev prompt logging into writing operations, continuation, and AI chat OpenRouter generators", () => {
    const taskGenerator = readSource("src/main/ai/openrouter-task-generator.ts");
    const writingOperationRunner = readSource("src/main/ai/writing-operation-runner.ts");
    const chatGenerator = readSource("src/main/ai/openrouter-chat-generator.ts");

    expect(writingOperationRunner).toContain("logDevLlmPrompt");
    expect(writingOperationRunner).toContain("writing-operation:${operation.id}");
    expect(writingOperationRunner).toContain("taskId: task.id");
    expect(writingOperationRunner).toContain("chapterId: task.chapterId");
    expect(writingOperationRunner).toContain('kind: `writing-operation:${operation.id}:continue`');
    expect(taskGenerator).toContain("this.runner.continueStream");
    expect(chatGenerator).toContain("logDevLlmPrompt");
    expect(chatGenerator).toContain('kind: "chat"');
    expect(chatGenerator).toContain("projectId: input.projectId");
    expect(chatGenerator).toContain("chapterId: input.chapterId");
    expect(chatGenerator).toContain("sessionId: input.sessionId");
  });

  it("uses the shared chat token budget for chat OpenRouter requests", () => {
    const chatGenerator = readSource("src/main/ai/openrouter-chat-generator.ts");

    expect(chatGenerator).toContain('getTokenBudget("chat")');
    expect(chatGenerator).toContain("chatBudget.maxOutputTokens");
    expect(chatGenerator).not.toContain("maxCompletionTokens: 1600");
  });
});
