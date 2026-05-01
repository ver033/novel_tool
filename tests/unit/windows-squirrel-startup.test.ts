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
});
