import { chromium } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cdpUrl = process.argv[2] ?? "http://127.0.0.1:9223";
const locale = process.argv[3] ?? "ja-JP";

const localeConfigs = {
  "ja-JP": {
    projectName: "雨境の書簡",
    newWork: "新しい作品",
    projectNamePlaceholder: "例：長い夜の帰路",
    createAndStart: "作成して執筆を始める",
    openAi: "AI チャットを開く",
    assistantTitle: "執筆アシスタント",
    chatInput: /AI チャット入力/,
    closeSidebar: "右サイドバーを閉じる",
    modules: {
      writing: "本文",
      relationshipGraph: "人物関係図",
      outline: "プロット",
      chapterReview: "AI レビュー",
      goals: "執筆目標",
      settings: "設定"
    },
    authorGraph: "作者設定",
    reviewSelectAll: "すべて選択",
    reviewStart: "レビューを開始",
    aiSettings: "AI サービス",
    question: "この章で、澪の決断を弱く見せている箇所を整理してください。",
    chapters: [
      {
        title: "第一章　雨の港",
        body: [
          "雨は夜明け前から、古い港町の屋根を細く叩き続けていた。",
          "澪は封を切れないままの手紙を机に置き、曇った窓の向こうへ目を向けた。遠い防波堤の灯が、波間でゆっくりと揺れている。",
          "汽笛が一度だけ響いた。約束の刻限まで、もう時間は残されていなかった。"
        ]
      },
      {
        title: "第二章　消えた航路",
        body: [
          "港の古い記録には、十二年前の航路だけが不自然に切り取られていた。",
          "澪は航海日誌の余白に残された父の筆跡を見つける。そこには『灯台を信じるな』と短く書かれていた。",
          "背後で床板が鳴り、幼なじみの直人が扉を閉めた。彼は事情を知っている顔をしていた。"
        ]
      },
      {
        title: "第三章　灯台守の証言",
        body: [
          "岬の灯台守・冬木は、嵐の夜に入港した船を見たと証言した。",
          "だが船名を尋ねた瞬間、冬木は口を閉ざす。直人は澪をかばうように一歩前へ出た。",
          "澪は手紙の封を切る。中には、失踪した父が残した島の座標が記されていた。"
        ]
      }
    ],
    characters: [
      { name: "澪", aliases: ["ミオ"], importance: "main", roleSummary: "父の失踪を追う主人公", faction: "港町", x: -170, y: -30 },
      { name: "直人", aliases: [], importance: "main", roleSummary: "澪を支える幼なじみ", faction: "港町", x: 10, y: -120 },
      { name: "冬木", aliases: ["灯台守"], importance: "supporting", roleSummary: "嵐の夜を知る証言者", faction: "岬の灯台", x: 190, y: -10 },
      { name: "久世", aliases: ["編集長"], importance: "supporting", roleSummary: "古い航路記録を管理する人物", faction: "海運資料館", x: 20, y: 130 }
    ],
    relationships: [
      { sourceCharacterName: "澪", targetCharacterName: "直人", sourceToTargetLabel: "幼なじみ・信頼", targetToSourceLabel: "守りたい相手" },
      { sourceCharacterName: "澪", targetCharacterName: "冬木", sourceToTargetLabel: "証言を求める", targetToSourceLabel: "秘密を隠す" },
      { sourceCharacterName: "冬木", targetCharacterName: "久世", sourceToTargetLabel: "旧知", targetToSourceLabel: "監視" },
      { sourceCharacterName: "直人", targetCharacterName: "久世", sourceToTargetLabel: "警戒", targetToSourceLabel: "利用価値を測る" }
    ],
    threads: [
      { name: "父の失踪", color: "#B66C45" },
      { name: "港町の秘密", color: "#4C7A6C" }
    ],
    events: [
      { chapter: 0, title: "届かなかった手紙", summary: "澪が父の手紙と向き合い、港へ向かう決意を固める。", time: "雨の夜明け前", location: "澪の部屋", characters: ["澪"], status: "written", thread: 0 },
      { chapter: 1, title: "切り取られた航路", summary: "古い航海記録から、失踪と灯台を結ぶ手掛かりを発見する。", time: "翌日の午後", location: "海運資料館", characters: ["澪", "直人", "久世"], status: "drafting", thread: 0 },
      { chapter: 2, title: "灯台守の沈黙", summary: "冬木の証言が、港町ぐるみの隠蔽を示唆する。", time: "同日の夜", location: "岬の灯台", characters: ["澪", "直人", "冬木"], status: "planned", thread: 1 }
    ],
    goalName: "第一部 完成目標"
  },
  "zh-CN": {
    projectName: "雨港来信",
    newWork: "新建作品",
    projectNamePlaceholder: "例如：长夜归途",
    createAndStart: "创建并开始写作",
    openAi: "打开 AI 对话",
    assistantTitle: "写作助手",
    chatInput: /AI 对话输入/,
    closeSidebar: "关闭右侧栏",
    modules: {
      writing: "正文",
      relationshipGraph: "人物关系图",
      outline: "大纲",
      chapterReview: "AI审稿",
      goals: "写作目标",
      settings: "设置"
    },
    authorGraph: "作者设定图谱",
    reviewSelectAll: "全选",
    reviewStart: "开始审稿",
    aiSettings: "AI 服务",
    question: "请整理这一章里让沈澜的决定显得不够坚定的地方。",
    chapters: [
      {
        title: "第一章　雨夜来信",
        body: [
          "雨从天亮前开始落下，细密地敲打着老港城的屋顶。",
          "沈澜把尚未拆封的信放在桌上，望向蒙着水雾的窗外。防波堤尽头的灯火在浪里缓慢摇动。",
          "汽笛只响了一声。离约定的时间，已经没有多久了。"
        ]
      },
      {
        title: "第二章　消失的航线",
        body: [
          "港务馆的旧档案里，十二年前的航线被人整齐地裁去。",
          "沈澜在航海日志的空白处找到父亲的笔迹，上面只写着一句：不要相信灯塔。",
          "身后的木地板忽然响了一声，周屿关上门。他的神情说明，他早就知道这件事。"
        ]
      },
      {
        title: "第三章　守塔人的证词",
        body: [
          "岬角的守塔人顾冬声称，他在暴风雨那夜看见一艘船进港。",
          "可沈澜刚问出船名，顾冬便沉默下来。周屿向前一步，挡在沈澜身前。",
          "沈澜终于拆开那封信。纸上留下的，是失踪父亲标出的海岛坐标。"
        ]
      }
    ],
    characters: [
      { name: "沈澜", aliases: ["阿澜"], importance: "main", roleSummary: "追查父亲失踪真相的主人公", faction: "老港城", x: -170, y: -30 },
      { name: "周屿", aliases: [], importance: "main", roleSummary: "陪伴沈澜调查的旧友", faction: "老港城", x: 10, y: -120 },
      { name: "顾冬", aliases: ["守塔人"], importance: "supporting", roleSummary: "知道暴风雨之夜真相的证人", faction: "岬角灯塔", x: 190, y: -10 },
      { name: "程砚", aliases: ["馆长"], importance: "supporting", roleSummary: "掌管旧航线档案的人", faction: "港务资料馆", x: 20, y: 130 }
    ],
    relationships: [
      { sourceCharacterName: "沈澜", targetCharacterName: "周屿", sourceToTargetLabel: "旧友・信任", targetToSourceLabel: "想要保护的人" },
      { sourceCharacterName: "沈澜", targetCharacterName: "顾冬", sourceToTargetLabel: "寻求证词", targetToSourceLabel: "隐瞒秘密" },
      { sourceCharacterName: "顾冬", targetCharacterName: "程砚", sourceToTargetLabel: "故交", targetToSourceLabel: "监视" },
      { sourceCharacterName: "周屿", targetCharacterName: "程砚", sourceToTargetLabel: "警惕", targetToSourceLabel: "衡量利用价值" }
    ],
    threads: [
      { name: "父亲失踪", color: "#B66C45" },
      { name: "港城秘密", color: "#4C7A6C" }
    ],
    events: [
      { chapter: 0, title: "没有寄出的信", summary: "沈澜面对父亲留下的信，决定前往港口。", time: "雨夜黎明前", location: "沈澜的房间", characters: ["沈澜"], status: "written", thread: 0 },
      { chapter: 1, title: "被裁掉的航线", summary: "旧航海档案把父亲的失踪与灯塔联系起来。", time: "次日下午", location: "港务资料馆", characters: ["沈澜", "周屿", "程砚"], status: "drafting", thread: 0 },
      { chapter: 2, title: "守塔人的沉默", summary: "顾冬的证词暗示整座港城都参与了隐瞒。", time: "同日夜晚", location: "岬角灯塔", characters: ["沈澜", "周屿", "顾冬"], status: "planned", thread: 1 }
    ],
    goalName: "第一部完稿目标"
  }
};

if (!(locale in localeConfigs)) {
  throw new Error(`Unsupported locale: ${locale}. Expected ja-JP or zh-CN.`);
}

const config = localeConfigs[locale];
const outputDir = path.join(rootDir, "assets", "readme", locale);
const projectRoot = mkdtempSync(path.join(tmpdir(), `moshu-readme-${locale}-`));
const browser = await chromium.connectOverCDP(cdpUrl);
const consoleFailures = new Set();
const consoleInspectionTasks = [];
let phase = "connect";

mkdirSync(outputDir, { recursive: true });

async function findAppPage() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const candidate = pages.find((candidatePage) => /^https?:\/\//u.test(candidatePage.url()));
    if (candidate) return candidate;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Electron renderer page was not exposed through CDP.");
}

const page = await findAppPage();
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") {
    const location = message.location();
    consoleFailures.add(`[${phase}] ${message.type()}: ${message.text()}${location.url ? ` (${location.url}:${location.lineNumber})` : ""}`);
    consoleInspectionTasks.push(Promise.all(message.args().map(async (argument) => {
      try {
        return await argument.evaluate((value) => value instanceof Error
          ? { message: value.message, name: value.name, stack: value.stack }
          : value);
      } catch {
        return "<unavailable>";
      }
    })).then((args) => {
      if (args.length > 1) {
        consoleFailures.add(`[${phase}] console arguments: ${JSON.stringify(args)}`);
      }
    }));
  }
});
page.on("pageerror", (error) => consoleFailures.add(`[${phase}] pageerror: ${error.message}`));

phase = "settings";
await page.waitForLoadState("domcontentloaded");
await page.evaluate(async ({ projectRoot, locale }) => {
  await window.api.settings.save({
    appLocale: locale,
    projectPath: projectRoot,
    aiProvider: {
      providerType: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      modelName: "deepseek/deepseek-v3.2",
      contextLength: 131_072,
      supportsTools: true,
      apiKey: "readme-e2e-placeholder"
    }
  });
}, { projectRoot, locale });
await page.reload({ waitUntil: "domcontentloaded" });

async function assertViewportFit(requiredSelectors) {
  const result = await page.evaluate((selectors) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const clipped = selectors.flatMap((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [`${selector}: missing`];
      const rect = element.getBoundingClientRect();
      return rect.left < -1 || rect.top < -1 || rect.right > viewport.width + 1 || rect.bottom > viewport.height + 1
        ? [`${selector}: clipped ${JSON.stringify({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })}`]
        : [];
    });
    return {
      clipped,
      documentOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    };
  }, requiredSelectors);
  if (result.clipped.length > 0 || result.documentOverflowX) {
    throw new Error(`Viewport fit failed: ${[...result.clipped, result.documentOverflowX ? "document horizontal overflow" : ""].filter(Boolean).join("; ")}`);
  }
}

async function capture(name, requiredSelectors) {
  await assertViewportFit(requiredSelectors);
  await page.waitForTimeout(320);
  await page.screenshot({
    path: path.join(outputDir, name),
    animations: "disabled"
  });
}

async function clickModule(label, expectedSelector) {
  await page.locator(".project-module-button", { hasText: label }).click();
  await page.locator(expectedSelector).waitFor();
  await page.waitForTimeout(450);
}

phase = "welcome";
await page.locator(".welcome-page").waitFor();
await capture("welcome.png", [".welcome-page", ".topbar", ".welcome-grid"]);

phase = "project-create";
await page.locator(".start-card", { hasText: config.newWork }).click();
await page.getByPlaceholder(config.projectNamePlaceholder).fill(config.projectName);
await page.locator("#new-project-language").selectOption(locale);
await page.getByRole("button", { name: config.createAndStart, exact: true }).click();
await page.locator(".writing-page").waitFor();

phase = "writing-fill";
const manuscript = page.locator(".tiptap-manuscript");
await manuscript.fill(config.chapters[0].body.join("\n\n"));
await page.waitForTimeout(1_600);

phase = "seed-workspace";
const seedResult = await page.evaluate(async ({ config }) => {
  const api = window.api;
  const project = await api.project.getCurrentProject();
  if (!project?.id) {
    throw new Error("No current project after project creation.");
  }

  function contentJson(paragraphs) {
    return {
      type: "doc",
      content: paragraphs.map((paragraph) => ({
        type: "paragraph",
        content: paragraph ? [{ type: "text", text: paragraph }] : []
      }))
    };
  }

  const initialChapters = await api.chapter.list({ projectId: project.id });
  const firstChapter = initialChapters[0];
  if (!firstChapter) {
    throw new Error("The created project has no initial chapter.");
  }
  await api.chapter.rename({ projectId: project.id, chapterId: firstChapter.id, title: config.chapters[0].title });

  const chapters = [firstChapter];
  for (let index = 1; index < config.chapters.length; index += 1) {
    const source = config.chapters[index];
    const created = await api.chapter.create({
      projectId: project.id,
      title: source.title,
      sortOrder: index,
      targetWordCount: 3_000
    });
    const plainText = source.body.join("\n\n");
    await api.chapter.saveContent({
      projectId: project.id,
      chapterId: created.id,
      contentJson: contentJson(source.body),
      plainText,
      wordCount: plainText.replace(/\s/gu, "").length,
      saveSource: "system"
    });
    chapters.push(created);
  }

  const createdCharacters = [];
  for (const character of config.characters) {
    const created = await api.authorRelationship.createCharacter({ projectId: project.id, name: character.name });
    await api.authorRelationship.updateCharacter({
      projectId: project.id,
      characterId: created.id,
      name: character.name,
      aliases: character.aliases,
      entityKind: "person",
      importance: character.importance,
      roleSummary: character.roleSummary,
      faction: character.faction,
      notes: null
    });
    await api.authorRelationship.updateCharacterLayout({
      projectId: project.id,
      characterId: created.id,
      layoutPosition: { x: character.x, y: character.y }
    });
    createdCharacters.push(created.id);
  }
  for (const relationship of config.relationships) {
    await api.authorRelationship.createRelationship({ projectId: project.id, ...relationship });
  }

  const threads = [];
  for (const thread of config.threads) {
    threads.push(await api.outline.createThread({ projectId: project.id, ...thread }));
  }
  for (const event of config.events) {
    await api.outline.createEvent({
      projectId: project.id,
      chapterId: chapters[event.chapter].id,
      title: event.title,
      summary: event.summary,
      storyDate: null,
      storyTimeLabel: event.time,
      weekdayLabel: "",
      storyTimeOrder: event.chapter + 1,
      daySegment: event.chapter === 1 ? "day" : "night",
      customDaySegment: null,
      location: event.location,
      povCharacter: config.characters[0].name,
      characters: event.characters,
      goal: event.summary,
      conflict: "",
      outcome: "",
      foreshadowing: event.chapter < 2 ? event.summary : "",
      notes: "",
      status: event.status,
      threadIds: [threads[event.thread].id]
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const deadline = new Date();
  deadline.setUTCDate(deadline.getUTCDate() + 90);
  await api.writingGoals.createGoal({
    projectId: project.id,
    name: config.goalName,
    goalType: "total_words",
    targetWordCount: 90_000,
    startDate: today,
    deadlineDate: deadline.toISOString().slice(0, 10),
    activeWeekdays: [1, 2, 3, 4, 5, 6],
    restDates: []
  });

  return { projectId: project.id, chapterIds: chapters.map((chapter) => chapter.id), characterIds: createdCharacters };
}, { config });

// Data seeding uses the real preload APIs, so reload once to refresh renderer-side
// chapter state before exercising modules that consume the chapter list.
await page.reload({ waitUntil: "domcontentloaded" });
await page.locator(".writing-page, .welcome-page").waitFor();
if (await page.locator(".welcome-page").isVisible()) {
  await page.locator(".project-main-button", { hasText: config.projectName }).first().click();
}
await page.locator(".writing-page").waitFor();
await page.locator(".chapter-tree .chapter-select").first().waitFor();

phase = "writing";
await capture("writing-workspace.png", [".writing-page", ".topbar", ".project-module-rail", ".chapter-tree", ".editor-wrap", ".bottom-metrics"]);

phase = "agent-open";
await page.getByRole("button", { name: config.openAi, exact: true }).click();
await page.getByRole("heading", { name: config.assistantTitle, exact: true }).waitFor();
const sidebarResizeHandle = page.locator(".sidebar-resize-handle");
const sidebarResizeBox = await sidebarResizeHandle.boundingBox();
if (sidebarResizeBox) {
  await page.mouse.move(sidebarResizeBox.x + sidebarResizeBox.width / 2, sidebarResizeBox.y + sidebarResizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sidebarResizeBox.x - 120, sidebarResizeBox.y + sidebarResizeBox.height / 2, { steps: 8 });
  await page.mouse.up();
}
await page.waitForTimeout(300);

phase = "agent-context-menu";
const input = page.getByRole("textbox", { name: config.chatInput });
await input.fill("@");
await page.locator(".chat-command-menu").waitFor();
await page.getByText("deepseek/deepseek-v3.2", { exact: true }).waitFor();
await capture("agent-context-menu.png", [".writing-page", ".project-module-rail", ".editor-wrap", ".right-sidebar", ".chat-command-menu", ".chat-runtime-bar"]);

phase = "agent-conversation";
await input.fill(config.question);
await input.press("Enter");
await page.locator(".messages .message:not(.user) .message-time").last().waitFor({ timeout: 45_000 });
await page.locator(".chat-runtime-bar").filter({ hasText: locale === "ja-JP" ? "準備完了" : "已就绪" }).waitFor({ timeout: 45_000 });
await capture("agent-conversation.png", [".writing-page", ".editor-wrap", ".right-sidebar", ".messages", ".chat-runtime-bar"]);

phase = "close-agent";
await page.getByRole("button", { name: config.closeSidebar, exact: true }).click();
await page.locator(".right-sidebar").waitFor({ state: "detached" });

phase = "relationship-graph";
await clickModule(config.modules.relationshipGraph, ".relationship-graph-page");
await page.getByRole("button", { name: config.authorGraph, exact: true }).click();
await page.locator(".relationship-graph-canvas:not(.empty)").waitFor({ timeout: 20_000 });
await capture("relationship-graph.png", [".relationship-graph-page", ".topbar", ".project-module-rail", ".relationship-graph-workspace", ".relationship-graph-canvas"]);

phase = "outline";
await clickModule(config.modules.outline, ".outline-page");
await page.locator(".outline-event-card").first().waitFor();
await capture("outline.png", [".outline-page", ".topbar", ".project-module-rail", ".outline-workspace", ".outline-main-panel"]);

phase = "chapter-review";
await clickModule(config.modules.chapterReview, ".chapter-review-page");
await page.getByRole("button", { name: config.reviewSelectAll, exact: true }).click();
await page.getByRole("button", { name: config.reviewStart, exact: true }).click();
await page.locator(".chapter-review-result").first().waitFor({ timeout: 60_000 });
await capture("chapter-review.png", [".chapter-review-page", ".topbar", ".project-module-rail", ".chapter-review-workspace"]);

phase = "writing-goals";
await clickModule(config.modules.goals, ".writing-goals-page");
await page.locator(".writing-goals-workspace").waitFor();
await capture("writing-goals.png", [".writing-goals-page", ".topbar", ".project-module-rail", ".writing-goals-workspace", ".writing-goals-grid"]);

phase = "settings";
await clickModule(config.modules.settings, ".settings-page");
await page.getByRole("button", { name: config.aiSettings, exact: true }).click();
await page.locator(".settings-card.wide").first().waitFor();
await capture("settings.png", [".settings-page", ".settings-top", ".settings-layout", ".settings-nav", ".settings-content"]);

await Promise.all(consoleInspectionTasks);
if (consoleFailures.size > 0) {
  throw new Error(`Renderer console failures:\n${[...consoleFailures].join("\n")}`);
}

console.log(JSON.stringify({
  locale,
  outputDir,
  projectRoot,
  seedResult,
  screenshots: [
    "welcome.png",
    "writing-workspace.png",
    "agent-context-menu.png",
    "agent-conversation.png",
    "relationship-graph.png",
    "outline.png",
    "chapter-review.png",
    "writing-goals.png",
    "settings.png"
  ]
}, null, 2));

await browser.close();
