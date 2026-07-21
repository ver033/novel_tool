import { LinkSimple, Plus, Trash, X } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { RelationshipGraphEdge, RelationshipGraphNode } from "../../main/shared/relationship-graph";
import { buildAuthorRelationshipCreateInput, type AuthorRelationshipCreateInput } from "./author-relationship-form";

type AuthorRelationshipControlsProps = {
  readonly edges: readonly RelationshipGraphEdge[];
  readonly loading: boolean;
  readonly nodes: readonly RelationshipGraphNode[];
  readonly selectedNodeName: string | null;
  readonly onCreateCharacter: (name: string) => Promise<void>;
  readonly onCreateRelationship: (input: AuthorRelationshipCreateInput) => Promise<void>;
  readonly onDeleteCharacter: (characterId: string) => Promise<void>;
  readonly onDeleteRelationship: (relationshipId: string) => Promise<void>;
};

function sortedNodes(nodes: readonly RelationshipGraphNode[]): RelationshipGraphNode[] {
  return [...nodes].sort((left, right) => right.relationCount - left.relationCount || left.name.localeCompare(right.name, "zh-CN"));
}

function relationshipDirectionOrder(edge: RelationshipGraphEdge): number {
  return edge.id.endsWith(":source_to_target") ? 0 : edge.id.endsWith(":target_to_source") ? 1 : 0;
}

function sortRelationshipEdges(left: RelationshipGraphEdge, right: RelationshipGraphEdge): number {
  return (
    right.evidenceCount - left.evidenceCount ||
    relationshipDirectionOrder(left) - relationshipDirectionOrder(right) ||
    left.sourceName.localeCompare(right.sourceName, "zh-CN")
  );
}

function recentEdges(edges: readonly RelationshipGraphEdge[]): RelationshipGraphEdge[] {
  const seenRelationshipIds = new Set<string>();
  const recent: RelationshipGraphEdge[] = [];
  for (const edge of [...edges].sort(sortRelationshipEdges)) {
    const relationshipId = edge.authorRelationshipId ?? edge.id;
    if (seenRelationshipIds.has(relationshipId)) {
      continue;
    }
    seenRelationshipIds.add(relationshipId);
    recent.push(edge);
    if (recent.length >= 6) {
      break;
    }
  }
  return recent;
}

function siblingEdges(edge: RelationshipGraphEdge, edges: readonly RelationshipGraphEdge[]): RelationshipGraphEdge[] {
  const relationshipId = edge.authorRelationshipId;
  if (!relationshipId) {
    return [edge];
  }
  return edges.filter((candidate) => candidate.authorRelationshipId === relationshipId);
}

function relationshipListLabel(edge: RelationshipGraphEdge, edges: readonly RelationshipGraphEdge[]): string {
  const relatedEdges = siblingEdges(edge, edges).sort(sortRelationshipEdges).slice(0, 2);
  const forward = normalizeRelationLabel(relatedEdges[0]?.baseRelationSourceToTargetLabel) || normalizeRelationLabel(relatedEdges[0]?.baseRelationLabel);
  const reverse =
    normalizeRelationLabel(relatedEdges[0]?.baseRelationTargetToSourceLabel) ||
    normalizeRelationLabel(relatedEdges.find((candidate) => candidate.id !== relatedEdges[0]?.id)?.baseRelationSourceToTargetLabel);
  if (!reverse || forward.toLocaleLowerCase("zh-CN") === reverse.toLocaleLowerCase("zh-CN")) {
    return forward;
  }
  return `${forward} ↔ ${reverse}`;
}

function normalizeRelationLabel(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function relationshipCountForNode(nodeId: string, edges: readonly RelationshipGraphEdge[]): number {
  const relationshipIds = new Set<string>();
  for (const edge of edges) {
    if (edge.sourceId !== nodeId && edge.targetId !== nodeId) {
      continue;
    }
    relationshipIds.add(edge.authorRelationshipId ?? edge.id);
  }
  return relationshipIds.size;
}

function confirmDeleteCharacter(node: RelationshipGraphNode, edges: readonly RelationshipGraphEdge[]): boolean {
  const relationshipCount = relationshipCountForNode(node.id, edges);
  const cascadeHint = relationshipCount > 0 ? `，并删除 ${relationshipCount} 条相关关系` : "";
  return window.confirm(`删除人物“${node.name}”${cascadeHint}？`);
}

export function AuthorRelationshipControls({
  edges,
  loading,
  nodes,
  selectedNodeName,
  onCreateCharacter,
  onCreateRelationship,
  onDeleteCharacter,
  onDeleteRelationship
}: AuthorRelationshipControlsProps) {
  const [characterName, setCharacterName] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [targetName, setTargetName] = useState("");
  const [forwardLabel, setForwardLabel] = useState("");
  const [reverseLabel, setReverseLabel] = useState("");
  const [sameRelationBothWays, setSameRelationBothWays] = useState(false);
  const [activePanel, setActivePanel] = useState<"character" | "relationship" | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const characterOptions = useMemo(() => sortedNodes(nodes), [nodes]);
  const relationshipOptions = useMemo(() => recentEdges(edges), [edges]);
  const submitting = loading || busy;

  function openRelationshipPanel(): void {
    setActivePanel("relationship");
    setLocalError(null);
    setSameRelationBothWays(false);
    setReverseLabel("");
    if (selectedNodeName) {
      setSourceName(selectedNodeName);
    }
  }

  function closePanel(): void {
    setActivePanel(null);
    setLocalError(null);
  }

  async function runAction(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setLocalError(null);
    try {
      await action();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="author-relationship-controls">
      <div className="relationship-author-actions">
        <button
          className={`relationship-primary-action ${activePanel === "character" ? "active" : ""}`}
          disabled={submitting}
          onClick={() => {
            setActivePanel("character");
            setLocalError(null);
          }}
          type="button"
        >
          <Plus size={15} weight="bold" />
          添加人物
        </button>
        <button
          className={`relationship-primary-action secondary ${activePanel === "relationship" ? "active" : ""}`}
          disabled={submitting}
          onClick={openRelationshipPanel}
          type="button"
        >
          <LinkSimple size={15} weight="bold" />
          添加关系
        </button>
        <span>{selectedNodeName ? `当前人物：${selectedNodeName}` : "选中人物后，可直接从此人物建立关系"}</span>
      </div>

      {activePanel ? (
        <div className="author-relationship-popover" role="dialog" aria-label={activePanel === "character" ? "添加人物" : "添加关系"}>
          <div className="author-relationship-popover-head">
            <div>
              <b>{activePanel === "character" ? "添加人物" : "添加人物关系"}</b>
              <span>{activePanel === "character" ? "写到新角色时先把名字放进图里。" : "选择两个人，再填写这条关系在线上的名称。"}</span>
            </div>
            <button aria-label="关闭" className="relationship-panel-icon-button" onClick={closePanel} title="关闭" type="button">
              <X size={15} />
            </button>
          </div>

          {activePanel === "character" ? (
            <form
              className="author-relationship-form compact"
              onSubmit={(event) => {
                event.preventDefault();
                const name = characterName.trim();
                if (!name) {
                  return;
                }
                void runAction(async () => {
                  await onCreateCharacter(name);
                  setCharacterName("");
                  setActivePanel(null);
                });
              }}
            >
              <label className="relationship-filter-label" htmlFor="author-character-name">
                人物名
              </label>
              <div className="author-relationship-inline">
                <input
                  autoFocus
                  className="relationship-filter-input"
                  id="author-character-name"
                  onChange={(event) => setCharacterName(event.target.value)}
                  placeholder="例如：白嘉轩"
                  value={characterName}
                />
                <button className="relationship-primary-action" disabled={submitting || !characterName.trim()} type="submit">
                  添加
                </button>
              </div>
            </form>
          ) : (
            <form
              className="author-relationship-form relationship-builder"
              onSubmit={(event) => {
                event.preventDefault();
                if (!sourceName.trim() || !targetName.trim() || !forwardLabel.trim()) {
                  return;
                }
                void runAction(async () => {
                  await onCreateRelationship(
                    buildAuthorRelationshipCreateInput({
                      sourceCharacterName: sourceName,
                      targetCharacterName: targetName,
                      sourceToTargetLabel: forwardLabel,
                      targetToSourceLabel: reverseLabel,
                      sameRelationBothWays
                    })
                  );
                  setSourceName(selectedNodeName ?? "");
                  setTargetName("");
                  setForwardLabel("");
                  setReverseLabel("");
                  setSameRelationBothWays(false);
                  setActivePanel(null);
                });
              }}
            >
              <datalist id="author-character-options">
                {characterOptions.map((node) => (
                  <option key={node.id} value={node.name} />
                ))}
              </datalist>
              <div className="author-relationship-pair">
                <label>
                  <span>人物 A</span>
                  <input
                    autoFocus={!selectedNodeName}
                    className="relationship-filter-input"
                    list="author-character-options"
                    onChange={(event) => setSourceName(event.target.value)}
                    placeholder="人物 A"
                    value={sourceName}
                  />
                </label>
                <label>
                  <span>人物 B</span>
                  <input
                    autoFocus={Boolean(selectedNodeName)}
                    className="relationship-filter-input"
                    list="author-character-options"
                    onChange={(event) => setTargetName(event.target.value)}
                    placeholder="人物 B"
                    value={targetName}
                  />
                </label>
              </div>
              <div className="author-relationship-mutual-row">
                <label className="relationship-checkline">
                  <input
                    checked={sameRelationBothWays}
                    onChange={(event) => setSameRelationBothWays(event.target.checked)}
                    type="checkbox"
                  />
                  <span>相互关系：B 对 A 使用同一名称</span>
                </label>
                <p>{sameRelationBothWays ? "勾选后会自动生成反向同名关系。" : "默认只保存 A 对 B；需要反向关系时再填写 B 对 A。"}</p>
              </div>
              <div className={sameRelationBothWays ? "author-relationship-pair single" : "author-relationship-pair"}>
                <label>
                  <span>{sameRelationBothWays ? "关系名称" : "A 对 B"}</span>
                  <input
                    className="relationship-filter-input"
                    onChange={(event) => setForwardLabel(event.target.value)}
                    placeholder={sameRelationBothWays ? "夫妻、同学、盟友、师生" : "父亲、老师、主家"}
                    value={forwardLabel}
                  />
                </label>
                {!sameRelationBothWays ? (
                  <label>
                    <span>B 对 A</span>
                    <input
                      className="relationship-filter-input"
                      onChange={(event) => setReverseLabel(event.target.value)}
                      placeholder="儿子、学生、长工"
                      value={reverseLabel}
                    />
                  </label>
                ) : null}
              </div>
              <button
                className="relationship-primary-action full"
                disabled={submitting || !sourceName.trim() || !targetName.trim() || !forwardLabel.trim()}
                type="submit"
              >
                添加关系
              </button>
            </form>
          )}

          {localError ? <p className="author-relationship-error">{localError}</p> : null}

          <section className="author-relationship-list compact">
            <div className="relationship-section-head">
              <h3>{activePanel === "character" ? "已有人物" : "已有关系"}</h3>
              <span>{activePanel === "character" ? nodes.length : edges.length}</span>
            </div>
            {activePanel === "character" ? (
              characterOptions.length ? (
                characterOptions.slice(0, 6).map((node) => (
                  <div className="author-relationship-list-row" key={node.id}>
                    <button className="author-relationship-name-button" title={node.name} type="button">
                      {node.name}
                    </button>
                    <span>{node.relationCount}</span>
                    <button
                      aria-label={`删除${node.name}`}
                      className="relationship-panel-icon-button subtle-danger"
                      disabled={submitting}
                      onClick={() => {
                        if (!confirmDeleteCharacter(node, edges)) {
                          return;
                        }
                        void runAction(() => onDeleteCharacter(node.id));
                      }}
                      title="删除人物"
                      type="button"
                    >
                      <Trash size={15} />
                    </button>
                  </div>
                ))
              ) : (
                <p className="muted">暂无人物。</p>
              )
            ) : relationshipOptions.length ? (
              relationshipOptions.map((edge) => (
                <div className="author-relationship-list-row relation" key={edge.id}>
                  <button className="author-relationship-name-button" title={`${edge.sourceName} - ${edge.targetName}`} type="button">
                    {edge.sourceName} / {edge.targetName}
                  </button>
                  <span>{relationshipListLabel(edge, edges)}</span>
                  <button
                    aria-label={`删除${edge.sourceName}与${edge.targetName}的关系`}
                    className="relationship-panel-icon-button subtle-danger"
                    disabled={submitting}
                    onClick={() => void runAction(() => onDeleteRelationship(edge.authorRelationshipId ?? edge.id))}
                    title="删除关系"
                    type="button"
                  >
                    <Trash size={15} />
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">暂无关系。</p>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
