export type TrayCloseEvent = {
  readonly preventDefault: () => void;
};

export type TrayWindow = {
  readonly hide: () => void;
  readonly show: () => void;
  readonly focus: () => void;
  readonly restore: () => void;
  readonly isMinimized: () => boolean;
  readonly on: (event: "close", listener: (event: TrayCloseEvent) => void) => void;
};

export type TrayMenuItem = {
  readonly label?: string;
  readonly type?: "separator";
  readonly click?: () => void;
};

export type TrayHandle<TMenu> = {
  readonly setToolTip: (toolTip: string) => void;
  readonly setContextMenu: (menu: TMenu) => void;
  readonly on: (event: "click" | "double-click", listener: () => void) => void;
};

export type TrayRuntime<TMenu = unknown> = {
  readonly platform: NodeJS.Platform;
  readonly buildContextMenu: (template: readonly TrayMenuItem[]) => TMenu;
  readonly createTray: () => TrayHandle<TMenu>;
  readonly quitApp: () => void;
};

export function createWindowsTrayBackgroundController<TMenu>(runtime: TrayRuntime<TMenu>, showMainWindow: () => void) {
  let isQuitting = false;
  let tray: TrayHandle<TMenu> | null = null;

  function isEnabled(): boolean {
    return runtime.platform === "win32";
  }

  function requestQuit(): void {
    isQuitting = true;
    runtime.quitApp();
  }

  return {
    ensureTray() {
      if (!isEnabled() || tray) {
        return;
      }

      const nextTray = runtime.createTray();
      tray = nextTray;
      nextTray.setToolTip("墨枢");
      nextTray.setContextMenu(
        runtime.buildContextMenu([
          {
            label: "打开墨枢",
            click: showMainWindow
          },
          {
            type: "separator"
          },
          {
            label: "退出",
            click: requestQuit
          }
        ])
      );
      nextTray.on("click", showMainWindow);
      nextTray.on("double-click", showMainWindow);
    },
    installWindowCloseHandler(window: TrayWindow) {
      if (!isEnabled()) {
        return;
      }

      window.on("close", (event) => {
        if (isQuitting) {
          return;
        }
        event.preventDefault();
        window.hide();
      });
    },
    markQuitting() {
      isQuitting = true;
    },
    shouldQuitOnWindowAllClosed() {
      return !isEnabled() || isQuitting;
    }
  };
}
