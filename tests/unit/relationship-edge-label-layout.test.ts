import { describe, expect, it } from "vitest";
import { resolveRelationshipEdgeLabelPlacement, type RelationshipEdgeLabelBox } from "../../src/renderer/relationship-graph/relationship-edge-label-layout";

function boxesOverlap(left: RelationshipEdgeLabelBox, right: RelationshipEdgeLabelBox): boolean {
  return left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y;
}

describe("resolveRelationshipEdgeLabelPlacement", () => {
  it("spreads labels for long relationship lines across both sides of the edge", () => {
    const placements = Array.from({ length: 24 }, (_, index) =>
      resolveRelationshipEdgeLabelPlacement({
        edgeKey: `relationship-edge-${index}`,
        label: `关系${index}`,
        source: { x: 0, y: 0, size: 8 },
        target: { x: 420, y: 0, size: 8 },
        edgeSize: 1.4,
        fontSize: 10
      })
    );

    expect(new Set(placements.map((placement) => Math.sign(placement.normalOffset))).size).toBeGreaterThan(1);
    expect(new Set(placements.map((placement) => placement.ratio)).size).toBeGreaterThan(1);
    expect(Math.max(...placements.map((placement) => Math.abs(placement.normalOffset)))).toBeLessThanOrEqual(11);
    expect(Math.min(...placements.map((placement) => placement.x))).toBeGreaterThan(120);
    expect(Math.max(...placements.map((placement) => placement.x))).toBeLessThan(300);
  });

  it("keeps relationship labels away from node circles on short edges", () => {
    const placement = resolveRelationshipEdgeLabelPlacement({
      edgeKey: "short-edge",
      label: "父子",
      source: { x: 0, y: 0, size: 20 },
      target: { x: 78, y: 0, size: 20 },
      edgeSize: 1,
      fontSize: 10
    });

    expect(placement.ratio).toBeCloseTo(0.5, 2);
    expect(Math.abs(placement.normalOffset)).toBeGreaterThanOrEqual(6);
    expect(Math.abs(placement.normalOffset)).toBeLessThanOrEqual(10);
  });

  it("moves hub relationship labels toward the low-degree endpoint to use open canvas space", () => {
    const hubToLeaf = resolveRelationshipEdgeLabelPlacement({
      edgeKey: "hub-to-leaf",
      label: "父子",
      source: { x: 0, y: 0, size: 24, relationshipWeight: 28 },
      target: { x: 420, y: 0, size: 8, relationshipWeight: 1 },
      edgeSize: 1.4,
      fontSize: 10
    });
    const leafToHub = resolveRelationshipEdgeLabelPlacement({
      edgeKey: "leaf-to-hub",
      label: "父子",
      source: { x: 0, y: 0, size: 8, relationshipWeight: 1 },
      target: { x: 420, y: 0, size: 24, relationshipWeight: 28 },
      edgeSize: 1.4,
      fontSize: 10
    });

    expect(hubToLeaf.ratio).toBeGreaterThan(0.66);
    expect(leafToHub.ratio).toBeLessThan(0.34);
  });

  it("chooses a non-overlapping candidate when the middle of a relationship line is already occupied", () => {
    const occupiedBox: RelationshipEdgeLabelBox = { x: 112, y: -22, width: 96, height: 44 };
    const placement = resolveRelationshipEdgeLabelPlacement({
      edgeKey: "candidate-edge",
      label: "父子",
      source: { x: 0, y: 0, size: 10, relationshipWeight: 2 },
      target: { x: 320, y: 0, size: 10, relationshipWeight: 2 },
      edgeSize: 1,
      fontSize: 10,
      textWidth: 42,
      textHeight: 14,
      viewport: { width: 360, height: 160 },
      occupiedBoxes: [occupiedBox]
    });

    expect(placement.box).toBeDefined();
    expect(boxesOverlap(placement.box!, occupiedBox)).toBe(false);
    expect(placement.ratio).not.toBeCloseTo(0.5, 2);
  });

  it("keeps edge labels away from endpoint character labels when there is room on the line", () => {
    const sourceLabelBox: RelationshipEdgeLabelBox = { x: 18, y: -12, width: 170, height: 24 };
    const placement = resolveRelationshipEdgeLabelPlacement({
      edgeKey: "label-aware-edge",
      label: "同村富户与潜在竞争者",
      source: { x: 0, y: 0, size: 12, labelWidth: 162, labelHeight: 16 },
      target: { x: 520, y: 0, size: 10 },
      edgeSize: 1,
      fontSize: 10,
      textWidth: 132,
      textHeight: 16,
      viewport: { width: 620, height: 160 }
    });

    expect(placement.box).toBeDefined();
    expect(boxesOverlap(placement.box!, sourceLabelBox)).toBe(false);
    expect(Math.abs(placement.normalOffset)).toBeLessThanOrEqual(14);
  });

});
