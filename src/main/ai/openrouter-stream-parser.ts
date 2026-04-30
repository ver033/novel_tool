export type OpenRouterStreamEvent =
  | { readonly type: "content"; readonly content: string }
  | {
      readonly type: "tool_call_delta";
      readonly index: number;
      readonly id?: string;
      readonly name?: string;
      readonly argumentsJsonDelta?: string;
    }
  | { readonly type: "tool_calls_done" }
  | {
      readonly type: "reasoning";
      readonly content: string;
      readonly source: "reasoning_details" | "reasoning_content" | "reasoning";
      readonly detailId?: string;
      readonly detailIndex?: number;
      readonly detailFormat?: string;
      readonly detailType?: string;
    }
  | { readonly type: "truncated" }
  | { readonly type: "done" }
  | { readonly type: "error"; readonly message: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function extractReasoningDetail(detail: unknown): Extract<OpenRouterStreamEvent, { readonly type: "reasoning" }> | null {
  if (!isObject(detail)) {
    return null;
  }
  const content =
    typeof detail.text === "string" && detail.text.length > 0
      ? detail.text
      : typeof detail.summary === "string" && detail.summary.length > 0
        ? detail.summary
        : null;
  if (!content) {
    return null;
  }

  return {
    type: "reasoning",
    content,
    source: "reasoning_details",
    ...(typeof detail.id === "string" && detail.id.length > 0 ? { detailId: detail.id } : {}),
    ...(typeof detail.index === "number" ? { detailIndex: detail.index } : {}),
    ...(typeof detail.format === "string" && detail.format.length > 0 ? { detailFormat: detail.format } : {}),
    ...(typeof detail.type === "string" && detail.type.length > 0 ? { detailType: detail.type } : {})
  };
}

function parseDataPayload(payload: string): OpenRouterStreamEvent[] {
  if (payload === "[DONE]") {
    return [{ type: "done" }];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
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
  let hasStructuredReasoning = false;
  if (isObject(delta) && Array.isArray(delta.reasoning_details)) {
    for (const detail of delta.reasoning_details) {
      const event = extractReasoningDetail(detail);
      if (event) {
        events.push(event);
        hasStructuredReasoning = true;
      }
    }
  }
  if (!hasStructuredReasoning) {
    if (isObject(delta) && typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
      events.push({ type: "reasoning", content: delta.reasoning_content, source: "reasoning_content" });
    }
    if (isObject(delta) && typeof delta.reasoning === "string" && delta.reasoning.length > 0) {
      events.push({ type: "reasoning", content: delta.reasoning, source: "reasoning" });
    }
  }
  if (isObject(delta) && typeof delta.content === "string" && delta.content.length > 0) {
    events.push({ type: "content", content: delta.content });
  }
  if (isObject(delta) && Array.isArray(delta.tool_calls)) {
    for (const toolCallDelta of delta.tool_calls) {
      if (!isObject(toolCallDelta) || typeof toolCallDelta.index !== "number") {
        continue;
      }
      const fn = toolCallDelta.function;
      events.push({
        type: "tool_call_delta",
        index: toolCallDelta.index,
        ...(typeof toolCallDelta.id === "string" && toolCallDelta.id.length > 0 ? { id: toolCallDelta.id } : {}),
        ...(isObject(fn) && typeof fn.name === "string" && fn.name.length > 0 ? { name: fn.name } : {}),
        ...(isObject(fn) && typeof fn.arguments === "string" && fn.arguments.length > 0 ? { argumentsJsonDelta: fn.arguments } : {})
      });
    }
  }

  if (firstChoice.finish_reason === "length") {
    events.push({ type: "truncated" });
  }
  if (firstChoice.finish_reason === "tool_calls") {
    events.push({ type: "tool_calls_done" });
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
