import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRendererFlushCoordinator, registerIpcHandlers } from './ipc';

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() },
  webUtils: { getPathForFile: vi.fn() },
}));

vi.mock('electron', () => electron);

const validBoard = () => ({
  schemaVersion: 1,
  revision: 0,
  camera: { x: 0, y: 0, scale: 1 },
  assets: [],
  items: [],
});

describe('IPC capability boundary', () => {
  function setup() {
    const registeredHandlers = new Map<string, (...args: never[]) => unknown>();
    const registeredEvents = new Map<string, (...args: never[]) => unknown>();
    const persistence = {
      libraryRoot: 'C:\\Referenzio',
      loadBoard: vi.fn().mockResolvedValue({ document: validBoard(), recovery: 'primary', recoveryMessage: null, missingAssetIds: [] }),
      saveBoard: vi.fn().mockResolvedValue({ ok: true, value: { revision: 1 } }),
    };
    const assets = {
      pasteClipboardImage: vi.fn().mockResolvedValue({ ok: true, value: validAsset() }),
      importDroppedImages: vi.fn().mockResolvedValue({ imported: [], rejected: [{ sourceName: 'bad.png', code: 'FILE_UNREADABLE', message: 'Nope' }] }),
    };
    const controller = {
      getRuntimeStatus: vi.fn(() => ({ alwaysOnTop: true, shortcut: { registered: true, message: null } })),
      setPinned: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
      minimize: vi.fn(),
      requestClose: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    };
    const shell = { openPath: vi.fn().mockResolvedValue('') };
    registerIpcHandlers({
      ipcMain: {
        handle: (channel: string, handler: (...args: never[]) => unknown) => registeredHandlers.set(channel, handler),
        on: (channel: string, listener: (...args: never[]) => unknown) => registeredEvents.set(channel, listener),
      } as never,
      persistence: persistence as never,
      assets: assets as never,
      controller: controller as never,
      shell,
      rendererUrl: 'http://localhost:5173/',
    });
    return { registeredHandlers, registeredEvents, persistence, assets, controller, shell };
  }

  const trustedEvent = () => ({ senderFrame: { url: 'http://localhost:5173/' } });

  it('rejects a renderer save with an unknown asset reference before persistence runs', async () => {
    const { registeredHandlers, persistence } = setup();
    const invalidItem = {
      id: '11111111-1111-4111-8111-111111111111',
      assetId: '22222222-2222-4222-8222-222222222222',
      x: 0, y: 0, width: 100, height: 100, zIndex: 0,
      createdAt: '2026-09-05T12:00:00.000Z', updatedAt: '2026-09-05T12:00:00.000Z',
    };

    await expect(registeredHandlers.get('board:save')!(trustedEvent() as never, { ...validBoard(), items: [invalidItem] } as never)).resolves.toEqual({
      ok: false, error: { code: 'REQUEST_INVALID', message: 'The request is invalid.', action: 'dismiss' },
    });
    expect(persistence.saveBoard).not.toHaveBeenCalled();
  });

  it('returns every allowed capability through a validated handler', async () => {
    const { registeredHandlers, persistence, assets, controller, shell } = setup();
    const call = (channel: string, value?: unknown) => registeredHandlers.get(channel)!(trustedEvent() as never, value as never);

    await expect(call('board:load')).resolves.toMatchObject({ ok: true, value: { recovery: 'primary' } });
    await expect(call('app:runtime-status')).resolves.toEqual({ ok: true, value: { alwaysOnTop: true, shortcut: { registered: true, message: null } } });
    await expect(call('clipboard:paste')).resolves.toMatchObject({ ok: true, value: validAsset() });
    await expect(call('assets:import-drop', ['C:\\drop.png'])).resolves.toEqual({ ok: true, value: { imported: [], rejected: [{ sourceName: 'bad.png', code: 'FILE_UNREADABLE', message: 'Nope' }] } });
    await expect(call('board:save', validBoard())).resolves.toEqual({ ok: true, value: { revision: 1 } });
    await expect(call('window:set-pinned', { value: false })).resolves.toEqual({ ok: true, value: undefined });
    await expect(call('shell:open-library')).resolves.toEqual({ ok: true, value: undefined });
    await expect(call('window:minimize')).resolves.toEqual({ ok: true, value: undefined });
    await expect(call('window:close')).resolves.toEqual({ ok: true, value: undefined });

    expect(persistence.loadBoard).toHaveBeenCalledOnce();
    expect(assets.importDroppedImages).toHaveBeenCalledWith(['C:\\drop.png']);
    expect(controller.setPinned).toHaveBeenCalledWith(false);
    expect(controller.minimize).toHaveBeenCalledOnce();
    expect(controller.requestClose).toHaveBeenCalledOnce();
    expect(shell.openPath).toHaveBeenCalledWith('C:\\Referenzio');
  });

  it('rejects an untrusted sender before every service call', async () => {
    const { registeredHandlers, persistence, assets, controller, shell } = setup();
    const result = await registeredHandlers.get('assets:import-drop')!({ senderFrame: { url: 'https://evil.example/' } } as never, ['C:\\drop.png'] as never);

    expect(result).toEqual({ ok: false, error: { code: 'UNTRUSTED_SENDER', message: 'The request was not sent by the Referenzio window.', action: 'dismiss' } });
    expect(assets.importDroppedImages).not.toHaveBeenCalled();
    expect(persistence.loadBoard).not.toHaveBeenCalled();
    expect(controller.getRuntimeStatus).not.toHaveBeenCalled();
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it('rejects untrusted and malformed input on every channel', async () => {
    const { registeredHandlers } = setup();
    const requests: Array<[string, unknown, unknown]> = [
      ['board:load', undefined, {}],
      ['app:runtime-status', undefined, {}],
      ['clipboard:paste', undefined, {}],
      ['assets:import-drop', ['C:\\drop.png'], ['relative.png']],
      ['board:save', validBoard(), {}],
      ['window:set-pinned', { value: true }, { value: 'true' }],
      ['shell:open-library', undefined, {}],
      ['window:minimize', undefined, {}],
      ['window:close', undefined, {}],
    ];
    for (const [channel, validPayload, malformedPayload] of requests) {
      await expect(registeredHandlers.get(channel)!({ senderFrame: { url: 'https://evil.example/' } } as never, validPayload as never)).resolves.toMatchObject({ ok: false, error: { code: 'UNTRUSTED_SENDER' } });
      await expect(registeredHandlers.get(channel)!(trustedEvent() as never, malformedPayload as never)).resolves.toMatchObject({ ok: false, error: { code: 'REQUEST_INVALID' } });
    }
  });

  it('rejects malformed input and more than 32 paths before services run', async () => {
    const { registeredHandlers, assets, controller } = setup();
    const handler = registeredHandlers.get('assets:import-drop')!;
    const tooMany = Array.from({ length: 33 }, (_, index) => `C:\\${index}.png`);

    await expect(handler(trustedEvent() as never, tooMany as never)).resolves.toEqual({ ok: false, error: { code: 'REQUEST_INVALID', message: 'The request is invalid.', action: 'dismiss' } });
    await expect(registeredHandlers.get('window:set-pinned')!(trustedEvent() as never, { value: 'yes' } as never)).resolves.toMatchObject({ ok: false, error: { code: 'REQUEST_INVALID' } });
    expect(assets.importDroppedImages).not.toHaveBeenCalled();
    expect(controller.setPinned).not.toHaveBeenCalled();
  });

  it('converts a non-empty shell error into a retryable result', async () => {
    const { registeredHandlers, shell } = setup();
    shell.openPath.mockResolvedValue('Access denied');

    await expect(registeredHandlers.get('shell:open-library')!(trustedEvent() as never, undefined as never)).resolves.toEqual({
      ok: false,
      error: { code: 'OPEN_LIBRARY_FAILED', message: 'The Referenzio library folder could not be opened.', action: 'retry-open-library' },
    });
  });
});

describe('renderer flush coordinator', () => {
  it('accepts only a matching token from the requesting web contents', async () => {
    const listeners = new Map<string, (...args: never[]) => unknown>();
    const webContents = { send: vi.fn() };
    const coordinator = createRendererFlushCoordinator(
      { on: (channel: string, listener: (...args: never[]) => unknown) => listeners.set(channel, listener) } as never,
      () => ({ webContents } as never),
      { token: () => '11111111-1111-4111-8111-111111111111' },
    );
    const pending = coordinator();
    expect(webContents.send).toHaveBeenCalledWith('app:flush-request', '11111111-1111-4111-8111-111111111111');

    listeners.get('app:flush-response')!({ sender: {} } as never, { token: '22222222-2222-4222-8222-222222222222', result: { ok: true, value: { revision: 1 } } } as never);
    listeners.get('app:flush-response')!({ sender: {} } as never, { token: '11111111-1111-4111-8111-111111111111', result: { ok: true, value: { revision: 1 } } } as never);
    listeners.get('app:flush-response')!({ sender: webContents } as never, { token: '11111111-1111-4111-8111-111111111111', result: { ok: true, value: { revision: 1 } } } as never);

    await expect(pending).resolves.toEqual({ ok: true, value: undefined });
  });

  it('returns a retryable timeout and removes its response entry', async () => {
    vi.useFakeTimers();
    const listeners = new Map<string, (...args: never[]) => unknown>();
    const webContents = { send: vi.fn() };
    const coordinator = createRendererFlushCoordinator(
      { on: (channel: string, listener: (...args: never[]) => unknown) => listeners.set(channel, listener) } as never,
      () => ({ webContents } as never),
      { token: () => '11111111-1111-4111-8111-111111111111' },
    );
    const pending = coordinator();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toEqual({ ok: false, error: { code: 'RENDERER_FLUSH_TIMEOUT', message: 'Saving the canvas before closing timed out.', action: 'retry-close' } });
    listeners.get('app:flush-response')!({ sender: webContents } as never, { token: '11111111-1111-4111-8111-111111111111', result: { ok: true, value: { revision: 1 } } } as never);
    vi.useRealTimers();
  });
});

describe('preload bridge', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function exposedApi() {
    await import('../preload/index');
    return electron.contextBridge.exposeInMainWorld.mock.calls.at(-1)![1] as unknown as {
      [key: string]: unknown;
      loadBoard(): Promise<unknown>;
      importDroppedImages(files: File[]): Promise<unknown>;
      onShortcutStatus(listener: (status: unknown) => void): () => void;
      onFlushRequest(listener: () => Promise<{ ok: true; value: { revision: number } }>): () => void;
    };
  }

  it('exposes only the documented capabilities', async () => {
    const api = await exposedApi();

    expect(api).toEqual(expect.objectContaining({ loadBoard: expect.any(Function), importDroppedImages: expect.any(Function) }));
    expect(api).not.toHaveProperty('ipcRenderer');
    expect(api).not.toHaveProperty('require');
  });

  it('maps local dropped Files to paths, rejects pathless Files individually, and never returns paths', async () => {
    electron.webUtils.getPathForFile.mockImplementation((file: { name: string }) => {
      if (file.name === 'local.png') return 'C:\\local.png';
      if (file.name === 'throws.png') throw new Error('synthetic file');
      return '';
    });
    electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: { imported: [validAsset()], rejected: [{ sourceName: 'bad.png', code: 'IMAGE_INVALID', message: 'Bad image' }] } });
    const api = await exposedApi();

    await expect(api.importDroppedImages([{ name: 'local.png' }, { name: 'pathless.png' }, { name: 'throws.png' }] as never)).resolves.toEqual({
      ok: true,
      value: {
        imported: [validAsset()],
        rejected: [
          { sourceName: 'pathless.png', code: 'FILE_UNREADABLE', message: 'Drop a local PNG, JPEG, or WebP file from Explorer.' },
          { sourceName: 'throws.png', code: 'FILE_UNREADABLE', message: 'Drop a local PNG, JPEG, or WebP file from Explorer.' },
          { sourceName: 'bad.png', code: 'IMAGE_INVALID', message: 'Bad image' },
        ],
      },
    });
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith('assets:import-drop', ['C:\\local.png']);
    expect(electron.webUtils.getPathForFile).toHaveBeenCalledTimes(3);

    electron.ipcRenderer.invoke.mockClear();
    await expect(api.importDroppedImages([{ name: 'also-pathless.png' }] as never)).resolves.toMatchObject({ ok: true, value: { imported: [] } });
    expect(electron.ipcRenderer.invoke).not.toHaveBeenCalled();
  });

  it('converts a bridge transport failure and validates event payloads before listeners run', async () => {
    electron.ipcRenderer.invoke.mockRejectedValue(new Error('channel closed'));
    const api = await exposedApi();
    await expect(api.loadBoard()).resolves.toMatchObject({ ok: false, error: { code: 'IPC_TRANSPORT_FAILED' } });

    const shortcut = vi.fn();
    const cleanup = api.onShortcutStatus(shortcut);
    const callback = electron.ipcRenderer.on.mock.calls.at(-1)![1];
    callback({}, { registered: 'not boolean', message: null });
    callback({}, { registered: true, message: null });
    expect(shortcut).toHaveBeenCalledOnce();
    cleanup();
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith('app:shortcut-status', callback);

    const invalidResult = await exposedApi();
    electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: { malformed: true } });
    await expect(invalidResult.loadBoard()).resolves.toMatchObject({ ok: false, error: { code: 'IPC_TRANSPORT_FAILED' } });
  });

  it('sends only a schema-validated flush response and cleans up its listener', async () => {
    const api = await exposedApi();
    const cleanup = api.onFlushRequest(async () => ({ ok: true, value: { revision: 2 } }));
    const callback = electron.ipcRenderer.on.mock.calls.at(-1)![1];
    await callback({}, 'not-a-token');
    expect(electron.ipcRenderer.send).not.toHaveBeenCalled();
    await callback({}, '11111111-1111-4111-8111-111111111111');
    expect(electron.ipcRenderer.send).toHaveBeenCalledWith('app:flush-response', {
      token: '11111111-1111-4111-8111-111111111111', result: { ok: true, value: { revision: 2 } },
    });
    cleanup();
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith('app:flush-request', callback);
  });
});

function validAsset() {
  return {
    id: '11111111-1111-4111-8111-111111111111', filename: '11111111-1111-4111-8111-111111111111.png', mediaType: 'image/png',
    pixelWidth: 1, pixelHeight: 1, byteSize: 1, importedAt: '2026-09-05T12:00:00.000Z',
  } as const;
}
