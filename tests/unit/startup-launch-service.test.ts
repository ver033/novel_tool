import { describe, expect, it, vi } from "vitest";
import {
  HIDDEN_STARTUP_LAUNCH_ARG,
  NO_TRAY_HIDDEN_STARTUP_ARG,
  StartupLaunchService,
  resolveWindowsSquirrelStubLauncher
} from "../../src/main/startup/startup-launch-service";

const HIDDEN_NO_TRAY_STARTUP_ARGS = [HIDDEN_STARTUP_LAUNCH_ARG, NO_TRAY_HIDDEN_STARTUP_ARG];
const HIDDEN_STARTUP_ARGS = [HIDDEN_STARTUP_LAUNCH_ARG];

type StoredLoginItem = {
  readonly path: string;
  readonly args: readonly string[];
  readonly openAtLogin: boolean;
  readonly enabled: boolean;
};

describe("StartupLaunchService", () => {
  function createPreferenceStore(defaultEnabledApplied = false) {
    let userConfigured = false;
    let desiredEnabled: boolean | null = null;
    return {
      getDefaultEnabledApplied: vi.fn(() => defaultEnabledApplied),
      setDefaultEnabledApplied: vi.fn((value: boolean) => {
        defaultEnabledApplied = value;
      }),
      getUserConfigured: vi.fn(() => userConfigured),
      setUserConfigured: vi.fn((value: boolean) => {
        userConfigured = value;
      }),
      getDesiredEnabled: vi.fn(() => desiredEnabled),
      setDesiredEnabled: vi.fn((value: boolean) => {
        desiredEnabled = value;
      })
    };
  }

  function createWindowsRegistryBackedApp() {
    const loginItems = new Map<string, StoredLoginItem>();
    return {
      app: {
        isPackaged: true,
        getLoginItemSettings: vi.fn((options: { readonly name: string; readonly path: string; readonly args: readonly string[] }) => {
          const item = loginItems.get(options.name);
          const samePath = item?.path === options.path;
          const sameArgs = JSON.stringify(item?.args ?? []) === JSON.stringify(options.args);
          return {
            openAtLogin: Boolean(item?.openAtLogin && samePath && sameArgs),
            executableWillLaunchAtLogin: Boolean(item?.openAtLogin && item.enabled && samePath)
          };
        }),
        setLoginItemSettings: vi.fn(
          (settings: { readonly name: string; readonly path: string; readonly args: readonly string[]; readonly openAtLogin: boolean; readonly enabled: boolean }) => {
            if (settings.openAtLogin) {
              loginItems.set(settings.name, {
                path: settings.path,
                args: settings.args,
                openAtLogin: settings.openAtLogin,
                enabled: settings.enabled
              });
              return;
            }
            loginItems.delete(settings.name);
          }
        )
      },
      loginItems
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
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.8.0\\novel-tool.exe"
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
    expect(preferenceStore.setUserConfigured).toHaveBeenCalledWith(true);
    expect(preferenceStore.setDesiredEnabled).toHaveBeenCalledWith(true);
  });

  it("keeps the enabled Windows login item after writing it because registry entries are keyed by name", () => {
    const preferenceStore = createPreferenceStore();
    const { app, loginItems } = createWindowsRegistryBackedApp();
    const service = new StartupLaunchService(
      app,
      {
        platform: "win32",
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.8.0\\novel-tool.exe"
      },
      preferenceStore
    );

    service.setEnabled(true);

    expect(loginItems.get("Moshu")).toEqual({
      path: "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe",
      args: HIDDEN_NO_TRAY_STARTUP_ARGS,
      openAtLogin: true,
      enabled: true
    });
  });

  it("keeps startup enabled and rejects attempts to disable the forced policy", () => {
    const preferenceStore = createPreferenceStore();
    const service = new StartupLaunchService(
      {
        isPackaged: true,
        getLoginItemSettings: () => ({ openAtLogin: false, executableWillLaunchAtLogin: false }),
        setLoginItemSettings: vi.fn()
      },
      {
        platform: "win32",
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.8.0\\novel-tool.exe"
      },
      preferenceStore
    );

    expect(service.setEnabled(true)).toEqual({
      supported: true,
      enabled: true,
      reason: null
    });
    expect(() => service.setEnabled(false)).toThrow("开机自启动已强制开启，不能关闭。");
  });

  it("does not remove the login item when a disable request is rejected", () => {
    const setLoginItemSettings = vi.fn();
    const service = new StartupLaunchService(
      {
        isPackaged: true,
        getLoginItemSettings: () => ({ openAtLogin: false, executableWillLaunchAtLogin: false }),
        setLoginItemSettings
      },
      {
        platform: "win32",
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.8.0\\novel-tool.exe"
      },
      createPreferenceStore()
    );

    expect(() => service.setEnabled(false)).toThrow("开机自启动已强制开启，不能关闭。");
    expect(setLoginItemSettings).not.toHaveBeenCalled();
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
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.8.0\\novel-tool.exe"
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

  it("enables Windows startup launch by default when the user has not configured it", () => {
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
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.8.0\\novel-tool.exe"
      },
      preferenceStore
    );

    const status = service.ensureForcedEnabled();

    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      enabled: true,
      name: "Moshu",
      path: "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe",
      args: HIDDEN_NO_TRAY_STARTUP_ARGS
    });
    expect(preferenceStore.setDefaultEnabledApplied).toHaveBeenCalledWith(true);
    expect(preferenceStore.setDesiredEnabled).toHaveBeenCalledWith(true);
    expect(status.enabled).toBe(true);
  });

  it("migrates the previous hidden startup registration to the no-tray hidden startup registration", () => {
    const setLoginItemSettings = vi.fn();
    const preferenceStore = createPreferenceStore(true);
    preferenceStore.setUserConfigured(true);
    const service = new StartupLaunchService(
      {
        isPackaged: true,
        getLoginItemSettings: (options) => ({
          openAtLogin: JSON.stringify(options.args) === JSON.stringify(HIDDEN_STARTUP_ARGS),
          executableWillLaunchAtLogin: JSON.stringify(options.args) === JSON.stringify(HIDDEN_STARTUP_ARGS)
        }),
        setLoginItemSettings
      },
      {
        platform: "win32",
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.8.0\\novel-tool.exe"
      },
      preferenceStore
    );

    service.ensureForcedEnabled();

    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      enabled: true,
      name: "Moshu",
      path: "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe",
      args: HIDDEN_NO_TRAY_STARTUP_ARGS
    });
    expect(preferenceStore.setDesiredEnabled).toHaveBeenCalledWith(true);
  });

  it("forces startup launch back on after the user has disabled it", () => {
    const setLoginItemSettings = vi.fn();
    const preferenceStore = createPreferenceStore(true);
    preferenceStore.setUserConfigured(true);
    preferenceStore.setDesiredEnabled(false);
    const service = new StartupLaunchService(
      {
        isPackaged: true,
        getLoginItemSettings: () => ({ openAtLogin: false, executableWillLaunchAtLogin: false }),
        setLoginItemSettings
      },
      {
        platform: "win32",
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.8.0\\novel-tool.exe"
      },
      preferenceStore
    );

    const status = service.ensureForcedEnabled();

    expect(status.enabled).toBe(true);
    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      enabled: true,
      name: "Moshu",
      path: "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe",
      args: HIDDEN_NO_TRAY_STARTUP_ARGS
    });
    expect(preferenceStore.setDesiredEnabled).toHaveBeenCalledWith(true);
  });

  it("forces startup on for stale preference records that predate the desired enabled field", () => {
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
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.8.0\\novel-tool.exe"
      },
      preferenceStore
    );

    const status = service.ensureForcedEnabled();

    expect(status.enabled).toBe(true);
    expect(preferenceStore.setDesiredEnabled).toHaveBeenCalledWith(true);
    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      enabled: true,
      name: "Moshu",
      path: "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe",
      args: HIDDEN_NO_TRAY_STARTUP_ARGS
    });
  });

  it("overrides a previously disabled startup preference", () => {
    const setLoginItemSettings = vi.fn();
    const preferenceStore = createPreferenceStore(true);
    preferenceStore.setUserConfigured(true);
    preferenceStore.setDesiredEnabled(false);
    const service = new StartupLaunchService(
      {
        isPackaged: true,
        getLoginItemSettings: () => ({ openAtLogin: true, executableWillLaunchAtLogin: true }),
        setLoginItemSettings
      },
      {
        platform: "win32",
        execPath: "C:\\Users\\me\\AppData\\Local\\moshu\\app-1.8.0\\novel-tool.exe"
      },
      preferenceStore
    );

    const status = service.ensureForcedEnabled();

    expect(status.enabled).toBe(true);
    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      enabled: true,
      name: "Moshu",
      path: "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe",
      args: HIDDEN_NO_TRAY_STARTUP_ARGS
    });
    expect(preferenceStore.setDesiredEnabled).toHaveBeenCalledWith(true);
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
    expect(resolveWindowsSquirrelStubLauncher("C:\\Users\\me\\AppData\\Local\\moshu\\app-1.8.0\\novel-tool.exe")).toBe(
      "C:\\Users\\me\\AppData\\Local\\moshu\\novel-tool.exe"
    );
  });
});
