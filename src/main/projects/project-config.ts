import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type ProjectConfig, projectConfigSchema } from "../../shared/project-config-schema";

export const DEFAULT_PROJECT_CONFIG: Omit<ProjectConfig, "projectName"> = {
  schemaVersion: 1,
  language: "zh-CN",
  defaultOpenState: {},
  taskModelProfile: {
    chat: { modelRole: "pro", reasoningEffort: "high", thinkingMode: "enabled" },
    polish: { modelRole: "flash", reasoningEffort: "high", thinkingMode: "disabled" },
    continuity: { modelRole: "pro", reasoningEffort: "high", thinkingMode: "enabled" },
    expand: { modelRole: "pro", reasoningEffort: "high", thinkingMode: "enabled" },
    proofread: { modelRole: "flash", reasoningEffort: "high", thinkingMode: "disabled" },
    memory: { modelRole: "flash", reasoningEffort: "high", thinkingMode: "enabled" }
  },
  customInstructions: {
    global: "保持作者风格，所有新增事实必须列出并等待确认。",
    polish: "保守润色，减少 AI 腔，不新增事实。",
    expand: "先覆盖情节要点，再补动作、环境和停顿。",
    proofread: "优先检查中文标点、称谓、道具名和表达别扭。",
    continuity: "证据不足时返回不确定，不直接判错。",
    chat: "回答必须列出来源段落。"
  },
  agentDefaults: {
    chatExecutionMode: "suggest_only",
    requireApprovalForWrites: true,
    showToolTrace: true,
    allowedTools: [
      "context_builder",
      "full_text_search",
      "canon_lookup",
      "memory_lookup",
      "diff_proposal",
      "issue_update_proposal"
    ]
  },
  contextReferences: {
    paragraphIds: []
  }
};

const secretKeyPattern = /(api[_-]?key|authorization|secret|token|providerApiKey)/i;

function containsSecretKey(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsSecretKey(item));
  }
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    return secretKeyPattern.test(key) || containsSecretKey(child);
  });
}

function configPath(projectPath: string): string {
  return path.join(projectPath, "project-config.json");
}

export function defaultProjectConfig(projectName: string): ProjectConfig {
  return projectConfigSchema.parse({
    ...DEFAULT_PROJECT_CONFIG,
    projectName
  });
}

export async function readProjectConfig(projectPath: string): Promise<ProjectConfig> {
  const raw = await readFile(configPath(projectPath), "utf8");
  return projectConfigSchema.parse(JSON.parse(raw));
}

export async function writeProjectConfig(projectPath: string, input: unknown): Promise<ProjectConfig> {
  if (containsSecretKey(input)) {
    throw new Error("Project config must not contain provider secrets");
  }
  const config = projectConfigSchema.parse(input);
  await writeFile(configPath(projectPath), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}
