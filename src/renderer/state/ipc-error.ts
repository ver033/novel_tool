const ipcInvokePrefixPattern = /^Error invoking remote method '[^']+': Error: /;
const ipcHandlerPrefixPattern = /^Error occurred in handler for '[^']+': Error: /;

export function formatIpcErrorMessage(reason: unknown, fallback: string): string {
  const rawMessage = reason instanceof Error ? reason.message : String(reason);
  const withoutHandlerStack = rawMessage.split("\nError occurred in handler for ")[0] ?? rawMessage;
  const message = withoutHandlerStack
    .replace(ipcInvokePrefixPattern, "")
    .replace(ipcHandlerPrefixPattern, "")
    .split(/\n\s+at\s+/)[0]
    ?.trim();
  return message || fallback;
}
