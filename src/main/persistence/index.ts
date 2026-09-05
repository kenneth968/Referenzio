import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { BoardDocument, LoadBoardResult, Result, WindowSettings } from '../../shared/contracts';
import { writeDurableBytes } from './atomic-file';
import { BoardStore } from './board-store';
import { createPersistencePaths, isAssetFilename } from './paths';
import { SettingsStore } from './settings-store';

export type PersistenceService = {
  libraryRoot: string;
  initialize(): Promise<void>;
  loadBoard(): Promise<LoadBoardResult>;
  saveBoard(document: BoardDocument): Promise<Result<{ revision: number }>>;
  loadSettings(): Promise<WindowSettings>;
  saveSettings(settings: WindowSettings): Promise<Result<void>>;
  writeAsset(filename: string, bytes: Uint8Array): Promise<Result<void>>;
  flush(): Promise<Result<void>>;
  assetPath(filename: string): string;
};

export function createPersistenceService({ libraryRoot, now = () => new Date() }: { libraryRoot: string; now?: () => Date }): PersistenceService {
  const paths = createPersistencePaths(libraryRoot);
  let initialization: Promise<void> | undefined;

  const initialize = (): Promise<void> => {
    if (initialization) return initialization;
    initialization = Promise.all([
      mkdir(paths.libraryRoot, { recursive: true }),
      mkdir(paths.assetsDirectory, { recursive: true }),
    ]).then(() => undefined).catch((error) => {
      initialization = undefined;
      throw error;
    });
    return initialization;
  };
  const boards = new BoardStore(paths, now, initialize);
  const settings = new SettingsStore(paths);
  const assetPath = (filename: string): string => {
    if (!isAssetFilename(filename)) throw new Error('Asset filename must be a canonical UUID followed by .png, .jpg, or .webp.');
    return join(paths.assetsDirectory, filename);
  };

  return {
    libraryRoot: paths.libraryRoot,
    initialize,
    async loadBoard() {
      await initialize();
      return boards.load();
    },
    saveBoard: (document) => boards.save(document),
    async loadSettings() {
      await initialize();
      return settings.load();
    },
    async saveSettings(value) {
      try {
        await initialize();
        return await settings.save(value);
      } catch {
        return { ok: false, error: { code: 'SETTINGS_SAVE_FAILED', message: 'The window settings could not be saved.', action: 'retry-save' } };
      }
    },
    async writeAsset(filename, bytes) {
      if (!isAssetFilename(filename)) {
        return { ok: false, error: { code: 'ASSET_INVALID', message: 'The asset filename is invalid and was not saved.', action: 'dismiss' } };
      }
      try {
        await initialize();
        await writeDurableBytes(assetPath(filename), bytes);
        return { ok: true, value: undefined };
      } catch {
        return { ok: false, error: { code: 'ASSET_SAVE_FAILED', message: 'The asset could not be saved.', action: 'retry-save' } };
      }
    },
    flush: () => boards.flush(),
    assetPath,
  };
}
