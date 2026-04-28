const ipcInvokePrefixPattern = /^Error invoking remote method '[^']+': Error: /;

export function formatIpcErrorMessage(reason: unknown, fallback: string): string {
  const rawMessage = reason instanceof Error ? reason.message : String(reason);
  const withoutHandlerStack = rawMessage.split("\nError occurred in handler for ")[0] ?? rawMessage;
  const message = withoutHandlerStack.replace(ipcInvokePrefixPattern, "").trim();
  return message || fallback;
}
