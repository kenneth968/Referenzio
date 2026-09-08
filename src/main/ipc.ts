import { randomUUID } from 'node:crypto';
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import {
  DropRequestSchema,
  FlushResponseSchema,
  PasteRequestSchema,
  SaveBoardRequestSchema,
  SetPinnedRequestSchema,
  type LoadBoardResult,
  type Result,
} from '../shared/contracts';
import type { AssetService } from './assets';
import type { PersistenceService } from './persistence';
import type { WindowController } from './window/controller';

type IpcMainLike = Pick<IpcMain, 'handle' | 'on'>;
type RendererWindow = { webContents: Pick<WebContents, 'send'> };

export type IpcHandlerDependencies = {
  ipcMain: IpcMainLike;
  persistence: Pick<PersistenceService, 'libraryRoot' | 'loadBoard' | 'saveBoard'>;
  assets: Pick<AssetService, 'pasteClipboardImage' | 'importDroppedImages'>;
  controller: Pick<WindowController, 'getRuntimeStatus' | 'setPinned' | 'minimize' | 'requestClose'>;
  shell: { openPath(path: string): Promise<string> };
  /** The exact renderer URL. Development URLs match their Vite origin. */
  rendererUrl?: string;
};

type FlushCoordinatorDependencies = {
  token?: () => string;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
};

const requestInvalid = (): Result<never> => ({
  ok: false,
  error: { code: 'REQUEST_INVALID', message: 'The request is invalid.', action: 'dismiss' },
});

const untrustedSender = (): Result<never> => ({
  ok: false,
  error: { code: 'UNTRUSTED_SENDER', message: 'The request was not sent by the Referenzio window.', action: 'dismiss' },
});

type ServiceFailureAction = 'retry-load' | 'retry-save';

const serviceFailure = (action: ServiceFailureAction = 'retry-save'): Result<never> => ({
  ok: false,
  error: { code: 'SERVICE_FAILED', message: 'The request could not be completed.', action },
});

const flushTimeout = (): Result<void> => ({
  ok: false,
  error: { code: 'RENDERER_FLUSH_TIMEOUT', message: 'Saving the canvas before closing timed out.', action: 'retry-close' },
});

const flushUnavailable = (): Result<void> => ({
  ok: false,
  error: { code: 'RENDERER_UNAVAILABLE', message: 'The Referenzio window is not available.', action: 'retry-close' },
});

function isTrustedRenderer(event: Pick<IpcMainInvokeEvent, 'senderFrame'>, rendererUrl?: string): boolean {
  const senderUrl = event.senderFrame?.url;
  if (!senderUrl) return false;
  try {
    const sender = new URL(senderUrl);
    if (!rendererUrl) return sender.protocol === 'file:';
    const expected = new URL(rendererUrl);
    return expected.protocol === 'file:' ? sender.href === expected.href : sender.origin === expected.origin;
  } catch {
    return false;
  }
}

function registerHandler<Input, Output>(
  ipcMain: IpcMainLike,
  channel: string,
  schema: { safeParse(value: unknown): { success: true; data: Input } | { success: false } },
  rendererUrl: string | undefined,
  operation: (input: Input) => Promise<Result<Output>> | Result<Output>,
  failureAction: ServiceFailureAction = 'retry-save',
): void {
  ipcMain.handle(channel, async (event, payload): Promise<Result<Output>> => {
    if (!isTrustedRenderer(event, rendererUrl)) return untrustedSender();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return requestInvalid();
    try {
      return await operation(parsed.data);
    } catch {
      return serviceFailure(failureAction);
    }
  });
}

/** Registers the entire renderer-facing capability surface in one place. */
export function registerIpcHandlers(dependencies: IpcHandlerDependencies): void {
  const { ipcMain, persistence, assets, controller, shell, rendererUrl } = dependencies;
  let boardLoadInFlight: Promise<LoadBoardResult> | undefined;

  registerHandler(ipcMain, 'board:load', PasteRequestSchema, rendererUrl, async () => {
    const load = boardLoadInFlight ?? (boardLoadInFlight = persistence.loadBoard().finally(() => { boardLoadInFlight = undefined; }));
    const value: LoadBoardResult = await load;
    return { ok: true, value };
  }, 'retry-load');
  registerHandler(ipcMain, 'app:runtime-status', PasteRequestSchema, rendererUrl, () => ({
    ok: true,
    value: controller.getRuntimeStatus(),
  }));
  registerHandler(ipcMain, 'clipboard:paste', PasteRequestSchema, rendererUrl, () => assets.pasteClipboardImage());
  registerHandler(ipcMain, 'assets:import-drop', DropRequestSchema, rendererUrl, async (paths) => ({
    ok: true,
    value: await assets.importDroppedImages(paths),
  }));
  registerHandler(ipcMain, 'board:save', SaveBoardRequestSchema, rendererUrl, (document) => persistence.saveBoard(document));
  registerHandler(ipcMain, 'window:set-pinned', SetPinnedRequestSchema, rendererUrl, ({ value }) => controller.setPinned(value));
  registerHandler(ipcMain, 'shell:open-library', PasteRequestSchema, rendererUrl, async () => {
    const error = await shell.openPath(persistence.libraryRoot);
    return error
      ? { ok: false, error: { code: 'OPEN_LIBRARY_FAILED', message: 'The Referenzio library folder could not be opened.', action: 'retry-open-library' } }
      : { ok: true, value: undefined };
  });
  registerHandler(ipcMain, 'window:minimize', PasteRequestSchema, rendererUrl, () => {
    controller.minimize();
    return { ok: true, value: undefined };
  });
  registerHandler(ipcMain, 'window:close', PasteRequestSchema, rendererUrl, () => controller.requestClose());
}

/** Coordinates a durable renderer save before the window controller destroys a window. */
export function createRendererFlushCoordinator(
  ipcMain: IpcMainLike,
  getWindow: () => RendererWindow | undefined,
  dependencies: FlushCoordinatorDependencies = {},
): () => Promise<Result<void>> {
  const createToken = dependencies.token ?? randomUUID;
  const schedule = dependencies.setTimeout ?? setTimeout;
  const cancel = dependencies.clearTimeout ?? clearTimeout;
  const pending = new Map<string, {
    sender: unknown;
    resolve: (result: Result<void>) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  ipcMain.on('app:flush-response', (event, payload) => {
    const parsed = FlushResponseSchema.safeParse(payload);
    if (!parsed.success) return;
    const entry = pending.get(parsed.data.token);
    if (!entry || event.sender !== entry.sender) return;
    pending.delete(parsed.data.token);
    cancel(entry.timeout);
    entry.resolve(parsed.data.result.ok
      ? { ok: true, value: undefined }
      : { ok: false, error: parsed.data.result.error });
  });

  return () => new Promise<Result<void>>((resolve) => {
    const window = getWindow();
    if (!window) {
      resolve(flushUnavailable());
      return;
    }
    const token = createToken();
    const sender = window.webContents;
    const timeout = schedule(() => {
      if (!pending.delete(token)) return;
      resolve(flushTimeout());
    }, 5_000);
    pending.set(token, { sender, resolve, timeout });
    try {
      window.webContents.send('app:flush-request', token);
    } catch {
      pending.delete(token);
      cancel(timeout);
      resolve(flushUnavailable());
    }
  });
}
