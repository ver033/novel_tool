import path from "node:path";
import type { SettingsRepository } from "../db/repositories/settings-repo";

const STARTUP_LAUNCH_NAME = "Moshu";
const STARTUP_LAUNCH_SETTINGS_KEY = "startupLaunch";
export const HIDDEN_STARTUP_LAUNCH_ARG = "--hidden-startup";

export type StartupLaunchUnsupportedReason = "not_windows" | "not_packaged";

export type StartupLaunchStatus = {
  readonly supported: boolean;
  readonly enabled: boolean;
  readonly reason: StartupLaunchUnsupportedReason | null;
};

type LoginItemSettings = {
  readonly openAtLogin?: boolean;
  readonly executableWillLaunchAtLogin?: boolean;
};

type LoginItemOptions = {
  readonly name: string;
  readonly path: string;
  readonly args: readonly string[];
};

type SetLoginItemSettingsInput = LoginItemOptions & {
  readonly openAtLogin: boolean;
  readonly enabled: boolean;
};

export type StartupLaunchElectronApp = {
  readonly isPackaged: boolean;
  readonly getLoginItemSettings: (options: LoginItemOptions) => LoginItemSettings;
  readonly setLoginItemSettings: (settings: SetLoginItemSettingsInput) => void;
};

export type StartupLaunchServiceOptions = {
  readonly platform?: NodeJS.Platform;
  readonly execPath?: string;
};

export type StartupLaunchPreferenceStore = {
  readonly getDefaultEnabledApplied: () => boolean;
  readonly setDefaultEnabledApplied: (value: boolean) => void;
  readonly getUserConfigured: () => boolean;
  readonly setUserConfigured: (value: boolean) => void;
};

type StoredStartupLaunchSettings = {
  readonly defaultEnabledApplied?: boolean;
  readonly userConfigured?: boolean;
};

const alreadyAppliedPreferenceStore: StartupLaunchPreferenceStore = {
  getDefaultEnabledApplied: () => true,
  setDefaultEnabledApplied() {},
  getUserConfigured: () => true,
  setUserConfigured() {}
};

export class SettingsStartupLaunchPreferenceStore implements StartupLaunchPreferenceStore {
  constructor(private readonly settingsRepo: SettingsRepository) {}

  private getStoredSettings(): StoredStartupLaunchSettings {
    return this.settingsRepo.getJson<StoredStartupLaunchSettings>(STARTUP_LAUNCH_SETTINGS_KEY) ?? {};
  }

  getDefaultEnabledApplied(): boolean {
    return Boolean(this.getStoredSettings().defaultEnabledApplied);
  }

  setDefaultEnabledApplied(value: boolean): void {
    this.settingsRepo.setJson(STARTUP_LAUNCH_SETTINGS_KEY, { ...this.getStoredSettings(), defaultEnabledApplied: value } satisfies StoredStartupLaunchSettings);
  }

  getUserConfigured(): boolean {
    return Boolean(this.getStoredSettings().userConfigured);
  }

  setUserConfigured(value: boolean): void {
    this.settingsRepo.setJson(STARTUP_LAUNCH_SETTINGS_KEY, { ...this.getStoredSettings(), userConfigured: value } satisfies StoredStartupLaunchSettings);
  }
}

export function resolveWindowsSquirrelStubLauncher(execPath: string): string {
  return path.win32.resolve(path.win32.dirname(execPath), "..", path.win32.basename(execPath));
}

export function isHiddenStartupLaunch(argv: readonly string[] = process.argv): boolean {
  return argv.includes(HIDDEN_STARTUP_LAUNCH_ARG);
}

export class StartupLaunchService {
  private readonly platform: NodeJS.Platform;
  private readonly execPath: string;

  constructor(
    private readonly app: StartupLaunchElectronApp,
    options: StartupLaunchServiceOptions = {},
    private readonly preferenceStore: StartupLaunchPreferenceStore = alreadyAppliedPreferenceStore
  ) {
    this.platform = options.platform ?? process.platform;
    this.execPath = options.execPath ?? process.execPath;
  }

  getStatus(): StartupLaunchStatus {
    const unsupportedReason = this.unsupportedReason();
    if (unsupportedReason) {
      return {
        supported: false,
        enabled: false,
        reason: unsupportedReason
      };
    }

    const settings = this.app.getLoginItemSettings(this.loginItemOptions());
    return {
      supported: true,
      enabled: Boolean((settings.openAtLogin && (settings.executableWillLaunchAtLogin ?? true)) || settings.executableWillLaunchAtLogin),
      reason: null
    };
  }

  setEnabled(enabled: boolean): StartupLaunchStatus {
    if (this.unsupportedReason()) {
      throw new Error("开机自启动只支持 Windows 安装版。");
    }

    this.applyLoginItemSettings(this.loginItemOptions(), enabled);
    if (!enabled) {
      this.applyLoginItemSettings(this.legacyLoginItemOptions(), false);
    }
    this.preferenceStore.setUserConfigured(true);
    this.preferenceStore.setDefaultEnabledApplied(true);
    return this.getStatus();
  }

  ensureDefaultEnabled(): StartupLaunchStatus {
    const unsupportedReason = this.unsupportedReason();
    if (unsupportedReason) {
      return this.getStatus();
    }

    const status = this.getStatus();
    if (status.enabled || this.preferenceStore.getUserConfigured()) {
      return status;
    }

    this.applyLoginItemSettings(this.loginItemOptions(), true);
    this.preferenceStore.setDefaultEnabledApplied(true);
    return this.getStatus();
  }

  private applyLoginItemSettings(options: LoginItemOptions, enabled: boolean): void {
    this.app.setLoginItemSettings({
      ...options,
      openAtLogin: enabled,
      enabled
    });
  }

  private unsupportedReason(): StartupLaunchUnsupportedReason | null {
    if (this.platform !== "win32") {
      return "not_windows";
    }
    if (!this.app.isPackaged) {
      return "not_packaged";
    }
    return null;
  }

  private loginItemOptions(): LoginItemOptions {
    return {
      name: STARTUP_LAUNCH_NAME,
      path: resolveWindowsSquirrelStubLauncher(this.execPath),
      args: [HIDDEN_STARTUP_LAUNCH_ARG]
    };
  }

  private legacyLoginItemOptions(): LoginItemOptions {
    return {
      ...this.loginItemOptions(),
      args: []
    };
  }
}
