import { describe, expect, it, vi } from "vitest";
import {
  HIDDEN_STARTUP_LAUNCH_ARG,
  NO_TRAY_HIDDEN_STARTUP_ARG,
  StartupLaunchService,
  resolveWindowsSquirrelStubLauncher
} from "../../src/main/startup/startup-launch-service";

const HIDDEN_NO_TRAY_STARTUP_ARGS = [HIDDEN_STARTUP_LAUNCH_ARG, NO_TRAY_HIDDEN_STARTUP_ARG];

describe("StartupLaunchService", () => {
  function createPreferenceStore(defaultEnabledApplied = false) {
    let userConfigured = false;
    return {
      getDefaultEnabledApplied: vi.fn(() => defaultEnabledApplied),
      setDefaultEnabledApplied: vi.fn((value: boolean) => {
        defaultEnabledApplied = value;
      }),
      getUserConfigured: vi.fn(() => userConfigured),
      setUserConfigured: vi.fn((value: boolean) => {
        userConfigured = value;
      })
    };
  }

  it("uses the Squirrel stub launcher and hidden startup argument when enabling Windows startup launch", () => {
    const setLoginItemSettings = vi.fn();
    const preferenceStore = createPreferenceStore();
    const service = new StartupLaunchService(
      {
        isPackaged: true,
        getLoginItemSettings: () => ({ openAtLogin: true }),
        setLoginItemSettings
      },
      {
        platform: "win32",
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.7.1\\novel-tool.exe"
      },
      preferenceStore
    );

    service.setEnabled(true);

    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      enabled: true,
      name: "Moshu",
      path: "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe",
      args: HIDDEN_NO_TRAY_STARTUP_ARGS
    });
    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: false,
      enabled: false,
      name: "Moshu",
      path: "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe",
      args: [HIDDEN_STARTUP_LAUNCH_ARG]
    });
    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: false,
      enabled: false,
      name: "Moshu",
      path: "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe",
      args: []
    });
    expect(preferenceStore.setUserConfigured).toHaveBeenCalledWith(true);
  });

  it("removes both hidden and legacy visible startup launch entries when disabling", () => {
    const setLoginItemSettings = vi.fn();
    const service = new StartupLaunchService(
      {
        isPackaged: true,
        getLoginItemSettings: () => ({ openAtLogin: false, executableWillLaunchAtLogin: false }),
        setLoginItemSettings
      },
      {
        platform: "win32",
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.7.1\\novel-tool.exe"
      },
      createPreferenceStore()
    );

    service.setEnabled(false);

    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: false,
      enabled: false,
      name: "Moshu",
      path: "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe",
      args: HIDDEN_NO_TRAY_STARTUP_ARGS
    });
    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: false,
      enabled: false,
      name: "Moshu",
      path: "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe",
      args: [HIDDEN_STARTUP_LAUNCH_ARG]
    });
    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: false,
      enabled: false,
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
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.7.1\\novel-tool.exe"
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
      args: HIDDEN_NO_TRAY_STARTUP_ARGS
    });
  });

  it("enables Windows startup launch by default for packaged Windows builds when the user has not configured it", () => {
    const setLoginItemSettings = vi.fn();
    const preferenceStore = createPreferenceStore(true);
    const service = new StartupLaunchService(
      {
        isPackaged: true,
        getLoginItemSettings: () => ({ openAtLogin: false, executableWillLaunchAtLogin: false }),
        setLoginItemSettings
      },
      {
        platform: "win32",
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.7.1\\novel-tool.exe"
      },
      preferenceStore
    );

    const status = service.ensureDefaultEnabled();

    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      enabled: true,
      name: "Moshu",
      path: "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe",
      args: HIDDEN_NO_TRAY_STARTUP_ARGS
    });
    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: false,
      enabled: false,
      name: "Moshu",
      path: "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe",
      args: [HIDDEN_STARTUP_LAUNCH_ARG]
    });
    expect(preferenceStore.setDefaultEnabledApplied).toHaveBeenCalledWith(true);
  });

  it("migrates the previous hidden startup registration to the no-tray hidden startup registration", () => {
    const setLoginItemSettings = vi.fn();
    const preferenceStore = createPreferenceStore(true);
    preferenceStore.setUserConfigured(true);
    const service = new StartupLaunchService(
      {
        isPackaged: true,
        getLoginItemSettings: (options) => ({
          openAtLogin: options.args.length === 1 && options.args[0] === HIDDEN_STARTUP_LAUNCH_ARG,
          executableWillLaunchAtLogin: options.args.length === 1 && options.args[0] === HIDDEN_STARTUP_LAUNCH_ARG
        }),
        setLoginItemSettings
      },
      {
        platform: "win32",
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.7.1\\novel-tool.exe"
      },
      preferenceStore
    );

    service.ensureDefaultEnabled();

    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      enabled: true,
      name: "Moshu",
      path: "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe",
      args: HIDDEN_NO_TRAY_STARTUP_ARGS
    });
    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: false,
      enabled: false,
      name: "Moshu",
      path: "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe",
      args: [HIDDEN_STARTUP_LAUNCH_ARG]
    });
  });

  it("does not force startup launch back on after the user has disabled it", () => {
    const setLoginItemSettings = vi.fn();
    const preferenceStore = createPreferenceStore(true);
    preferenceStore.setUserConfigured(true);
    const service = new StartupLaunchService(
      {
        isPackaged: true,
        getLoginItemSettings: () => ({ openAtLogin: false, executableWillLaunchAtLogin: false }),
        setLoginItemSettings
      },
      {
        platform: "win32",
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.7.1\\novel-tool.exe"
      },
      preferenceStore
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
    expect(resolveWindowsSquirrelStubLauncher("C:\\Users\\me\\AppData\\Local\\moshu\\app-1.7.1\\novel-tool.exe")).toBe(
      "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe"
    );
  });
});
