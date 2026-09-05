import { app, BrowserWindow, clipboard, dialog, globalShortcut, nativeImage, net, protocol, screen, session } from 'electron';
import started from 'electron-squirrel-startup';
import path from 'node:path';
import { createAssetService } from './assets';
import { createPersistenceService } from './persistence';
import { registerAssetProtocol } from './security/asset-protocol';
import { installContentSecurityPolicy } from './security/content-security-policy';
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
      await persistence.loadBoard();
    } catch {
      dialog.showErrorBox('Referenzio could not start', 'The Referenzio library could not be initialized.');
      app.quit();
      return;
    }

    const assets = createAssetService({ persistence, clipboard: { captureImage: () => captureElectronClipboardImage(clipboard, nativeImage) } });
    void assets;
    registerAssetProtocol({ protocol, net, persistence });
    installContentSecurityPolicy(session.defaultSession, app.isPackaged);

    const controller = createWindowController({
      BrowserWindow,
      screen,
      globalShortcut,
      persistence,
      notifyShortcut: () => {},
      notifyError: () => {},
      // Task 6 replaces this seam with the renderer IPC flush coordinator.
      flushRenderer: async () => ({ ok: true, value: undefined }),
      quit: () => app.quit(),
    });
    await controller.createOrFocus();

    app.on('second-instance', () => { void controller.createOrFocus(); });
    app.on('activate', () => { void controller.createOrFocus(); });
  });
}

bootstrapApp();
