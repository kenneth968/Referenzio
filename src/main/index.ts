import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, nativeImage, net, protocol, screen, session, shell } from 'electron';
import started from 'electron-squirrel-startup';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAssetService } from './assets';
import { createPersistenceService } from './persistence';
import { registerAssetProtocol } from './security/asset-protocol';
import { installContentSecurityPolicy } from './security/content-security-policy';
import { createRendererFlushCoordinator, registerIpcHandlers } from './ipc';
import { createWindowController } from './window/controller';

protocol.registerSchemesAsPrivileged([{
  scheme: 'referenzio-asset',
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}]);

let bootstrapped = false;

export async function captureElectronClipboardImage(
  electronClipboard: Pick<Electron.Clipboard, 'read'>,
  images: Pick<typeof nativeImage, 'createFromBuffer'>,
) {
  const items = await electronClipboard.read();
  for (const mediaType of ['image/png', 'image/jpeg']) {
    const item = items.find((candidate) => candidate.types.includes(mediaType));
    if (!item) continue;
    const blob = await item.getType(mediaType) as Blob;
    return images.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
  }
  return undefined;
}

export function bootstrapApp(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  if (started || !app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  void app.whenReady().then(async () => {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) {
      dialog.showErrorBox('Referenzio could not start', 'LOCALAPPDATA is required to locate the Referenzio library.');
      app.quit();
      return;
    }

    const persistence = createPersistenceService({ libraryRoot: path.join(localAppData, 'Referenzio', 'library') });
    try {
      await persistence.initialize();
    } catch {
      dialog.showErrorBox('Referenzio could not start', 'The Referenzio library could not be initialized.');
      app.quit();
      return;
    }

    const assets = createAssetService({ persistence, clipboard: { captureImage: () => captureElectronClipboardImage(clipboard, nativeImage) } });
    registerAssetProtocol({ protocol, net, persistence });
    installContentSecurityPolicy(session.defaultSession, app.isPackaged);

    let mainWindow: BrowserWindow | undefined;
    const flushRenderer = createRendererFlushCoordinator(ipcMain, () => mainWindow);
    const sendToRenderer = <T>(channel: string, value: T): void => {
      if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(channel, value);
    };

    const controller = createWindowController({
      BrowserWindow,
      screen,
      globalShortcut,
      persistence,
      notifyShortcut: (status) => sendToRenderer('app:shortcut-status', status),
      notifyError: (error) => sendToRenderer('app:error', error),
      flushRenderer,
      quit: () => app.quit(),
    });
    registerIpcHandlers({
      ipcMain,
      persistence,
      assets,
      controller,
      shell,
      rendererUrl: typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'undefined'
        ? pathToFileURL(path.join(__dirname, '../renderer', typeof MAIN_WINDOW_VITE_NAME === 'undefined' ? 'main_window' : MAIN_WINDOW_VITE_NAME, 'index.html')).href
        : MAIN_WINDOW_VITE_DEV_SERVER_URL,
    });
    mainWindow = await controller.createOrFocus();
    const runtimeStatus = controller.getRuntimeStatus();
    if (!runtimeStatus.shortcut.registered) sendToRenderer('app:shortcut-status', runtimeStatus.shortcut);

    app.on('second-instance', () => { void controller.createOrFocus(); });
    app.on('activate', () => { void controller.createOrFocus(); });
  });
}

bootstrapApp();
