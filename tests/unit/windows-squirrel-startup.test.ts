import { describe, expect, it, vi } from "vitest";
import { handleWindowsSquirrelStartupEvent } from "../../src/main/windows-squirrel-startup";

describe("Windows Squirrel startup events", () => {
  it("handles install events before the app creates a BrowserWindow", () => {
    const quit = vi.fn();
    const runUpdateCommand = vi.fn();

    const handled = handleWindowsSquirrelStartupEvent({
      argv: ["novel-tool.exe", "--squirrel-install"],
      platform: "win32",
      exeName: "novel-tool.exe",
      quit,
      runUpdateCommand
    });

    expect(handled).toBe(true);
    expect(runUpdateCommand).toHaveBeenCalledWith(["--createShortcut", "novel-tool.exe"]);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("ignores normal launches", () => {
    const quit = vi.fn();
    const runUpdateCommand = vi.fn();

    const handled = handleWindowsSquirrelStartupEvent({
      argv: ["novel-tool.exe"],
      platform: "win32",
      exeName: "novel-tool.exe",
      quit,
      runUpdateCommand
    });

    expect(handled).toBe(false);
    expect(runUpdateCommand).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });

  it("removes the external watchdog task during uninstall", () => {
    const quit = vi.fn();
    const runUpdateCommand = vi.fn();
    const removeProcessWatchdog = vi.fn();

    const handled = handleWindowsSquirrelStartupEvent({
      argv: ["novel-tool.exe", "--squirrel-uninstall"],
      platform: "win32",
      exeName: "novel-tool.exe",
      quit,
      runUpdateCommand,
      removeProcessWatchdog
    });

    expect(handled).toBe(true);
    expect(runUpdateCommand).toHaveBeenCalledWith(["--removeShortcut", "novel-tool.exe"]);
    expect(removeProcessWatchdog).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
  });
});
