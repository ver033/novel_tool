export type ChatMessageBlock =
  | {
      readonly type: "paragraph";
      readonly text: string;
    }
  | {
      readonly type: "heading";
      readonly text: string;
    }
  | {
      readonly type: "orderedList";
      readonly items: readonly string[];
    }
  | {
      readonly type: "unorderedList";
      readonly items: readonly string[];
    }
  | {
      readonly type: "draft";
      readonly label: string;
      readonly text: string;
    }
  | {
      readonly type: "code";
      readonly text: string;
    };

function stripInlineMarkdown(value: string): string {
  return value
    .trim()
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/^#{1,4}\s+/, "")
    .trim();
}

function draftBlockFromText(text: string): ChatMessageBlock | null {
  const match = text.trim().match(/^【(润色稿|改写稿|扩写稿|续写稿|候选正文)】\s*\n?([\s\S]*)$/);
  if (!match) {
    return null;
  }
  return {
    type: "draft",
    label: match[1],
    text: match[2].trim()
  };
}

function isHeading(line: string): boolean {
  return /^#{1,4}\s+\S/.test(line) || /^\*\*[^*]+：?\*\*$/.test(line);
}

function orderedItem(line: string): string | null {
  const match = line.match(/^\s*\d+[.)、]\s+(.+)$/);
  return match ? stripInlineMarkdown(match[1]) : null;
}

function unorderedItem(line: string): string | null {
  const match = line.match(/^\s*[-*]\s+(.+)$/);
  return match ? stripInlineMarkdown(match[1]) : null;
}

export function parseChatMessageBlocks(text: string): readonly ChatMessageBlock[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const draft = draftBlockFromText(trimmed);
  if (draft) {
    return [draft];
  }

  const blocks: ChatMessageBlock[] = [];
  const lines = trimmed.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "code", text: codeLines.join("\n").trimEnd() });
      index += 1;
      continue;
    }

    if (isHeading(line)) {
      blocks.push({ type: "heading", text: stripInlineMarkdown(line) });
      index += 1;
      continue;
    }

    const firstOrdered = orderedItem(line);
    if (firstOrdered) {
      const items = [firstOrdered];
      index += 1;
      while (index < lines.length) {
        const item = orderedItem(lines[index].trim());
        if (!item) {
          break;
        }
        items.push(item);
        index += 1;
      }
      blocks.push({ type: "orderedList", items });
      continue;
    }

    const firstUnordered = unorderedItem(line);
    if (firstUnordered) {
      const items = [firstUnordered];
      index += 1;
      while (index < lines.length) {
        const item = unorderedItem(lines[index].trim());
        if (!item) {
          break;
        }
        items.push(item);
        index += 1;
      }
      blocks.push({ type: "unorderedList", items });
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index].trim();
      if (!next || isHeading(next) || orderedItem(next) || unorderedItem(next) || next.startsWith("```")) {
        break;
      }
      paragraphLines.push(next);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join("\n") });
  }

  return blocks;
}
