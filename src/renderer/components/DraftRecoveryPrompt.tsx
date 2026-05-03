import { Button } from "./Button";
import type { EditorDraftRecord } from "../state/draft-recovery-store";

type DraftRecoveryPromptProps = {
  readonly draft: EditorDraftRecord;
  readonly onRecover: () => void;
  readonly onDismiss: () => void;
};

function formatDraftTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "时间未知";
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function DraftRecoveryPrompt({ draft, onDismiss, onRecover }: DraftRecoveryPromptProps) {
  return (
    <div className="draft-recovery-prompt" role="alert">
      <div className="draft-recovery-copy">
        <strong>发现未恢复草稿</strong>
        <span>这章有一份比当前项目文件更新的本地草稿。你可以先恢复，也可以忽略。</span>
        <small>
          {draft.chapterTitle} · {formatDraftTime(draft.updatedAt)} · {draft.wordCount.toLocaleString("zh-CN")} 字
        </small>
      </div>
      <div className="draft-recovery-actions">
        <Button onClick={onDismiss} type="button" variant="ghost">
          忽略
        </Button>
        <Button onClick={onRecover} type="button" variant="primary">
          恢复草稿
        </Button>
      </div>
    </div>
  );
}
