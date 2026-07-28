import { spawn } from "node:child_process";
import path from "node:path";
import { removeProcessWatchdogTaskDetached } from "./startup/process-watchdog";

type WindowsSquirrelStartupOptions = {
  readonly argv?: readonly string[];
  readonly platform?: NodeJS.Platform;
  readonly exeName?: string;
  readonly quit: () => void;
  readonly runUpdateCommand?: (args: readonly string[]) => void;
  readonly removeProcessWatchdog?: () => void;
};

function runSquirrelUpdateCommand(args: readonly string[]): void {
  const updateExe = path.resolve(path.dirname(process.execPath), "..", "Update.exe");
  spawn(updateExe, [...args], { detached: true, stdio: "ignore" }).unref();
}

export function handleWindowsSquirrelStartupEvent(options: WindowsSquirrelStartupOptions): boolean {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return false;
  }

  const argv = options.argv ?? process.argv;
  const squirrelEvent = argv[1];
  if (!squirrelEvent?.startsWith("--squirrel-")) {
    return false;
  }

  const runUpdateCommand = options.runUpdateCommand ?? runSquirrelUpdateCommand;
  const exeName = options.exeName ?? path.basename(process.execPath);

  if (squirrelEvent === "--squirrel-install" || squirrelEvent === "--squirrel-updated") {
    runUpdateCommand(["--createShortcut", exeName]);
    options.quit();
    return true;
  }

  if (squirrelEvent === "--squirrel-uninstall") {
    runUpdateCommand(["--removeShortcut", exeName]);
    (options.removeProcessWatchdog ?? removeProcessWatchdogTaskDetached)();
    options.quit();
    return true;
  }

  if (squirrelEvent === "--squirrel-obsolete") {
    options.quit();
    return true;
  }

  return false;
}
