import path from 'node:path';
import type { BrowserWindow as ElectronBrowserWindow } from 'electron';
import type { Result, RuntimeStatus, UserError, WindowSettings } from '../../shared/contracts';
import type { PersistenceService } from '../persistence';
import { clampBounds, type WindowBounds, type WorkArea } from './bounds';

type WindowLike = {
  once(event: 'ready-to-show', listener: () => void): void;
  on(event: 'move' | 'resize', listener: () => void): void;
  on(event: 'close', listener: (event: { preventDefault(): void }) => void): void;
  isVisible(): boolean;
  isFocused(): boolean;
  isMinimized(): boolean;
  show(): void;
  focus(): void;
  restore(): void;
  hide(): void;
  minimize(): void;
  setAlwaysOnTop(value: boolean): void;
  getNormalBounds(): WindowBounds;
  destroy(): void;
  loadURL?(url: string): Promise<void> | void;
  loadFile?(file: string): Promise<void> | void;
};

type ControllerDependencies = {
  BrowserWindow: new (options: Record<string, unknown>) => WindowLike;
  screen: { getAllDisplays(): Array<{ workArea: WorkArea }>; getPrimaryDisplay(): { workArea: WorkArea } };
  globalShortcut: { register(accelerator: string, callback: () => void): boolean; unregisterAll(): void };
  persistence: Pick<PersistenceService, 'loadSettings' | 'saveSettings' | 'flush'>;
  notifyShortcut(status: RuntimeStatus['shortcut']): void;
  notifyError(error: UserError): void;
  flushRenderer(): Promise<Result<void>>;
  quit?(): void;
};

export type WindowController = {
  createOrFocus(): Promise<ElectronBrowserWindow>;
  toggleVisibility(): void;
  setPinned(value: boolean): Promise<Result<void>>;
  minimize(): void;
  requestClose(): Promise<Result<void>>;
  flushWindowState(): Promise<Result<void>>;
  getRuntimeStatus(): RuntimeStatus;
};

const unavailableShortcut = 'Ctrl+Shift+Space is unavailable; use the Referenzio taskbar window.';

const closeFailure = (result: Result<void>): UserError => result.ok
  ? { code: 'CLOSE_FAILED', message: 'The window could not be closed.', action: 'retry-close' }
  : { ...result.error, action: 'retry-close' };

export function createWindowController(dependencies: ControllerDependencies): WindowController {
  let window: WindowLike | undefined;
  let settings: WindowSettings | undefined;
  let settingsTimer: ReturnType<typeof setTimeout> | undefined;
  let shortcutRegistered = false;
  let shortcut = { registered: false, message: null } as RuntimeStatus['shortcut'];
  let allowDestroy = false;
  let closeInFlight: Promise<Result<void>> | undefined;

  const getSettings = (): WindowSettings => {
    if (!settings) throw new Error('Window settings are not loaded.');
    return settings;
  };

  const persistSettings = async (): Promise<Result<void>> => dependencies.persistence.saveSettings(getSettings());

  const captureBounds = (): void => {
    if (!window || !settings) return;
    settings = { ...settings, bounds: window.getNormalBounds() };
  };

  const scheduleBoundsSave = (): void => {
    captureBounds();
    if (settingsTimer) clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      settingsTimer = undefined;
      void persistSettings();
    }, 300);
  };

  const focusWindow = (): void => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };

  const flushWindowState = async (): Promise<Result<void>> => {
    if (!window || !settings) return { ok: true, value: undefined };
    if (settingsTimer) {
      clearTimeout(settingsTimer);
      settingsTimer = undefined;
    }
    captureBounds();
    return persistSettings();
  };

  const requestClose = (): Promise<Result<void>> => {
    if (closeInFlight) return closeInFlight;
    const inFlight = (async (): Promise<Result<void>> => {
      const renderer = await dependencies.flushRenderer();
      const disk = await dependencies.persistence.flush();
      const windowState = await flushWindowState();
      const failed = !renderer.ok ? renderer : !disk.ok ? disk : windowState;
      if (!failed.ok) {
        const error = closeFailure(failed);
        dependencies.notifyError(error);
        closeInFlight = undefined;
        return { ok: false as const, error };
      }
      dependencies.globalShortcut.unregisterAll();
      allowDestroy = true;
      window?.destroy();
      dependencies.quit?.();
      return { ok: true as const, value: undefined };
    })().catch(() => {
      const error: UserError = { code: 'CLOSE_FAILED', message: 'The window could not be closed.', action: 'retry-close' };
      dependencies.notifyError(error);
      closeInFlight = undefined;
      return { ok: false as const, error };
    });
    closeInFlight = inFlight;
    return inFlight;
  };

  const createOrFocus = async (): Promise<ElectronBrowserWindow> => {
    if (window) {
      focusWindow();
      return window as ElectronBrowserWindow;
    }

    settings = await dependencies.persistence.loadSettings();
    const bounds = clampBounds(
      settings.bounds,
      dependencies.screen.getAllDisplays().map((display) => display.workArea),
      dependencies.screen.getPrimaryDisplay().workArea,
    );
    settings = { ...settings, bounds };
    window = new dependencies.BrowserWindow({
      title: 'Referenzio',
      ...bounds,
      alwaysOnTop: settings.alwaysOnTop,
      frame: false,
      resizable: true,
      thickFrame: true,
      minWidth: 640,
      minHeight: 480,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        navigateOnDragDrop: false,
      },
    });
    const createdWindow = window;
    createdWindow.once('ready-to-show', () => focusWindow());
    createdWindow.on('move', scheduleBoundsSave);
    createdWindow.on('resize', scheduleBoundsSave);
    createdWindow.on('close', (event) => {
      if (allowDestroy) return;
      event.preventDefault();
      void requestClose();
    });
    const devServerUrl = typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'undefined' ? undefined : MAIN_WINDOW_VITE_DEV_SERVER_URL;
    const rendererName = typeof MAIN_WINDOW_VITE_NAME === 'undefined' ? 'main_window' : MAIN_WINDOW_VITE_NAME;
    if (devServerUrl) {
      void createdWindow.loadURL?.(devServerUrl);
    } else {
      void createdWindow.loadFile?.(path.join(__dirname, '../renderer', rendererName, 'index.html'));
    }
    if (!shortcutRegistered) {
      shortcutRegistered = dependencies.globalShortcut.register('Ctrl+Shift+Space', () => toggleVisibility());
      shortcut = shortcutRegistered ? { registered: true, message: null } : { registered: false, message: unavailableShortcut };
      if (!shortcutRegistered) dependencies.notifyShortcut(shortcut);
    }
    return createdWindow as ElectronBrowserWindow;
  };

  const toggleVisibility = (): void => {
    if (!window) return;
    if (window.isVisible() && window.isFocused()) {
      window.hide();
      return;
    }
    focusWindow();
  };

  const setPinned = async (value: boolean): Promise<Result<void>> => {
    if (!window || !settings) return { ok: false, error: { code: 'WINDOW_UNAVAILABLE', message: 'The Referenzio window is not available.', action: 'retry-save' } };
    window.setAlwaysOnTop(value);
    settings = { ...settings, alwaysOnTop: value };
    return persistSettings();
  };

  return {
    createOrFocus,
    toggleVisibility,
    setPinned,
    minimize: () => window?.minimize(),
    requestClose,
    flushWindowState,
    getRuntimeStatus: (): RuntimeStatus => ({ alwaysOnTop: settings?.alwaysOnTop ?? false, shortcut }),
  };
}
