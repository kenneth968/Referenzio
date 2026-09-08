import { lstat, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Asset, ImportBatchResult, Result, UserError } from '../../shared/contracts';
import type { PersistenceService } from '../persistence';
import { imageTypeForPath, inspectImage, isWithinByteLimit, isWithinPixelLimit, type ImageInspection, type ImageType } from './image-inspector';

type ClipboardImage = {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  toPNG(): Uint8Array;
};

export type AssetClipboard = { captureImage(): Promise<ClipboardImage | undefined> };
export type AssetPersistence = Pick<PersistenceService, 'writeAsset' | 'assetPath'>;
export type AssetService = {
  pasteClipboardImage(): Promise<Result<Asset>>;
  importDroppedImages(paths: string[]): Promise<ImportBatchResult>;
};
export type AssetServiceDependencies = {
  persistence: AssetPersistence;
  clipboard: AssetClipboard;
  now?: () => Date;
  createId?: () => string;
};

const pngType: ImageType = { extension: 'png', format: 'png', mediaType: 'image/png', label: 'PNG' };
const errors = {
  clipboardEmpty: (): UserError => ({ code: 'CLIPBOARD_EMPTY', message: 'Copy an image, then paste it onto the canvas.', action: 'dismiss' }),
  clipboardInvalid: (): UserError => ({ code: 'CLIPBOARD_IMAGE_INVALID', message: 'The clipboard image could not be decoded.', action: 'dismiss' }),
  clipboardTooLarge: (): UserError => ({ code: 'IMAGE_TOO_LARGE', message: 'The image exceeds the 40,000,000-pixel import limit.', action: 'dismiss' }),
  write: (): UserError => ({ code: 'ASSET_WRITE_FAILED', message: 'The image could not be saved to the library.', action: 'retry-save' }),
};

function rejection(sourceName: string, code: string, message: string) {
  return { sourceName, code, message };
}

function inspectionRejection(sourceName: string, type: ImageType, result: Extract<ImageInspection, { ok: false }>) {
  switch (result.code) {
    case 'TYPE_MISMATCH': return rejection(sourceName, result.code, 'The file extension does not match its image data.');
    case 'IMAGE_TOO_LARGE': return rejection(sourceName, result.code, 'The image exceeds the 40,000,000-pixel import limit.');
    default: return rejection(sourceName, result.code, `The file is not a valid ${type.label} image.`);
  }
}

function asAsset(id: string, type: ImageType, dimensions: { width: number; height: number }, byteSize: number, now: () => Date): Asset {
  return {
    id,
    filename: `${id}.${type.extension}`,
    mediaType: type.mediaType,
    pixelWidth: dimensions.width,
    pixelHeight: dimensions.height,
    byteSize,
    importedAt: now().toISOString(),
  };
}

export function createAssetService({ persistence, clipboard, now = () => new Date(), createId = randomUUID }: AssetServiceDependencies): AssetService {
  let queue: Promise<void> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };

  const writeInspectedAsset = async (bytes: Uint8Array, type: ImageType, inspection: Extract<ImageInspection, { ok: true }>): Promise<Result<Asset>> => {
    const asset = asAsset(createId(), type, inspection, bytes.byteLength, now);
    try {
      const saved = await persistence.writeAsset(asset.filename, bytes);
      return saved.ok ? { ok: true, value: asset } : { ok: false, error: errors.write() };
    } catch {
      return { ok: false, error: errors.write() };
    }
  };

  const importOne = async (path: string): Promise<{ asset?: Asset; rejected?: ImportBatchResult['rejected'][number] }> => {
    const sourceName = basename(path);
    try {
      const stats = await lstat(path);
      if (!stats.isFile()) return { rejected: rejection(sourceName, 'FILE_UNREADABLE', 'The file could not be read.') };
      const type = imageTypeForPath(path);
      if (!type) return { rejected: rejection(sourceName, 'UNSUPPORTED_FORMAT', 'Only PNG, JPEG, and WebP images can be imported.') };
      if (!isWithinByteLimit(stats.size)) return { rejected: rejection(sourceName, 'FILE_TOO_LARGE', 'The file is larger than the 100 MiB import limit.') };
      const bytes = await readFile(path);
      if (!isWithinByteLimit(bytes.byteLength)) return { rejected: rejection(sourceName, 'FILE_TOO_LARGE', 'The file is larger than the 100 MiB import limit.') };
      const inspected = await inspectImage(bytes, type);
      if (!inspected.ok) return { rejected: inspectionRejection(sourceName, type, inspected) };
      const stored = await writeInspectedAsset(bytes, type, inspected);
      return stored.ok ? { asset: stored.value } : { rejected: rejection(sourceName, 'ASSET_WRITE_FAILED', 'The image could not be saved to the library.') };
    } catch {
      return { rejected: rejection(sourceName, 'FILE_UNREADABLE', 'The file could not be read.') };
    }
  };

  return {
    async pasteClipboardImage() {
      let image: ClipboardImage | undefined;
      try {
        image = await clipboard.captureImage();
      } catch {
        return { ok: false, error: errors.clipboardInvalid() };
      }
      if (!image || image.isEmpty()) return { ok: false, error: errors.clipboardEmpty() };
      const size = image.getSize();
      if (!isWithinPixelLimit(size.width, size.height)) return { ok: false, error: errors.clipboardTooLarge() };
      const bytes = image.toPNG();
      if (!isWithinByteLimit(bytes.byteLength)) return { ok: false, error: errors.clipboardTooLarge() };
      return enqueue(async () => {
        const inspected = await inspectImage(bytes, pngType);
        if (!inspected.ok) return { ok: false, error: inspected.code === 'IMAGE_TOO_LARGE' ? errors.clipboardTooLarge() : errors.clipboardInvalid() };
        return writeInspectedAsset(bytes, pngType, inspected);
      });
    },
    importDroppedImages(paths) {
      return enqueue(async () => {
        const result: ImportBatchResult = { imported: [], rejected: [] };
        for (const path of paths) {
          const outcome = await importOne(path);
          if (outcome.asset) result.imported.push(outcome.asset);
          if (outcome.rejected) result.rejected.push(outcome.rejected);
        }
        return result;
      });
    },
  };
}
