import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { z } from 'zod';
import {
  AssetSchema,
  FlushRequestSchema,
  ImportBatchResultSchema,
  LoadBoardResultSchema,
  MainErrorEventSchema,
  ResultSchema,
  RevisionSchema,
  RuntimeStatusSchema,
  ShortcutStatusEventSchema,
  type Asset,
  type BoardDocument,
  type ImportBatchResult,
  type ImportRejection,
  type LoadBoardResult,
  type Result,
  type RuntimeStatus,
  type ShortcutStatus,
  type UserError,
} from '../shared/contracts';

const transportFailure = <T>(): Result<T> => ({
  ok: false,
  error: { code: 'IPC_TRANSPORT_FAILED', message: 'The Referenzio window could not complete the request.', action: 'retry-save' },
});

async function invoke<T>(channel: string, schema: { safeParse(value: unknown): { success: true; data: Result<T> } | { success: false } }, ...args: unknown[]): Promise<Result<T>> {
  try {
    const parsed = schema.safeParse(await ipcRenderer.invoke(channel, ...args));
    return parsed.success ? parsed.data : transportFailure<T>();
  } catch {
    return transportFailure<T>();
  }
}

const voidResultSchema = ResultSchema(z.void());

const api = {
  loadBoard: (): Promise<Result<LoadBoardResult>> => invoke('board:load', ResultSchema(LoadBoardResultSchema)),
  getRuntimeStatus: (): Promise<Result<RuntimeStatus>> => invoke('app:runtime-status', ResultSchema(RuntimeStatusSchema)),
  pasteClipboardImage: (): Promise<Result<Asset>> => invoke('clipboard:paste', ResultSchema(AssetSchema)),
  importDroppedImages: async (files: File[]): Promise<Result<ImportBatchResult>> => {
    const paths: string[] = [];
    const rejected: ImportRejection[] = [];
    for (const file of files) {
      try {
        const path = webUtils.getPathForFile(file);
        if (!path) throw new Error('not a local file');
        paths.push(path);
      } catch {
        rejected.push({ sourceName: file.name, code: 'FILE_UNREADABLE', message: 'Drop a local PNG, JPEG, or WebP file from Explorer.' });
      }
    }
    if (!paths.length) return { ok: true, value: { imported: [], rejected } };
    const result = await invoke('assets:import-drop', ResultSchema(ImportBatchResultSchema), paths);
    if (!result.ok) return result;
    return { ok: true, value: { imported: result.value.imported, rejected: [...rejected, ...result.value.rejected] } };
  },
  saveBoard: (document: BoardDocument): Promise<Result<{ revision: number }>> => invoke('board:save', ResultSchema(RevisionSchema), document),
  setPinned: (value: boolean): Promise<Result<void>> => invoke('window:set-pinned', voidResultSchema, { value }),
  openLibraryFolder: (): Promise<Result<void>> => invoke('shell:open-library', voidResultSchema),
  minimizeWindow: (): Promise<Result<void>> => invoke('window:minimize', voidResultSchema),
  closeWindow: (): Promise<Result<void>> => invoke('window:close', voidResultSchema),
  onShortcutStatus: (listener: (status: ShortcutStatus) => void): (() => void) => {
    const callback = (_: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = ShortcutStatusEventSchema.safeParse(value);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on('app:shortcut-status', callback);
    return () => ipcRenderer.removeListener('app:shortcut-status', callback);
  },
  onMainError: (listener: (error: UserError) => void): (() => void) => {
    const callback = (_: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = MainErrorEventSchema.safeParse(value);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on('app:error', callback);
    return () => ipcRenderer.removeListener('app:error', callback);
  },
  onFlushRequest: (listener: () => Promise<Result<{ revision: number }>>): (() => void) => {
    const callback = async (_: Electron.IpcRendererEvent, value: unknown) => {
      const token = FlushRequestSchema.safeParse(value);
      if (!token.success) return;
      let result: Result<{ revision: number }>;
      try {
        result = await listener();
      } catch {
        result = transportFailure<{ revision: number }>();
      }
      const validated = ResultSchema(RevisionSchema).safeParse(result);
      ipcRenderer.send('app:flush-response', { token: token.data, result: validated.success ? validated.data : transportFailure<{ revision: number }>() });
    };
    ipcRenderer.on('app:flush-request', callback);
    return () => ipcRenderer.removeListener('app:flush-request', callback);
  },
};

contextBridge.exposeInMainWorld('referenzio', api);
