import { Sparkle } from "@phosphor-icons/react";

type FloatingAiButtonProps = {
  readonly onClick: () => void;
};

export function FloatingAiButton({ onClick }: FloatingAiButtonProps) {
  return (
    <button className="floating-ai" onClick={onClick} type="button" aria-label="打开 AI 对话" title="打开 AI 对话">
      <Sparkle size={25} weight="regular" />
    </button>
  );
}
