import { describe, expect, it, vi } from "vitest";
import { createWindowsTrayBackgroundController, type TrayCloseEvent, type TrayMenuItem, type TrayRuntime, type TrayWindow } from "../../src/main/window-tray-background";
import { isHiddenStartupLaunch, isNoTrayHiddenStartupLaunch } from "../../src/main/startup/startup-launch-service";

type CloseEvent = TrayCloseEvent & { readonly preventDefault: ReturnType<typeof vi.fn<() => void>> };

function createFakeWindow(): TrayWindow & { readonly emitClose: () => CloseEvent } {
  const closeListeners: Array<(event: CloseEvent) => void> = [];
  const window = {
    hide: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    isMinimized: vi.fn(() => false),
    on: vi.fn((event: "close", listener: (event: CloseEvent) => void) => {
      if (event === "close") {
        closeListeners.push(listener);
      }
    }),
    emitClose() {
      const event: CloseEvent = { preventDefault: vi.fn(() => undefined) };
      closeListeners.forEach((listener) => listener(event));
      return event;
    }
  };
  return window;
}

function createRuntime(platform: NodeJS.Platform = "win32") {
  const tray = {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn()
  };
  const runtime: TrayRuntime<readonly TrayMenuItem[]> = {
    platform,
    buildContextMenu: vi.fn((template) => template),
    createTray: vi.fn(() => tray),
    quitApp: vi.fn()
  };
  return { runtime, tray };
}

describe("Windows tray background mode", () => {
  it("detects login startup launches that should start hidden", () => {
    expect(isHiddenStartupLaunch(["novel-tool.exe", "--hidden-startup"])).toBe(true);
    expect(isHiddenStartupLaunch(["novel-tool.exe"])).toBe(false);
  });

  it("detects test login startup launches that should start hidden without a tray", () => {
    expect(isNoTrayHiddenStartupLaunch(["novel-tool.exe", "--hidden-startup", "--hidden-startup-no-tray"])).toBe(true);
    expect(isNoTrayHiddenStartupLaunch(["novel-tool.exe", "--hidden-startup"])).toBe(false);
    expect(isNoTrayHiddenStartupLaunch(["novel-tool.exe", "--hidden-startup-no-tray"])).toBe(false);
  });

  it("hides the Windows main window instead of closing when the user clicks X", () => {
    const { runtime } = createRuntime("win32");
    const window = createFakeWindow();
    const controller = createWindowsTrayBackgroundController(runtime, vi.fn());

    controller.installWindowCloseHandler(window);
    const closeEvent = window.emitClose();

    expect(closeEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(window.hide).toHaveBeenCalledTimes(1);
    expect(controller.shouldQuitOnWindowAllClosed()).toBe(false);
  });

  it("lets the tray exit action quit the app and allows the window to close", () => {
    const { runtime } = createRuntime("win32");
    const window = createFakeWindow();
    const controller = createWindowsTrayBackgroundController(runtime, vi.fn());

    controller.installWindowCloseHandler(window);
    controller.ensureTray();
    const template = vi.mocked(runtime.buildContextMenu).mock.calls[0]?.[0] ?? [];
    const exitItem = template.find((item) => item.label === "退出");
    exitItem?.click?.();
    const closeEvent = window.emitClose();

    expect(runtime.quitApp).toHaveBeenCalledTimes(1);
    expect(closeEvent.preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
    expect(controller.shouldQuitOnWindowAllClosed()).toBe(true);
  });

  it("keeps non-Windows close behavior unchanged", () => {
    const { runtime } = createRuntime("darwin");
    const window = createFakeWindow();
    const controller = createWindowsTrayBackgroundController(runtime, vi.fn());

    controller.installWindowCloseHandler(window);
    controller.ensureTray();
    const closeEvent = window.emitClose();

    expect(runtime.createTray).not.toHaveBeenCalled();
    expect(closeEvent.preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
    expect(controller.shouldQuitOnWindowAllClosed()).toBe(true);
  });
});
