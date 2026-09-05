import { join } from 'node:path';

export type PersistencePaths = {
  libraryRoot: string;
  assetsDirectory: string;
  board: string;
  backup: string;
  settings: string;
};

export function createPersistencePaths(libraryRoot: string): PersistencePaths {
  return {
    libraryRoot,
    assetsDirectory: join(libraryRoot, 'assets'),
    board: join(libraryRoot, 'board.json'),
    backup: join(libraryRoot, 'board.backup.json'),
    settings: join(libraryRoot, 'settings.json'),
  };
}

export const AssetFilenamePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|webp)$/;

export function isAssetFilename(filename: string): boolean {
  return AssetFilenamePattern.test(filename);
}
