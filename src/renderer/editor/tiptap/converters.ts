export type TiptapJsonNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapJson[];
  text?: string;
};

export type TiptapJson = TiptapJsonNode;

export type TiptapDocument = {
  type: "doc";
  content: TiptapJson[];
};

function isTiptapNode(value: unknown): value is TiptapJsonNode {
  return Boolean(value && typeof value === "object" && "type" in value && typeof (value as { type?: unknown }).type === "string");
}

function nodeToPlainText(node: TiptapJson): string {
  if (node.type === "text") {
    return node.text ?? "";
  }

  if (node.type === "hardBreak") {
    return "\n";
  }

  return node.content?.map(nodeToPlainText).join("") ?? "";
}

export function isTiptapDocument(value: unknown): value is TiptapDocument {
  return isTiptapNode(value) && value.type === "doc" && Array.isArray(value.content);
}

export function extractPlainTextFromTiptapJson(value: unknown): string {
  if (!isTiptapDocument(value)) {
    return "";
  }

  return value.content.map(nodeToPlainText).join("\n\n").trimEnd();
}

export function createTiptapDocumentFromPlainText(text: string): TiptapDocument {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return {
    type: "doc",
    content: (paragraphs.length > 0 ? paragraphs : [""]).map((paragraph) => ({
      type: "paragraph",
      content: paragraph ? [{ type: "text", text: paragraph }] : []
    }))
  };
}

export function normalizeTiptapDocument(value: unknown, replacementPlainText = ""): TiptapDocument {
  return isTiptapDocument(value) ? value : createTiptapDocumentFromPlainText(replacementPlainText);
}
