import { describe, expect, it } from "vitest";
import type { RelationshipGraphEdge, RelationshipGraphNode } from "../../src/main/shared/relationship-graph";
import { buildRelationshipHubSeedLayoutPositions } from "../../src/renderer/relationship-graph/relationship-graph-hub-layout";

function makeNode(id: string, name: string, score = 4): RelationshipGraphNode {
  return {
    id,
    name,
    aliases: [],
    entityKind: "person",
    importance: score > 8 ? "main" : "supporting",
    roleSummary: null,
    faction: null,
    chapterIds: ["chapter_1"],
    firstChapterOrder: 1,
    latestChapterOrder: 1,
    evidenceCount: 1,
    relationCount: 1,
    averageConfidence: 0.8,
    averageIntensity: 0.6,
    score
  };
}

function makeEdge(id: string, sourceId: string, targetId: string, sourceName: string, targetName: string): RelationshipGraphEdge {
  return {
    id,
    sourceId,
    targetId,
    sourceName,
    targetName,
    baseRelationLabel: "基础关系",
    baseRelationSummary: null,
    plotRelationLabel: "剧情关系",
    plotRelationSummary: "剧情关系摘要",
    primaryDimensionName: "动态关系",
    relationshipDimensions: [{ name: "动态关系", description: "测试关系维度", confidence: 0.8 }],
    semanticMarkers: [],
    direction: "undirected",
    polarity: "mixed",
    intensity: 0.7,
    confidence: 0.85,
    weight: 2,
    evidenceCount: 2,
    evidenceSources: ["summary_payload"],
    chapterIds: ["chapter_1"],
    firstChapterOrder: 1,
    latestChapterOrder: 1,
    timeline: []
  };
}

function distance(left: { readonly x: number; readonly y: number }, right: { readonly x: number; readonly y: number }): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

describe("buildRelationshipHubSeedLayoutPositions", () => {
  it("places high-degree character hubs into separated sectors before force layout runs", () => {
    const hubs = [makeNode("hub_a", "主角甲", 12), makeNode("hub_b", "主角乙", 11), makeNode("hub_c", "主角丙", 10)];
    const satellites = Array.from({ length: 18 }, (_, index) => makeNode(`sat_${index}`, `角色${index}`));
    const nodes = [...hubs, ...satellites];
    const edges: RelationshipGraphEdge[] = satellites.map((node, index) => {
      const hub = hubs[Math.floor(index / 6)];
      return makeEdge(`edge_${node.id}`, hub.id, node.id, hub.name, node.name);
    });
    edges.push(makeEdge("edge_hub_a_b", "hub_a", "hub_b", "主角甲", "主角乙"));
    edges.push(makeEdge("edge_hub_b_c", "hub_b", "hub_c", "主角乙", "主角丙"));

    const positions = buildRelationshipHubSeedLayoutPositions({ nodes, edges, width: 1000, height: 700 });
    const hubPositions = hubs.map((node) => positions.get(node.id));

    expect(positions.size).toBe(nodes.length);
    expect(hubPositions.every(Boolean)).toBe(true);
    expect(distance(hubPositions[0]!, hubPositions[1]!)).toBeGreaterThan(420);
    expect(distance(hubPositions[1]!, hubPositions[2]!)).toBeGreaterThan(420);
    expect(distance(hubPositions[0]!, hubPositions[2]!)).toBeGreaterThan(420);
    expect(distance(positions.get("sat_0")!, positions.get("hub_a")!)).toBeLessThan(distance(positions.get("sat_0")!, positions.get("hub_b")!));
  });

  it("does not seed tiny graphs where the normal force layout has enough room", () => {
    const nodes = [makeNode("a", "甲"), makeNode("b", "乙"), makeNode("c", "丙")];
    const edges = [makeEdge("edge_a_b", "a", "b", "甲", "乙")];

    expect(buildRelationshipHubSeedLayoutPositions({ nodes, edges, width: 800, height: 600 }).size).toBe(0);
  });
});
