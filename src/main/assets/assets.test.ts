import { cp, lstat, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MAX_IMPORT_BYTES, MAX_IMPORT_PIXELS, type Result } from '../../shared/contracts';
import { createAssetService as createAssetServiceImpl, type AssetServiceDependencies } from './asset-service';
import { isWithinByteLimit, isWithinPixelLimit } from './image-inspector';

let png = Buffer.alloc(0);
const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];
type MemoryPersistence = { writeAsset: ReturnType<typeof vi.fn>; assetPath(filename: string): string };
let root = '';
let fixture = (name: string) => join(root, name);

function createAssetService(dependencies: Omit<AssetServiceDependencies, 'persistence'> & { persistence: MemoryPersistence }) {
  return createAssetServiceImpl({ ...dependencies, persistence: dependencies.persistence as never });
}

function persistence(): MemoryPersistence {
  const assets = join(root, 'owned');
  return {
    writeAsset: vi.fn(async (filename: string, bytes: Uint8Array): Promise<Result<void>> => {
      await writeFile(join(assets, filename), bytes);
      return { ok: true, value: undefined };
    }),
    assetPath: (filename) => join(assets, filename),
  };
}

function clipboard(buffer: Buffer | undefined) {
  return { readImage: () => ({ isEmpty: () => buffer === undefined, getSize: () => ({ width: 1, height: 1 }), toPNG: () => buffer ?? Buffer.alloc(0) }) };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'referenzio-assets-'));
  png = await sharp({ create: { width: 1, height: 1, channels: 4, background: 'red' } }).png().toBuffer();
  await writeFile(fixture('one-pixel.png'), png);
  await writeFile(fixture('not-an-image.png'), 'not an image');
  await sharp({ create: { width: 2, height: 1, channels: 3, background: 'red' } }).jpeg().toFile(fixture('small.jpg'));
  await sharp({ create: { width: 2, height: 1, channels: 4, background: 'red' } }).webp().toFile(fixture('small.webp'));
  await writeFile(fixture('truncated.png'), png.subarray(0, 20));
  await mkdir(fixture('owned'));
  await mkdir(fixture('owned.png'));
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('asset service', () => {
  it('copies a verified PNG before reporting it as imported', async () => {
    const store = persistence();
    const assets = createAssetService({ persistence: store, clipboard: clipboard(undefined), now: () => new Date('2026-09-05T12:00:00.000Z'), createId: () => ids[0] });
    const result = await assets.importDroppedImages([fixture('one-pixel.png')]);
    expect(result.imported).toHaveLength(1);
    const asset = result.imported[0];
    await expect(readFile(store.assetPath(asset.filename))).resolves.toEqual(await readFile(fixture('one-pixel.png')));
    expect(asset).toMatchObject({ id: ids[0], filename: `${ids[0]}.png`, mediaType: 'image/png', pixelWidth: 1, pixelHeight: 1 });
  });

  it('allows a good file beside a rejected one', async () => {
    const assets = createAssetService({ persistence: persistence(), clipboard: clipboard(undefined), createId: () => ids[0] });
    const result = await assets.importDroppedImages([fixture('one-pixel.png'), fixture('not-an-image.png')]);
    expect(result.imported).toHaveLength(1);
    expect(result.rejected).toEqual([{ sourceName: 'not-an-image.png', code: 'DECODE_FAILED', message: 'The file is not a valid PNG image.' }]);
  });

  it('imports verified JPEG and WebP without changing their original bytes', async () => {
    let next = 0;
    const store = persistence();
    const assets = createAssetService({ persistence: store, clipboard: clipboard(undefined), createId: () => ids[next++] });
    const result = await assets.importDroppedImages([fixture('small.jpg'), fixture('small.webp')]);
    expect(result.imported.map(({ mediaType, filename }) => [mediaType, filename])).toEqual([['image/jpeg', `${ids[0]}.jpg`], ['image/webp', `${ids[1]}.webp`]]);
    await expect(readFile(store.assetPath(`${ids[0]}.jpg`))).resolves.toEqual(await readFile(fixture('small.jpg')));
  });

  it('rejects an empty clipboard', async () => {
    const assets = createAssetService({ persistence: persistence(), clipboard: clipboard(undefined), createId: () => ids[0] });
    await expect(assets.pasteClipboardImage()).resolves.toEqual({ ok: false, error: { code: 'CLIPBOARD_EMPTY', message: 'Copy an image, then paste it onto the canvas.', action: 'dismiss' } });
  });

  it('durably imports the clipboard PNG', async () => {
    const store = persistence();
    const assets = createAssetService({ persistence: store, clipboard: clipboard(png), createId: () => ids[0] });
    const result = await assets.pasteClipboardImage();
    expect(result).toMatchObject({ ok: true, value: { filename: `${ids[0]}.png`, mediaType: 'image/png', pixelWidth: 1, pixelHeight: 1 } });
    await expect(readFile(store.assetPath(`${ids[0]}.png`))).resolves.toEqual(png);
  });

  it('does not write corrupt image payloads', async () => {
    const store = persistence();
    const assets = createAssetService({ persistence: store, clipboard: clipboard(undefined), createId: () => ids[0] });
    const result = await assets.importDroppedImages([fixture('truncated.png')]);
    expect(result.rejected).toEqual([{ sourceName: 'truncated.png', code: 'DECODE_FAILED', message: 'The file is not a valid PNG image.' }]);
    expect(store.writeAsset).not.toHaveBeenCalled();
  });

  it('rejects a claimed extension that differs from the decoded image', async () => {
    await cp(fixture('one-pixel.png'), fixture('actually-png.jpg'));
    const assets = createAssetService({ persistence: persistence(), clipboard: clipboard(undefined), createId: () => ids[0] });
    await expect(assets.importDroppedImages([fixture('actually-png.jpg')])).resolves.toMatchObject({ rejected: [{ code: 'TYPE_MISMATCH' }] });
  });

  it('rejects a destination write failure without returning an asset', async () => {
    const store = persistence();
    store.writeAsset.mockResolvedValueOnce({ ok: false, error: { code: 'ASSET_SAVE_FAILED', message: 'nope', action: 'retry-save' } });
    const assets = createAssetService({ persistence: store, clipboard: clipboard(png), createId: () => ids[0] });
    await expect(assets.pasteClipboardImage()).resolves.toMatchObject({ ok: false, error: { code: 'ASSET_WRITE_FAILED' } });
  });

  it('keeps imported bytes readable after the source file is deleted', async () => {
    const store = persistence();
    const source = fixture('remove-after-import.png');
    await cp(fixture('one-pixel.png'), source);
    const assets = createAssetService({ persistence: store, clipboard: clipboard(undefined), createId: () => ids[0] });
    const result = await assets.importDroppedImages([source]);
    await rm(source);
    await expect(readFile(store.assetPath(result.imported[0].filename))).resolves.toEqual(png);
  });

  it('declares the documented size and pixel boundaries', async () => {
    expect(MAX_IMPORT_BYTES).toBe(104_857_600);
    expect(MAX_IMPORT_PIXELS).toBe(40_000_000);
    expect(isWithinByteLimit(MAX_IMPORT_BYTES)).toBe(true);
    expect(isWithinByteLimit(MAX_IMPORT_BYTES + 1)).toBe(false);
    expect(isWithinPixelLimit(8_000, 5_000)).toBe(true);
    expect(isWithinPixelLimit(8_000, 5_001)).toBe(false);
    await expect(lstat(fixture('not-an-image.png'))).resolves.toMatchObject({ isFile: expect.any(Function) });
  });

  it('rejects directories without attempting an image write', async () => {
    const store = persistence();
    const assets = createAssetService({ persistence: store, clipboard: clipboard(undefined), createId: () => ids[0] });
    await expect(assets.importDroppedImages([fixture('owned.png')])).resolves.toEqual({
      imported: [], rejected: [{ sourceName: 'owned.png', code: 'FILE_UNREADABLE', message: 'The file could not be read.' }],
    });
    expect(store.writeAsset).not.toHaveBeenCalled();
  });

  it('serializes overlapping imports so only one durable write is active', async () => {
    const store = persistence();
    let releaseFirst: (() => void) | undefined;
    store.writeAsset.mockImplementationOnce(() => new Promise<Result<void>>((resolve) => { releaseFirst = () => resolve({ ok: true, value: undefined }); }));
    const assets = createAssetService({ persistence: store, clipboard: clipboard(undefined), createId: () => ids[0] });
    const first = assets.importDroppedImages([fixture('one-pixel.png')]);
    const second = assets.importDroppedImages([fixture('one-pixel.png')]);
    await vi.waitFor(() => expect(store.writeAsset).toHaveBeenCalledTimes(1));
    expect(releaseFirst).toBeTypeOf('function');
    releaseFirst?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ imported: [expect.objectContaining({ filename: `${ids[0]}.png` })] }),
      expect.objectContaining({ imported: [expect.objectContaining({ filename: `${ids[0]}.png` })] }),
    ]);
  });

  it('captures a clipboard bitmap before waiting for an occupied import queue', async () => {
    const store = persistence();
    let releaseFirst: (() => void) | undefined;
    store.writeAsset.mockImplementationOnce(() => new Promise<Result<void>>((resolve) => { releaseFirst = () => resolve({ ok: true, value: undefined }); }));
    let captured = png;
    const nativeClipboard = { readImage: () => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toPNG: () => captured }) };
    let next = 0;
    const assets = createAssetService({ persistence: store, clipboard: nativeClipboard, createId: () => ids[next++] });
    const heldImport = assets.importDroppedImages([fixture('one-pixel.png')]);
    await vi.waitFor(() => expect(store.writeAsset).toHaveBeenCalledTimes(1));
    const paste = assets.pasteClipboardImage();
    captured = await sharp({ create: { width: 1, height: 1, channels: 4, background: 'blue' } }).png().toBuffer();
    releaseFirst?.();
    await heldImport;
    const result = await paste;
    if (!result.ok) throw new Error('clipboard paste should succeed');
    await expect(readFile(store.assetPath(result.value.filename))).resolves.toEqual(png);
  });
});
