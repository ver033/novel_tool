import { describe, expect, it } from "vitest";
import { resolveNodeLabelAnchor } from "../../src/renderer/relationship-graph/relationship-node-label-layout";

describe("resolveNodeLabelAnchor", () => {
  it("places a node label away from the dominant outgoing edge direction", () => {
    expect(resolveNodeLabelAnchor([{ dx: 320, dy: 24 }])).toMatchObject({
      x: -1,
      y: 0,
      textAlign: "right"
    });
  });

  it("keeps labels on the right when edges mainly leave to the left", () => {
    expect(resolveNodeLabelAnchor([{ dx: -180, dy: 8 }])).toMatchObject({
      x: 1,
      y: 0,
      textAlign: "left"
    });
  });

  it("uses vertical placement when horizontal placement would not avoid the edge", () => {
    expect(resolveNodeLabelAnchor([{ dx: 6, dy: -220 }])).toMatchObject({
      x: 0,
      y: 1,
      textAlign: "center"
    });
  });

  it("falls back to the familiar right-side label when edge directions cancel out", () => {
    expect(resolveNodeLabelAnchor([{ dx: 100, dy: 0 }, { dx: -100, dy: 0 }])).toMatchObject({
      x: 1,
      y: 0,
      textAlign: "left"
    });
  });
});
