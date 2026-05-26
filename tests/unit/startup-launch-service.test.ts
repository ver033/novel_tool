import { describe, expect, it, vi } from "vitest";
import { StartupLaunchService, resolveWindowsSquirrelStubLauncher } from "../../src/main/startup/startup-launch-service";

describe("StartupLaunchService", () => {
  function createPreferenceStore(defaultEnabledApplied = false) {
    return {
      getDefaultEnabledApplied: vi.fn(() => defaultEnabledApplied),
      setDefaultEnabledApplied: vi.fn((value: boolean) => {
        defaultEnabledApplied = value;
      })
    };
  }

  it("uses the Squirrel stub launcher when enabling Windows startup launch", () => {
    const setLoginItemSettings = vi.fn();
    const service = new StartupLaunchService(
      {
        isPackaged: true,
        getLoginItemSettings: () => ({ openAtLogin: true }),
        setLoginItemSettings
      },
      {
        platform: "win32",
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.6.1\\novel-tool.exe"
      }
    );

    service.setEnabled(true);

    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      enabled: true,
      name: "Moshu",
      path: "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe",
      args: []
    });
  });

  it("reads Windows startup launch status with the same Squirrel launcher options", () => {
    const getLoginItemSettings = vi.fn(() => ({ openAtLogin: true, executableWillLaunchAtLogin: true }));
    const service = new StartupLaunchService(
      {
        isPackaged: true,
        getLoginItemSettings,
        setLoginItemSettings: vi.fn()
      },
      {
        platform: "win32",
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.6.1\\novel-tool.exe"
      }
    );

    const status = service.getStatus();

    expect(status).toEqual({
      supported: true,
      enabled: true,
      reason: null
    });
    expect(getLoginItemSettings).toHaveBeenCalledWith({
      name: "Moshu",
      path: "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe",
      args: []
    });
  });

  it("enables Windows startup launch by default once for packaged Windows builds", () => {
    const setLoginItemSettings = vi.fn();
    const preferenceStore = createPreferenceStore(false);
    const service = new StartupLaunchService(
      {
        isPackaged: true,
        getLoginItemSettings: () => ({ openAtLogin: true, executableWillLaunchAtLogin: true }),
        setLoginItemSettings
      },
      {
        platform: "win32",
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.6.1\\novel-tool.exe"
      },
      preferenceStore
    );

    const status = service.ensureDefaultEnabled();

    expect(status.enabled).toBe(true);
    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      enabled: true,
      name: "Moshu",
      path: "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe",
      args: []
    });
    expect(preferenceStore.setDefaultEnabledApplied).toHaveBeenCalledWith(true);
  });

  it("does not force startup launch back on after the default has already been applied", () => {
    const setLoginItemSettings = vi.fn();
    const service = new StartupLaunchService(
      {
        isPackaged: true,
        getLoginItemSettings: () => ({ openAtLogin: false, executableWillLaunchAtLogin: false }),
        setLoginItemSettings
      },
      {
        platform: "win32",
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.6.1\\novel-tool.exe"
      },
      createPreferenceStore(true)
    );

    const status = service.ensureDefaultEnabled();

    expect(status.enabled).toBe(false);
    expect(setLoginItemSettings).not.toHaveBeenCalled();
  });

  it("does not expose startup launch on non-Windows or unpackaged builds", () => {
    const nonWindows = new StartupLaunchService(
      {
        isPackaged: true,
        getLoginItemSettings: vi.fn(),
        setLoginItemSettings: vi.fn()
      },
      { platform: "darwin", execPath: "/Applications/墨枢.app/Contents/MacOS/novel-tool" }
    );
    const unpackagedWindows = new StartupLaunchService(
      {
        isPackaged: false,
        getLoginItemSettings: vi.fn(),
        setLoginItemSettings: vi.fn()
      },
      { platform: "win32", execPath: "C:\\repo\\node_modules\\electron\\dist\\electron.exe" }
    );

    expect(nonWindows.getStatus()).toEqual({
      supported: false,
      enabled: false,
      reason: "not_windows"
    });
    expect(unpackagedWindows.getStatus()).toEqual({
      supported: false,
      enabled: false,
      reason: "not_packaged"
    });
    expect(() => nonWindows.setEnabled(true)).toThrow("开机自启动只支持 Windows 安装版。");
    expect(() => unpackagedWindows.setEnabled(true)).toThrow("开机自启动只支持 Windows 安装版。");
  });

  it("resolves the Windows Squirrel stub launcher without depending on the versioned app folder", () => {
    expect(resolveWindowsSquirrelStubLauncher("C:\\Users\\me\\AppData\\Local\\moshu\\app-1.6.1\\novel-tool.exe")).toBe(
      "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe"
    );
  });
});
