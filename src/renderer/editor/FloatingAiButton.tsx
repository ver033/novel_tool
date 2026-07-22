import { Sparkle } from "@phosphor-icons/react";
import { useI18n } from "../i18n";

type FloatingAiButtonProps = {
  readonly onClick: () => void;
};

export function FloatingAiButton({ onClick }: FloatingAiButtonProps) {
  const { locale } = useI18n();
  const label = locale === "ja-JP" ? "AI チャットを開く" : "打开 AI 对话";
  return (
    <button className="floating-ai" onClick={onClick} type="button" aria-label={label} title={label}>
      <Sparkle size={25} weight="regular" />
    </button>
  );
}
