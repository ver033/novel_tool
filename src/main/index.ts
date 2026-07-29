import { app, BrowserWindow, crashReporter, Menu, nativeImage, net, session, Tray } from "electron";
import path from "node:path";
import { registerIpcHandlers } from "./ipc/register-ipc";
import { initializeMainLogger, installMainProcessErrorHandlers, logMainError, writeMainLog } from "./logger";
import { createSystemProxyNetwork } from "./network/system-proxy-network";
import { ProcessLivenessJournal } from "./process-liveness-journal";
import {
  ProcessWatchdogRuntimeMonitor,
  WindowsProcessWatchdogService,
  isProcessWatchdogLaunch,
  shouldRevealMainWindowForSecondInstance
} from "./startup/process-watchdog";
import { isHiddenStartupLaunch, isNoTrayHiddenStartupLaunch } from "./startup/startup-launch-service";
import { createWindowsTrayBackgroundController } from "./window-tray-background";
import { handleWindowsSquirrelStartupEvent } from "./windows-squirrel-startup";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindowRef: BrowserWindow | null = null;
let processLivenessJournal: ProcessLivenessJournal | null = null;
const processWatchdogRuntimeMonitor = new ProcessWatchdogRuntimeMonitor({
  isPackaged: app.isPackaged
});
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

function createMainWindow(options: { readonly show?: boolean } = {}): void {
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1120,
    minHeight: 760,
    show: options.show ?? true,
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
  mainWindow.on("unresponsive", () => {
    writeMainLog("warn", "renderer window became unresponsive", {
      windowId: mainWindow.id
    });
  });
  mainWindow.on("responsive", () => {
    writeMainLog("info", "renderer window became responsive", {
      windowId: mainWindow.id
    });
  });
  mainWindow.on("session-end", () => {
    try {
      processLivenessJournal?.markOrderlyExit("windows-session-end");
    } catch (error) {
      logMainError("record Windows session end failed", error);
    }
    writeMainLog("info", "Windows session ending");
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    writeMainLog("error", "renderer process gone", {
      windowId: mainWindow.id,
      details
    });
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

function initializeProcessLiveness(userDataPath: string): void {
  try {
    const journal = new ProcessLivenessJournal(
      path.join(userDataPath, "logs", "process-liveness.json")
    );
    const startResult = journal.start();
    processLivenessJournal = journal;
    writeMainLog("info", "application process started", {
      pid: startResult.currentSession.pid,
      sessionId: startResult.currentSession.sessionId,
      appVersion: app.getVersion(),
      hiddenStartup: isHiddenStartupLaunch()
    });
    if (startResult.previousUncleanSession) {
      writeMainLog("warn", "previous application process ended without an orderly exit", {
        previousSession: startResult.previousUncleanSession
      });
    }
    const heartbeatTimer = setInterval(() => {
      try {
        journal.heartbeat();
      } catch (error) {
        logMainError("process liveness heartbeat failed", error);
      }
    }, 60_000);
    heartbeatTimer.unref();
  } catch (error) {
    logMainError("initialize process liveness journal failed", error);
  }
}

function ensureWindowsProcessWatchdog(): void {
  const watchdogService = new WindowsProcessWatchdogService({
    isPackaged: app.isPackaged
  });
  processWatchdogRuntimeMonitor.recordRegistrationAttempt();
  void watchdogService
    .ensureInstalled()
    .then((status) => {
      if (status.supported) {
        processWatchdogRuntimeMonitor.recordRegistrationSuccess();
        writeMainLog("info", "Windows process watchdog installed", {
          installed: status.installed
        });
      }
    })
    .catch((error) => {
      processWatchdogRuntimeMonitor.recordRegistrationFailure();
      logMainError("install Windows process watchdog failed", error);
    });
}

if (!handleWindowsSquirrelStartupEvent({ quit: () => app.quit() })) {
  if (process.env.NODE_ENV === "test" && process.env.NOVEL_TOOL_E2E_USER_DATA_DIR) {
    app.setPath("userData", process.env.NOVEL_TOOL_E2E_USER_DATA_DIR);
  }
  if (app.isPackaged) {
    crashReporter.start({
      uploadToServer: false,
      compress: false
    });
  }
  if (isProcessWatchdogLaunch()) {
    processWatchdogRuntimeMonitor.recordRecoveryLaunch();
  }

  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on("second-instance", (_event, commandLine) => {
      if (!shouldRevealMainWindowForSecondInstance(commandLine)) {
        processWatchdogRuntimeMonitor.recordProbe();
        writeMainLog("info", "healthy primary instance ignored process watchdog probe");
        return;
      }
      showMainWindowWithTray();
    });

    app.whenReady().then(async () => {
      initializeMainLogger(app.getPath("userData"));
      installMainProcessErrorHandlers();
      initializeProcessLiveness(app.getPath("userData"));
      ensureWindowsProcessWatchdog();
      const electronFetch: typeof globalThis.fetch = (input, init) => {
        const normalizedInput = input instanceof URL ? input.toString() : input;
        return net.fetch(
          normalizedInput as string | Request,
          {
            ...init,
            bypassCustomProtocolHandlers: true
          }
        ) as Promise<Response>;
      };
      const systemProxyNetwork = createSystemProxyNetwork({
        fetchImpl: electronFetch,
        session: session.defaultSession,
        setGlobalFetch(fetchImpl) {
          globalThis.fetch = fetchImpl;
        },
        log: writeMainLog
      });
      try {
        await systemProxyNetwork.install();
      } catch (error) {
        logMainError("install Electron system proxy network failed", error);
      }
      app.on("child-process-gone", (_event, details) => {
        writeMainLog("error", "Electron child process gone", {
          details
        });
      });
      try {
        registerIpcHandlers({
          getProcessWatchdogStatus: () => processWatchdogRuntimeMonitor.getStatus()
        });
      } catch (error) {
        logMainError("registerIpcHandlers failed", error);
        throw error;
      }
      const noTrayHiddenStartup = isNoTrayHiddenStartupLaunch();
      if (!isHiddenStartupLaunch()) {
        createMainWindow();
      } else if (noTrayHiddenStartup) {
        createMainWindow({ show: false });
      }
      if (!noTrayHiddenStartup) {
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
  writeMainLog("info", "application before-quit");
  windowsTrayBackgroundController.markQuitting();
});

app.on("will-quit", () => {
  try {
    processLivenessJournal?.markOrderlyExit("will-quit");
  } catch (error) {
    logMainError("record orderly application exit failed", error);
  }
  writeMainLog("info", "application will-quit");
});

app.on("quit", (_event, exitCode) => {
  writeMainLog("info", "application quit", {
    exitCode
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (windowsTrayBackgroundController.shouldQuitOnWindowAllClosed()) {
      app.quit();
    }
  }
});
