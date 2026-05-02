import { describe, expect, it } from "vitest";
import {
  bookAiSummaryPayloadSchema,
  chapterAiSummaryPayloadSchema,
  computeChapterContentHash,
  computeSourceHash,
  summaryJobStatusSchema,
  summaryStatusSchema
} from "../../src/main/shared/summary-index";

const validChapterPayload = {
  oneLine: "少年在测试中失利，承受众人的嘲讽。",
  synopsis: "本章围绕萧炎的斗气测试展开，展现他跌落天才光环后的处境。",
  keyEvents: ["萧炎斗之力测试结果为三段", "广场众人议论并嘲讽他"],
  characterMentions: [
    {
      name: "萧炎",
      roleInChapter: "测试失败的少年主角",
      stateOrChange: "从昔日天才变成被嘲笑的低级修炼者"
    }
  ],
  relationshipHints: ["族人对萧炎的态度冷淡且带有轻视"],
  timeAndPlace: ["萧家测试广场"],
  foreshadowingHints: ["萧炎异常跌落的原因尚未解释"],
  unresolvedQuestions: ["萧炎为何从天才变成斗之力三段"],
  emotionalArc: "从强忍平静到苦涩自嘲。",
  importantQuotes: ["斗之力，三段！"]
};

describe("summary index schemas", () => {
  it("accepts a complete structured chapter summary payload", () => {
    expect(chapterAiSummaryPayloadSchema.parse(validChapterPayload)).toEqual(validChapterPayload);
  });

  it("rejects empty required chapter summary fields", () => {
    expect(() =>
      chapterAiSummaryPayloadSchema.parse({
        ...validChapterPayload,
        oneLine: ""
      })
    ).toThrow();
  });

  it("accepts book summary coverage with stale, missing, and skipped chapter ids", () => {
    const payload = {
      coverage: {
        totalChapterCount: 4,
        indexedChapterCount: 2,
        staleChapterIds: ["chapter_stale"],
        missingChapterIds: ["chapter_missing"],
        skippedTooShortChapterIds: ["chapter_short"]
      },
      synopsis: "全书当前围绕少年失势后的处境展开。",
      mainPlot: ["萧炎在家族测试中暴露修炼低谷"],
      majorCharacters: [{ name: "萧炎", summary: "主角，当前处于低谷。" }],
      majorConflicts: ["萧炎与家族评价之间的冲突"],
      relationshipChanges: ["族人对萧炎的尊重下降"],
      foreshadowingHints: ["修为倒退原因未揭示"],
      unresolvedQuestions: ["萧炎能否恢复实力"]
    };

    expect(bookAiSummaryPayloadSchema.parse(payload)).toEqual(payload);
  });

  it("rejects unknown summary and job statuses", () => {
    expect(() => summaryStatusSchema.parse("queued")).toThrow();
    expect(() => summaryJobStatusSchema.parse("stale")).toThrow();
  });

  it("computes a stable chapter content hash across CRLF and LF text", () => {
    expect(computeChapterContentHash("第一段\r\n\r\n第二段\n")).toBe(computeChapterContentHash("第一段\n\n第二段"));
  });

  it("computes source hashes from ordered child hashes", () => {
    const first = computeSourceHash(["chapter_1:aaa", "chapter_2:bbb"]);
    const second = computeSourceHash(["chapter_2:bbb", "chapter_1:aaa"]);

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
  });
});
