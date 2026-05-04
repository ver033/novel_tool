import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = join(__dirname, "../..");

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("Proofread V2 UI", () => {
  it("renders V2 proofread metadata instead of legacy issue fields", () => {
    const currentTask = readSource("src/renderer/sidebar/CurrentTaskTab.tsx");

    expect(currentTask).toContain("proofreadIssueLabels");
    expect(currentTask).toContain("needsAuthorJudgment");
    expect(currentTask).toContain("canAutoApply");
    expect(currentTask).not.toContain("formatProofreadConfidence");
    expect(currentTask).not.toContain("置信度");
    expect(currentTask).not.toContain("置信依据");
    expect(currentTask).not.toContain("confidenceRationale");
    expect(currentTask).toContain("evidence");
    expect(currentTask).toContain("suggestedReplacement");
    expect(currentTask).toContain("proofread-clean-state");
    expect(currentTask).toContain("proofread-issue-card");
    expect(currentTask).toContain("proofread-issue-primary");
    expect(currentTask).toContain("issue-meta-row");
    expect(currentTask).not.toContain("issue.type");
    expect(currentTask).not.toContain("issue.reason");
    expect(currentTask).not.toContain("apply_proofread_suggestion");
    expect(currentTask).not.toContain("可自动应用");
  });

  it("keeps the live OpenRouter acceptance proofread schema aligned with V2 metadata", () => {
    const liveAcceptance = readSource("scripts/live-v1-openrouter-acceptance.mjs");

    expect(liveAcceptance).toContain('"code"');
    expect(liveAcceptance).toContain('"needsAuthorJudgment"');
    expect(liveAcceptance).not.toContain('"confidence"');
    expect(liveAcceptance).not.toContain("confidence:");
  });

  it("keeps default task instructions subordinate to the main writing skills", () => {
    const currentTask = readSource("src/renderer/sidebar/CurrentTaskTab.tsx");

    expect(currentTask).toContain("按原文风格轻量润色");
    expect(currentTask).toContain("可替换原选区的完整版本");
    expect(currentTask).toContain("按校对规则检查明确问题");
    expect(currentTask).toContain("插入选区下方的新正文");
    expect(currentTask).not.toContain("更文雅一些");
    expect(currentTask).not.toContain("请补充环境和心理细节");
    expect(currentTask).not.toContain("请检查错别字、病句、重复表达和表达不顺");
  });

  it("styles evidence and diagnostic badges for compact sidebar reading", () => {
    const css = readSource("src/renderer/styles/globals.css");

    expect(css).toContain(".issue-evidence-list");
    expect(css).toContain(".proofread-issue-card");
    expect(css).toContain(".proofread-issue-primary");
    expect(css).toContain(".issue-meta-row");
    expect(css).toContain(".mini-tag.subtle");
    expect(css).toContain(".mini-tag.warning");
  });

  it("uses icon-only copy controls for AI candidates and proofread results", () => {
    const currentTask = readSource("src/renderer/sidebar/CurrentTaskTab.tsx");

    expect(currentTask).toContain("CopySimple");
    expect(currentTask).toContain("Check");
    expect(currentTask).toContain("copyGeneratedCandidate");
    expect(currentTask).toContain("copyAllProofreadIssues");
    expect(currentTask).toContain('label="复制候选正文"');
    expect(currentTask).toContain('label="复制全部校对结果"');
    expect(currentTask).toContain('label="复制这条校对建议"');
    expect(currentTask).not.toContain(">复制建议</button>");
  });
});
