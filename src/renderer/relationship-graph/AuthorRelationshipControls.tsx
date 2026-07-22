import { LinkSimple, Plus, Trash, X } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { RelationshipGraphEdge, RelationshipGraphNode } from "../../main/shared/relationship-graph";
import { useLocalizedCopy } from "../i18n/localized-copy";
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

type AuthorRelationshipControlsCopy = {
  readonly addCharacter: string;
  readonly addRelationship: string;
  readonly currentCharacter: (name: string) => string;
  readonly selectCharacterHint: string;
  readonly addRelationshipHeading: string;
  readonly characterHint: string;
  readonly relationshipHint: string;
  readonly close: string;
  readonly characterName: string;
  readonly characterPlaceholder: string;
  readonly add: string;
  readonly characterA: string;
  readonly characterB: string;
  readonly mutualRelationship: string;
  readonly mutualRelationshipEnabledHint: string;
  readonly mutualRelationshipDisabledHint: string;
  readonly relationshipName: string;
  readonly aToB: string;
  readonly bToA: string;
  readonly mutualRelationshipPlaceholder: string;
  readonly forwardRelationshipPlaceholder: string;
  readonly reverseRelationshipPlaceholder: string;
  readonly existingCharacters: string;
  readonly existingRelationships: string;
  readonly deleteCharacterAria: (name: string) => string;
  readonly deleteRelationshipAria: (sourceName: string, targetName: string) => string;
  readonly deleteCharacter: string;
  readonly deleteRelationship: string;
  readonly noCharacters: string;
  readonly noRelationships: string;
  readonly deleteCharacterCascade: (count: number) => string;
  readonly deleteCharacterConfirm: (name: string, cascadeHint: string) => string;
};

const authorRelationshipControlsCopy = {
  "zh-CN": {
    addCharacter: "添加人物",
    addRelationship: "添加关系",
    currentCharacter: (name: string) => `当前人物：${name}`,
    selectCharacterHint: "选中人物后，可直接从此人物建立关系",
    addRelationshipHeading: "添加人物关系",
    characterHint: "写到新角色时先把名字放进图里。",
    relationshipHint: "选择两个人，再填写这条关系在线上的名称。",
    close: "关闭",
    characterName: "人物名",
    characterPlaceholder: "例如：白嘉轩",
    add: "添加",
    characterA: "人物 A",
    characterB: "人物 B",
    mutualRelationship: "相互关系：B 对 A 使用同一名称",
    mutualRelationshipEnabledHint: "勾选后会自动生成反向同名关系。",
    mutualRelationshipDisabledHint: "默认只保存 A 对 B；需要反向关系时再填写 B 对 A。",
    relationshipName: "关系名称",
    aToB: "A 对 B",
    bToA: "B 对 A",
    mutualRelationshipPlaceholder: "夫妻、同学、盟友、师生",
    forwardRelationshipPlaceholder: "父亲、老师、主家",
    reverseRelationshipPlaceholder: "儿子、学生、长工",
    existingCharacters: "已有人物",
    existingRelationships: "已有关系",
    deleteCharacterAria: (name: string) => `删除${name}`,
    deleteRelationshipAria: (sourceName: string, targetName: string) => `删除${sourceName}与${targetName}的关系`,
    deleteCharacter: "删除人物",
    deleteRelationship: "删除关系",
    noCharacters: "暂无人物。",
    noRelationships: "暂无关系。",
    deleteCharacterCascade: (count: number) => `，并删除 ${count} 条相关关系`,
    deleteCharacterConfirm: (name: string, cascadeHint: string) => `删除人物“${name}”${cascadeHint}？`
  },
  "ja-JP": {
    addCharacter: "人物を追加",
    addRelationship: "関係を追加",
    currentCharacter: (name: string) => `選択中：${name}`,
    selectCharacterHint: "人物を選ぶと、その人物から関係を作成できます",
    addRelationshipHeading: "人物関係を追加",
    characterHint: "新しい人物の名前を作者設定の関係図へ追加します。",
    relationshipHint: "二人を選び、関係線に表示する名称を入力します。",
    close: "閉じる",
    characterName: "人物名",
    characterPlaceholder: "例：澪",
    add: "追加",
    characterA: "人物 A",
    characterB: "人物 B",
    mutualRelationship: "相互関係：B から A にも同じ名称を使う",
    mutualRelationshipEnabledHint: "逆方向にも同名の関係を自動作成します。",
    mutualRelationshipDisabledHint: "初期状態では A から B のみ保存します。必要なら B から A も入力してください。",
    relationshipName: "関係名",
    aToB: "A から B",
    bToA: "B から A",
    mutualRelationshipPlaceholder: "夫婦、同級生、盟友、師弟",
    forwardRelationshipPlaceholder: "姉、師匠、依頼人",
    reverseRelationshipPlaceholder: "弟子、協力者、調査員",
    existingCharacters: "登録済みの人物",
    existingRelationships: "登録済みの関係",
    deleteCharacterAria: (name: string) => `${name}を削除`,
    deleteRelationshipAria: (sourceName: string, targetName: string) => `${sourceName}と${targetName}の関係を削除`,
    deleteCharacter: "人物を削除",
    deleteRelationship: "関係を削除",
    noCharacters: "人物はまだ登録されていません。",
    noRelationships: "関係はまだ登録されていません。",
    deleteCharacterCascade: (count: number) => `（関連する ${count} 件の関係も削除されます）`,
    deleteCharacterConfirm: (name: string, cascadeHint: string) => `人物「${name}」を削除しますか${cascadeHint}？`
  }
} satisfies Record<"zh-CN" | "ja-JP", AuthorRelationshipControlsCopy>;

function confirmDeleteCharacter(
  node: RelationshipGraphNode,
  edges: readonly RelationshipGraphEdge[],
  copy: AuthorRelationshipControlsCopy
): boolean {
  const relationshipCount = relationshipCountForNode(node.id, edges);
  const cascadeHint = relationshipCount > 0 ? copy.deleteCharacterCascade(relationshipCount) : "";
  return window.confirm(copy.deleteCharacterConfirm(node.name, cascadeHint));
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
  const copy = useLocalizedCopy(authorRelationshipControlsCopy);
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
          {copy.addCharacter}
        </button>
        <button
          className={`relationship-primary-action secondary ${activePanel === "relationship" ? "active" : ""}`}
          disabled={submitting}
          onClick={openRelationshipPanel}
          type="button"
        >
          <LinkSimple size={15} weight="bold" />
          {copy.addRelationship}
        </button>
        <span>{selectedNodeName ? copy.currentCharacter(selectedNodeName) : copy.selectCharacterHint}</span>
      </div>

      {activePanel ? (
        <div className="author-relationship-popover" role="dialog" aria-label={activePanel === "character" ? copy.addCharacter : copy.addRelationship}>
          <div className="author-relationship-popover-head">
            <div>
              <b>{activePanel === "character" ? copy.addCharacter : copy.addRelationshipHeading}</b>
              <span>{activePanel === "character" ? copy.characterHint : copy.relationshipHint}</span>
            </div>
            <button aria-label={copy.close} className="relationship-panel-icon-button" onClick={closePanel} title={copy.close} type="button">
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
                {copy.characterName}
              </label>
              <div className="author-relationship-inline">
                <input
                  autoFocus
                  className="relationship-filter-input"
                  id="author-character-name"
                  onChange={(event) => setCharacterName(event.target.value)}
                  placeholder={copy.characterPlaceholder}
                  value={characterName}
                />
                <button className="relationship-primary-action" disabled={submitting || !characterName.trim()} type="submit">
                  {copy.add}
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
                  <span>{copy.characterA}</span>
                  <input
                    autoFocus={!selectedNodeName}
                    className="relationship-filter-input"
                    list="author-character-options"
                    onChange={(event) => setSourceName(event.target.value)}
                    placeholder={copy.characterA}
                    value={sourceName}
                  />
                </label>
                <label>
                  <span>{copy.characterB}</span>
                  <input
                    autoFocus={Boolean(selectedNodeName)}
                    className="relationship-filter-input"
                    list="author-character-options"
                    onChange={(event) => setTargetName(event.target.value)}
                    placeholder={copy.characterB}
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
                  <span>{copy.mutualRelationship}</span>
                </label>
                <p>{sameRelationBothWays ? copy.mutualRelationshipEnabledHint : copy.mutualRelationshipDisabledHint}</p>
              </div>
              <div className={sameRelationBothWays ? "author-relationship-pair single" : "author-relationship-pair"}>
                <label>
                  <span>{sameRelationBothWays ? copy.relationshipName : copy.aToB}</span>
                  <input
                    className="relationship-filter-input"
                    onChange={(event) => setForwardLabel(event.target.value)}
                    placeholder={sameRelationBothWays ? copy.mutualRelationshipPlaceholder : copy.forwardRelationshipPlaceholder}
                    value={forwardLabel}
                  />
                </label>
                {!sameRelationBothWays ? (
                  <label>
                    <span>{copy.bToA}</span>
                    <input
                      className="relationship-filter-input"
                      onChange={(event) => setReverseLabel(event.target.value)}
                      placeholder={copy.reverseRelationshipPlaceholder}
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
                {copy.addRelationship}
              </button>
            </form>
          )}

          {localError ? <p className="author-relationship-error">{localError}</p> : null}

          <section className="author-relationship-list compact">
            <div className="relationship-section-head">
              <h3>{activePanel === "character" ? copy.existingCharacters : copy.existingRelationships}</h3>
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
                      aria-label={copy.deleteCharacterAria(node.name)}
                      className="relationship-panel-icon-button subtle-danger"
                      disabled={submitting}
                      onClick={() => {
                        if (!confirmDeleteCharacter(node, edges, copy)) {
                          return;
                        }
                        void runAction(() => onDeleteCharacter(node.id));
                      }}
                      title={copy.deleteCharacter}
                      type="button"
                    >
                      <Trash size={15} />
                    </button>
                  </div>
                ))
              ) : (
                <p className="muted">{copy.noCharacters}</p>
              )
            ) : relationshipOptions.length ? (
              relationshipOptions.map((edge) => (
                <div className="author-relationship-list-row relation" key={edge.id}>
                  <button className="author-relationship-name-button" title={`${edge.sourceName} - ${edge.targetName}`} type="button">
                    {edge.sourceName} / {edge.targetName}
                  </button>
                  <span>{relationshipListLabel(edge, edges)}</span>
                  <button
                    aria-label={copy.deleteRelationshipAria(edge.sourceName, edge.targetName)}
                    className="relationship-panel-icon-button subtle-danger"
                    disabled={submitting}
                    onClick={() => void runAction(() => onDeleteRelationship(edge.authorRelationshipId ?? edge.id))}
                    title={copy.deleteRelationship}
                    type="button"
                  >
                    <Trash size={15} />
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">{copy.noRelationships}</p>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
