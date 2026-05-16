import type { RelationshipGraphGetInput, RelationshipGraphResult } from "../../main/shared/types";
import type { RelationshipGraphFilterState } from "./RelationshipGraphFilters";

export type RelationshipGraphChapterCursor = "all" | "latest" | number;

export type RelationshipGraphRequestState = {
  readonly filters: RelationshipGraphFilterState;
  readonly chapterCursor: RelationshipGraphChapterCursor;
  readonly mode: "global" | "focus";
  readonly focusEntityId: string | null;
  readonly focusName: string | null;
  readonly hopDepth: 1 | 2;
};

type RelationshipGraphApiLike = {
  readonly relationshipGraph?: {
    readonly getGraph?: (input: RelationshipGraphGetInput) => Promise<unknown> | unknown;
  };
  readonly authorRelationship?: {
    readonly getGraph?: (input: RelationshipGraphGetInput) => Promise<unknown> | unknown;
  };
};

const DEFAULT_RELATIONSHIP_GRAPH_LOAD_TIMEOUT_MS = 10_000;

function parsePositiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function buildRelationshipGraphInput(projectId: string, requestState: RelationshipGraphRequestState): RelationshipGraphGetInput {
  const minConfidence = Number.isFinite(requestState.filters.minConfidence) ? requestState.filters.minConfidence : undefined;
  return {
    projectId,
    chapterFrom: parsePositiveInt(requestState.filters.chapterFrom),
    chapterTo: parsePositiveInt(requestState.filters.chapterTo),
    chapterCursor: requestState.chapterCursor,
    roleScope: requestState.filters.roleScope,
    mode: requestState.mode,
    focusEntityId: requestState.mode === "focus" ? (requestState.focusEntityId ?? undefined) : undefined,
    focusName: requestState.mode === "focus" ? (requestState.focusName ?? undefined) : undefined,
    hopDepth: requestState.mode === "focus" ? requestState.hopDepth : undefined,
    minConfidence,
    includeUncertain: requestState.filters.includeUncertain,
    query: requestState.filters.query.trim() || undefined
  };
}

function withGraphLoadTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error("人物关系图读取超时。请返回正文后重试，或重启应用以刷新主进程接口。"));
    }, timeoutMs);

    promise
      .then((value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((reason: unknown) => {
        globalThis.clearTimeout(timeoutId);
        reject(reason);
      });
  });
}

export async function requestRelationshipGraph(
  api: RelationshipGraphApiLike,
  projectId: string,
  requestState: RelationshipGraphRequestState,
  timeoutMs = DEFAULT_RELATIONSHIP_GRAPH_LOAD_TIMEOUT_MS
): Promise<RelationshipGraphResult> {
  const getGraph = api.relationshipGraph?.getGraph;
  if (typeof getGraph !== "function") {
    throw new Error("人物关系图接口未加载。请重启应用后再试。");
  }

  const request = Promise.resolve().then(() => getGraph(buildRelationshipGraphInput(projectId, requestState)));
  return (await withGraphLoadTimeout(request, timeoutMs)) as RelationshipGraphResult;
}

export async function requestAuthorRelationshipGraph(
  api: RelationshipGraphApiLike,
  projectId: string,
  requestState: RelationshipGraphRequestState,
  timeoutMs = DEFAULT_RELATIONSHIP_GRAPH_LOAD_TIMEOUT_MS
): Promise<RelationshipGraphResult> {
  const getGraph = api.authorRelationship?.getGraph;
  if (typeof getGraph !== "function") {
    throw new Error("作者手工关系图接口未加载。请重启应用后再试。");
  }

  const request = Promise.resolve().then(() => getGraph(buildRelationshipGraphInput(projectId, requestState)));
  return (await withGraphLoadTimeout(request, timeoutMs)) as RelationshipGraphResult;
}
