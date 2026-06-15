import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsService } from "../../src/main/settings/settings-service";

const axiosPost = vi.hoisted(() => vi.fn());

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    post: axiosPost
  }
}));

import { createOpenRouterChapterReviewClient } from "../../src/main/chapter-review/chapter-review-service";

describe("createOpenRouterChapterReviewClient", () => {
  beforeEach(() => {
    axiosPost.mockReset();
  });

  it("uses throughput routing without strict parameter filtering", async () => {
    axiosPost.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "本章可读。",
                readabilityScore: 4,
                aiToneRisk: "none",
                issues: []
              })
            }
          }
        ]
      }
    });
    const settingsService = {
      async getOpenRouterConfigWithModelMetadata() {
        return {
          apiKey: "sk-or-v1-test-key",
          baseUrl: "https://openrouter.ai/api/v1",
          modelName: "deepseek/deepseek-v3.2",
          contextLength: 64_000,
          supportsTools: null
        };
      }
    } as unknown as SettingsService;

    const client = await createOpenRouterChapterReviewClient(settingsService);
    await client.review({
      projectName: "斗破测试",
      chapterTitle: "第五十章",
      chapterOrder: 50,
      chunkIndex: 0,
      chunkCount: 1,
      chapterText: "萧炎推门而入。",
      nearbyContext: ""
    });

    const body = axiosPost.mock.calls[0]?.[1] as { readonly provider?: Record<string, unknown> };

    expect(body.provider).toMatchObject({ sort: "throughput" });
    expect(body.provider).not.toHaveProperty("require_parameters");
  });
});
