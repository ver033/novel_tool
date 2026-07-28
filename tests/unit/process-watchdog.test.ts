import { describe, expect, it, vi } from "vitest";
import {
  PROCESS_WATCHDOG_LAUNCH_ARG,
  PROCESS_WATCHDOG_TASK_NAME,
  ProcessWatchdogRuntimeMonitor,
  WindowsProcessWatchdogService,
  buildProcessWatchdogTaskAction,
  shouldRevealMainWindowForSecondInstance
} from "../../src/main/startup/process-watchdog";

describe("Windows process watchdog", () => {
  const execPath = "C:\\Users\\me\\AppData\\Local\\moshu\\app-2.1.2\\novel-tool.exe";

  it("creates a limited current-user task that checks the app every hour", async () => {
    const runCommand = vi.fn(async () => undefined);
    const service = new WindowsProcessWatchdogService({
      platform: "win32",
      isPackaged: true,
      execPath,
      systemRoot: "C:\\Windows",
      runCommand
    });

    await expect(service.ensureInstalled()).resolves.toEqual({
      supported: true,
      installed: true,
      reason: null
    });
    expect(runCommand).toHaveBeenCalledWith(
      "C:\\Windows\\System32\\schtasks.exe",
      [
        "/Create",
        "/F",
        "/TN",
        PROCESS_WATCHDOG_TASK_NAME,
        "/SC",
        "MINUTE",
        "/MO",
        "60",
        "/TR",
        '"C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe" --hidden-startup --hidden-startup-no-tray --process-watchdog',
        "/IT",
        "/RL",
        "LIMITED"
      ]
    );
  });

  it("builds a quoted action against the stable Squirrel launcher", () => {
    expect(buildProcessWatchdogTaskAction(execPath)).toBe(
      '"C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe" --hidden-startup --hidden-startup-no-tray --process-watchdog'
    );
  });

  it("does not touch Task Scheduler outside a packaged Windows build", async () => {
    const runCommand = vi.fn(async () => undefined);
    const service = new WindowsProcessWatchdogService({
      platform: "darwin",
      isPackaged: true,
      execPath: "/Applications/墨枢.app/Contents/MacOS/novel-tool",
      runCommand
    });

    await expect(service.ensureInstalled()).resolves.toEqual({
      supported: false,
      installed: false,
      reason: "not_windows"
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("keeps watchdog probes silent when a healthy primary instance receives them", () => {
    expect(shouldRevealMainWindowForSecondInstance(["novel-tool.exe", PROCESS_WATCHDOG_LAUNCH_ARG])).toBe(false);
    expect(shouldRevealMainWindowForSecondInstance(["novel-tool.exe", "--hidden-startup"])).toBe(true);
    expect(shouldRevealMainWindowForSecondInstance(["novel-tool.exe"])).toBe(true);
  });

  it("tracks registration, health probes, and recovery launches without retaining command details", () => {
    let now = new Date("2026-05-19T08:50:00.000Z");
    const monitor = new ProcessWatchdogRuntimeMonitor({
      platform: "win32",
      isPackaged: true,
      now: () => now
    });

    monitor.recordRegistrationAttempt();
    now = new Date("2026-05-19T08:50:01.000Z");
    monitor.recordRegistrationSuccess();
    now = new Date("2026-05-19T08:55:00.000Z");
    monitor.recordProbe();
    now = new Date("2026-05-19T09:00:00.000Z");
    monitor.recordRecoveryLaunch();

    expect(monitor.getStatus()).toEqual({
      supported: true,
      registrationState: "installed",
      intervalMinutes: 60,
      lastRegistrationAttemptAt: "2026-05-19T08:50:00.000Z",
      lastRegistrationSuccessAt: "2026-05-19T08:50:01.000Z",
      lastProbeAt: "2026-05-19T08:55:00.000Z",
      lastRecoveryLaunchAt: "2026-05-19T09:00:00.000Z"
    });
  });
});
