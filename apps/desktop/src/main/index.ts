import { config } from 'dotenv';
import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  nativeImage,
  dialog,
  nativeTheme,
  Menu,
} from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createConnection } from 'node:net';

const APP_DATA_NAME = 'Accomplish';
app.setPath('userData', path.join(app.getPath('appData'), APP_DATA_NAME));

if (process.platform === 'win32') {
  app.setAppUserModelId('ai.accomplish.desktop');
}

import { registerIPCHandlers } from './ipc/handlers';
import { FutureSchemaError } from '@accomplish_ai/agent-core';
import { initThoughtStreamApi, startThoughtStreamServer } from './thought-stream-api';
import type { ProviderId } from '@accomplish_ai/agent-core';
import { disposeTaskManager, cleanupVertexServiceAccountKey } from './opencode';
import { oauthBrowserFlow } from './opencode/auth-browser';
import { migrateLegacyData } from './store/legacyMigration';
import {
  initializeStorage,
  closeStorage,
  getStorage,
  resetStorageSingleton,
} from './store/storage';
import { getApiKey, clearSecureStorage } from './store/secureStorage';
import { initializeLogCollector, shutdownLogCollector, getLogCollector } from './logging';
import { skillsManager } from './skills';
import { getAirLLMServer } from './services/airllmServer';

if (process.argv.includes('--e2e-skip-auth')) {
  (global as Record<string, unknown>).E2E_SKIP_AUTH = true;
}
if (process.argv.includes('--e2e-mock-tasks') || process.env.E2E_MOCK_TASK_EVENTS === '1') {
  (global as Record<string, unknown>).E2E_MOCK_TASK_EVENTS = true;
}

if (process.env.CLEAN_START === '1') {
  const userDataPath = app.getPath('userData');
  console.log('[Clean Mode] Clearing userData directory:', userDataPath);
  try {
    if (fs.existsSync(userDataPath)) {
      fs.rmSync(userDataPath, { recursive: true, force: true });
      console.log('[Clean Mode] Successfully cleared userData');
    }
  } catch (err) {
    console.error('[Clean Mode] Failed to clear userData:', err);
  }
  // Clear secure storage first (while singleton still exists), then null the reference.
  // Reversing this order would cause getStorage() to re-create the singleton.
  clearSecureStorage();
  resetStorageSingleton();
  console.log('[Clean Mode] All singletons reset');
}

app.setName('Accomplish');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = app.isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.join(__dirname, '../../.env');
config({ path: envPath });

process.env.APP_ROOT = path.join(__dirname, '../..');

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');

const ROUTER_URL = process.env.ACCOMPLISH_ROUTER_URL;

// In production, web's build output is packaged as an extraResource.
const WEB_DIST = app.isPackaged
  ? path.join(process.resourcesPath, 'web-ui')
  : path.join(process.env.APP_ROOT, '../web/dist/client');

let mainWindow: BrowserWindow | null = null;
let rendererCrashRecoveryCount = 0;
let rendererCrashRecoveryTimer: NodeJS.Timeout | null = null;

function getPreloadPath(): string {
  return path.join(__dirname, '../preload/index.cjs');
}

function canConnectToUrl(rawUrl: string, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const url = new URL(rawUrl);
      const host = url.hostname;
      const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
      const socket = createConnection({ host, port });

      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        resolve(ok);
      };

      socket.setTimeout(timeoutMs);
      socket.on('connect', () => finish(true));
      socket.on('timeout', () => finish(false));
      socket.on('error', () => finish(false));
    } catch {
      resolve(false);
    }
  });
}

async function resolveDevRouterUrl(): Promise<string | null> {
  const candidates = [
    ROUTER_URL,
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (await canConnectToUrl(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function loadRenderer(mainWindowRef: BrowserWindow): Promise<void> {
  if (app.isPackaged) {
    const indexPath = path.join(WEB_DIST, 'index.html');
    if (fs.existsSync(indexPath)) {
      console.log('[Main] Loading from file:', indexPath);
      await mainWindowRef.loadFile(indexPath);
    } else {
      console.error('[Main] Packaged web UI missing:', indexPath);
      const packagedMissingHtml = `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; color: #1f2937;">
    <h2>UI Assets Missing</h2>
    <p>The packaged web UI was not found.</p>
    <p>Expected file: <code>${indexPath}</code></p>
    <p>Rebuild and reinstall the app package.</p>
  </body>
</html>`;
      await mainWindowRef.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(packagedMissingHtml)}`,
      );
    }
    return;
  }

  const resolvedUrl = await resolveDevRouterUrl();
  if (resolvedUrl) {
    console.log('[Main] Loading from router URL:', resolvedUrl);
    await mainWindowRef.loadURL(resolvedUrl);
    return;
  }

  console.error('[Main] No reachable dev router URL found. Showing startup diagnostics page.');
  const diagnosticsHtml = `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; color: #1f2937;">
    <h2>Renderer Not Reachable</h2>
    <p>Accomplish could not connect to the web dev server.</p>
    <p>Expected one of: <code>http://localhost:5173</code> or <code>http://localhost:5174</code></p>
    <p>Try restarting with <code>pnpm dev</code>.</p>
  </body>
</html>`;
  await mainWindowRef.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(diagnosticsHtml)}`);
}

function createWindow() {
  console.log('[Main] Creating main application window');

  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, iconFile)
    : path.join(process.env.APP_ROOT!, 'resources', iconFile);
  const icon = nativeImage.createFromPath(iconPath);
  if (process.platform === 'darwin' && app.dock && !icon.isEmpty()) {
    app.dock.setIcon(icon);
  }

  const preloadPath = getPreloadPath();
  console.log('[Main] Using preload script:', preloadPath);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Accomplish',
    icon: icon.isEmpty() ? undefined : icon,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#171717' : '#f9f9f9',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true,
    },
  });

  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (!params.misspelledWord) {
      return;
    }

    const menuItems: Electron.MenuItemConstructorOptions[] = params.dictionarySuggestions.map(
      (suggestion) => ({
        label: suggestion,
        click: () => mainWindow?.webContents.replaceMisspelling(suggestion),
      }),
    );

    if (menuItems.length > 0) {
      menuItems.push({ type: 'separator' });
    }

    menuItems.push({
      label: 'Add to Dictionary',
      click: () =>
        mainWindow?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
    });

    Menu.buildFromTemplate(menuItems).popup();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.maximize();

  const isE2EMode = (global as Record<string, unknown>).E2E_SKIP_AUTH === true;
  const isTestEnv = process.env.NODE_ENV === 'test';
  const shouldOpenDevTools = process.env.ACCOMPLISH_OPEN_DEVTOOLS === '1';
  if (!app.isPackaged && !isE2EMode && !isTestEnv && shouldOpenDevTools) {
    mainWindow.webContents.openDevTools({ mode: 'right' });
  }

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https: ws: wss:; font-src 'self' https: data:",
        ],
      },
    });
  });

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame) {
        console.error('[Main] Renderer failed to load:', {
          errorCode,
          errorDescription,
          validatedURL,
        });
        const failHtml = `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; color: #1f2937;">
    <h2>Renderer Load Failed</h2>
    <p>${errorDescription} (code ${errorCode})</p>
    <p>URL: <code>${validatedURL || 'unknown'}</code></p>
    <p>Try restarting <code>pnpm dev</code> or rebuilding the desktop app.</p>
  </body>
</html>`;
        void mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(failHtml)}`);
      }
    },
  );

  mainWindow.webContents.on('did-finish-load', () => {
    rendererCrashRecoveryCount = 0;
    if (rendererCrashRecoveryTimer) {
      clearTimeout(rendererCrashRecoveryTimer);
      rendererCrashRecoveryTimer = null;
    }
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (!sourceId.includes('localhost') && !sourceId.includes('index.html')) {
      return;
    }
    const levelLabel = level === 3 ? 'ERROR' : level === 2 ? 'WARN' : 'INFO';
    console.log(`[Renderer ${levelLabel}] ${sourceId}:${line} ${message}`);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Main] Renderer process exited unexpectedly:', details);

    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (rendererCrashRecoveryCount >= 3) {
      console.error('[Main] Renderer recovery limit reached. Manual restart required.');
      return;
    }

    rendererCrashRecoveryCount += 1;
    if (rendererCrashRecoveryTimer) {
      clearTimeout(rendererCrashRecoveryTimer);
    }

    rendererCrashRecoveryTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      console.warn(
        `[Main] Attempting renderer recovery (${rendererCrashRecoveryCount}/3) by reloading UI`,
      );
      void loadRenderer(mainWindow).catch((error) => {
        console.error('[Main] Renderer recovery load failed:', error);
      });
    }, 600);
  });

  void loadRenderer(mainWindow).catch((error) => {
    console.error('[Main] Failed to load renderer:', error);
  });
}

process.on('uncaughtException', (error) => {
  try {
    const collector = getLogCollector();
    collector.log('ERROR', 'main', `Uncaught exception: ${error.message}`, {
      name: error.name,
      stack: error.stack,
    });
  } catch {
    // ignore - log collector may not be initialized
  }
});

process.on('unhandledRejection', (reason) => {
  try {
    const collector = getLogCollector();
    collector.log('ERROR', 'main', 'Unhandled promise rejection', { reason });
  } catch {
    // ignore - log collector may not be initialized
  }
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Main] Second instance attempted; quitting');
  app.quit();
} else {
  initializeLogCollector();
  getLogCollector().logEnv('INFO', 'App starting', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
  });

  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      console.log('[Main] Focused existing instance after second-instance event');

      if (process.platform === 'win32') {
        const protocolUrl = commandLine.find((arg) => arg.startsWith('accomplish://'));
        if (protocolUrl) {
          console.log('[Main] Received protocol URL from second-instance:', protocolUrl);
          if (protocolUrl.startsWith('accomplish://callback/mcp')) {
            mainWindow.webContents.send('auth:mcp-callback', protocolUrl);
          } else if (protocolUrl.startsWith('accomplish://callback')) {
            mainWindow.webContents.send('auth:callback', protocolUrl);
          }
        }
      }
    }
  });

  app.whenReady().then(async () => {
    console.log('[Main] Electron app ready, version:', app.getVersion());

    if (process.env.CLEAN_START !== '1') {
      try {
        const didMigrate = migrateLegacyData();
        if (didMigrate) {
          console.log('[Main] Migrated data from legacy userData path');
        }
      } catch (err) {
        console.error('[Main] Legacy data migration failed:', err);
      }
    }

    try {
      initializeStorage();
    } catch (err) {
      if (err instanceof FutureSchemaError) {
        await dialog.showMessageBox({
          type: 'error',
          title: 'Update Required',
          message: `This data was created by a newer version of Accomplish (schema v${err.storedVersion}).`,
          detail: `Your app supports up to schema v${err.appVersion}. Please update Accomplish to continue.`,
          buttons: ['Quit'],
        });
        app.quit();
        return;
      }
      throw err;
    }

    try {
      const storage = getStorage();
      const settings = storage.getProviderSettings();
      for (const [id, provider] of Object.entries(settings.connectedProviders)) {
        const providerId = id as ProviderId;
        const credType = provider?.credentials?.type;
        if (!credType || credType === 'api_key') {
          const key = getApiKey(providerId);
          if (!key) {
            console.warn(
              `[Main] Provider ${providerId} has api_key auth but key not found in secure storage`,
            );
            storage.removeConnectedProvider(providerId);
            console.log(`[Main] Removed provider ${providerId} due to missing API key`);
          }
        }
      }
    } catch (err) {
      console.error('[Main] Provider validation failed:', err);
    }

    await skillsManager.initialize();

    if (process.platform === 'darwin' && app.dock) {
      const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'icon.png')
        : path.join(process.env.APP_ROOT!, 'resources', 'icon.png');
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        app.dock.setIcon(icon);
      }
    }

    // Must run before createWindow() so backgroundColor matches the theme
    try {
      const storage = getStorage();
      nativeTheme.themeSource = storage.getTheme();
    } catch {
      // First launch or corrupt DB — nativeTheme stays 'system'
    }

    registerIPCHandlers();
    console.log('[Main] IPC handlers registered');

    // Start AirLLM server in the background
    getAirLLMServer()
      .start()
      .then((res) => {
        if (!res.success) {
          console.error('[Main] AirLLM server failed to start:', res.error);
        } else {
          console.log('[Main] AirLLM server started successfully');
        }
      })
      .catch((err) => console.error('[Main] AirLLM server start error:', err));

    createWindow();

    if (mainWindow) {
      initThoughtStreamApi(mainWindow);
      startThoughtStreamServer();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        console.log('[Main] Application reactivated; recreated window');
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  void getAirLLMServer().stop();
  disposeTaskManager(); // Also cleans up proxies internally
  cleanupVertexServiceAccountKey();
  oauthBrowserFlow.dispose();
  closeStorage();
  shutdownLogCollector();
});

if (process.platform === 'win32' && !app.isPackaged) {
  app.setAsDefaultProtocolClient('accomplish', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('accomplish');
}

function handleProtocolUrlFromArgs(): void {
  if (process.platform === 'win32') {
    const protocolUrl = process.argv.find((arg) => arg.startsWith('accomplish://'));
    if (protocolUrl) {
      app.whenReady().then(() => {
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (protocolUrl.startsWith('accomplish://callback/mcp')) {
              mainWindow.webContents.send('auth:mcp-callback', protocolUrl);
            } else if (protocolUrl.startsWith('accomplish://callback')) {
              mainWindow.webContents.send('auth:callback', protocolUrl);
            }
          }
        }, 1000);
      });
    }
  }
}

handleProtocolUrlFromArgs();

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (url.startsWith('accomplish://callback/mcp')) {
    mainWindow?.webContents?.send('auth:mcp-callback', url);
  } else if (url.startsWith('accomplish://callback')) {
    mainWindow?.webContents?.send('auth:callback', url);
  }
});

ipcMain.handle('app:version', () => {
  return app.getVersion();
});

ipcMain.handle('app:platform', () => {
  return process.platform;
});

ipcMain.handle('app:is-e2e-mode', () => {
  return (
    (global as Record<string, unknown>).E2E_MOCK_TASK_EVENTS === true ||
    process.env.E2E_MOCK_TASK_EVENTS === '1'
  );
});
