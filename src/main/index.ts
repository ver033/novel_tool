import { app, BrowserWindow } from "electron";
import path from "node:path";
import { registerIpcHandlers } from "./ipc/register-ipc";
import { initializeMainLogger, installMainProcessErrorHandlers, logMainError } from "./logger";
import { handleWindowsSquirrelStartupEvent } from "./windows-squirrel-startup";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindowRef: BrowserWindow | null = null;

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

if (!handleWindowsSquirrelStartupEvent({ quit: () => app.quit() })) {
  if (process.env.NODE_ENV === "test" && process.env.NOVEL_TOOL_E2E_USER_DATA_DIR) {
    app.setPath("userData", process.env.NOVEL_TOOL_E2E_USER_DATA_DIR);
  }

  app.whenReady().then(() => {
    initializeMainLogger(app.getPath("userData"));
    installMainProcessErrorHandlers();
    try {
      registerIpcHandlers();
    } catch (error) {
      logMainError("registerIpcHandlers failed", error);
      throw error;
    }
    createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
