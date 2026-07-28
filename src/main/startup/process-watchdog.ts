import { execFile, spawn } from "node:child_process";
import path from "node:path";
import {
  HIDDEN_STARTUP_LAUNCH_ARG,
  NO_TRAY_HIDDEN_STARTUP_ARG,
  resolveWindowsSquirrelStubLauncher
} from "./startup-launch-service";

export const PROCESS_WATCHDOG_LAUNCH_ARG = "--process-watchdog";
export const PROCESS_WATCHDOG_TASK_NAME = "Moshu Process Watchdog";
export const PROCESS_WATCHDOG_INTERVAL_MINUTES = 5;

type ProcessWatchdogUnsupportedReason = "not_windows" | "not_packaged";

export type ProcessWatchdogRuntimeStatus = {
  readonly supported: boolean;
  readonly registrationState: "not_supported" | "pending" | "installed" | "failed";
  readonly intervalMinutes: number;
  readonly lastRegistrationAttemptAt: string | null;
  readonly lastRegistrationSuccessAt: string | null;
  readonly lastProbeAt: string | null;
  readonly lastRecoveryLaunchAt: string | null;
};

export type ProcessWatchdogRuntimeMonitorOptions = {
  readonly platform?: NodeJS.Platform;
  readonly isPackaged: boolean;
  readonly now?: () => Date;
};

export type ProcessWatchdogStatus = {
  readonly supported: boolean;
  readonly installed: boolean;
  readonly reason: ProcessWatchdogUnsupportedReason | null;
};

export class ProcessWatchdogRuntimeMonitor {
  private readonly now: () => Date;
  private status: ProcessWatchdogRuntimeStatus;

  constructor(options: ProcessWatchdogRuntimeMonitorOptions) {
    this.now = options.now ?? (() => new Date());
    const supported = (options.platform ?? process.platform) === "win32" && options.isPackaged;
    this.status = {
      supported,
      registrationState: supported ? "pending" : "not_supported",
      intervalMinutes: PROCESS_WATCHDOG_INTERVAL_MINUTES,
      lastRegistrationAttemptAt: null,
      lastRegistrationSuccessAt: null,
      lastProbeAt: null,
      lastRecoveryLaunchAt: null
    };
  }

  getStatus(): ProcessWatchdogRuntimeStatus {
    return { ...this.status };
  }

  recordRegistrationAttempt(): void {
    if (!this.status.supported) {
      return;
    }
    this.status = {
      ...this.status,
      registrationState: "pending",
      lastRegistrationAttemptAt: this.now().toISOString()
    };
  }

  recordRegistrationSuccess(): void {
    if (!this.status.supported) {
      return;
    }
    this.status = {
      ...this.status,
      registrationState: "installed",
      lastRegistrationSuccessAt: this.now().toISOString()
    };
  }

  recordRegistrationFailure(): void {
    if (!this.status.supported) {
      return;
    }
    this.status = {
      ...this.status,
      registrationState: "failed"
    };
  }

  recordProbe(): void {
    if (!this.status.supported) {
      return;
    }
    this.status = {
      ...this.status,
      lastProbeAt: this.now().toISOString()
    };
  }

  recordRecoveryLaunch(): void {
    if (!this.status.supported) {
      return;
    }
    this.status = {
      ...this.status,
      lastRecoveryLaunchAt: this.now().toISOString()
    };
  }
}

type RunCommand = (command: string, args: readonly string[]) => Promise<void>;

export type WindowsProcessWatchdogOptions = {
  readonly platform?: NodeJS.Platform;
  readonly isPackaged: boolean;
  readonly execPath?: string;
  readonly systemRoot?: string;
  readonly runCommand?: RunCommand;
};

function runCommand(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, [...args], { windowsHide: true, timeout: 30_000 }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    child.stdin?.end();
  });
}

function resolveSchtasksExecutable(systemRoot: string | undefined): string {
  return systemRoot
    ? path.win32.join(systemRoot, "System32", "schtasks.exe")
    : "schtasks.exe";
}

function processWatchdogArguments(): readonly string[] {
  return [
    HIDDEN_STARTUP_LAUNCH_ARG,
    NO_TRAY_HIDDEN_STARTUP_ARG,
    PROCESS_WATCHDOG_LAUNCH_ARG
  ];
}

export function buildProcessWatchdogTaskAction(execPath: string): string {
  const launcherPath = resolveWindowsSquirrelStubLauncher(execPath);
  if (launcherPath.includes('"')) {
    throw new Error("Windows watchdog launcher path is invalid.");
  }
  return `"${launcherPath}" ${processWatchdogArguments().join(" ")}`;
}

export function isProcessWatchdogLaunch(argv: readonly string[] = process.argv): boolean {
  return argv.includes(PROCESS_WATCHDOG_LAUNCH_ARG);
}

export function shouldRevealMainWindowForSecondInstance(argv: readonly string[]): boolean {
  return !isProcessWatchdogLaunch(argv);
}

export class WindowsProcessWatchdogService {
  private readonly platform: NodeJS.Platform;
  private readonly execPath: string;
  private readonly systemRoot: string | undefined;
  private readonly commandRunner: RunCommand;

  constructor(private readonly options: WindowsProcessWatchdogOptions) {
    this.platform = options.platform ?? process.platform;
    this.execPath = options.execPath ?? process.execPath;
    this.systemRoot = options.systemRoot ?? process.env.SystemRoot;
    this.commandRunner = options.runCommand ?? runCommand;
  }

  async ensureInstalled(): Promise<ProcessWatchdogStatus> {
    const reason = this.unsupportedReason();
    if (reason) {
      return {
        supported: false,
        installed: false,
        reason
      };
    }

    await this.commandRunner(resolveSchtasksExecutable(this.systemRoot), [
      "/Create",
      "/F",
      "/TN",
      PROCESS_WATCHDOG_TASK_NAME,
      "/SC",
      "MINUTE",
      "/MO",
      String(PROCESS_WATCHDOG_INTERVAL_MINUTES),
      "/TR",
      buildProcessWatchdogTaskAction(this.execPath),
      "/IT",
      "/RL",
      "LIMITED"
    ]);

    return {
      supported: true,
      installed: true,
      reason: null
    };
  }

  private unsupportedReason(): ProcessWatchdogUnsupportedReason | null {
    if (this.platform !== "win32") {
      return "not_windows";
    }
    if (!this.options.isPackaged) {
      return "not_packaged";
    }
    return null;
  }
}

export function removeProcessWatchdogTaskDetached(
  platform: NodeJS.Platform = process.platform,
  systemRoot: string | undefined = process.env.SystemRoot
): void {
  if (platform !== "win32") {
    return;
  }

  spawn(
    resolveSchtasksExecutable(systemRoot),
    ["/Delete", "/F", "/TN", PROCESS_WATCHDOG_TASK_NAME],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }
  ).unref();
}
