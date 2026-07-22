import type { AiAgentActivityRecord } from "../../shared/types";
import type { ContentLanguage } from "../../shared/language";
import {
  NOVEL_AGENT_TASK_CREATE_TOOL,
  NOVEL_AGENT_TASK_UPDATE_TOOL,
  type NovelAgentTask
} from "./novel-agent-task-tools";

const MAX_INPUT_LENGTH = 1_200;
const MAX_OUTPUT_LENGTH = 1_600;

function serialize(value: unknown, maxLength: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  }
  const normalized = text.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function toolTitle(toolName: string, language: ContentLanguage): string {
  const labels: Readonly<Record<string, readonly [string, string]>> = {
    get_project_context: ["查看项目状态", "プロジェクト状態を確認"],
    list_chapters: ["查看章节目录", "章一覧を確認"],
    read_chapters: ["读取章节上下文", "章の文脈を読む"],
    read_selection: ["读取编辑器选区", "選択範囲を読む"],
    run_writing_operation: ["执行写作操作", "執筆操作を実行"],
    check_continuity: ["检查跨章连续性", "章をまたぐ整合性を確認"],
    add_to_scratchpad: ["保存到草稿纸", "下書きメモへ保存"]
  };
  const label = labels[toolName];
  if (!label) {
    return language === "ja-JP" ? `ツールを実行: ${toolName}` : `调用工具：${toolName}`;
  }
  return language === "ja-JP" ? label[1] : label[0];
}

function toolDetail(toolName: string, args: unknown, language: ContentLanguage): string {
  const record = typeof args === "object" && args !== null && !Array.isArray(args) ? args as Record<string, unknown> : {};
  if (toolName === "read_chapters") {
    const scope = typeof record.scope === "string" ? record.scope : "requested_scope";
    const from = record.from ?? record.ordinal;
    const to = record.to;
    const range = from === undefined ? scope : to === undefined ? `${scope} · ${String(from)}` : `${scope} · ${String(from)}–${String(to)}`;
    return language === "ja-JP" ? `必要な範囲を選択: ${range}` : `按请求选择范围：${range}`;
  }
  if (toolName === "run_writing_operation" && typeof record.operation === "string") {
    return language === "ja-JP" ? `操作: ${record.operation}` : `操作：${record.operation}`;
  }
  if (toolName === "check_continuity" && typeof record.scope === "string") {
    return language === "ja-JP" ? `確認範囲: ${record.scope}` : `检查范围：${record.scope}`;
  }
  return language === "ja-JP" ? "ユーザーの依頼に基づいて実行" : "根据用户请求执行";
}

function extractToolOutput(result: unknown): unknown {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return result;
  }
  const record = result as Record<string, unknown>;
  if (Array.isArray(record.content)) {
    const text = record.content
      .flatMap((part) => typeof part === "object" && part !== null && (part as Record<string, unknown>).type === "text"
        ? [String((part as Record<string, unknown>).text ?? "")]
        : [])
      .join("\n")
      .trim();
    return text || result;
  }
  return result;
}

export type NovelAgentActivityTracker = {
  readonly records: () => readonly AiAgentActivityRecord[];
  readonly startTool: (toolCallId: string, toolName: string, args: unknown) => void;
  readonly updateTool: (toolCallId: string, partialResult: unknown) => void;
  readonly finishTool: (toolCallId: string, result: unknown, isError: boolean) => void;
  readonly upsertTask: (task: NovelAgentTask) => void;
  readonly finishAll: () => void;
  readonly stopRunning: (status: "error" | "stopped") => void;
};

export function createNovelAgentActivityTracker(input: {
  readonly requestId: string;
  readonly language: ContentLanguage;
  readonly now: () => number;
  readonly onActivity?: (activity: AiAgentActivityRecord) => void;
}): NovelAgentActivityTracker {
  const activities = new Map<string, AiAgentActivityRecord>();

  const upsert = (activity: AiAgentActivityRecord): void => {
    activities.set(activity.id, activity);
    input.onActivity?.(activity);
  };
  const create = (
    id: string,
    patch: Omit<AiAgentActivityRecord, "id" | "createdAt" | "updatedAt">
  ): AiAgentActivityRecord => {
    const timestamp = new Date(input.now()).toISOString();
    return { id, ...patch, createdAt: timestamp, updatedAt: timestamp };
  };
  const update = (id: string, patch: Partial<AiAgentActivityRecord>): void => {
    const current = activities.get(id);
    if (!current) return;
    upsert({ ...current, ...patch, id: current.id, createdAt: current.createdAt, updatedAt: new Date(input.now()).toISOString() });
  };
  const taskActivityStatus = (status: NovelAgentTask["status"]): AiAgentActivityRecord["status"] => {
    if (status === "in_progress") return "running";
    if (status === "completed") return "complete";
    if (status === "cancelled") return "stopped";
    return status;
  };
  const isInternalTaskTool = (toolName: string): boolean =>
    toolName === NOVEL_AGENT_TASK_CREATE_TOOL || toolName === NOVEL_AGENT_TASK_UPDATE_TOOL;

  return {
    records: () => [...activities.values()],
    startTool(toolCallId, toolName, args) {
      if (isInternalTaskTool(toolName)) return;
      upsert(create(`${input.requestId}:tool:${toolCallId}`, {
        kind: "tool",
        status: "running",
        title: toolTitle(toolName, input.language),
        detail: toolDetail(toolName, args, input.language),
        toolName,
        input: serialize(args, MAX_INPUT_LENGTH)
      }));
    },
    updateTool(toolCallId, partialResult) {
      update(`${input.requestId}:tool:${toolCallId}`, { output: serialize(extractToolOutput(partialResult), MAX_OUTPUT_LENGTH) });
    },
    finishTool(toolCallId, result, isError) {
      update(`${input.requestId}:tool:${toolCallId}`, {
        status: isError ? "error" : "complete",
        output: serialize(extractToolOutput(result), MAX_OUTPUT_LENGTH)
      });
    },
    upsertTask(task) {
      const id = `${input.requestId}:task:${task.id}`;
      const current = activities.get(id);
      const patch = {
        kind: "task" as const,
        status: taskActivityStatus(task.status),
        title: task.subject,
        detail: task.description,
        taskId: task.id,
        activeForm: task.activeForm,
        toolName: undefined
      };
      if (current) {
        update(id, patch);
      } else {
        upsert(create(id, patch));
      }
    },
    finishAll() {
      for (const activity of activities.values()) {
        if (activity.status !== "running") continue;
        update(activity.id, { status: activity.kind === "task" ? "stopped" : "complete" });
      }
    },
    stopRunning(status) {
      for (const activity of activities.values()) {
        if (activity.status === "running") update(activity.id, { status });
      }
    }
  };
}
