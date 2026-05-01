import { OpenRouterClient, type OpenRouterHttpRequest } from "./openrouter-client";
import type {
  OpenRouterConnectionTester,
  OpenRouterConnectionTestResult,
  OpenRouterRuntimeConfig
} from "../settings/settings-service";

type DefaultOpenRouterConnectionTesterDeps = {
  readonly httpPost?: (request: OpenRouterHttpRequest) => Promise<unknown>;
};

export class DefaultOpenRouterConnectionTester implements OpenRouterConnectionTester {
  constructor(private readonly deps: DefaultOpenRouterConnectionTesterDeps = {}) {}

  async testConnection(config: OpenRouterRuntimeConfig): Promise<OpenRouterConnectionTestResult> {
    const client = new OpenRouterClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      modelName: config.modelName,
      httpPost: this.deps.httpPost
    });

    await client.createChatCompletion({
      messages: [
        {
          role: "system",
          content: "你是连接测试助手。"
        },
        {
          role: "user",
          content: "请只回复 OK。"
        }
      ],
      maxCompletionTokens: 16,
      temperature: 0,
      allowEmptyContent: true
    });

    return {
      ok: true,
      modelName: config.modelName
    };
  }
}
