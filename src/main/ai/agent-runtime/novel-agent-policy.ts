import { buildChatAgentMemoryText } from "../chat-agent-memory";
import { estimateTextTokens } from "../token-estimator";
import type { TokenBudget } from "../token-budget";
import { proofreadIssueLabels, proofreadIssueLabelsJa, type ProofreadIssueCode } from "../../shared/proofread";
import type { ContentLanguage } from "../../shared/language";
import type { AiContextIndexMode, TaskType } from "../../shared/types";
import type { NovelAgentDirectoryItem, NovelAgentRunInput, NovelAgentToolDefinition } from "./novel-agent-runtime";

export const NOVEL_AGENT_MAX_TURNS = 8;

export type NovelAgentContextStatus = {
  readonly contextMode: "direct" | "summarized" | "mixed";
  readonly scopeLabel: string;
  readonly indexMode?: AiContextIndexMode;
  readonly indexedChapterCount?: number;
  readonly totalChapterCount?: number;
  readonly staleChapterCount?: number;
  readonly skippedTooShortChapterCount?: number;
};

const japaneseToolDescriptions: Readonly<Record<string, string>> = {
  get_project_context: "現在のプロジェクトの章数、開いている章、選択範囲の有無を取得します。",
  list_chapters: "現在のプロジェクトの章一覧、順序、文字数、開いている章を取得します。",
  read_chapters:
    "指定した章または章範囲の原文・要約を読みます。要約、人物、伏線、設定、整合性について答える前に、根拠となる範囲をこのツールで読んでください。",
  read_selection: "エディターの選択範囲を読みます。ユーザーが本文を直接貼った場合は inlineText にそのまま渡します。",
  run_writing_operation:
    "小説本文の推敲、加筆、校正、続きを執筆します。作者がこれらを明示的に依頼した場合は必ずこのツールを使い、最終回答だけで代替しないでください。候補または校正指摘だけを生成し、本文を直接上書きしません。",
  check_continuity: "章の要約キャッシュに基づき、時系列、人物認識、状態、設定、因果、伏線の整合性を確認します。",
  add_to_scratchpad: "整理済みの要約、着想、設定、素材を下書きメモへ保存します。作者が明示的に保存を求めた場合だけ使います。"
};

export function localizeNovelAgentTools(
  tools: readonly NovelAgentToolDefinition[],
  language: ContentLanguage
): readonly NovelAgentToolDefinition[] {
  if (language !== "ja-JP") {
    return tools;
  }
  return tools.map((tool) => ({
    ...tool,
    description: japaneseToolDescriptions[tool.name] ?? tool.description
  }));
}

function contentLanguageLabel(language: ContentLanguage, responseLanguage: ContentLanguage): string {
  if (responseLanguage === "ja-JP") {
    return language === "ja-JP" ? "日本語" : "中国語";
  }
  return language === "ja-JP" ? "日语" : "中文";
}

export function buildNovelAgentSystemPrompt(responseLanguage: ContentLanguage, contentLanguage: ContentLanguage = responseLanguage): string {
  if (responseLanguage === "ja-JP") {
    return [
      contentLanguage === "ja-JP"
        ? "あなたは墨枢の日本語小説執筆エージェントです。長編小説を書く作者を支援します。"
        : "あなたは墨枢の小説執筆エージェントです。作者への説明と最終回答は日本語で行ってください。",
      `作品本文の言語は${contentLanguageLabel(contentLanguage, responseLanguage)}です。本文の推敲・加筆・校正・続きを執筆する場合は、作者が明示的に別言語を指定しない限り、この作品言語を維持してください。`,
      "ツール結果、作者が現在のメッセージに貼り付けた本文、システムが提示したプロジェクト文脈だけを信頼できる本文根拠として扱ってください。読んでいない章の内容を捏造してはいけません。",
      "依頼ごとに、手元の文脈だけで回答できるか、追加の章・選択範囲・整合性確認・執筆操作が必要かを判断してください。必要なツールだけを選び、固定された順序で呼び出してはいけません。作者が推敲・加筆・校正・続きを書くことを明示的に依頼した場合は、最終回答で直接処理せず、必ず run_writing_operation を使い、operation は polish、expand、proofread、continue のいずれかにしてください。要約、分析、検索、比較、情報抽出、プロット、人物表、設定表、年表、形式変換を無理にこの四種類へ分類してはいけません。",
      "複数の独立した手順がある、または長時間かかると判断した依頼では、task_create と task_update で作業項目を必ず可視化してください。直接回答や単一のツール呼び出しではタスクを作成しないでください。作成したタスクは作業開始時と完了時に更新してください。",
      "対象は selection、inline_text、chapter、chapter_range で正確に指定します。本文がメッセージ内に貼られている場合は、省略や言い換えをせず inline_text.text にそのまま入れてください。",
      "要約、人物分析、筋書き分析、伏線、設定、整合性への回答は、必要な章範囲を先に read_chapters または check_continuity で確認してください。",
      "expand は対象を含む完全な加筆版で置き換える操作です。continue は対象の後ろへ追加する新規本文だけを返す操作です。",
      "本文を直接上書きしてはいけません。候補は作者が確認できる形で提示し、校正は問題点と修正案を提示します。",
      "下書きメモへの保存は、作者が明示的に求めた場合だけ add_to_scratchpad を使ってください。",
      "ツールが失敗した場合、同じ呼び出しを繰り返さず、理由と次の選択肢を簡潔な日本語で説明してください。",
      "ユーザーに見せる進捗説明、ツールの要約、最終回答はすべて日本語に統一し、中国語の推論文や途中メモを出力してはいけません。",
      "最終回答は日本語で、簡潔かつ具体的にしてください。"
    ].join("\n");
  }

  return [
    contentLanguage === "zh-CN"
      ? "你是墨枢的中文小说写作 agent，服务对象是正在写长篇中文小说的作者。"
      : "你是墨枢的小说写作 agent。请使用中文向作者解释并给出最终回答。",
    `作品正文语言是${contentLanguageLabel(contentLanguage, responseLanguage)}。执行润色、扩写、校对或续写时，除非作者明确指定其他语言，否则必须保持作品正文语言。`,
    "工具结果、作者当前消息里直接粘贴的正文、系统提供的项目上下文才是可靠的正文来源。不要伪造未读取的章节内容。",
    "每次根据请求自主判断现有上下文是否足够，以及是否需要读取章节、读取选区、检查连续性或执行写作操作。只调用必要的工具，不要按固定顺序调用。作者明确要求润色、扩写、校对或续写时，不要直接在最终回答中处理，必须调用 run_writing_operation，operation 分别使用 polish、expand、proofread、continue；不要把总结、分析、查询、比对、信息提取、大纲、人物卡、设定卡、时间线或格式转换强行归入这四类。",
    "当你判断请求包含多个独立步骤或预计耗时较长时，必须使用 task_create 和 task_update 展示工作项。直接回答或单次工具调用不要创建任务；创建后应在开始和完成时更新状态。",
    "目标必须准确使用 selection、inline_text、chapter 或 chapter_range。用户在消息里粘贴正文时，把正文原样放入 inline_text.text，不要省略或改写。",
    "回答总结、人物、剧情、伏笔、设定或连续性问题前，先用 read_chapters 或 check_continuity 读取必要范围。",
    "扩写是包含原目标含义的完整替换版；续写只返回插入目标之后的新增正文。",
    "不要直接写回正文。正文修改只生成由作者确认的候选；校对只列问题和修改建议。",
    "只有作者明确要求保存到草稿纸时，才调用 add_to_scratchpad。",
    "工具失败后不要反复调用同一失败工具；用简洁中文说明原因和下一步。",
    "面向用户的进度说明、工具摘要和最终回答必须统一使用中文，不要输出其他语言的推理草稿或中间笔记。",
    "最终回答要简洁、具体、可执行。"
  ].join("\n");
}

function formatChapterDirectory(chapters: readonly NovelAgentDirectoryItem[], language: ContentLanguage): string {
  if (chapters.length === 0) {
    return language === "ja-JP" ? "（このプロジェクトには章がありません）" : "（当前项目没有章节）";
  }

  const maxInlineChapters = 160;
  const listed = chapters.length > maxInlineChapters ? [...chapters.slice(0, 80), ...chapters.slice(-80)] : chapters;
  const lines = listed.map((chapter) => {
    const marker = chapter.current ? (language === "ja-JP" ? " | 現在開いている章" : " | 当前打开") : "";
    const countLabel = language === "ja-JP" ? "文字数" : "字数";
    return `${chapter.ordinal}. ${chapter.title} | id=${chapter.id} | ${countLabel}=${chapter.wordCount}${marker}`;
  });

  if (listed.length === chapters.length) {
    return lines.join("\n");
  }
  return [
    language === "ja-JP"
      ? `全 ${chapters.length} 章のうち、文脈量を抑えるため先頭80章と末尾80章だけを表示します。`
      : `项目实际共有 ${chapters.length} 章。为控制上下文，只列出前80章和后80章。`,
    ...lines
  ].join("\n");
}

export function buildNovelAgentUserPrompt(
  input: NovelAgentRunInput,
  budget: TokenBudget,
  language: ContentLanguage,
  contentLanguage: ContentLanguage = input.contentLanguage ?? language
): string {
  const memory = buildChatAgentMemoryText({
    history: input.history,
    tokenBudget: budget,
    compactedSummary: input.compactedMemorySummary,
    compactedThroughMessageId: input.compactedMemoryThroughMessageId
  });
  if (language === "ja-JP") {
    return [
      "ユーザーの依頼:",
      input.message,
      "",
      `作品本文の言語: ${contentLanguageLabel(contentLanguage, language)}`,
      "回答言語: 日本語",
      `現在開いている章: ${input.currentChapterTitle ?? input.chapterId ?? "なし"}`,
      input.selectionText?.trim() ? "現在、エディターに選択範囲があります。" : "現在、エディターに選択範囲はありません。",
      "",
      "章一覧:",
      formatChapterDirectory(input.chapterDirectory, language),
      "",
      "直近の会話メモ（依頼意図の理解専用。本文根拠ではありません）:",
      memory
    ].join("\n");
  }
  return [
    "用户问题：",
    input.message,
    "",
    `作品正文语言：${contentLanguageLabel(contentLanguage, language)}`,
    "回答语言：中文",
    `当前打开章节：${input.currentChapterTitle ?? input.chapterId ?? "无"}`,
    input.selectionText?.trim() ? "当前有编辑器选区。" : "当前没有编辑器选区。",
    "",
    "章节目录：",
    formatChapterDirectory(input.chapterDirectory, language),
    "",
    "最近对话记忆（只用于理解追问和任务意图，不是正文来源）：",
    memory
  ].join("\n");
}

export function isProofreadRequest(message: string): boolean {
  return /(校对|审校|纠错|错别字|病句|校正|誤字|脱字|文法|表記ゆれ|整合性を確認)/u.test(message);
}

export function explicitlyRequestsWritingOperation(message: string): boolean {
  const normalized = message.replace(/\s+/gu, "");
  const positiveIntent = normalized
    .replace(/(?:不要|不用|别|无需|不需要|不能|禁止|避免|不是|并非).{0,12}(?:润色|改写|扩写|续写|校对|校正)/gu, "")
    .replace(/(?:推敲|加筆|校正|続きを書|続きを執筆|リライト).{0,12}(?:しない|不要|ではない)/gu, "");
  return /(润色|润一下|改写|扩写|续写|校对|审校|纠错|校正|推敲|加筆|誤字|脱字|文法|表記ゆれ|続きを書|続きを執筆|リライト|書き直)/u.test(positiveIntent);
}

export function userRequestedScratchpad(message: string): boolean {
  const normalized = message.replace(/\s+/g, "");
  return (
    /(草稿纸|草稿|素材)/u.test(normalized) && /(加入|保存|存到|放到|记录)/u.test(normalized)
  ) || (
    /(下書きメモ|下書き|メモ|素材)/u.test(normalized) && /(追加|保存|入れて|記録|残して)/u.test(normalized)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function operationTitle(operation: unknown, language: ContentLanguage): string {
  const titles: Record<TaskType, readonly [string, string]> = {
    polish: ["润色稿", "推敲案"],
    expand: ["扩写稿", "加筆案"],
    proofread: ["校对结果", "校正結果"],
    continue: ["续写稿", "続きの本文"]
  };
  const type: TaskType = operation === "expand" || operation === "proofread" || operation === "continue" ? operation : "polish";
  return titles[type][language === "ja-JP" ? 1 : 0];
}

function proofreadIssueTitle(code: unknown, language: ContentLanguage): string {
  if (typeof code !== "string" || !(code in proofreadIssueLabels)) {
    return language === "ja-JP" ? "校正指摘" : "校对问题";
  }
  const issueCode = code as ProofreadIssueCode;
  return language === "ja-JP" ? proofreadIssueLabelsJa[issueCode] : proofreadIssueLabels[issueCode];
}

export function formatWritingOperationToolResult(content: string, language: ContentLanguage): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  if (parsed.outputKind === "candidate_text" && typeof parsed.generatedText === "string" && parsed.generatedText.trim()) {
    return `【${operationTitle(parsed.operation, language)}】\n${parsed.generatedText.trim()}`;
  }
  if (parsed.outputKind !== "proofread_issues" || !Array.isArray(parsed.proofreadIssues)) {
    return null;
  }
  if (parsed.proofreadIssues.length === 0) {
    return language === "ja-JP" ? "【校正結果】\n明確な問題は見つかりませんでした。" : "【校对结果】\n未发现明确问题。";
  }
  const lines = parsed.proofreadIssues.map((issue, index) => {
    if (!isRecord(issue)) {
      return `${index + 1}. ${String(issue)}`;
    }
    if (language === "ja-JP") {
      return [
        `### ${index + 1}. ${proofreadIssueTitle(issue.code, language)}`,
        typeof issue.quote === "string" ? `- **原文**: ${issue.quote}` : null,
        typeof issue.suggestion === "string" ? `- **修正案**: ${issue.suggestion}` : null,
        typeof issue.explanation === "string" ? `- **説明**: ${issue.explanation}` : null,
        issue.needsAuthorJudgment === true ? "- **作者の判断が必要**: はい" : null
      ].filter(Boolean).join("\n");
    }
    return [
      `### ${index + 1}. ${proofreadIssueTitle(issue.code, language)}`,
      typeof issue.quote === "string" ? `- **原文**：${issue.quote}` : null,
      typeof issue.suggestion === "string" ? `- **建议**：${issue.suggestion}` : null,
      typeof issue.explanation === "string" ? `- **说明**：${issue.explanation}` : null,
      issue.needsAuthorJudgment === true ? "- **需要作者判断**：是" : null
    ].filter(Boolean).join("\n");
  });
  return [`【${operationTitle("proofread", language)}】`, ...lines].join("\n");
}

export function readNovelAgentContextStatus(content: string): NovelAgentContextStatus | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    if (parsed.mode === "direct" || parsed.mode === "summarized" || parsed.mode === "mixed") {
      if (typeof parsed.scopeLabel !== "string" || !parsed.scopeLabel.trim()) {
        return null;
      }
      return {
        contextMode: parsed.mode,
        scopeLabel: parsed.scopeLabel.trim(),
        indexMode: isIndexMode(parsed.indexMode) ? parsed.indexMode : undefined,
        indexedChapterCount: toCount(parsed.indexedChapterCount),
        totalChapterCount: toCount(parsed.totalChapterCount),
        staleChapterCount: toCount(parsed.staleChapterCount),
        skippedTooShortChapterCount: toCount(parsed.skippedTooShortChapterCount)
      };
    }
    if (isRecord(parsed.contextPlan) && (parsed.contextPlan.mode === "direct" || parsed.contextPlan.mode === "summarized" || parsed.contextPlan.mode === "mixed")) {
      return {
        contextMode: parsed.contextPlan.mode,
        scopeLabel: `writing:${typeof parsed.operation === "string" ? parsed.operation : "operation"}`
      };
    }
  } catch {
    return null;
  }
  return null;
}

function isIndexMode(value: unknown): value is AiContextIndexMode {
  return value === "raw" || value === "raw_small_project" || value === "summary_cache" || value === "hybrid" || value === "missing" || value === "stale";
}

function toCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function estimateNovelAgentInputTokens(systemPrompt: string, userPrompt: string, tools: readonly NovelAgentToolDefinition[]): number {
  return estimateTextTokens([systemPrompt, userPrompt, JSON.stringify(tools)].join("\n"));
}
