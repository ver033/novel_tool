import type { BrowserWindowConstructorOptions } from 'electron';

type ContentSecurityPolicyOptions = {
  isDevelopment?: boolean;
};

export function createContentSecurityPolicy(options: ContentSecurityPolicyOptions = {}): string {
  const scriptSrc = options.isDevelopment ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'";
  const connectSrc = options.isDevelopment
    ? "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*"
    : "connect-src 'self' http://localhost:*";

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    connectSrc,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function buildMainWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1360,
    height: 880,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#f6f1e8',
    show: false,
    title: 'Novel Tool',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  };
}
