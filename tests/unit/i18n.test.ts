import { describe, expect, it } from "vitest";
import { translate } from "../../src/renderer/i18n";
import { needsJapaneseResponseCorrection, resolveInlineContentLanguage, resolveResponseLanguage } from "../../src/main/shared/language";

describe("renderer i18n", () => {
  it("translates the primary writing workflow into Japanese", () => {
    expect(translate("ja-JP", "newProject")).toBe("新しいプロジェクト");
    expect(translate("ja-JP", "importNovel")).toBe("小説をインポート");
    expect(translate("ja-JP", "aiChat")).toBe("AI チャット");
    expect(translate("ja-JP", "chapterGoalReached")).toContain("目標を達成");
    expect(translate("ja-JP", "agentProcessSummary", { count: 3 })).toBe("3 件のツール実行");
    expect(translate("ja-JP", "agentTaskProgress")).toBe("タスク進捗");
  });

  it("keeps Simplified Chinese as the default catalog", () => {
    expect(translate("zh-CN", "newProject")).toBe("新建项目");
    expect(translate("zh-CN", "aiChat")).toBe("AI 对话");
  });

  it("interpolates localized values without exposing placeholders", () => {
    expect(translate("ja-JP", "importResult", { name: "雪国", count: 3 })).toBe("『雪国』へ 3 章をインポートしました。");
  });

  it("uses the question language without mistaking manuscript-language words for a reply instruction", () => {
    expect(resolveResponseLanguage("この中文小説の人物関係を分析して", "zh-CN")).toBe("ja-JP");
    expect(resolveResponseLanguage("这段日语是什么意思？", "zh-CN")).toBe("zh-CN");
    expect(resolveResponseLanguage("この段落を中国語に翻訳してください", "ja-JP")).toBe("zh-CN");
    expect(resolveResponseLanguage("这个用日本語で回答してください", "zh-CN")).toBe("ja-JP");
  });

  it("only flags high-confidence Chinese-first answers for Japanese correction", () => {
    expect(needsJapaneseResponseCorrection("下面是第一章的总结，主要讲述了人物的成长。")).toBe(true);
    expect(needsJapaneseResponseCorrection("第一章では、主人公の成長過程を要約します。")).toBe(false);
    expect(needsJapaneseResponseCorrection("中国語の原文「下面是第一章」を引用します。")).toBe(false);
  });

  it("uses inline manuscript text before the project fallback language", () => {
    expect(resolveInlineContentLanguage("彼は扉を開けた。そして静かに入った。", "zh-CN")).toBe("ja-JP");
    expect(resolveInlineContentLanguage("他打开门，然后安静地走了进去。", "zh-CN")).toBe("zh-CN");
    expect(resolveInlineContentLanguage("", "ja-JP")).toBe("ja-JP");
  });
});
