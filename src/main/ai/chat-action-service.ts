import type { ScratchNoteRepository } from "../db/repositories/scratch-note-repo";
import type { AiChatAction, AiSendChatMessageStreamInput } from "../shared/types";

type ScratchNoteRepositoryResolver = (projectId: string) => ScratchNoteRepository;

function shouldAddSummaryToScratchpad(message: string): boolean {
  const normalized = message.replace(/\s+/g, "");
  return /草稿纸|草稿|素材/.test(normalized) && /总结|摘要|概括|提炼/.test(normalized);
}

export class ChatActionService {
  constructor(private readonly resolveScratchRepo: ScratchNoteRepositoryResolver) {}

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
