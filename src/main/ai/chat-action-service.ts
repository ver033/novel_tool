import type { ChatAgentContext, ChatAgentPlan } from "./chat-agent-types";
import type { ScratchNoteRepository } from "../db/repositories/scratch-note-repo";
import type { AiChatAction, AiSendChatMessageStreamInput } from "../shared/types";

type ScratchNoteRepositoryResolver = (projectId: string) => ScratchNoteRepository;

function shouldAddSummaryToScratchpad(message: string): boolean {
  const normalized = message.replace(/\s+/g, "");
  return /草稿纸|草稿|素材/.test(normalized) && /加入|保存|存到|放到|记录/.test(normalized) && /总结|摘要|概括|提炼/.test(normalized);
}

export class ChatActionService {
  constructor(private readonly resolveScratchRepo: ScratchNoteRepositoryResolver) {}

  executePlannedActionFromChat(
    input: AiSendChatMessageStreamInput & { readonly agentContext?: ChatAgentContext },
    plan: ChatAgentPlan,
    assistantContent: string
  ): AiChatAction | null {
    if (!plan.actions.some((action) => action.type === "add_to_scratchpad")) {
      return null;
    }

    const content = assistantContent.trim();
    if (!content) {
      return null;
    }

    const sourceChapterIds = input.agentContext?.sourceChapterIds ?? [];
    const chapterId =
      plan.scope.type === "all_chapters" || plan.scope.type === "chapter_range" ? null : sourceChapterIds.length === 1 ? sourceChapterIds[0] : null;
    const action = {
      type: "add_to_scratchpad",
      content,
      chapterId
    } satisfies AiChatAction;

    this.resolveScratchRepo(input.projectId).create({
      projectId: input.projectId,
      chapterId: action.chapterId,
      content: action.content,
      pinned: false,
      sourceTaskId: null
    });

    return action;
  }

  executeSafeActionFromChat(input: AiSendChatMessageStreamInput, assistantContent: string): AiChatAction | null {
    const content = assistantContent.trim();
    if (!content || !shouldAddSummaryToScratchpad(input.message)) {
      return null;
    }

    const action = {
      type: "add_to_scratchpad",
      content,
      chapterId: input.chapterId ?? null
    } satisfies AiChatAction;

    this.resolveScratchRepo(input.projectId).create({
      projectId: input.projectId,
      chapterId: action.chapterId,
      content: action.content,
      pinned: false,
      sourceTaskId: null
    });

    return action;
  }
}
