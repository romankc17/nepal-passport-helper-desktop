import { join } from 'node:path';
import { BrowserWindow, session, shell } from 'electron';

export interface WindowDeps {
  isDev: boolean;
  isMinimizeToTrayEnabled: () => boolean;
  isQuitting: () => boolean;
  getAllowedExternalOrigin: () => string | null;
}

const STRICT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
].join('; ');

// Dev server needs inline scripts (react-refresh preamble) and the HMR
// websocket; production never loads http(s) content, so the strict CSP
// applies there (also injected as a meta tag at build time).
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' ws:",
].join('; ');

export function applySessionSecurity(deps: WindowDeps): void {
  const rendererSession = session.defaultSession;

  rendererSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [deps.isDev ? DEV_CSP : STRICT_CSP],
      },
    });
  });

  rendererSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  rendererSession.setPermissionCheckHandler(() => false);
}

export function createMainWindow(deps: WindowDeps): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0f2440',
    title: 'Nepal Passport Helper',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: deps.isDev,
    },
  });

  win.on('ready-to-show', () => win.show());

  win.on('close', (event) => {
    if (deps.isQuitting() || !deps.isMinimizeToTrayEnabled()) return;
    event.preventDefault();
    win.hide();
  });

  // The renderer is a local SPA — no in-app navigation away from it.
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url, deps)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (deps.isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

function isAllowedExternalUrl(url: string, deps: WindowDeps): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  // http is only ever allowed for the configured dev API origin.
  const allowedOrigin = deps.getAllowedExternalOrigin();
  if (deps.isDev && parsed.protocol === 'http:' && allowedOrigin) {
    return parsed.origin === allowedOrigin;
  }
  return false;
}

export function isTrustedRendererFrame(frameUrl: string): boolean {
  if (frameUrl.startsWith('file://')) return true;
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl && frameUrl.startsWith(devUrl)) return true;
  return false;
}

export function focusOrCreateWindow(deps: WindowDeps, existing: BrowserWindow | null): BrowserWindow {
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }
  return createMainWindow(deps);
}
