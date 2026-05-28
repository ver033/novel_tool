import { app, BrowserWindow, Menu, nativeImage, Tray } from "electron";
import path from "node:path";
import { registerIpcHandlers } from "./ipc/register-ipc";
import { initializeMainLogger, installMainProcessErrorHandlers, logMainError } from "./logger";
import { isHiddenStartupLaunch, isNoTrayHiddenStartupLaunch } from "./startup/startup-launch-service";
import { createWindowsTrayBackgroundController } from "./window-tray-background";
import { handleWindowsSquirrelStartupEvent } from "./windows-squirrel-startup";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindowRef: BrowserWindow | null = null;
const WINDOWS_TRAY_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAACXBIWXMAAAAAAAAAAQCEeRdzAAAEXUlEQVR4nLVVXWhcVRD+zv3bze7S5ndj2HYJpZHaBCPYhqJtxVrFtEkkSPtUKooigg8+CIKv4pOiPhYpPqgPDVKr2FoISluhClpLWzXEGmmTNKZt4qbJ/mbvz3Hm3L13f0JFBQ8sh713Zr6Zb76ZKzzPk/gfj9H4QCq4/44phLg7gJQysKp5+M8CB4lxDE2r+ocAzFSI/i8KYBfXo1uB+P6uK6HrogrgkgWFhxZ6Va8Q6y6guRyQSHCC1Ur4J4QHXdN8AD97LYwRFChrb4m697oO3FyQGPscePlZEQYPjuMQVVZYgVQOYbJybRu44ulbDjl66ElbyBYljpwAPjwGdCQlDu6rgjBVnipJZwC/MbKBgtq/7Mrmk9dtZLMFdHe1ImYJHB6SiMWBoT1AaVUiQs+COMEdNlnW1i/rERQdGRdTs2VkFu+g/94oVZFAqg14foSqp+YtrQCdbViTqBEwHvCsETdC80hq3BuhmqcbAud+zGMxU8TKcgGfjU/jtRd7iWhgfYzshURTlKn2s6sFMYLggoMT0WNfTGDvrjS6kgmlBNPUcG1uFV9+s4ANHWTr2Tj51XU8uSuJ/q0dSoE6lTB/awVnzs/gwHCfanANQEUeBF62PVy4PI9HdqQqtAklgA+Oz+DGXAbPDG+C8JowfmYC77x/HkffGgmHqlx28cOlGxjd11vHcMMkc5kuPJczhbpZTulOE4XcMi5P3CaDEsqlLLZu7qaXWkXiwRx4yq+hBzVNZgDHpsmUajr5x+WOPJqi8n/H2W+vwS3n0NMdx6GnB5RyjIq82cdxnHqx1DWZXniSjWxFCxWibodu0zSxe3snPv70Ilw7Tzz3IxKJkK1L3kKtGNdhH7s6jFWZyurESigAyzQoKAPQdFPNDgF1dcSRyWTg2EVspDngBJh+3gAGRbEskyh10bgv6yrgk8sVcGr8Arb0dCK9IYlUVzs5A79OzZFElyiBEiZ/m8XgY1soiI75m39iZvY2frn6B/L5os8ND24VwOeeAUwitLU5ijffO0XD46IpIvBA30a8cHgQTw1uw9iJcwQgMDr0ML77fhJHPzqNi1emUSi59FzDwdGdaui4b6J+kv11wUp4/ZUhHDqwE0VyWljM4tJPU3jj7U+w/4kHFRjvmJOnz6oqB7bdj+HBvUi2r0M0aiCdaoHtBOtUKm4M5opXQdl2IAwTLc0xrF8XU7zzJO/Z3YulO4/j2PGv8fPEVZKhROqeVhx591W0tcQoY9qa5K9rwciyolxYqkFcAT2LUIOKxYJqqk5oPPosP49XBgG1t0bw0nP7sWP7farS/r5NsKh2TXPUoPFPCP9zyVKFLJPKYgrPYEw2SCSiWF4pkIFJqjCVOngvaYZQQQ1d4qGBzcrJowxFRUHBYepsUqCQNpqJBfaVqNlFlqkTPXFSQgmrq3nVD6m+cyIQRiDm+lFFkD0QjRiIx+OUjLZ2VSg0esH8e6rhf/dhbtztIqSq9svH5y8FXyH5pcK5XwAAAABJRU5ErkJggg==";

const windowsTrayBackgroundController = createWindowsTrayBackgroundController(
  {
    platform: process.platform,
    buildContextMenu: (template) => Menu.buildFromTemplate(template.map((item) => ({ ...item }))),
    createTray: () => {
      const tray = new Tray(nativeImage.createFromDataURL(WINDOWS_TRAY_ICON_DATA_URL));
      return {
        setToolTip: (toolTip) => tray.setToolTip(toolTip),
        setContextMenu: (menu) => tray.setContextMenu(menu),
        on: (event, listener) => {
          if (event === "click") {
            tray.on("click", () => listener());
            return;
          }
          tray.on("double-click", () => listener());
        }
      };
    },
    quitApp: () => app.quit()
  },
  showMainWindow
);

function createRendererContentSecurityPolicy(isDev: boolean): string {
  return [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "worker-src 'self' blob:",
    "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join("; ");
}

function installMainWindowSecurity(mainWindow: BrowserWindow): void {
  const rendererContentSecurityPolicy = createRendererContentSecurityPolicy(Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    if (isAllowedRendererNavigation(navigationUrl)) {
      return;
    }
    event.preventDefault();
  });
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [rendererContentSecurityPolicy]
      }
    });
  });
}

function isAllowedRendererNavigation(navigationUrl: string): boolean {
  if (!MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return false;
  }

  try {
    return new URL(navigationUrl).origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
  } catch {
    return false;
  }
}

function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: "#fafaf8",
    title: "墨枢",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindowRef = mainWindow;
  windowsTrayBackgroundController.installWindowCloseHandler(mainWindow);
  mainWindow.on("closed", () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null;
    }
  });
  installMainWindowSecurity(mainWindow);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }
}

function showMainWindow(): void {
  if (!mainWindowRef) {
    createMainWindow();
    return;
  }
  if (mainWindowRef.isMinimized()) {
    mainWindowRef.restore();
  }
  mainWindowRef.show();
  mainWindowRef.focus();
}

function showMainWindowWithTray(): void {
  showMainWindow();
  windowsTrayBackgroundController.ensureTray();
}

if (!handleWindowsSquirrelStartupEvent({ quit: () => app.quit() })) {
  if (process.env.NODE_ENV === "test" && process.env.NOVEL_TOOL_E2E_USER_DATA_DIR) {
    app.setPath("userData", process.env.NOVEL_TOOL_E2E_USER_DATA_DIR);
  }

  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      showMainWindowWithTray();
    });

    app.whenReady().then(() => {
      initializeMainLogger(app.getPath("userData"));
      installMainProcessErrorHandlers();
      try {
        registerIpcHandlers();
      } catch (error) {
        logMainError("registerIpcHandlers failed", error);
        throw error;
      }
      if (!isHiddenStartupLaunch()) {
        createMainWindow();
      }
      if (!isNoTrayHiddenStartupLaunch()) {
        windowsTrayBackgroundController.ensureTray();
      }

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createMainWindow();
        }
      });
    });
  }
}

app.on("before-quit", () => {
  windowsTrayBackgroundController.markQuitting();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (windowsTrayBackgroundController.shouldQuitOnWindowAllClosed()) {
      app.quit();
    }
  }
});
