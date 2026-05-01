import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "link";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
  readonly children: ReactNode;
};

const variantClass: Record<ButtonVariant, string> = {
  primary: "primary-button",
  secondary: "secondary-button",
  ghost: "ghost-button",
  link: "link-button"
};

export function Button({ variant = "secondary", className = "", children, ...props }: ButtonProps) {
  return (
    <button className={`${variantClass[variant]} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
