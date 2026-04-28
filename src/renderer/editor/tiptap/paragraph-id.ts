import type { TiptapDocument, TiptapJson, TiptapJsonNode } from "./converters";

const paragraphIdTypes = new Set(["paragraph", "heading"]);

export function createParagraphId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `paragraph_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function ensureNodeParagraphId(node: TiptapJson, generateId: () => string): TiptapJson {
  const nextNode: TiptapJsonNode = {
    ...node,
    attrs: node.attrs ? { ...node.attrs } : undefined,
    content: node.content?.map((child) => ensureNodeParagraphId(child, generateId))
  };

  if (paragraphIdTypes.has(nextNode.type) && !nextNode.attrs?.paragraphId) {
    nextNode.attrs = {
      ...nextNode.attrs,
      paragraphId: generateId()
    };
  }

  return nextNode;
}

export function ensureParagraphIds(document: TiptapDocument, generateId: () => string = createParagraphId): TiptapDocument {
  return {
    ...document,
    content: document.content.map((node) => ensureNodeParagraphId(node, generateId))
  };
}
