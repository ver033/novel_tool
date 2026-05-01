import { describe, expect, it } from "vitest";
import { parseChatMessageBlocks } from "../../src/renderer/sidebar/chat-message-format";

describe("chat message formatting", () => {
  it("turns markdown-like AI answers into structured blocks", () => {
    expect(
      parseChatMessageBlocks(["**核心润色：**", "1. 增强画面感", "2. 优化节奏", "", "请告诉我偏好。"].join("\n"))
    ).toEqual([
      {
        type: "heading",
        text: "核心润色："
      },
      {
        type: "orderedList",
        items: ["增强画面感", "优化节奏"]
      },
      {
        type: "paragraph",
        text: "请告诉我偏好。"
      }
    ]);
  });

  it("highlights polished candidate text as a draft block", () => {
    expect(parseChatMessageBlocks("【润色稿】\n他在雨声里停步，掌心的旧伤隐隐发烫。")).toEqual([
      {
        type: "draft",
        label: "润色稿",
        text: "他在雨声里停步，掌心的旧伤隐隐发烫。"
      }
    ]);
  });
});
