export const AI_PROVIDER_TYPES = ["openrouter", "deepseek", "tencent-tokenhub"] as const;

export type AiProviderType = (typeof AI_PROVIDER_TYPES)[number];

export const BACKGROUND_AUTOMATION_PROVIDER_TYPE: AiProviderType =
  "tencent-tokenhub";

export type AiProviderDefaults = {
  readonly baseUrl: string;
  readonly modelName: string;
  readonly connectionTestModel: string;
};

export const AI_PROVIDER_DEFAULTS: Record<AiProviderType, AiProviderDefaults> = {
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    modelName: "openai/gpt-5.2",
    connectionTestModel: "openrouter/auto"
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    modelName: "deepseek-v4-flash",
    connectionTestModel: "deepseek-v4-flash"
  },
  "tencent-tokenhub": {
    baseUrl: "https://tokenhub.tencentmaas.com/v1",
    modelName: "deepseek-v4-flash",
    connectionTestModel: "deepseek-v4-flash"
  }
};

export const DEEPSEEK_MODEL_SUMMARIES = [
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    contextLength: 1_000_000,
    supportsTools: true
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    contextLength: 1_000_000,
    supportsTools: true
  }
] as const;

export const TENCENT_TOKENHUB_ENDPOINTS = [
  {
    id: "guangzhou",
    baseUrl: "https://tokenhub.tencentmaas.com/v1",
    labelZh: "广州（中国大陆）",
    labelJa: "広州（中国大陸）"
  },
  {
    id: "singapore",
    baseUrl: "https://tokenhub-intl.tencentmaas.com/v1",
    labelZh: "新加坡（全球）",
    labelJa: "シンガポール（グローバル）"
  },
  {
    id: "guangzhou-backup",
    baseUrl: "https://tokenhub.tencentmaas.cn/v1",
    labelZh: "广州备用地址",
    labelJa: "広州の予備アドレス"
  },
  {
    id: "singapore-backup",
    baseUrl: "https://tokenhub-intl.tencentmaas.cn/v1",
    labelZh: "新加坡备用地址",
    labelJa: "シンガポールの予備アドレス"
  }
] as const;

export const TENCENT_TOKENHUB_KNOWN_MODEL_SUMMARIES = [
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    contextLength: 1_000_000,
    supportsTools: true
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    contextLength: 1_000_000,
    supportsTools: true
  },
  {
    id: "deepseek-v4-flash-202605",
    name: "DeepSeek V4 Flash 202605",
    contextLength: 1_000_000,
    supportsTools: true
  },
  {
    id: "deepseek-v4-pro-202606",
    name: "DeepSeek V4 Pro 202606",
    contextLength: 1_000_000,
    supportsTools: true
  },
  {
    id: "deepseek-v3.2",
    name: "DeepSeek V3.2",
    contextLength: 128_000,
    supportsTools: true
  }
] as const;

export function isAiProviderType(value: unknown): value is AiProviderType {
  return typeof value === "string" && (AI_PROVIDER_TYPES as readonly string[]).includes(value);
}

export function getAiProviderDefaults(providerType: AiProviderType): AiProviderDefaults {
  return AI_PROVIDER_DEFAULTS[providerType];
}

export function getAiProviderDisplayName(providerType: AiProviderType): string {
  if (providerType === "deepseek") {
    return "DeepSeek";
  }
  return providerType === "tencent-tokenhub" ? "腾讯云 TokenHub" : "OpenRouter";
}
