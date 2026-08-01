import {
  OpenRouterClient,
  type OpenRouterChatCompletionInput,
  type OpenRouterChatCompletionResult,
  type OpenRouterClientOptions
} from "../ai/openrouter-client";
import type { SettingsService } from "../settings/settings-service";
import { getAiProviderDefaults } from "../shared/ai-provider";
import type { ExternalBookSyncProviderTransport } from "./book-sync-provider-failover";

type ExternalBookSyncClient = {
  readonly streamChatCompletion: (input: OpenRouterChatCompletionInput) => Promise<OpenRouterChatCompletionResult>;
};

type ExternalBookSyncProviderSettings = Pick<SettingsService, "getSettings" | "getAiConfigForProvider">;

export class SettingsExternalBookSyncProviderTransport implements ExternalBookSyncProviderTransport {
  constructor(
    private readonly settingsService: ExternalBookSyncProviderSettings,
    private readonly options: {
      readonly createClient?: (options: OpenRouterClientOptions) => ExternalBookSyncClient;
    } = {}
  ) {}

  isConfigured(provider: Parameters<ExternalBookSyncProviderTransport["isConfigured"]>[0]): boolean {
    return this.settingsService.getSettings().aiProviderKeyStatus[provider];
  }

  async send(input: Parameters<ExternalBookSyncProviderTransport["send"]>[0]): Promise<void> {
    const config = this.settingsService.getAiConfigForProvider(input.provider);
    const clientOptions: OpenRouterClientOptions = {
      providerType: config.providerType,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      modelName: input.provider === "openrouter"
        ? getAiProviderDefaults("openrouter").connectionTestModel
        : config.modelName
    };
    const client = this.options.createClient?.(clientOptions) ?? new OpenRouterClient(clientOptions);
    await client.streamChatCompletion({
      messages: [
        {
          role: "system",
          content: "这是外部同步投递。只回复 OK，不要复述、解释或处理用户内容。"
        },
        {
          role: "user",
          content: input.message
        }
      ],
      maxCompletionTokens: 8,
      reasoning: {
        enabled: false,
        effort: "none",
        exclude: true
      },
      temperature: 0
    });
  }
}
