import { describe, expect, it } from "vitest";
import { requestRelationshipGraph } from "../../src/renderer/relationship-graph/relationship-graph-load";

const filters = {
  filters: {
    chapterFrom: "",
    chapterTo: "",
    roleScope: "main",
    minConfidence: 0,
    includeUncertain: false,
    query: ""
  },
  chapterCursor: "all",
  mode: "global",
  focusEntityId: null,
  focusName: null,
  hopDepth: 1
} as const;

describe("relationship graph loading", () => {
  it("fails fast when the running preload API has not exposed relationship graph methods", async () => {
    await expect(requestRelationshipGraph({} as never, "project_1", filters)).rejects.toThrow("人物关系图接口未加载");
  });

  it("turns synchronous preload failures into rejected load errors", async () => {
    const api = {
      relationshipGraph: {
        getGraph: () => {
          throw new Error("No handler registered");
        }
      }
    };

    await expect(requestRelationshipGraph(api as never, "project_1", filters)).rejects.toThrow("No handler registered");
  });

  it("fails instead of staying in loading state when the graph request hangs", async () => {
    const api = {
      relationshipGraph: {
        getGraph: () => new Promise(() => undefined)
      }
    };

    await expect(requestRelationshipGraph(api as never, "project_1", filters, 1)).rejects.toThrow("人物关系图读取超时");
  });
});
