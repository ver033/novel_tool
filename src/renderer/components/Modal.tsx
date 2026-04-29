import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

type ModalProps = {
  readonly open: boolean;
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
};

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function Modal({ open, title, children, onClose }: ModalProps) {
  const titleId = useId();
  const modalRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const firstFocusable = modalRef.current?.querySelector<HTMLElement>(focusableSelector);
    firstFocusable?.focus();
    return undefined;
  }, [open]);

  if (!open) return null;

  function closeOnBackdrop(event: MouseEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }

    const focusable = Array.from(modalRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={closeOnBackdrop} role="presentation">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal"
        onKeyDown={handleKeyDown}
        ref={modalRef}
        role="dialog"
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </section>
    </div>
  );
}
