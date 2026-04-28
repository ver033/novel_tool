import type { ReactNode } from "react";

type ModalProps = {
  readonly open: boolean;
  readonly title: string;
  readonly children: ReactNode;
};

export function Modal({ open, title, children }: ModalProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label={title} className="modal">
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}
