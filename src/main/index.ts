import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';

import { registerIpcHandlers } from './ipc/register-ipc';
import { logMain } from './log-main';
import { buildMainWindowOptions, createContentSecurityPolicy } from './window-options';

let mainWindow: BrowserWindow | null = null;

function installContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          createContentSecurityPolicy({ isDevelopment: Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL) }),
        ],
      },
    });
  });
}

async function createWindow(): Promise<void> {
  const preloadPath = path.join(__dirname, 'preload.js');
  logMain('creating window', { preloadPath, devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL || null });
  mainWindow = new BrowserWindow(buildMainWindowOptions(preloadPath));

  mainWindow.once('ready-to-show', () => {
    logMain('window ready-to-show');
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    logMain('window closed');
    mainWindow = null;
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logMain('window did-fail-load', { errorCode, errorDescription, validatedURL });
  });

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    logMain('preload error', {
      preloadPath,
      error: error instanceof Error ? error.stack : error,
    });
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logMain('renderer process gone', details);
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  logMain('window load completed');
}

if (!app.requestSingleInstanceLock()) {
  logMain('single instance lock denied');
  app.quit();
} else {
  app.whenReady().then(async () => {
    logMain('app ready');
    installContentSecurityPolicy();
    registerIpcHandlers();
    await createWindow();
  }).catch((error) => {
    logMain('app startup failed', error instanceof Error ? error.stack : error);
    app.quit();
  });

  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window) {
      if (window.isMinimized()) {
        window.restore();
      }
      window.focus();
    }
  });

  app.on('activate', () => {
    if (!app.isReady()) {
      return;
    }
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow().catch((error) => {
        logMain('window activate failed', error instanceof Error ? error.stack : error);
      });
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
