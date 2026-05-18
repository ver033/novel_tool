import { CaretRight, Crosshair, NotePencil } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";
import type { RelationshipGraphEdge, RelationshipGraphNode } from "../../main/shared/relationship-graph";

type RelationshipGraphInspectorProps = {
  readonly edges: readonly RelationshipGraphEdge[];
  readonly nodes: readonly RelationshipGraphNode[];
  readonly selectedId: string | null;
  readonly graphSource?: "ai" | "author";
  readonly mode: "global" | "focus";
  readonly focusNodeId: string | null;
  readonly hopDepth: 1 | 2;
  readonly onCollapse: () => void;
  readonly onFocusNode: (node: RelationshipGraphNode) => void;
  readonly onReturnGlobal: () => void;
  readonly onHopDepthChange: (hopDepth: 1 | 2) => void;
  readonly onOpenChapter: (chapterId: string) => void;
  readonly onUpdateAuthorCharacter?: (input: AuthorRelationshipCharacterDraftInput) => Promise<void>;
};

type ChapterActivityItem = {
  readonly chapterId: string;
  readonly chapterOrder: number;
  readonly chapterTitle: string;
  readonly count: number;
  readonly summary: string;
};

type AuthorRelationshipCharacterDraftInput = {
  readonly characterId: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly entityKind: RelationshipGraphNode["entityKind"];
  readonly importance: RelationshipGraphNode["importance"];
  readonly roleSummary: string | null;
  readonly faction: string | null;
  readonly notes: string | null;
};

const importanceLabels: Record<RelationshipGraphNode["importance"], string> = {
  main: "主要",
  supporting: "配角",
  minor: "边缘",
  unknown: "未定"
};

const entityKindLabels: Record<RelationshipGraphNode["entityKind"], string> = {
  person: "人物",
  nonhuman: "非人实体",
  group: "组织",
  identity: "身份",
  unknown: "未定实体"
};

const authorImportanceOptions: ReadonlyArray<{ readonly value: RelationshipGraphNode["importance"]; readonly label: string }> = [
  { value: "main", label: "主要人物" },
  { value: "supporting", label: "配角" },
  { value: "minor", label: "边缘人物" },
  { value: "unknown", label: "未定" }
];

const authorEntityKindOptions: ReadonlyArray<{ readonly value: RelationshipGraphNode["entityKind"]; readonly label: string }> = [
  { value: "person", label: "人物" },
  { value: "group", label: "组织 / 家族" },
  { value: "identity", label: "身份称谓" },
  { value: "nonhuman", label: "非人实体" },
  { value: "unknown", label: "未定" }
];

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function chapterLabel(order: number | null): string {
  return order ? `第${order}章` : "未定";
}

function counterpartName(edge: RelationshipGraphEdge, nodeId: string): string {
  return edge.sourceId === nodeId ? edge.targetName : edge.sourceName;
}

function normalizedRelationLabel(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function sourceToTargetLabel(edge: RelationshipGraphEdge): string {
  return normalizedRelationLabel(edge.baseRelationSourceToTargetLabel) || normalizedRelationLabel(edge.baseRelationLabel);
}

function targetToSourceLabel(edge: RelationshipGraphEdge): string {
  return normalizedRelationLabel(edge.baseRelationTargetToSourceLabel);
}

function labelsMatch(left: string, right: string): boolean {
  return left.toLocaleLowerCase("zh-CN") === right.toLocaleLowerCase("zh-CN");
}

function relationLabelForNode(edge: RelationshipGraphEdge, nodeId: string): string {
  if (edge.sourceId === nodeId) {
    return sourceToTargetLabel(edge);
  }
  return targetToSourceLabel(edge) || sourceToTargetLabel(edge);
}

function edgeScore(edge: RelationshipGraphEdge): number {
  return edge.weight * 1.2 + edge.evidenceCount * 0.8 + edge.intensity + edge.confidence;
}

function buildChapterActivity(edges: readonly RelationshipGraphEdge[]): ChapterActivityItem[] {
  const activityByChapter = new Map<string, ChapterActivityItem>();
  for (const edge of edges) {
    for (const stage of edge.timeline) {
      if (stage.evidenceSource === "author_manual") {
        continue;
      }
      const key = `${stage.chapterOrder}:${stage.chapterId}`;
      const existing = activityByChapter.get(key);
      const summary = stage.changeSummary || stage.evidenceQuote || stage.plotRelationLabel || edge.plotRelationLabel;
      if (existing) {
        activityByChapter.set(key, {
          ...existing,
          count: existing.count + 1,
          summary: existing.summary || summary
        });
        continue;
      }
      activityByChapter.set(key, {
        chapterId: stage.chapterId,
        chapterOrder: stage.chapterOrder,
        chapterTitle: stage.chapterTitle,
        count: 1,
        summary
      });
    }
  }
  return [...activityByChapter.values()].sort((left, right) => left.chapterOrder - right.chapterOrder);
}

function polarityClassName(edge: RelationshipGraphEdge): string {
  if (edge.polarity === "positive") {
    return "positive";
  }
  if (edge.polarity === "negative") {
    return "negative";
  }
  if (edge.polarity === "mixed") {
    return "mixed";
  }
  return "unknown";
}

function parseAliasDraft(value: string): readonly string[] {
  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const segment of value.split(/[\n,，、;；]+/)) {
    const alias = segment.replace(/\s+/g, " ").trim();
    if (!alias) {
      continue;
    }
    const key = alias.toLocaleLowerCase("zh-CN");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    aliases.push(alias);
  }
  return aliases.slice(0, 20);
}

function nullableDraft(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

function CollapseDetailButton({ onCollapse }: { readonly onCollapse: () => void }) {
  return (
    <button
      aria-label="收起人物信息"
      className="relationship-panel-icon-button"
      onClick={onCollapse}
      title="收起人物信息"
      type="button"
    >
      <CaretRight size={16} weight="bold" />
    </button>
  );
}

export function RelationshipGraphInspector({
  edges,
  nodes,
  selectedId,
  graphSource = "ai",
  mode,
  focusNodeId,
  hopDepth,
  onCollapse,
  onFocusNode,
  onReturnGlobal,
  onHopDepthChange,
  onOpenChapter,
  onUpdateAuthorCharacter
}: RelationshipGraphInspectorProps) {
  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null;
  const selectedEdge = edges.find((edge) => edge.id === selectedId) ?? null;
  const selectedNodeAliasDraft = selectedNode?.aliases.join("、") ?? "";
  const [authorName, setAuthorName] = useState("");
  const [authorAliasDraft, setAuthorAliasDraft] = useState("");
  const [authorEntityKind, setAuthorEntityKind] = useState<RelationshipGraphNode["entityKind"]>("person");
  const [authorImportance, setAuthorImportance] = useState<RelationshipGraphNode["importance"]>("supporting");
  const [authorRoleSummary, setAuthorRoleSummary] = useState("");
  const [authorFaction, setAuthorFaction] = useState("");
  const [authorNotes, setAuthorNotes] = useState("");
  const [authorSaving, setAuthorSaving] = useState(false);
  const [authorError, setAuthorError] = useState<string | null>(null);

  useEffect(() => {
    if (graphSource !== "author" || !selectedNode) {
      setAuthorError(null);
      return;
    }
    setAuthorName(selectedNode.name);
    setAuthorAliasDraft(selectedNodeAliasDraft);
    setAuthorEntityKind(selectedNode.entityKind);
    setAuthorImportance(selectedNode.importance);
    setAuthorRoleSummary(selectedNode.roleSummary ?? "");
    setAuthorFaction(selectedNode.faction ?? "");
    setAuthorNotes(selectedNode.authorNotes ?? "");
    setAuthorError(null);
  }, [
    graphSource,
    selectedNode,
    selectedNodeAliasDraft
  ]);

  async function handleSaveAuthorCharacter(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedNode || !onUpdateAuthorCharacter) {
      return;
    }
    const name = authorName.trim();
    if (!name) {
      setAuthorError("人物名不能为空。");
      return;
    }
    setAuthorSaving(true);
    setAuthorError(null);
    try {
      await onUpdateAuthorCharacter({
        characterId: selectedNode.id,
        name,
        aliases: parseAliasDraft(authorAliasDraft).filter((alias) => alias.toLocaleLowerCase("zh-CN") !== name.toLocaleLowerCase("zh-CN")),
        entityKind: authorEntityKind,
        importance: authorImportance,
        roleSummary: nullableDraft(authorRoleSummary),
        faction: nullableDraft(authorFaction),
        notes: nullableDraft(authorNotes)
      });
    } catch (error) {
      setAuthorError(error instanceof Error ? error.message : String(error));
    } finally {
      setAuthorSaving(false);
    }
  }

  if (!selectedNode && !selectedEdge) {
    return (
      <aside className="relationship-graph-inspector">
        <div className="relationship-inspector-topline">
          <h2>人物信息</h2>
          <div className="relationship-inspector-top-actions">
            {mode === "focus" ? (
              <button onClick={onReturnGlobal} type="button">
                返回全局图
              </button>
            ) : null}
            <CollapseDetailButton onCollapse={onCollapse} />
          </div>
        </div>
        <p className="muted">选择人物后查看角色定位和相关人物；选择关系线查看基础关系、剧情关系和原文证据。</p>
      </aside>
    );
  }

  if (graphSource === "author" && selectedNode) {
    const relatedEdges = edges
      .filter((edge) => edge.sourceId === selectedNode.id || edge.targetId === selectedNode.id)
      .sort((left, right) => edgeScore(right) - edgeScore(left));
    return (
      <aside className="relationship-graph-inspector">
        <div className="relationship-character-head">
          <div className="relationship-inspector-topline">
            <div className="relationship-character-title">
              <span>作者设定</span>
              <h2>{selectedNode.name}</h2>
            </div>
            <div className="relationship-inspector-top-actions">
              <CollapseDetailButton onCollapse={onCollapse} />
            </div>
          </div>
          <div className="relationship-inspector-chips">
            <span>{importanceLabels[selectedNode.importance]}</span>
            <span>{entityKindLabels[selectedNode.entityKind]}</span>
            {selectedNode.aliases.length ? <span>{selectedNode.aliases.length} 个别名</span> : null}
            {selectedNode.faction ? <span>{selectedNode.faction}</span> : <span>未分阵营</span>}
          </div>
        </div>

        <form className="relationship-author-detail-form" onSubmit={(event) => void handleSaveAuthorCharacter(event)}>
          <div className="relationship-author-field-grid">
            <label>
              <span>人物名</span>
              <input
                className="relationship-filter-input"
                onChange={(event) => setAuthorName(event.target.value)}
                placeholder="例如：白嘉轩"
                value={authorName}
              />
            </label>
            <label>
              <span>别名 / 称呼</span>
              <input
                className="relationship-filter-input"
                onChange={(event) => setAuthorAliasDraft(event.target.value)}
                placeholder="母亲、族长、校长"
                value={authorAliasDraft}
              />
            </label>
            <label>
              <span>人物类型</span>
              <select
                className="relationship-filter-input"
                onChange={(event) => setAuthorEntityKind(event.target.value as RelationshipGraphNode["entityKind"])}
                value={authorEntityKind}
              >
                {authorEntityKindOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>角色级别</span>
              <select
                className="relationship-filter-input"
                onChange={(event) => setAuthorImportance(event.target.value as RelationshipGraphNode["importance"])}
                value={authorImportance}
              >
                {authorImportanceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            <span>身份定位</span>
            <textarea
              className="relationship-filter-input relationship-author-textarea"
              onChange={(event) => setAuthorRoleSummary(event.target.value)}
              placeholder="例如：白鹿村白家族长，强势守旧，是家族秩序的核心。"
              rows={3}
              value={authorRoleSummary}
            />
          </label>
          <label>
            <span>所属阵营</span>
            <input
              className="relationship-filter-input"
              onChange={(event) => setAuthorFaction(event.target.value)}
              placeholder="家族、门派、班级、公司或势力"
              value={authorFaction}
            />
          </label>
          <label>
            <span>作者备注</span>
            <textarea
              className="relationship-filter-input relationship-author-textarea"
              onChange={(event) => setAuthorNotes(event.target.value)}
              placeholder="只记录写作时真正需要提醒自己的设定。"
              rows={4}
              value={authorNotes}
            />
          </label>
          {authorError ? <p className="author-relationship-error">{authorError}</p> : null}
          <button className="relationship-primary-action full" disabled={authorSaving || !authorName.trim()} type="submit">
            保存设定
          </button>
        </form>

        <section>
          <div className="relationship-section-head">
            <h3>手动关系</h3>
            <span>{relatedEdges.length}</span>
          </div>
          <div className="relationship-author-relation-list">
            {relatedEdges.length ? (
              relatedEdges.map((edge) => (
                <div key={edge.id} className="relationship-author-relation-row">
                  <b>{counterpartName(edge, selectedNode.id)}</b>
                  <span>{relationLabelForNode(edge, selectedNode.id)}</span>
                  <em>{edge.baseRelationSummary ?? "作者手动录入"}</em>
                </div>
              ))
            ) : (
              <p>暂无手动关系。可以在顶部添加关系。</p>
            )}
          </div>
        </section>

        <div className="relationship-character-action-row footer">
          <button
            className={`relationship-primary-action ${focusNodeId === selectedNode.id && mode === "focus" ? "active" : ""}`}
            disabled={focusNodeId === selectedNode.id && mode === "focus"}
            onClick={() => onFocusNode(selectedNode)}
            type="button"
          >
            <Crosshair size={15} weight="bold" />
            以此为中心
          </button>
          {mode === "focus" ? (
            <button className="relationship-return-global-button" onClick={onReturnGlobal} type="button">
              返回全局图
            </button>
          ) : null}
          {mode === "focus" ? (
            <div className="relationship-segmented compact" role="group" aria-label="关系跳数">
              <button className={hopDepth === 1 ? "active" : ""} onClick={() => onHopDepthChange(1)} type="button">
                一跳
              </button>
              <button className={hopDepth === 2 ? "active" : ""} onClick={() => onHopDepthChange(2)} type="button">
                二跳
              </button>
            </div>
          ) : null}
        </div>
      </aside>
    );
  }

  if (graphSource === "author" && selectedEdge) {
    const forwardLabel = sourceToTargetLabel(selectedEdge);
    const reverseLabel = targetToSourceLabel(selectedEdge);
    const sameBothWays = Boolean(reverseLabel && labelsMatch(forwardLabel, reverseLabel));
    return (
      <aside className="relationship-graph-inspector">
        <div className="relationship-inspector-topline">
          <h2>
            {selectedEdge.sourceName} - {selectedEdge.targetName}
          </h2>
          <div className="relationship-inspector-top-actions">
            <CollapseDetailButton onCollapse={onCollapse} />
          </div>
        </div>
        <div className="relationship-inspector-chips">
          <span>作者关系</span>
          <span>手动设定</span>
        </div>
        <section>
          <h3>关系名称</h3>
          <div className="relationship-author-relation-list">
            {sameBothWays ? (
              <div className="relationship-author-relation-row">
                <b>
                  {selectedEdge.sourceName} ↔ {selectedEdge.targetName}
                </b>
                <span>{forwardLabel}</span>
                <em>相互关系</em>
              </div>
            ) : (
              <>
                <div className="relationship-author-relation-row">
                  <b>
                    {selectedEdge.sourceName} → {selectedEdge.targetName}
                  </b>
                  <span>{forwardLabel}</span>
                  <em>正向</em>
                </div>
                {reverseLabel ? (
                  <div className="relationship-author-relation-row">
                    <b>
                      {selectedEdge.targetName} → {selectedEdge.sourceName}
                    </b>
                    <span>{reverseLabel}</span>
                    <em>反向</em>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>
        <section>
          <h3>关系说明</h3>
          <p>{selectedEdge.baseRelationSummary ?? "作者手动录入的固定关系。"}</p>
        </section>
        <section>
          <h3>关系两端</h3>
          <div className="relationship-author-relation-list">
            <div className="relationship-author-relation-row">
              <b>{selectedEdge.sourceName}</b>
              <span>指向</span>
              <em>{selectedEdge.targetName}</em>
            </div>
          </div>
        </section>
      </aside>
    );
  }

  if (selectedNode) {
    const relatedEdges = edges
      .filter((edge) => edge.sourceId === selectedNode.id || edge.targetId === selectedNode.id)
      .sort((left, right) => edgeScore(right) - edgeScore(left));
    const strongestEdge = relatedEdges[0] ?? null;
    const latestStage = relatedEdges
      .flatMap((edge) => edge.timeline.map((stage) => ({ edge, stage })))
      .sort((left, right) => right.stage.chapterOrder - left.stage.chapterOrder)[0] ?? null;
    const evidenceSnippets = relatedEdges
      .flatMap((edge) => edge.timeline.map((stage) => ({ edge, stage })))
      .filter((item) => item.stage.evidenceSource !== "author_manual")
      .filter((item) => item.stage.evidenceQuote || item.stage.changeSummary)
      .sort((left, right) => right.stage.chapterOrder - left.stage.chapterOrder)
      .slice(0, 3);
    const chapterActivity = buildChapterActivity(relatedEdges);
    const maxChapterActivityCount = Math.max(1, ...chapterActivity.map((item) => item.count));
    return (
      <aside className="relationship-graph-inspector">
        <div className="relationship-character-head">
          <div className="relationship-inspector-topline">
            <div className="relationship-character-title">
              <span>人物信息</span>
              <h2>{selectedNode.name}</h2>
            </div>
            <div className="relationship-inspector-top-actions">
              <CollapseDetailButton onCollapse={onCollapse} />
            </div>
          </div>
          <div className="relationship-inspector-chips">
            <span>{importanceLabels[selectedNode.importance]}</span>
            <span>{entityKindLabels[selectedNode.entityKind]}</span>
            <span>{chapterLabel(selectedNode.firstChapterOrder)}-{chapterLabel(selectedNode.latestChapterOrder)}</span>
            <span>置信 {formatPercent(selectedNode.averageConfidence)}</span>
          </div>
        </div>
        <div className="relationship-character-metrics">
          <span>
            <b>{relatedEdges.length}</b>
            关系
          </span>
          <span>
            <b>{selectedNode.evidenceCount}</b>
            证据
          </span>
          <span>
            <b>{selectedNode.relationCount}</b>
            关联人物
          </span>
        </div>
        <section>
          <h3>角色定位</h3>
          <p>{selectedNode.roleSummary ?? "暂无身份摘要。"}</p>
        </section>
        <section>
          <div className="relationship-section-head">
            <h3>出场章节活动</h3>
            <span>{chapterActivity.length ? `${chapterActivity.length} 章有关系事件` : "暂无关系事件"}</span>
          </div>
          {chapterActivity.length ? (
            <>
              <div className="relationship-activity-chart" aria-label={`${selectedNode.name}出场章节活动`}>
                {chapterActivity.map((item) => (
                  <div key={`${item.chapterOrder}:${item.chapterId}`} className="relationship-activity-item">
                    <button
                      aria-label={`查看第${item.chapterOrder}章活动，${item.count}条关系事件`}
                      className={`relationship-activity-bar${item.count === maxChapterActivityCount ? " peak" : ""}`}
                      onClick={() => onOpenChapter(item.chapterId)}
                      style={{ height: `${14 + (item.count / maxChapterActivityCount) * 42}px` }}
                      title={`第${item.chapterOrder}章 ${item.chapterTitle}：${item.summary}`}
                      type="button"
                    >
                      <span className="sr-only">{item.count} 条关系事件</span>
                    </button>
                    <span className="relationship-activity-chapter">{item.chapterOrder}</span>
                  </div>
                ))}
              </div>
              <div className="relationship-activity-axis">
                <span>第{chapterActivity[0].chapterOrder}章</span>
                <span>章节进展</span>
                <span>第{chapterActivity[chapterActivity.length - 1].chapterOrder}章</span>
              </div>
            </>
          ) : (
            <p>暂无可视化活动数据。</p>
          )}
        </section>
        <section>
          <h3>人物弧线</h3>
          <div className="relationship-character-timeline">
            <div className="relationship-character-timeline-row">
              <span>登场</span>
              <b>{chapterLabel(selectedNode.firstChapterOrder)}</b>
              <em>{strongestEdge ? `与${counterpartName(strongestEdge, selectedNode.id)}形成主要牵连` : "等待关系索引补全"}</em>
            </div>
            <div className="relationship-character-timeline-row">
              <span>冲突升级</span>
              <b>{strongestEdge ? chapterLabel(strongestEdge.latestChapterOrder) : "未定"}</b>
              <em>{strongestEdge?.plotRelationLabel || strongestEdge?.baseRelationLabel || "暂无明确变化"}</em>
            </div>
            <div className="relationship-character-timeline-row">
              <span>最近变化</span>
              <b>{latestStage ? `第${latestStage.stage.chapterOrder}章` : chapterLabel(selectedNode.latestChapterOrder)}</b>
              <em>{latestStage?.stage.changeSummary || "暂无新的关系变化"}</em>
            </div>
          </div>
        </section>
        <section>
          <h3>关键关系</h3>
          <div className="relationship-key-relation-list">
            {relatedEdges.length ? (
              relatedEdges.slice(0, 5).map((edge) => (
                <div key={edge.id} className="relationship-key-relation-row">
                  <span className={`relationship-relation-swatch ${polarityClassName(edge)}`} />
                  <b>{counterpartName(edge, selectedNode.id)}</b>
                  <span>{edge.baseRelationLabel}</span>
                  <em>{edge.plotRelationLabel}</em>
                </div>
              ))
            ) : (
              <p>暂无明确关系。</p>
            )}
          </div>
        </section>
        <section>
          <h3>证据摘录</h3>
          <div className="relationship-evidence-snippets">
            {evidenceSnippets.length ? (
              evidenceSnippets.map(({ edge, stage }) => (
                <button key={`${edge.id}:${stage.chapterId}:${stage.evidenceQuote}`} onClick={() => onOpenChapter(stage.chapterId)} type="button">
                  <b>第{stage.chapterOrder}章</b>
                  <span>{stage.evidenceQuote || stage.changeSummary}</span>
                </button>
              ))
            ) : (
              <p>暂无可打开的证据摘录。</p>
            )}
          </div>
        </section>
        <div className="relationship-character-action-row footer">
          <button
            className="relationship-primary-action"
            disabled={focusNodeId === selectedNode.id && mode === "focus"}
            onClick={() => onFocusNode(selectedNode)}
            type="button"
          >
            <Crosshair size={15} weight="bold" />
            以此为中心
          </button>
          {mode === "focus" ? (
            <button className="relationship-return-global-button" onClick={onReturnGlobal} type="button">
              返回全局图
            </button>
          ) : null}
          <button disabled type="button">
            <NotePencil size={15} weight="bold" />
            添加备注
          </button>
          {mode === "focus" ? (
            <div className="relationship-segmented compact" role="group" aria-label="关系跳数">
              <button className={hopDepth === 1 ? "active" : ""} onClick={() => onHopDepthChange(1)} type="button">
                一跳
              </button>
              <button className={hopDepth === 2 ? "active" : ""} onClick={() => onHopDepthChange(2)} type="button">
                二跳
              </button>
            </div>
          ) : null}
        </div>
      </aside>
    );
  }

  if (!selectedEdge) {
    return null;
  }

  return (
    <aside className="relationship-graph-inspector">
      <div className="relationship-inspector-topline">
        <h2>
          {selectedEdge.sourceName} - {selectedEdge.targetName}
        </h2>
        <div className="relationship-inspector-top-actions">
          {mode === "focus" ? (
            <button onClick={onReturnGlobal} type="button">
              返回全局图
            </button>
          ) : null}
          <CollapseDetailButton onCollapse={onCollapse} />
        </div>
      </div>
      <div className="relationship-inspector-chips">
        <span>置信 {formatPercent(selectedEdge.confidence)}</span>
        <span>强度 {formatPercent(selectedEdge.intensity)}</span>
        <span>{selectedEdge.evidenceCount} 条证据</span>
        {selectedEdge.timeline.some((stage) => stage.uncertainty) ? <span>不确定</span> : null}
      </div>
      <section>
        <h3>基础关系</h3>
        <p>
          <b>{selectedEdge.baseRelationLabel}</b>
          {selectedEdge.baseRelationSummary ? `：${selectedEdge.baseRelationSummary}` : ""}
        </p>
      </section>
      <section>
        <h3>剧情关系</h3>
        <p>{selectedEdge.plotRelationLabel ? <b>{selectedEdge.plotRelationLabel}</b> : null}{selectedEdge.plotRelationLabel ? "：" : ""}{selectedEdge.plotRelationSummary}</p>
      </section>
      <section>
        <h3>关系维度</h3>
        <div className="relationship-dimension-list">
          {selectedEdge.relationshipDimensions.map((dimension) => (
            <span key={dimension.name} title={dimension.description || dimension.name}>
              {dimension.name}
            </span>
          ))}
        </div>
      </section>
      <section>
        <h3>证据来源</h3>
        <div className="relationship-evidence-list">
          {selectedEdge.timeline.map((item) => (
            item.evidenceSource === "author_manual" ? (
              <div className="relationship-evidence-manual" key={`${item.chapterId}:${item.chapterOrder}:${item.evidenceQuote}`}>
                <b>{item.chapterTitle}</b>
                <span>{item.changeSummary || item.evidenceQuote}</span>
              </div>
            ) : (
              <button key={`${item.chapterId}:${item.chapterOrder}:${item.evidenceQuote}`} onClick={() => onOpenChapter(item.chapterId)} type="button">
                <b>
                  第{item.chapterOrder}章 {item.chapterTitle}
                </b>
                <span>{item.evidenceQuote || item.changeSummary}</span>
                <em>打开原文</em>
              </button>
            )
          ))}
        </div>
      </section>
    </aside>
  );
}
