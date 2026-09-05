import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '../../shared/contracts';
import { registerAssetProtocol } from '../security/asset-protocol';
import { contentSecurityPolicy, installContentSecurityPolicy } from '../security/content-security-policy';
import { createWindowController } from './controller';

const settings = { bounds: { x: 50_000, y: 50_000, width: 1200, height: 800 }, alwaysOnTop: true };

function setup({ flushRenderer = vi.fn().mockResolvedValue({ ok: true, value: undefined }) }: { flushRenderer?: () => Promise<Result<void>> } = {}) {
  const handlers: Record<string, Array<(...args: never[]) => void>> = {};
  const window = {
    once: vi.fn((event: string, listener: (...args: never[]) => void) => { handlers[`once:${event}`] = [listener]; }),
    on: vi.fn((event: string, listener: (...args: never[]) => void) => { (handlers[event] ??= []).push(listener); }),
    isVisible: vi.fn(() => true), isFocused: vi.fn(() => false),
    isMinimized: vi.fn(() => false), show: vi.fn(), focus: vi.fn(), restore: vi.fn(), hide: vi.fn(),
    minimize: vi.fn(), setAlwaysOnTop: vi.fn(), getNormalBounds: vi.fn(() => settings.bounds), destroy: vi.fn(),
  };
  const BrowserWindow = vi.fn(function BrowserWindowFake() { return window; });
  const persistence = {
    loadSettings: vi.fn().mockResolvedValue(settings), saveSettings: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    flush: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  };
  const globalShortcut = { register: vi.fn(() => true), unregisterAll: vi.fn() };
  const notifyShortcut = vi.fn();
  const controller = createWindowController({
    BrowserWindow: BrowserWindow as never,
    screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }], getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) } as never,
    globalShortcut: globalShortcut as never, persistence: persistence as never, notifyShortcut,
    notifyError: vi.fn(), flushRenderer,
  });
  return { controller, BrowserWindow, globalShortcut, notifyShortcut, persistence, window, handlers, flushRenderer };
}

describe('window controller', () => {
  it('clamps saved bounds to the primary work area when no saved rectangle intersects a display', async () => {
    const { controller, BrowserWindow } = setup();

    await controller.createOrFocus();

    expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
      x: 0, y: 0, width: 1200, height: 800, alwaysOnTop: true, frame: false, resizable: true,
    }));
  });

  it('warns but starts when the fixed shortcut cannot register', async () => {
    const { controller, globalShortcut, notifyShortcut } = setup();
    globalShortcut.register.mockReturnValue(false);

    await controller.createOrFocus();

    expect(notifyShortcut).toHaveBeenCalledWith({ registered: false, message: 'Ctrl+Shift+Space is unavailable; use the Referenzio taskbar window.' });
  });

  it('hides a focused visible window and restores focus when it is hidden', async () => {
    const { controller, window } = setup();
    await controller.createOrFocus();
    window.isFocused.mockReturnValue(true);

    controller.toggleVisibility();
    expect(window.hide).toHaveBeenCalledOnce();

    window.isVisible.mockReturnValue(false);
    controller.toggleVisibility();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it('persists a pin change immediately and exposes the startup pin and shortcut status', async () => {
    const { controller, persistence, window } = setup();
    await controller.createOrFocus();

    expect(controller.getRuntimeStatus()).toEqual({ alwaysOnTop: true, shortcut: { registered: true, message: null } });
    await expect(controller.setPinned(false)).resolves.toEqual({ ok: true, value: undefined });
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(false);
    expect(persistence.saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ alwaysOnTop: false }));
  });

  it('debounces move persistence for 300ms and flushes the latest normal bounds on close', async () => {
    vi.useFakeTimers();
    const { controller, persistence, window, handlers } = setup();
    await controller.createOrFocus();
    window.getNormalBounds.mockReturnValue({ x: 10, y: 20, width: 700, height: 500 });
    handlers.move[0]();
    handlers.resize[0]();
    await vi.advanceTimersByTimeAsync(299);
    expect(persistence.saveSettings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(persistence.saveSettings).toHaveBeenCalledTimes(1);

    window.getNormalBounds.mockReturnValue({ x: 12, y: 22, width: 702, height: 502 });
    await controller.flushWindowState();
    expect(persistence.saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ bounds: { x: 12, y: 22, width: 702, height: 502 } }));
    vi.useRealTimers();
  });

  it('drains the renderer before persistence and destroys once for overlapping close requests', async () => {
    let release!: () => void;
    const flushRenderer = vi.fn(() => new Promise<{ ok: true; value: undefined }>((resolve) => { release = () => resolve({ ok: true, value: undefined }); }));
    const { controller, persistence, window } = setup({ flushRenderer });
    await controller.createOrFocus();

    const first = controller.requestClose();
    const second = controller.requestClose();
    expect(flushRenderer).toHaveBeenCalledOnce();
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true, value: undefined }, { ok: true, value: undefined }]);
    expect(persistence.flush).toHaveBeenCalledOnce();
    expect(window.destroy).toHaveBeenCalledOnce();
    expect(flushRenderer.mock.invocationCallOrder[0]).toBeLessThan(persistence.flush.mock.invocationCallOrder[0]);
    expect(persistence.flush.mock.invocationCallOrder[0]).toBeLessThan(persistence.saveSettings.mock.invocationCallOrder.at(-1)!);
  });

  it('keeps the window open and permits retry when a renderer close flush fails', async () => {
    const flushRenderer = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'FLUSH_TIMEOUT', message: 'Timed out', action: 'retry-save' } }).mockResolvedValueOnce({ ok: true, value: undefined });
    const { controller, persistence, window } = setup({ flushRenderer });
    await controller.createOrFocus();

    await expect(controller.requestClose()).resolves.toEqual({ ok: false, error: { code: 'FLUSH_TIMEOUT', message: 'Timed out', action: 'retry-close' } });
    expect(window.destroy).not.toHaveBeenCalled();
    await expect(controller.requestClose()).resolves.toEqual({ ok: true, value: undefined });
    expect(persistence.flush).toHaveBeenCalledTimes(2);
    expect(window.destroy).toHaveBeenCalledOnce();
  });
});

describe('main-process security boundaries', () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  it('serves only canonical app-owned asset filenames', async () => {
    const root = await mkdtemp(join(tmpdir(), 'referenzio-protocol-'));
    roots.push(root);
    const filename = '11111111-1111-4111-8111-111111111111.png';
    const assetPath = join(root, filename);
    await writeFile(assetPath, 'asset');
    let handler!: (request: { url: string }) => Promise<Response>;
    const fetch = vi.fn().mockResolvedValue(new Response('asset'));
    registerAssetProtocol({ protocol: { handle: (_scheme, next) => { handler = next; } }, net: { fetch }, persistence: { assetPath: (candidate) => join(root, candidate) } });

    await expect(handler({ url: `referenzio-asset://asset/${filename}` })).resolves.toMatchObject({ status: 200 });
    await expect(handler({ url: 'referenzio-asset://asset/..%2Fsecret.png' })).resolves.toMatchObject({ status: 404 });
    await expect(handler({ url: 'referenzio-asset://asset/not-a-uuid.png' })).resolves.toMatchObject({ status: 404 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('installs production CSP without remote images and adds only local Vite sources in development', () => {
    let listener!: (details: { responseHeaders?: Record<string, string[] | undefined> }, callback: (response: { responseHeaders: Record<string, string[] | undefined> }) => void) => void;
    installContentSecurityPolicy({ webRequest: { onHeadersReceived: (next: typeof listener) => { listener = next; } } } as never, true);
    const production: { responseHeaders?: Record<string, string[] | undefined> } = {};
    listener({ responseHeaders: { Existing: ['preserved'] } }, (response) => { production.responseHeaders = response.responseHeaders; });
    expect(production.responseHeaders?.['Content-Security-Policy']).toEqual([contentSecurityPolicy(true)]);
    expect(contentSecurityPolicy(true)).not.toContain('http:');
    expect(contentSecurityPolicy(true)).not.toContain('https:');
    expect(contentSecurityPolicy(false)).toContain("script-src 'self' 'unsafe-eval' http://localhost:*");
    expect(contentSecurityPolicy(false)).toContain('connect-src \'self\' http://localhost:* ws://localhost:*');
    expect(contentSecurityPolicy(false)).not.toMatch(/img-src[^;]*http/);
  });
});
