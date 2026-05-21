import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaretRight } from "@phosphor-icons/react";
import type { ProjectRecord } from "../../main/shared/types";
import type { RelationshipGraphNode, RelationshipGraphResult, RelationshipGraphSourceStatus } from "../../main/shared/relationship-graph";
import { ProjectModuleRail, type ProjectModule } from "../layout/ProjectModuleRail";
import { TopBar } from "../layout/TopBar";
import { getNovelToolApi } from "../state/app-store";
import { AuthorRelationshipControls } from "./AuthorRelationshipControls";
import { RelationshipGraphCanvas } from "./RelationshipGraphCanvas";
import { RelationshipGraphChapterSlider } from "./RelationshipGraphChapterSlider";
import { RelationshipGraphFilters, type RelationshipGraphFilterState, type RelationshipGraphSourceMode } from "./RelationshipGraphFilters";
import { RelationshipGraphInspector } from "./RelationshipGraphInspector";
import { RelationshipGraphLegend } from "./RelationshipGraphLegend";
import { RelationshipGraphStatusBar } from "./RelationshipGraphStatusBar";
import {
  defaultRelationshipGraphDisplaySettings,
  type RelationshipGraphDisplaySettings
} from "./relationship-graph-display-settings";
import {
  requestAuthorRelationshipGraph,
  requestRelationshipGraph,
  type RelationshipGraphChapterCursor,
  type RelationshipGraphRequestState
} from "./relationship-graph-load";

type CharacterRelationshipGraphPageProps = {
  readonly currentProject: ProjectRecord | null;
  readonly onOpenChapter: (chapterId: string) => void;
  readonly onOpenOutline: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenWriting: () => void;
  readonly onOpenWritingGoals: () => void;
  readonly onWelcome: () => void;
};

const defaultFilters: RelationshipGraphFilterState = {
  chapterFrom: "",
  chapterTo: "",
  roleScope: "main",
  minConfidence: 0,
  includeUncertain: false,
  query: ""
};

export function CharacterRelationshipGraphPage({
  currentProject,
  onOpenChapter,
  onOpenOutline,
  onOpenSettings,
  onOpenWriting,
  onOpenWritingGoals,
  onWelcome
}: CharacterRelationshipGraphPageProps) {
  const api = useMemo(getNovelToolApi, []);
  const mountedRef = useRef(true);
  const loadRequestIdRef = useRef(0);
  const statusRequestIdRef = useRef(0);
  const lastAutoLoadKeyRef = useRef<string | null>(null);
  const [filters, setFilters] = useState<RelationshipGraphFilterState>(defaultFilters);
  const [graphSource, setGraphSource] = useState<RelationshipGraphSourceMode>("ai");
  const [chapterCursor, setChapterCursor] = useState<RelationshipGraphChapterCursor>("all");
  const [mode, setMode] = useState<"global" | "focus">("global");
  const [focusNode, setFocusNode] = useState<{ readonly id: string; readonly name: string } | null>(null);
  const [hopDepth, setHopDepth] = useState<1 | 2>(1);
  const [graph, setGraph] = useState<RelationshipGraphResult | null>(null);
  const [status, setStatus] = useState<RelationshipGraphSourceStatus | null>(null);
  const [displaySettings, setDisplaySettings] = useState<RelationshipGraphDisplaySettings>(
    defaultRelationshipGraphDisplaySettings
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [displayPanelCollapsed, setDisplayPanelCollapsed] = useState(true);
  const [detailPanelCollapsed, setDetailPanelCollapsed] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const projectId = currentProject?.id ?? null;
  const requestState = useMemo<RelationshipGraphRequestState>(
    () => ({
      filters,
      chapterCursor,
      mode,
      focusEntityId: mode === "focus" ? (focusNode?.id ?? null) : null,
      focusName: mode === "focus" ? (focusNode?.name ?? null) : null,
      hopDepth
    }),
    [chapterCursor, filters, focusNode, hopDepth, mode]
  );
  const graphRequestKey = useMemo(() => JSON.stringify({ graphSource, projectId, requestState }), [graphSource, projectId, requestState]);

  const refreshStatus = useCallback(() => {
    const requestId = statusRequestIdRef.current + 1;
    statusRequestIdRef.current = requestId;
    if (!projectId) {
      setStatus(null);
      return;
    }
    if (graphSource === "author") {
      return;
    }
    const getSourceStatus = api.relationshipGraph?.getSourceStatus;
    if (typeof getSourceStatus !== "function") {
      return;
    }
    void Promise.resolve(getSourceStatus({ projectId }))
      .then((result) => {
        if (mountedRef.current && statusRequestIdRef.current === requestId) {
          setStatus(result as RelationshipGraphSourceStatus);
        }
      })
      .catch(() => {
        if (mountedRef.current && statusRequestIdRef.current === requestId) {
          setStatus(null);
        }
      });
  }, [api, graphSource, projectId]);

  const loadGraph = useCallback(() => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;

    if (!projectId) {
      setGraph(null);
      setSelectedId(null);
      setStatus(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const graphPromise =
      graphSource === "author"
        ? requestAuthorRelationshipGraph(api, projectId, requestState)
        : requestRelationshipGraph(api, projectId, requestState);
    void graphPromise
      .then((result) => {
        if (mountedRef.current && loadRequestIdRef.current === requestId) {
          setGraph(result);
          setStatus(result.sourceStatus);
        }
      })
      .catch((reason: unknown) => {
        if (mountedRef.current && loadRequestIdRef.current === requestId) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (mountedRef.current && loadRequestIdRef.current === requestId) {
          setLoading(false);
        }
      });
  }, [api, graphSource, projectId, requestState]);

  useEffect(() => {
    if (loadRequestIdRef.current > 0 && graphRequestKey === lastAutoLoadKeyRef.current) {
      return;
    }
    lastAutoLoadKeyRef.current = graphRequestKey;
    loadGraph();
    refreshStatus();
  }, [graphRequestKey, loadGraph, refreshStatus]);

  useEffect(() => {
    if (!graph || !selectedId) {
      return;
    }
    const exists = graph.nodes.some((node) => node.id === selectedId) || graph.edges.some((edge) => edge.id === selectedId);
    if (!exists) {
      setSelectedId(null);
      setDetailPanelCollapsed(true);
    }
  }, [graph, selectedId]);

  function handleNavigate(module: ProjectModule): void {
    if (module === "writing") {
      onOpenWriting();
      return;
    }
    if (module === "settings") {
      onOpenSettings();
      return;
    }
    if (module === "goals") {
      onOpenWritingGoals();
      return;
    }
    if (module === "outline") {
      onOpenOutline();
    }
  }

  const handleSearchChange = useCallback((value: string) => {
    setFilters((current) => ({ ...current, query: value }));
  }, []);

  const handleGraphSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (graph?.nodes.some((node) => node.id === id) || graph?.edges.some((edge) => edge.id === id)) {
        setDetailPanelCollapsed(false);
      }
    },
    [graph?.edges, graph?.nodes]
  );

  const handleFocusNode = useCallback((node: RelationshipGraphNode) => {
    setMode("focus");
    setFocusNode({ id: node.id, name: node.name });
    setSelectedId(node.id);
    setDetailPanelCollapsed(false);
  }, []);

  const handleReturnGlobal = useCallback(() => {
    setMode("global");
    setFocusNode(null);
    setHopDepth(1);
  }, []);

  const handleGraphSourceChange = useCallback((nextSource: RelationshipGraphSourceMode) => {
    setGraphSource(nextSource);
    setMode("global");
    setFocusNode(null);
    setHopDepth(1);
    setSelectedId(null);
    setDetailPanelCollapsed(true);
    setGraph(null);
    setStatus(null);
    setError(null);
  }, []);

  const runAuthorMutation = useCallback(
    async (operation: () => Promise<unknown> | unknown): Promise<void> => {
      if (!projectId) {
        return;
      }
      setError(null);
      await Promise.resolve(operation());
      loadRequestIdRef.current += 1;
      setLoading(true);
      try {
        const result = await requestAuthorRelationshipGraph(api, projectId, requestState);
        if (mountedRef.current) {
          setGraph(result);
          setStatus(result.sourceStatus);
        }
      } catch (reason) {
        if (mountedRef.current) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [api, projectId, requestState]
  );

  const handleAuthorNodePositionChange = useCallback(
    (characterId: string, layoutPosition: { readonly x: number; readonly y: number }) => {
      if (graphSource !== "author" || !projectId) {
        return;
      }
      void Promise.resolve(api.authorRelationship?.updateCharacterLayout({ projectId, characterId, layoutPosition })).catch((reason: unknown) => {
        if (mountedRef.current) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    },
    [api, graphSource, projectId]
  );

  const handleResetDisplaySettings = useCallback(() => {
    setDisplaySettings(defaultRelationshipGraphDisplaySettings);
  }, []);

  const focusNodeId = mode === "focus" ? (focusNode?.id ?? null) : null;
  const statusForUi = status ?? graph?.sourceStatus ?? null;
  const selectedNode = selectedId ? (graph?.nodes.find((node) => node.id === selectedId) ?? null) : null;
  const selectedEdge = selectedId ? (graph?.edges.find((edge) => edge.id === selectedId) ?? null) : null;
  const shouldShowDetailPanel = Boolean(selectedNode || selectedEdge) && !detailPanelCollapsed;
  const workspaceClassName = [
    "relationship-graph-workspace",
    displayPanelCollapsed ? "display-collapsed" : "",
    shouldShowDetailPanel ? "detail-open" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="relationship-graph-page">
      <TopBar
        mode="writing"
        title={currentProject?.name ?? "我的小说"}
        searchValue={filters.query}
        searchPlaceholder="搜索人物、关系或章节"
        showEditorHistoryControls={false}
        showSaveStatus={false}
        onSearchChange={handleSearchChange}
        onSettings={onOpenSettings}
        onWelcome={onWelcome}
      />
      <main className="relationship-graph-shell">
        <ProjectModuleRail activeModule="relationshipGraph" onNavigate={handleNavigate} />
        <section className={workspaceClassName} aria-label="人物关系图">
          <div className="relationship-graph-display-panel">
            {displayPanelCollapsed ? (
              <button
                aria-label="展开显示设置"
                className="relationship-panel-rail-button"
                onClick={() => setDisplayPanelCollapsed(false)}
                title="展开显示设置"
                type="button"
              >
                <CaretRight size={18} weight="bold" />
              </button>
            ) : (
              <>
                <RelationshipGraphFilters
                  displaySettings={displaySettings}
                  filters={filters}
                  graphSource={graphSource}
                  loading={loading}
                  status={statusForUi}
                  onChange={setFilters}
                  onCollapse={() => setDisplayPanelCollapsed(true)}
                  onDisplaySettingsChange={setDisplaySettings}
                  onRefresh={loadGraph}
                  onResetDisplaySettings={handleResetDisplaySettings}
                />
                {graphSource === "ai" ? <RelationshipGraphLegend /> : null}
              </>
            )}
          </div>
          <div className="relationship-graph-main-area">
            <div className="relationship-graph-view-toolbar">
              <div className="relationship-view-switcher">
                <span>图谱视图</span>
                <div className="relationship-segmented relationship-view-tabs" role="group" aria-label="图谱视图">
                  <button className={graphSource === "ai" ? "active" : ""} onClick={() => handleGraphSourceChange("ai")} type="button">
                    AI 分析图谱
                  </button>
                  <button className={graphSource === "author" ? "active" : ""} onClick={() => handleGraphSourceChange("author")} type="button">
                    作者设定图谱
                  </button>
                </div>
              </div>
              {graphSource === "author" ? (
                <AuthorRelationshipControls
                  edges={graph?.edges ?? []}
                  loading={loading}
                  nodes={graph?.nodes ?? []}
                  selectedNodeName={selectedNode?.name ?? null}
                  onCreateCharacter={(name) =>
                    runAuthorMutation(() => api.authorRelationship?.createCharacter({ projectId: projectId ?? "", name }))
                  }
                  onCreateRelationship={(input) =>
                    runAuthorMutation(() =>
                      api.authorRelationship?.createRelationship({
                        projectId: projectId ?? "",
                        ...input
                      })
                    )
                  }
                  onDeleteCharacter={(characterId) =>
                    runAuthorMutation(() => api.authorRelationship?.deleteCharacter({ projectId: projectId ?? "", characterId }))
                  }
                  onDeleteRelationship={(relationshipId) =>
                    runAuthorMutation(() => api.authorRelationship?.deleteRelationship({ projectId: projectId ?? "", relationshipId }))
                  }
                />
              ) : (
                <span className="relationship-view-toolbar-hint">AI 图谱来自阶段摘要和全书摘要；手工设定不会改写缓存。</span>
              )}
            </div>
            {!currentProject ? <p className="relationship-no-project">请先打开项目</p> : null}
            <RelationshipGraphCanvas
              displaySettings={displaySettings}
              edges={graph?.edges ?? []}
              error={error}
              focusNodeId={focusNodeId}
              graphSource={graphSource}
              layoutMode={graphSource === "author" ? "manual" : "auto"}
              loading={loading}
              nodes={graph?.nodes ?? []}
              selectedId={selectedId}
              onNodePositionChange={graphSource === "author" ? handleAuthorNodePositionChange : undefined}
              onSelect={handleGraphSelect}
            />
            <RelationshipGraphStatusBar
              error={error}
              loading={loading}
              stats={graph?.graphStats ?? null}
              status={statusForUi}
              onOpenSettings={onOpenSettings}
            />
            {graphSource === "ai" ? (
              <RelationshipGraphChapterSlider
                availableChapters={graph?.availableChapters ?? []}
                chapterCursor={chapterCursor}
                loading={loading}
                onChange={setChapterCursor}
              />
            ) : null}
          </div>
          {shouldShowDetailPanel ? (
            <div className="relationship-graph-detail-panel">
              <RelationshipGraphInspector
                edges={graph?.edges ?? []}
                focusNodeId={focusNodeId}
                graphSource={graphSource}
                hopDepth={hopDepth}
                mode={mode}
                nodes={graph?.nodes ?? []}
                selectedId={selectedId}
                onCollapse={() => setDetailPanelCollapsed(true)}
                onFocusNode={handleFocusNode}
                onHopDepthChange={setHopDepth}
                onOpenChapter={onOpenChapter}
                onReturnGlobal={handleReturnGlobal}
                onUpdateAuthorCharacter={(input) =>
                  runAuthorMutation(() =>
                    api.authorRelationship?.updateCharacter({
                      projectId: projectId ?? "",
                      ...input,
                      aliases: [...input.aliases]
                    })
                  )
                }
                onUpdateAuthorRelationship={(input) =>
                  runAuthorMutation(() =>
                    api.authorRelationship?.updateRelationship({
                      projectId: projectId ?? "",
                      ...input
                    })
                  )
                }
              />
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
