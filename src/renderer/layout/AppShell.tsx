import type { ReactNode } from "react";

type AppShellProps = {
  readonly children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return <div className="app">{children}</div>;
}
