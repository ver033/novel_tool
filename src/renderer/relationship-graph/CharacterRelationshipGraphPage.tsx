import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaretRight } from "@phosphor-icons/react";
import type { ProjectRecord } from "../../main/shared/types";
import type { RelationshipGraphIndexStatus, RelationshipGraphNode, RelationshipGraphResult } from "../../main/shared/relationship-index";
import { ProjectModuleRail, type ProjectModule } from "../layout/ProjectModuleRail";
import { TopBar } from "../layout/TopBar";
import { getNovelToolApi } from "../state/app-store";
import { RelationshipGraphCanvas } from "./RelationshipGraphCanvas";
import { RelationshipGraphChapterSlider } from "./RelationshipGraphChapterSlider";
import { RelationshipGraphFilters, type RelationshipGraphFilterState } from "./RelationshipGraphFilters";
import { RelationshipGraphInspector } from "./RelationshipGraphInspector";
import { RelationshipGraphLegend } from "./RelationshipGraphLegend";
import { RelationshipGraphStatusBar } from "./RelationshipGraphStatusBar";
import {
  defaultRelationshipGraphDisplaySettings,
  type RelationshipGraphDisplaySettings
} from "./relationship-graph-display-settings";
import { requestRelationshipGraph, type RelationshipGraphChapterCursor, type RelationshipGraphRequestState } from "./relationship-graph-load";

type CharacterRelationshipGraphPageProps = {
  readonly currentProject: ProjectRecord | null;
  readonly onOpenChapter: (chapterId: string) => void;
  readonly onOpenSettings: () => void;
  readonly onOpenWriting: () => void;
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
  onOpenSettings,
  onOpenWriting,
  onWelcome
}: CharacterRelationshipGraphPageProps) {
  const api = useMemo(getNovelToolApi, []);
  const mountedRef = useRef(true);
  const loadRequestIdRef = useRef(0);
  const statusRequestIdRef = useRef(0);
  const lastAutoLoadKeyRef = useRef<string | null>(null);
  const [filters, setFilters] = useState<RelationshipGraphFilterState>(defaultFilters);
  const [chapterCursor, setChapterCursor] = useState<RelationshipGraphChapterCursor>("all");
  const [mode, setMode] = useState<"global" | "focus">("global");
  const [focusNode, setFocusNode] = useState<{ readonly id: string; readonly name: string } | null>(null);
  const [hopDepth, setHopDepth] = useState<1 | 2>(1);
  const [graph, setGraph] = useState<RelationshipGraphResult | null>(null);
  const [status, setStatus] = useState<RelationshipGraphIndexStatus | null>(null);
  const [displaySettings, setDisplaySettings] = useState<RelationshipGraphDisplaySettings>(
    defaultRelationshipGraphDisplaySettings
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [displayPanelCollapsed, setDisplayPanelCollapsed] = useState(true);
  const [detailPanelCollapsed, setDetailPanelCollapsed] = useState(true);
  const [loading, setLoading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
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
  const graphRequestKey = useMemo(() => JSON.stringify({ projectId, requestState }), [projectId, requestState]);

  const refreshStatus = useCallback(() => {
    const requestId = statusRequestIdRef.current + 1;
    statusRequestIdRef.current = requestId;
    if (!projectId) {
      setStatus(null);
      return;
    }
    const getStatus = api.relationshipGraph?.getStatus;
    if (typeof getStatus !== "function") {
      return;
    }
    void Promise.resolve(getStatus({ projectId }))
      .then((result) => {
        if (mountedRef.current && statusRequestIdRef.current === requestId) {
          setStatus(result as RelationshipGraphIndexStatus);
        }
      })
      .catch(() => {
        if (mountedRef.current && statusRequestIdRef.current === requestId) {
          setStatus(null);
        }
      });
  }, [api, projectId]);

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
    void requestRelationshipGraph(api, projectId, requestState)
      .then((result) => {
        if (mountedRef.current && loadRequestIdRef.current === requestId) {
          setGraph(result);
          setStatus(result.indexStatus);
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
  }, [api, projectId, requestState]);

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

  const handleRebuild = useCallback(() => {
    if (!projectId) {
      return;
    }
    const rebuild = api.relationshipGraph?.rebuild;
    if (typeof rebuild !== "function") {
      setError("人物关系图重建接口未加载。请重启应用后再试。");
      return;
    }
    setRebuilding(true);
    setError(null);
    void Promise.resolve(rebuild({ projectId, force: false }))
      .then((result) => {
        if (mountedRef.current) {
          setStatus(result as RelationshipGraphIndexStatus);
          refreshStatus();
        }
      })
      .catch((reason: unknown) => {
        if (mountedRef.current) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (mountedRef.current) {
          setRebuilding(false);
        }
      });
  }, [api, projectId, refreshStatus]);

  function handleNavigate(module: ProjectModule): void {
    if (module === "writing") {
      onOpenWriting();
      return;
    }
    if (module === "settings") {
      onOpenSettings();
    }
  }

  const handleSearchChange = useCallback((value: string) => {
    setFilters((current) => ({ ...current, query: value }));
  }, []);

  const handleGraphSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (graph?.nodes.some((node) => node.id === id)) {
        setDetailPanelCollapsed(false);
      }
    },
    [graph?.nodes]
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

  const handleResetDisplaySettings = useCallback(() => {
    setDisplaySettings(defaultRelationshipGraphDisplaySettings);
  }, []);

  const focusNodeId = mode === "focus" ? (focusNode?.id ?? null) : null;
  const statusForUi = status ?? graph?.indexStatus ?? null;
  const selectedNode = selectedId ? (graph?.nodes.find((node) => node.id === selectedId) ?? null) : null;
  const shouldShowDetailPanel = Boolean(selectedNode) && !detailPanelCollapsed;
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
                  loading={loading}
                  status={statusForUi}
                  onChange={setFilters}
                  onCollapse={() => setDisplayPanelCollapsed(true)}
                  onDisplaySettingsChange={setDisplaySettings}
                  onRefresh={loadGraph}
                  onResetDisplaySettings={handleResetDisplaySettings}
                />
                <RelationshipGraphLegend />
              </>
            )}
          </div>
          <div className="relationship-graph-main-area">
            {!currentProject ? <p className="relationship-no-project">请先打开项目</p> : null}
            <RelationshipGraphCanvas
              displaySettings={displaySettings}
              edges={graph?.edges ?? []}
              error={error}
              focusNodeId={focusNodeId}
              loading={loading}
              nodes={graph?.nodes ?? []}
              selectedId={selectedId}
              onSelect={handleGraphSelect}
            />
            <RelationshipGraphStatusBar
              error={error}
              loading={loading}
              rebuilding={rebuilding}
              stats={graph?.graphStats ?? null}
              status={statusForUi}
              onRebuild={handleRebuild}
            />
            <RelationshipGraphChapterSlider
              availableChapters={graph?.availableChapters ?? []}
              chapterCursor={chapterCursor}
              loading={loading}
              onChange={setChapterCursor}
            />
          </div>
          {shouldShowDetailPanel ? (
            <div className="relationship-graph-detail-panel">
              <RelationshipGraphInspector
                edges={graph?.edges ?? []}
                focusNodeId={focusNodeId}
                hopDepth={hopDepth}
                mode={mode}
                nodes={graph?.nodes ?? []}
                selectedId={selectedId}
                onCollapse={() => setDetailPanelCollapsed(true)}
                onFocusNode={handleFocusNode}
                onHopDepthChange={setHopDepth}
                onOpenChapter={onOpenChapter}
                onReturnGlobal={handleReturnGlobal}
              />
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
