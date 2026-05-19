import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("character relationship graph page wiring", () => {
  it("adds a relationship graph route without removing writing page protections", () => {
    const app = readSource("src/renderer/App.tsx");
    const writingPage = readSource("src/renderer/routes/WritingPage.tsx");

    expect(app).toContain('"relationshipGraph"');
    expect(app).toContain("<CharacterRelationshipGraphPage");
    expect(writingPage).toContain("onOpenRelationshipGraph");
    expect(writingPage).toContain("flushBeforeNavigation(onOpenRelationshipGraph)");
    expect(writingPage).toContain("<ProjectModuleRail");
    expect(writingPage).toContain('activeModule="writing"');
  });

  it("renders the relationship graph shell using existing app language", () => {
    const page = readSource("src/renderer/relationship-graph/CharacterRelationshipGraphPage.tsx");
    const topBar = readSource("src/renderer/layout/TopBar.tsx");

    expect(page).toContain("<TopBar");
    expect(page).toContain("<ProjectModuleRail");
    expect(page).toContain('activeModule="relationshipGraph"');
    expect(page).toContain("人物关系图");
    expect(page).toContain("搜索人物、关系或章节");
    expect(page).toContain("showEditorHistoryControls={false}");
    expect(page).toContain("showSaveStatus={false}");
    expect(page).not.toContain("avatar");
    expect(page).not.toContain("头像");
    expect(topBar).toContain("searchPlaceholder");
  });

  it("loads graph data through the relationshipGraph preload API and renders filters", () => {
    const page = readSource("src/renderer/relationship-graph/CharacterRelationshipGraphPage.tsx");
    const load = readSource("src/renderer/relationship-graph/relationship-graph-load.ts");
    const filters = readSource("src/renderer/relationship-graph/RelationshipGraphFilters.tsx");

    expect(page).toContain("requestRelationshipGraph(api, projectId, requestState)");
    expect(page).toContain("graphRequestKey");
    expect(page).toContain("lastAutoLoadKeyRef");
    expect(load).toContain("api.relationshipGraph?.getGraph");
    expect(page).toContain("RelationshipGraphFilters");
    expect(page).toContain("RelationshipGraphChapterSlider");
    expect(page).toContain("RelationshipGraphStatusBar");
    expect(page).toContain("mountedRef.current = true");
    expect(page).toContain("setLoading");
    expect(page).toContain("setError");
    expect(filters).toContain("章节范围");
    expect(filters).toContain("角色范围");
    expect(filters).toContain("最低置信度");
  });

  it("keeps author-defined relationship editing separate from AI graph loading", () => {
    const page = readSource("src/renderer/relationship-graph/CharacterRelationshipGraphPage.tsx");
    const filters = readSource("src/renderer/relationship-graph/RelationshipGraphFilters.tsx");
    const authorControls = readSource("src/renderer/relationship-graph/AuthorRelationshipControls.tsx");
    const load = readSource("src/renderer/relationship-graph/relationship-graph-load.ts");

    expect(page).toContain('useState<RelationshipGraphSourceMode>("ai")');
    expect(page).toContain("relationship-graph-view-toolbar");
    expect(page).toContain("图谱视图");
    expect(page).toContain("AI 分析图谱");
    expect(page).toContain("作者设定图谱");
    expect(page).toContain("requestAuthorRelationshipGraph(api, projectId, requestState)");
    expect(page).toContain("api.authorRelationship?.createCharacter");
    expect(page).toContain("api.authorRelationship?.updateCharacter");
    expect(page).toContain("api.authorRelationship?.createRelationship");
    expect(page).toContain("api.authorRelationship?.deleteCharacter");
    expect(page).toContain("api.authorRelationship?.deleteRelationship");
    expect(page).toContain("graph?.edges.some((edge) => edge.id === id)");
    expect(page).toContain("Boolean(selectedNode || selectedEdge)");
    expect(page).toContain('graphSource={graphSource}');
    expect(page).toContain('graphSource === "ai" ? <RelationshipGraphLegend /> : null');
    expect(page).toContain('graphSource === "ai" ? (');
    expect(filters).not.toContain("作者手工");
    expect(filters).not.toContain("图谱来源");
    expect(authorControls).toContain("relationship-author-actions");
    expect(authorControls).toContain("author-relationship-popover");
    expect(authorControls).toContain("添加关系");
    expect(authorControls).toContain("useState(false)");
    expect(authorControls).toContain("默认只保存 A 对 B；需要反向关系时再填写 B 对 A。");
    expect(authorControls).toContain("setSameRelationBothWays(false)");
    expect(authorControls).toContain("setReverseLabel(\"\")");
    expect(authorControls).toContain("删除人物");
    expect(authorControls).toContain("edge.authorRelationshipId ?? edge.id");
    expect(authorControls).toContain("useState(false)");
    expect(authorControls).toContain("默认只保存 A 对 B；需要反向关系时再填写 B 对 A。");
    expect(authorControls).toContain("setSameRelationBothWays(false)");
    expect(authorControls).toContain('setReverseLabel("")');
    expect(load).toContain("api.authorRelationship?.getGraph");
  });

  it("uses a text-only Sigma graph canvas and separates AI evidence from author setting fields", () => {
    const canvas = readSource("src/renderer/relationship-graph/RelationshipGraphCanvas.tsx");
    const inspector = readSource("src/renderer/relationship-graph/RelationshipGraphInspector.tsx");
    const sigmaGraph = readSource("src/renderer/relationship-graph/SigmaRelationshipGraph.tsx");

    expect(canvas).toContain("SigmaRelationshipGraph");
    expect(canvas).not.toContain("<svg");
    expect(sigmaGraph).toContain("SigmaContainer");
    expect(sigmaGraph).toContain("Graph");
    expect(sigmaGraph).toContain("forceAtlas2");
    expect(canvas).not.toContain("<img");
    expect(canvas).not.toContain("avatar");
    expect(inspector).toContain("证据来源");
    expect(inspector).toContain("打开原文");
    expect(inspector).toContain("作者设定");
    expect(inspector).toContain("别名 / 称呼");
    expect(inspector).toContain("身份定位");
    expect(inspector).toContain("所属阵营");
    expect(inspector).toContain("作者备注");
    expect(inspector).toContain("保存设定");
  });

  it("opens source chapters from graph evidence through App navigation", () => {
    const app = readSource("src/renderer/App.tsx");
    const page = readSource("src/renderer/relationship-graph/CharacterRelationshipGraphPage.tsx");

    expect(app).toContain("openWritingAtChapter");
    expect(app).toContain("appStore.selectChapter(chapterId)");
    expect(page).toContain("onOpenChapter");
  });

  it("contains empty, loading, and error states for graph data", () => {
    const page = readSource("src/renderer/relationship-graph/CharacterRelationshipGraphPage.tsx");
    const canvas = readSource("src/renderer/relationship-graph/RelationshipGraphCanvas.tsx");

    expect(page).toContain("loading");
    expect(page).toContain("error");
    expect(page).toContain("请先打开项目");
    expect(canvas).toContain("还没有可展示的人物关系");
    expect(canvas).toContain("关系图读取失败");
    expect(canvas).toContain("正在读取关系图");
  });
});
