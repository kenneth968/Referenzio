import { describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  app: { requestSingleInstanceLock: vi.fn(() => false), quit: vi.fn(), whenReady: vi.fn() },
  BrowserWindow: vi.fn(),
  clipboard: { read: vi.fn() },
  dialog: { showErrorBox: vi.fn() },
  globalShortcut: { register: vi.fn(), unregisterAll: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() },
  net: { fetch: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  screen: {},
  session: { defaultSession: {} },
}));

vi.mock('electron', () => electron);
vi.mock('electron-squirrel-startup', () => ({ default: false }));

import { captureElectronClipboardImage } from './index';

describe('Electron 44 clipboard adapter', () => {
  it('prefers PNG over JPEG and converts its Blob bytes into a native image before ingestion', async () => {
    const jpeg = { types: ['image/jpeg'], getType: vi.fn() };
    const png = { types: ['image/png'], getType: vi.fn().mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])])) };
    const native = { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toPNG: () => new Uint8Array([1, 2, 3]) };
    electron.clipboard.read.mockResolvedValue([jpeg, png]);
    electron.nativeImage.createFromBuffer.mockReturnValue(native);

    await expect(captureElectronClipboardImage(electron.clipboard as never, electron.nativeImage as never)).resolves.toBe(native);

    expect(png.getType).toHaveBeenCalledWith('image/png');
    expect(jpeg.getType).not.toHaveBeenCalled();
    expect(electron.nativeImage.createFromBuffer).toHaveBeenCalledWith(Buffer.from([1, 2, 3]));
  });

  it('falls back to JPEG when PNG is unavailable', async () => {
    const jpeg = { types: ['image/jpeg'], getType: vi.fn().mockResolvedValue(new Blob([new Uint8Array([4, 5])])) };
    electron.clipboard.read.mockResolvedValue([jpeg]);
    electron.nativeImage.createFromBuffer.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toPNG: () => new Uint8Array([4, 5]) });

    await captureElectronClipboardImage(electron.clipboard as never, electron.nativeImage as never);

    expect(jpeg.getType).toHaveBeenCalledWith('image/jpeg');
    expect(electron.nativeImage.createFromBuffer).toHaveBeenCalledWith(Buffer.from([4, 5]));
  });
});
