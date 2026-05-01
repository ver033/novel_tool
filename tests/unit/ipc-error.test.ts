import { describe, expect, it } from "vitest";
import { formatIpcErrorMessage } from "../../src/renderer/state/ipc-error";

describe("formatIpcErrorMessage", () => {
  it("removes Electron IPC transport wrappers and handler stacks while keeping the real provider error", () => {
    const wrapped = new Error(
      [
        "Error invoking remote method 'novelTool:ai:generatePreview': Error: OpenRouter 请求失败 (429)：Provider returned error",
        "Error occurred in handler for 'novelTool:ai:generatePreview': Error: OpenRouter 请求失败 (429)：Provider returned error",
        "    at AiTaskService.generatePreview (/app/.vite/build/index.js:129:10)"
      ].join("\n")
    );

    expect(formatIpcErrorMessage(wrapped, "生成预览失败")).toBe("OpenRouter 请求失败 (429)：Provider returned error");
  });

  it("removes handler-only Electron error wrappers and stack frames", () => {
    const wrapped = new Error(
      [
        "Error occurred in handler for 'novelTool:ai:sendChatMessageStream': Error: OpenRouter 请求失败 (429)：provider returned an error",
        "    at sanitizeIpcError (/app/.vite/build/index.js:29874:37)",
        "    at async Session.<anonymous> (node:electron/js2c/browser_init:2:116462)"
      ].join("\n")
    );

    expect(formatIpcErrorMessage(wrapped, "AI 对话失败")).toBe("OpenRouter 请求失败 (429)：provider returned an error");
  });
});
