function countCjk(value: string): number {
  return Array.from(value.matchAll(/[\u3400-\u9fff\uf900-\ufaff]/g)).length;
}

function countNonWhitespace(value: string): number {
  return value.replace(/\s+/g, "").length;
}

export function estimateTextTokens(text: string): number {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }

  const cjkCount = countCjk(normalized);
  const nonWhitespaceCount = countNonWhitespace(normalized);
  const nonCjkCount = Math.max(0, nonWhitespaceCount - cjkCount);

  return Math.ceil(cjkCount * 1.1 + nonCjkCount / 3);
}
