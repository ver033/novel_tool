import path from "node:path";
import type { SettingsRepository } from "../db/repositories/settings-repo";

const STARTUP_LAUNCH_NAME = "Moshu";
const STARTUP_LAUNCH_SETTINGS_KEY = "startupLaunch";
export const HIDDEN_STARTUP_LAUNCH_ARG = "--hidden-startup";
export const NO_TRAY_HIDDEN_STARTUP_ARG = "--hidden-startup-no-tray";

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
  readonly getDesiredEnabled: () => boolean | null;
  readonly setDesiredEnabled: (value: boolean) => void;
};

type StoredStartupLaunchSettings = {
  readonly defaultEnabledApplied?: boolean;
  readonly userConfigured?: boolean;
  readonly desiredEnabled?: boolean;
};

const alreadyAppliedPreferenceStore: StartupLaunchPreferenceStore = {
  getDefaultEnabledApplied: () => true,
  setDefaultEnabledApplied() {},
  getUserConfigured: () => true,
  setUserConfigured() {},
  getDesiredEnabled: () => null,
  setDesiredEnabled() {}
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

  getDesiredEnabled(): boolean | null {
    const value = this.getStoredSettings().desiredEnabled;
    return typeof value === "boolean" ? value : null;
  }

  setDesiredEnabled(value: boolean): void {
    this.settingsRepo.setJson(STARTUP_LAUNCH_SETTINGS_KEY, { ...this.getStoredSettings(), desiredEnabled: value } satisfies StoredStartupLaunchSettings);
  }
}

export function resolveWindowsSquirrelStubLauncher(execPath: string): string {
  return path.win32.resolve(path.win32.dirname(execPath), "..", path.win32.basename(execPath));
}

export function isHiddenStartupLaunch(argv: readonly string[] = process.argv): boolean {
  return argv.includes(HIDDEN_STARTUP_LAUNCH_ARG);
}

export function isNoTrayHiddenStartupLaunch(argv: readonly string[] = process.argv): boolean {
  return isHiddenStartupLaunch(argv) && argv.includes(NO_TRAY_HIDDEN_STARTUP_ARG);
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

    const desiredEnabled = this.preferenceStore.getDesiredEnabled();
    if (desiredEnabled !== null) {
      return this.enabledStatus(desiredEnabled);
    }

    const settings = this.getEnabledLoginItemSettings();
    return this.enabledStatus(Boolean((settings.openAtLogin && (settings.executableWillLaunchAtLogin ?? true)) || settings.executableWillLaunchAtLogin));
  }

  setEnabled(enabled: boolean): StartupLaunchStatus {
    if (this.unsupportedReason()) {
      throw new Error("开机自启动只支持 Windows 安装版。");
    }

    if (enabled) {
      this.applyLoginItemSettings(this.loginItemOptions(), true);
    } else {
      this.disableAllLoginItems();
    }
    this.preferenceStore.setDesiredEnabled(enabled);
    this.preferenceStore.setUserConfigured(true);
    this.preferenceStore.setDefaultEnabledApplied(true);
    return this.enabledStatus(enabled);
  }

  ensureDefaultEnabled(): StartupLaunchStatus {
    const unsupportedReason = this.unsupportedReason();
    if (unsupportedReason) {
      return this.getStatus();
    }

    const desiredEnabled = this.preferenceStore.getDesiredEnabled();
    if (desiredEnabled !== null) {
      if (desiredEnabled) {
        this.applyLoginItemSettings(this.loginItemOptions(), true);
      } else {
        this.disableAllLoginItems();
      }
      return this.enabledStatus(desiredEnabled);
    }

    const currentStatus = this.readLoginItemStatus(this.loginItemOptions());
    if (currentStatus.enabled) {
      this.preferenceStore.setDesiredEnabled(true);
      this.preferenceStore.setDefaultEnabledApplied(true);
      return this.getStatus();
    }

    const legacyStatus = this.getLegacyEnabledLoginItemStatus();
    if (legacyStatus.enabled) {
      this.applyLoginItemSettings(this.loginItemOptions(), true);
      this.preferenceStore.setDesiredEnabled(true);
      this.preferenceStore.setDefaultEnabledApplied(true);
      return this.getStatus();
    }

    this.applyLoginItemSettings(this.loginItemOptions(), true);
    this.preferenceStore.setDesiredEnabled(true);
    this.preferenceStore.setDefaultEnabledApplied(true);
    return this.enabledStatus(true);
  }

  private enabledStatus(enabled: boolean): StartupLaunchStatus {
    return {
      supported: true,
      enabled,
      reason: null
    };
  }

  private applyLoginItemSettings(options: LoginItemOptions, enabled: boolean): void {
    this.app.setLoginItemSettings({
      ...options,
      openAtLogin: enabled,
      enabled
    });
  }

  private disableAllLoginItems(): void {
    this.applyLoginItemSettings(this.loginItemOptions(), false);
    this.applyLoginItemSettings(this.hiddenStartupWithTrayLoginItemOptions(), false);
    this.applyLoginItemSettings(this.legacyVisibleLoginItemOptions(), false);
  }

  private getEnabledLoginItemSettings(): LoginItemSettings {
    const currentStatus = this.readLoginItemStatus(this.loginItemOptions());
    if (currentStatus.enabled) {
      return currentStatus.settings;
    }
    const legacyStatus = this.getLegacyEnabledLoginItemStatus();
    if (legacyStatus.enabled) {
      return legacyStatus.settings;
    }
    return currentStatus.settings;
  }

  private getLegacyEnabledLoginItemStatus(): { readonly enabled: boolean; readonly settings: LoginItemSettings } {
    const hiddenWithTrayStatus = this.readLoginItemStatus(this.hiddenStartupWithTrayLoginItemOptions());
    if (hiddenWithTrayStatus.enabled) {
      return hiddenWithTrayStatus;
    }
    return this.readLoginItemStatus(this.legacyVisibleLoginItemOptions());
  }

  private readLoginItemStatus(options: LoginItemOptions): { readonly enabled: boolean; readonly settings: LoginItemSettings } {
    const settings = this.app.getLoginItemSettings(options);
    return {
      enabled: Boolean((settings.openAtLogin && (settings.executableWillLaunchAtLogin ?? true)) || settings.executableWillLaunchAtLogin),
      settings
    };
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
      args: [HIDDEN_STARTUP_LAUNCH_ARG, NO_TRAY_HIDDEN_STARTUP_ARG]
    };
  }

  private hiddenStartupWithTrayLoginItemOptions(): LoginItemOptions {
    return {
      ...this.loginItemOptions(),
      args: [HIDDEN_STARTUP_LAUNCH_ARG]
    };
  }

  private legacyVisibleLoginItemOptions(): LoginItemOptions {
    return {
      ...this.loginItemOptions(),
      args: []
    };
  }
}
