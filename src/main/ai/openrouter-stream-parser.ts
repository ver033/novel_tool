export type OpenRouterStreamEvent =
  | { readonly type: "content"; readonly content: string }
  | { readonly type: "done" }
  | { readonly type: "error"; readonly message: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function parseDataPayload(payload: string): OpenRouterStreamEvent[] {
  if (payload === "[DONE]") {
    return [{ type: "done" }];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("OpenRouter 流式响应不是合法 JSON。");
  }

  if (!isObject(parsed)) {
    return [];
  }

  const error = parsed.error;
  if (isObject(error) && typeof error.message === "string") {
    return [{ type: "error", message: error.message }];
  }

  const choices = parsed.choices;
  if (!Array.isArray(choices)) {
    return [];
  }

  const firstChoice = choices[0] as unknown;
  if (!isObject(firstChoice)) {
    return [];
  }

  const choiceError = firstChoice.error;
  if (isObject(choiceError) && typeof choiceError.message === "string") {
    return [{ type: "error", message: choiceError.message }];
  }

  const events: OpenRouterStreamEvent[] = [];
  const delta = firstChoice.delta;
  if (isObject(delta) && typeof delta.content === "string" && delta.content.length > 0) {
    events.push({ type: "content", content: delta.content });
  }

  if (firstChoice.finish_reason === "length") {
    events.push({ type: "error", message: "OpenRouter 流式响应被截断（finish_reason: length）。" });
  }

  return events;
}

export function parseOpenRouterSsePayload(raw: string): OpenRouterStreamEvent[] {
  const events: OpenRouterStreamEvent[] = [];
  const blocks = raw.split(/\r?\n\r?\n/);

  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0 && !line.startsWith(":"));
    const dataLines = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice("data:".length).trimStart());
    if (dataLines.length === 0) {
      continue;
    }

    events.push(...parseDataPayload(dataLines.join("\n")));
  }

  return events;
}
