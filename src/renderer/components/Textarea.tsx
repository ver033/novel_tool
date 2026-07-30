import { useLayoutEffect, useRef, type ChangeEvent, type TextareaHTMLAttributes } from "react";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  readonly autoResize?: boolean;
  readonly maxAutoHeight?: number;
};

function resizeTextarea(element: HTMLTextAreaElement, maxAutoHeight: number): void {
  element.style.height = "auto";
  const nextHeight = Math.min(element.scrollHeight, maxAutoHeight);
  element.style.height = `${nextHeight}px`;
  element.style.overflowY = element.scrollHeight > maxAutoHeight ? "auto" : "hidden";
}

export function Textarea({
  autoResize = false,
  className = "",
  maxAutoHeight = 280,
  onChange,
  value,
  ...props
}: TextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    if (autoResize && textareaRef.current) {
      resizeTextarea(textareaRef.current, maxAutoHeight);
    }
  }, [autoResize, maxAutoHeight, value]);

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    if (autoResize) {
      resizeTextarea(event.currentTarget, maxAutoHeight);
    }
    onChange?.(event);
  }

  return (
    <textarea
      className={`text-box ${className}`.trim()}
      onChange={handleChange}
      ref={textareaRef}
      value={value}
      {...props}
    />
  );
}
