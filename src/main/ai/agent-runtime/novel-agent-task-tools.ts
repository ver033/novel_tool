import type { ContentLanguage } from "../../shared/language";
import type { NovelAgentToolDefinition } from "./novel-agent-runtime";

export const NOVEL_AGENT_TASK_CREATE_TOOL = "task_create";
export const NOVEL_AGENT_TASK_UPDATE_TOOL = "task_update";

export type NovelAgentTaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "cancelled" | "error";

export type NovelAgentTask = {
  readonly id: string;
  readonly subject: string;
  readonly description?: string;
  readonly activeForm?: string;
  readonly status: NovelAgentTaskStatus;
};

export type NovelAgentTaskExecution = {
  readonly content: string;
  readonly task: NovelAgentTask;
};

export type NovelAgentTaskTools = {
  readonly definitions: readonly NovelAgentToolDefinition[];
  readonly has: (toolName: string) => boolean;
  readonly execute: (toolName: string, params: unknown) => NovelAgentTaskExecution;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function taskStatus(value: unknown, fallback: NovelAgentTaskStatus): NovelAgentTaskStatus {
  return value === "pending"
    || value === "in_progress"
    || value === "completed"
    || value === "blocked"
    || value === "cancelled"
    || value === "error"
    ? value
    : fallback;
}

function definitions(language: ContentLanguage): readonly NovelAgentToolDefinition[] {
  const japanese = language === "ja-JP";
  return [
    {
      name: NOVEL_AGENT_TASK_CREATE_TOOL,
      description: japanese
        ? "複数の独立した手順がある、または長時間かかる依頼だけに可視タスクを作成します。直接回答や単一のツール呼び出しには使用しないでください。"
        : "仅在请求包含多个独立步骤或需要较长时间时创建可见任务。直接回答或单次工具调用不要使用。",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: japanese ? "短いタスク名" : "简短任务名称" },
          description: { type: "string", description: japanese ? "任意の補足説明" : "可选任务说明" },
          activeForm: { type: "string", description: japanese ? "実行中に表示する表現" : "执行中显示的进行时描述" }
        },
        required: ["subject"],
        additionalProperties: false
      }
    },
    {
      name: NOVEL_AGENT_TASK_UPDATE_TOOL,
      description: japanese
        ? "作成済みの可視タスクの状態や実行中表示を更新します。"
        : "更新已有可见任务的状态或执行中描述。",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: japanese ? "作成結果で返されたタスク ID" : "创建结果返回的任务 ID" },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "blocked", "cancelled", "error"]
          },
          subject: { type: "string" },
          description: { type: "string" },
          activeForm: { type: "string" }
        },
        required: ["taskId"],
        additionalProperties: false
      }
    }
  ];
}

export function createNovelAgentTaskTools(language: ContentLanguage): NovelAgentTaskTools {
  const tasks = new Map<string, NovelAgentTask>();
  let nextTaskId = 1;
  const toolDefinitions = definitions(language);
  const supported = new Set(toolDefinitions.map((definition) => definition.name));

  return {
    definitions: toolDefinitions,
    has: (toolName) => supported.has(toolName),
    execute(toolName, params) {
      const input = asRecord(params);
      if (toolName === NOVEL_AGENT_TASK_CREATE_TOOL) {
        const id = String(nextTaskId++);
        const subject = optionalText(input.subject);
        if (!subject) {
          throw new Error(language === "ja-JP" ? "タスク名が必要です。" : "任务名称不能为空。");
        }
        const task: NovelAgentTask = {
          id,
          subject,
          description: optionalText(input.description),
          activeForm: optionalText(input.activeForm),
          status: "pending"
        };
        tasks.set(id, task);
        return { content: JSON.stringify({ task }), task };
      }

      if (toolName === NOVEL_AGENT_TASK_UPDATE_TOOL) {
        const id = optionalText(input.taskId);
        if (!id) {
          throw new Error(language === "ja-JP" ? "タスク ID が必要です。" : "任务 ID 不能为空。");
        }
        const current = tasks.get(id);
        if (!current) {
          throw new Error(language === "ja-JP" ? `タスクが見つかりません: ${id}` : `找不到任务：${id}`);
        }
        const task: NovelAgentTask = {
          id,
          subject: optionalText(input.subject) ?? current.subject,
          description: optionalText(input.description) ?? current.description,
          activeForm: optionalText(input.activeForm) ?? current.activeForm,
          status: taskStatus(input.status, current.status)
        };
        tasks.set(id, task);
        return { content: JSON.stringify({ task }), task };
      }

      throw new Error(language === "ja-JP" ? `未対応の内部ツールです: ${toolName}` : `不支持的内部工具：${toolName}`);
    }
  };
}
